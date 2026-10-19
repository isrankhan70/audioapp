import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMergedDuration,
  encodeWavBuffer,
  estimateWavFileSize,
  formatTimecode,
  spliceAudioTracks,
  computeWaveformPeaks,
} from './audioMath.ts';

test('calculateMergedDuration handles seamless, crossfade, and gap modes accurately', () => {
  const tracks = [
    { trimStart: 0, trimEnd: 10 },
    { trimStart: 2, trimEnd: 12 }, // 10s active
    { trimStart: 0, trimEnd: 5 },  // 5s active
  ];

  // Seamless: 10 + 10 + 5 = 25s
  assert.equal(calculateMergedDuration(tracks, 'seamless', 0), 25);

  // Gap of 1.5s between 3 tracks (2 transitions): 25 + 3 = 28s
  assert.equal(calculateMergedDuration(tracks, 'gap', 1.5), 28);

  // Crossfade of 2s between 3 tracks (2 overlaps): 25 - 4 = 21s
  assert.equal(calculateMergedDuration(tracks, 'crossfade', 2), 21);
});

test('encodeWavBuffer creates valid 16-bit, 24-bit, and 32-bit float RIFF WAVE headers', () => {
  const left = new Float32Array([0, 0.5, -0.5, 1.0]);
  const right = new Float32Array([0, -0.5, 0.5, -1.0]);

  // 24-bit stereo @ 48000 Hz: 4 samples * 2 channels * 3 bytes = 24 bytes + 44 header = 68 bytes
  const wav24 = encodeWavBuffer([left, right], 48000, 24);
  assert.equal(wav24.byteLength, 68);
  const view24 = new DataView(wav24);
  const riff = String.fromCharCode(
    view24.getUint8(0),
    view24.getUint8(1),
    view24.getUint8(2),
    view24.getUint8(3)
  );
  assert.equal(riff, 'RIFF');
  assert.equal(view24.getUint16(20, true), 1); // PCM format
  assert.equal(view24.getUint16(22, true), 2); // 2 channels
  assert.equal(view24.getUint32(24, true), 48000); // 48 kHz
  assert.equal(view24.getUint16(34, true), 24); // 24-bit

  // 32-bit float stereo @ 44100 Hz: 4 samples * 2 channels * 4 bytes = 32 + 44 = 76 bytes
  const wav32 = encodeWavBuffer([left, right], 44100, 32);
  assert.equal(wav32.byteLength, 76);
  const view32 = new DataView(wav32);
  assert.equal(view32.getUint16(20, true), 3); // IEEE Float format = 3
  assert.equal(view32.getUint16(34, true), 32);
});

test('spliceAudioTracks merges tracks losslessly and normalizes peak when enabled', () => {
  const sr = 1000;
  const ch1 = new Float32Array(1000).fill(0.4);
  const ch2 = new Float32Array(1000).fill(0.5);

  const resultSeamless = spliceAudioTracks(
    [
      {
        channels: [ch1],
        sampleRate: sr,
        trimStart: 0,
        trimEnd: 1.0,
        gainDb: 0,
        fadeInSec: 0,
        fadeOutSec: 0,
      },
      {
        channels: [ch2],
        sampleRate: sr,
        trimStart: 0,
        trimEnd: 1.0,
        gainDb: 0,
        fadeInSec: 0,
        fadeOutSec: 0,
      },
    ],
    sr,
    1,
    'seamless',
    0,
    true
  );

  assert.equal(resultSeamless.duration, 2.0);
  assert.equal(resultSeamless.channels[0].length, 2000);
  // Peak should be normalized close to -0.3 dBFS
  assert.equal(resultSeamless.peakDb, -0.3);
});

test('formatTimecode and estimateWavFileSize return deterministic values', () => {
  assert.equal(formatTimecode(65.42), '01:05.42');
  assert.equal(estimateWavFileSize(10, 48000, 2, 24), 44 + 10 * 48000 * 2 * 3);
  const peaks = computeWaveformPeaks(new Float32Array([0.1, -0.8, 0.4, 0.2]), 2);
  assert.equal(peaks.length, 2);
  assert.ok(peaks[0] >= 0.79);
});
