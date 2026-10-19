import { computeWaveformPeaks, linearToDb } from './audioMath';

export interface AudioTrackItem {
  id: string;
  name: string;
  formatLabel: string;
  fileSize: number;
  sampleRate: number;
  channels: Float32Array[];
  originalDuration: number;
  trimStart: number;
  trimEnd: number;
  gainDb: number;
  fadeInSec: number;
  fadeOutSec: number;
  peaks: number[];
  peakDb: number;
}

/**
 * Generates 3 studio-grade stereo demo tracks in memory (48 kHz) so users can test
 * lossless splicing, crossfading, trimming, and instant WAV export immediately.
 */
export function generateStudioDemoTracks(): AudioTrackItem[] {
  const sampleRate = 48000;

  // Track 1: Warm Electric Piano Chords (3.6 seconds)
  const dur1 = 3.6;
  const len1 = Math.floor(dur1 * sampleRate);
  const t1L = new Float32Array(len1);
  const t1R = new Float32Array(len1);
  const chord1 = [261.63, 329.63, 392.0, 493.88]; // Cmaj7
  const chord2 = [220.0, 261.63, 329.63, 392.0]; // Am7

  for (let i = 0; i < len1; i++) {
    const t = i / sampleRate;
    const activeChord = t < 1.8 ? chord1 : chord2;
    const localT = t < 1.8 ? t : t - 1.8;
    const env = Math.min(1, localT / 0.04) * Math.exp(-localT * 1.15);
    let sigL = 0;
    let sigR = 0;
    for (let c = 0; c < activeChord.length; c++) {
      const f = activeChord[c];
      const pan = c % 2 === 0 ? 0.85 : 0.55;
      const harmonic =
        Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2 * t);
      sigL += harmonic * pan;
      sigR += harmonic * (1.4 - pan);
    }
    t1L[i] = (sigL / activeChord.length) * env * 0.72;
    t1R[i] = (sigR / activeChord.length) * env * 0.72;
  }

  // Track 2: Rhythmic Synth Arpeggio & Warm Sub Bass (4.2 seconds)
  const dur2 = 4.2;
  const len2 = Math.floor(dur2 * sampleRate);
  const t2L = new Float32Array(len2);
  const t2R = new Float32Array(len2);
  const arpNotes = [293.66, 349.23, 440.0, 523.25, 440.0, 349.23]; // Dm7 arp

  for (let i = 0; i < len2; i++) {
    const t = i / sampleRate;
    const stepIdx = Math.floor(t / 0.35);
    const stepT = t % 0.35;
    const noteFreq = arpNotes[stepIdx % arpNotes.length];
    const pluckEnv = Math.min(1, stepT / 0.015) * Math.exp(-stepT * 6.5);
    const subBass =
      Math.sin(2 * Math.PI * 73.42 * t) * 0.45 * Math.min(1, (dur2 - t) / 0.25);
    const arpWave =
      (Math.sin(2 * Math.PI * noteFreq * t) +
        0.35 * Math.sin(2 * Math.PI * noteFreq * 3 * t)) *
      pluckEnv *
      0.48;
    const stereoSpread = Math.sin(2 * Math.PI * 1.5 * t) * 0.15;
    t2L[i] = Math.max(-0.95, Math.min(0.95, subBass + arpWave * (1 + stereoSpread)));
    t2R[i] = Math.max(-0.95, Math.min(0.95, subBass + arpWave * (1 - stereoSpread)));
  }

  // Track 3: Shimmering Ambient Pad Resolution (3.8 seconds)
  const dur3 = 3.8;
  const len3 = Math.floor(dur3 * sampleRate);
  const t3L = new Float32Array(len3);
  const t3R = new Float32Array(len3);
  const padNotes = [196.0, 293.66, 392.0, 493.88, 587.33]; // Gmaj9

  for (let i = 0; i < len3; i++) {
    const t = i / sampleRate;
    const swellEnv =
      Math.sin(Math.min(1, t / 0.9) * (Math.PI / 2)) *
      Math.min(1, Math.max(0, (dur3 - t) / 0.9));
    let padL = 0;
    let padR = 0;
    for (let n = 0; n < padNotes.length; n++) {
      const freq = padNotes[n];
      const detuneL = freq * 1.0015;
      const detuneR = freq * 0.9985;
      padL += Math.sin(2 * Math.PI * detuneL * t);
      padR += Math.sin(2 * Math.PI * detuneR * t);
    }
    t3L[i] = (padL / padNotes.length) * swellEnv * 0.78;
    t3R[i] = (padR / padNotes.length) * swellEnv * 0.78;
  }

  const buildTrack = (
    id: string,
    name: string,
    left: Float32Array,
    right: Float32Array,
    fadeInSec: number,
    fadeOutSec: number
  ): AudioTrackItem => {
    let maxAbs = 0;
    for (let i = 0; i < left.length; i++) {
      const a = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      if (a > maxAbs) maxAbs = a;
    }
    const duration = left.length / sampleRate;
    return {
      id,
      name,
      formatLabel: 'WAV 24-bit · 48.0 kHz · Stereo',
      fileSize: 44 + left.length * 2 * 3,
      sampleRate,
      channels: [left, right],
      originalDuration: duration,
      trimStart: 0,
      trimEnd: Number(duration.toFixed(2)),
      gainDb: 0,
      fadeInSec,
      fadeOutSec,
      peaks: computeWaveformPeaks(left, 110),
      peakDb: linearToDb(maxAbs),
    };
  };

  return [
    buildTrack(
      'demo-track-1',
      '01_Warm_Rhodes_Intro_Cmaj7.wav',
      t1L,
      t1R,
      0.05,
      0.15
    ),
    buildTrack(
      'demo-track-2',
      '02_Analog_Arp_SubGroove_Dm7.wav',
      t2L,
      t2R,
      0.05,
      0.15
    ),
    buildTrack(
      'demo-track-3',
      '03_Atmospheric_Outro_Gmaj9.wav',
      t3L,
      t3R,
      0.1,
      0.4
    ),
  ];
}

