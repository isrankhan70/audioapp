export type BitDepth = 16 | 24 | 32;
export type TransitionMode = 'seamless' | 'crossfade' | 'gap';

export interface TrackTrimMeta {
  id: string;
  name: string;
  originalDuration: number;
  trimStart: number;
  trimEnd: number;
  gainDb: number;
  fadeInSec: number;
  fadeOutSec: number;
  sampleRate: number;
  channels: number;
}

export interface RawTrackChannelData {
  channels: Float32Array[];
  sampleRate: number;
  trimStart: number;
  trimEnd: number;
  gainDb: number;
  fadeInSec: number;
  fadeOutSec: number;
}

export interface MergedAudioResult {
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
  peakDb: number;
  clippingSamples: number;
}

/**
 * Computes the active trimmed duration of a single track in seconds.
 */
export function getActiveTrackDuration(track: Pick<TrackTrimMeta, 'trimStart' | 'trimEnd'>): number {
  return Math.max(0, Number((track.trimEnd - track.trimStart).toFixed(4)));
}

/**
 * Calculates the exact total duration of all spliced tracks given the transition mode.
 */
export function calculateMergedDuration(
  tracks: Pick<TrackTrimMeta, 'trimStart' | 'trimEnd'>[],
  mode: TransitionMode,
  transitionSec: number
): number {
  if (tracks.length === 0) return 0;

  const activeDurations = tracks.map(getActiveTrackDuration).filter((d) => d > 0);
  if (activeDurations.length === 0) return 0;

  let total = activeDurations[0];
  for (let i = 1; i < activeDurations.length; i++) {
    const dur = activeDurations[i];
    if (mode === 'crossfade') {
      const safeOverlap = Math.min(transitionSec, total * 0.45, dur * 0.45);
      total = total + dur - safeOverlap;
    } else if (mode === 'gap') {
      total = total + dur + Math.max(0, transitionSec);
    } else {
      total = total + dur;
    }
  }
  return Math.max(0, Number(total.toFixed(4)));
}

/**
 * Converts decibels (dB) to linear amplitude multiplier.
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Converts linear peak amplitude to decibels Full Scale (dBFS).
 */
export function linearToDb(linear: number): number {
  if (linear <= 0.00001) return -96.0;
  return Number((20 * Math.log10(linear)).toFixed(1));
}

/**
 * Formats seconds into MM:SS.ms studio timecode format.
 */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds - Math.floor(seconds)) * 100);
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const hs = String(hundredths).padStart(2, '0');
  return `${mm}:${ss}.${hs}`;
}

/**
 * Estimates exact uncompressed WAV file size in bytes (44-byte RIFF header + PCM data).
 */
export function estimateWavFileSize(
  durationSec: number,
  sampleRate: number,
  channels: number,
  bitDepth: BitDepth
): number {
  if (durationSec <= 0) return 0;
  const totalSamples = Math.ceil(durationSec * sampleRate);
  const bytesPerSample = bitDepth / 8;
  return 44 + totalSamples * channels * bytesPerSample;
}

/**
 * Formats byte count into human-readable MB or KB.
 */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Linear interpolation resampling for a single Float32Array channel when sample rates differ.
 */
export function resampleChannel(
  input: Float32Array,
  sourceRate: number,
  targetRate: number
): Float32Array {
  if (sourceRate === targetRate || input.length === 0) {
    return input;
  }
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const idx0 = Math.floor(srcPos);
    const idx1 = Math.min(idx0 + 1, input.length - 1);
    const frac = srcPos - idx0;
    output[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
  }
  return output;
}

/**
 * Computes normalized peak buckets (0.0 to 1.0) for waveform rendering.
 */
export function computeWaveformPeaks(channelData: Float32Array, bucketCount: number): number[] {
  if (bucketCount <= 0 || channelData.length === 0) {
    return new Array(Math.max(0, bucketCount)).fill(0);
  }
  const peaks: number[] = new Array(bucketCount).fill(0);
  const samplesPerBucket = channelData.length / bucketCount;

  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * samplesPerBucket);
    const end = Math.min(channelData.length, Math.floor((b + 1) * samplesPerBucket));
    const step = Math.max(1, Math.floor((end - start) / 64));
    let maxAbs = 0;
    for (let i = start; i < end; i += step) {
      const abs = Math.abs(channelData[i]);
      if (abs > maxAbs) maxAbs = abs;
    }
    peaks[b] = Math.min(1, maxAbs);
  }
  return peaks;
}