/**
 * Decodes an uploaded File or Blob into lossless Float32Array channel buffers.
 * Uses OfflineAudioContext first so decoding works reliably on mobile browsers
 * even when hardware AudioContext is suspended by autoplay policies.
 */
export async function decodeUploadedAudioFile(
  file: File,
  fallbackAudioCtx?: AudioContext
): Promise<AudioTrackItem> {
  const arrayBuffer = await file.arrayBuffer();

  let audioBuffer: AudioBuffer;
  const OfflineCtx =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;

  if (OfflineCtx) {
    const offlineCtx = new OfflineCtx(2, 44100, 48000);
    audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer.slice(0));
  } else if (fallbackAudioCtx) {
    audioBuffer = await fallbackAudioCtx.decodeAudioData(arrayBuffer.slice(0));
  } else {
    throw new Error('Web Audio API not supported on this device');
  }

  const numChannels = Math.min(2, Math.max(1, audioBuffer.numberOfChannels));
  const channels: Float32Array[] = [];
  let maxAbs = 0;

  for (let ch = 0; ch < numChannels; ch++) {
    const raw = audioBuffer.getChannelData(ch);
    const copy = new Float32Array(raw.length);
    copy.set(raw);
    for (let i = 0; i < copy.length; i++) {
      const abs = Math.abs(copy[i]);
      if (abs > maxAbs) maxAbs = abs;
    }
    channels.push(copy);
  }

  const ext = file.name.split('.').pop()?.toUpperCase() || 'AUDIO';
  const srKhz = (audioBuffer.sampleRate / 1000).toFixed(1);
  const chLabel = numChannels === 2 ? 'Stereo' : 'Mono';

  return {
    id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    formatLabel: `${ext} · ${srKhz} kHz · ${chLabel}`,
    fileSize: file.size,
    sampleRate: audioBuffer.sampleRate,
    channels,
    originalDuration: audioBuffer.duration,
    trimStart: 0,
    trimEnd: Number(audioBuffer.duration.toFixed(2)),
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
    peaks: computeWaveformPeaks(channels[0], 110),
    peakDb: linearToDb(maxAbs),
  };
}