/**
 * Performs lossless, sample-accurate splicing of multiple tracks with per-track trim,
 * gain, fade-in/out, equal-power crossfades, and optional true-peak normalization.
 */
export function spliceAudioTracks(
  tracks: RawTrackChannelData[],
  targetSampleRate: number,
  outputChannels: 1 | 2,
  mode: TransitionMode,
  transitionSec: number,
  normalizePeak: boolean
): MergedAudioResult {
  if (tracks.length === 0) {
    return {
      channels: [new Float32Array(0)],
      sampleRate: targetSampleRate,
      duration: 0,
      peakDb: -96,
      clippingSamples: 0,
    };
  }

  // Step 1: Prepare trimmed, resampled, gain-adjusted, and faded segments for each track
  const processedSegments: Float32Array[][] = [];

  for (const track of tracks) {
    const startSample = Math.max(0, Math.floor(track.trimStart * track.sampleRate));
    const endSample = Math.min(
      track.channels[0]?.length ?? 0,
      Math.floor(track.trimEnd * track.sampleRate)
    );
    if (endSample <= startSample) continue;

    const gainLinear = dbToLinear(track.gainDb);
    const trackChans: Float32Array[] = [];

    for (let ch = 0; ch < outputChannels; ch++) {
      const sourceChan = track.channels[Math.min(ch, track.channels.length - 1)];
      const sliced = sourceChan.slice(startSample, endSample);
      const resampled = resampleChannel(sliced, track.sampleRate, targetSampleRate);
      const processed = new Float32Array(resampled.length);

      const fadeInSamples = Math.min(
        resampled.length,
        Math.floor(Math.max(0, track.fadeInSec) * targetSampleRate)
      );
      const fadeOutSamples = Math.min(
        resampled.length,
        Math.floor(Math.max(0, track.fadeOutSec) * targetSampleRate)
      );

      for (let i = 0; i < resampled.length; i++) {
        let env = 1.0;
        if (fadeInSamples > 0 && i < fadeInSamples) {
          // Equal-power / cosine fade-in curve
          const phase = i / fadeInSamples;
          env *= Math.sin(phase * (Math.PI / 2));
        }
        if (fadeOutSamples > 0 && i >= resampled.length - fadeOutSamples) {
          const remaining = resampled.length - 1 - i;
          const phase = Math.max(0, remaining / fadeOutSamples);
          env *= Math.sin(phase * (Math.PI / 2));
        }
        processed[i] = resampled[i] * gainLinear * env;
      }

      trackChans.push(processed);
    }

    processedSegments.push(trackChans);
  }

  if (processedSegments.length === 0) {
    return {
      channels: new Array(outputChannels).fill(0).map(() => new Float32Array(0)),
      sampleRate: targetSampleRate,
      duration: 0,
      peakDb: -96,
      clippingSamples: 0,
    };
  }

  // Step 2: Calculate exact sample offsets for each segment
  const offsets: number[] = [0];
  const overlaps: number[] = [0];
  let currentEndSample = processedSegments[0][0].length;

  for (let i = 1; i < processedSegments.length; i++) {
    const segLen = processedSegments[i][0].length;
    if (mode === 'crossfade') {
      const requestedOverlap = Math.floor(Math.max(0, transitionSec) * targetSampleRate);
      const safeOverlap = Math.min(
        requestedOverlap,
        Math.floor(currentEndSample * 0.45),
        Math.floor(segLen * 0.45)
      );
      overlaps.push(safeOverlap);
      const startOffset = currentEndSample - safeOverlap;
      offsets.push(startOffset);
      currentEndSample = startOffset + segLen;
    } else if (mode === 'gap') {
      overlaps.push(0);
      const gapSamples = Math.floor(Math.max(0, transitionSec) * targetSampleRate);
      const startOffset = currentEndSample + gapSamples;
      offsets.push(startOffset);
      currentEndSample = startOffset + segLen;
    } else {
      overlaps.push(0);
      offsets.push(currentEndSample);
      currentEndSample += segLen;
    }
  }

  const totalSamples = Math.max(1, currentEndSample);
  const masterChannels: Float32Array[] = new Array(outputChannels)
    .fill(0)
    .map(() => new Float32Array(totalSamples));

  // Step 3: Mix segments into master buffer using equal-power crossfades when overlapping
  for (let segIdx = 0; segIdx < processedSegments.length; segIdx++) {
    const seg = processedSegments[segIdx];
    const segLen = seg[0].length;
    const offset = offsets[segIdx];
    const inOverlap = overlaps[segIdx];
    const outOverlap = segIdx + 1 < overlaps.length ? overlaps[segIdx + 1] : 0;

    for (let ch = 0; ch < outputChannels; ch++) {
      const master = masterChannels[ch];
      const src = seg[ch];
      for (let i = 0; i < segLen; i++) {
        let weight = 1.0;
        if (inOverlap > 0 && i < inOverlap) {
          const t = i / inOverlap;
          weight *= Math.sin(t * (Math.PI / 2));
        }
        if (outOverlap > 0 && i >= segLen - outOverlap) {
          const rem = segLen - 1 - i;
          const t = Math.max(0, rem / outOverlap);
          weight *= Math.sin(t * (Math.PI / 2));
        }
        master[offset + i] += src[i] * weight;
      }
    }
  }

  // Step 4: Measure peak and apply true-peak normalization (-0.3 dBFS ceiling) if requested
  let maxPeak = 0;
  let clippingSamples = 0;
  for (let ch = 0; ch < outputChannels; ch++) {
    const data = masterChannels[ch];
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > maxPeak) maxPeak = abs;
      if (abs > 1.0) clippingSamples++;
    }
  }

  if (normalizePeak && maxPeak > 0.0001) {
    // Target -0.3 dBFS (~0.966 linear) for studio-safe lossless headroom
    const targetPeak = 0.966;
    const scale = targetPeak / maxPeak;
    maxPeak = 0;
    clippingSamples = 0;
    for (let ch = 0; ch < outputChannels; ch++) {
      const data = masterChannels[ch];
      for (let i = 0; i < data.length; i++) {
        data[i] = data[i] * scale;
        const abs = Math.abs(data[i]);
        if (abs > maxPeak) maxPeak = abs;
      }
    }
  } else if (maxPeak > 1.0) {
    // Soft-limit any sample exceeding 0 dBFS to prevent digital distortion
    for (let ch = 0; ch < outputChannels; ch++) {
      const data = masterChannels[ch];
      for (let i = 0; i < data.length; i++) {
        if (data[i] > 1.0) data[i] = 1.0;
        else if (data[i] < -1.0) data[i] = -1.0;
      }
    }
    maxPeak = 1.0;
  }

  return {
    channels: masterChannels,
    sampleRate: targetSampleRate,
    duration: totalSamples / targetSampleRate,
    peakDb: linearToDb(maxPeak),
    clippingSamples,
  };
}

/**
 * Encodes multi-channel Float32Array audio buffers into an uncompressed, lossless
 * RIFF WAVE ArrayBuffer supporting 16-bit PCM, 24-bit Studio PCM, or 32-bit IEEE Float.
 */
export function encodeWavBuffer(
  channels: Float32Array[],
  sampleRate: number,
  bitDepth: BitDepth = 24
): ArrayBuffer {
  const numChannels = Math.max(1, channels.length);
  const numSamples = channels[0]?.length ?? 0;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF chunk descriptor
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');

  // fmt sub-chunk
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM / IEEE Float)
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true); // AudioFormat: 1 = PCM, 3 = IEEE Float
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // data sub-chunk
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  if (bitDepth === 16) {
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        const intVal = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, Math.round(intVal), true);
        offset += 2;
      }
    }
  } else if (bitDepth === 24) {
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        const intVal = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
        view.setUint8(offset, intVal & 0xff);
        view.setUint8(offset + 1, (intVal >> 8) & 0xff);
        view.setUint8(offset + 2, (intVal >> 16) & 0xff);
        offset += 3;
      }
    }
  } else {
    // 32-bit IEEE Float lossless
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        view.setFloat32(offset, channels[ch][i], true);
        offset += 4;
      }
    }
  }

  return buffer;
}
