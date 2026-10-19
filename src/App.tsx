/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Upload,
  Download,
  Play,
  Square,
  Plus,
  Layers,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Volume2,
  RotateCcw,
  FileAudio,
  Share2,
  Disc,
  WifiOff,
} from 'lucide-react';
import {
  BitDepth,
  TransitionMode,
  calculateMergedDuration,
  computeWaveformPeaks,
  encodeWavBuffer,
  estimateWavFileSize,
  formatFileSize,
  formatTimecode,
  spliceAudioTracks,
  dbToLinear,
} from './utils/audioMath';
import {
  AudioTrackItem,
  decodeUploadedAudioFile,
  generateStudioDemoTracks,
} from './utils/demoAudio';
import { TrackCard } from './components/TrackCard';
import { WaveformCanvas } from './components/WaveformCanvas';
import { PWAInstallButton } from './components/PWAInstallButton';
import { usePWAInstall } from './hooks/usePWAInstall';

interface MergedOutputState {
  blob: Blob;
  blobUrl: string;
  fileName: string;
  fileSize: number;
  duration: number;
  sampleRate: number;
  bitDepth: BitDepth;
  channelsCount: 1 | 2;
  peakDb: number;
  peaks: number[];
  channelsData: Float32Array[];
  mergedAt: number;
}

type MobileTab = 'tracks' | 'settings' | 'master';

export default function App() {
  const [tracks, setTracks] = useState<AudioTrackItem[]>(() =>
    generateStudioDemoTracks()
  );
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(
    'demo-track-1'
  );
  const [lang, setLang] = useState<'en' | 'bn'>('en');
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTab>('tracks');

  // Mastering & Splicing settings
  const [transitionMode, setTransitionMode] =
    useState<TransitionMode>('crossfade');
  const [transitionSec, setTransitionSec] = useState<number>(0.4);
  const [sampleRateOption, setSampleRateOption] = useState<
    'auto' | 48000 | 44100
  >('auto');
  const [bitDepth, setBitDepth] = useState<BitDepth>(24);
  const [outputChannels, setOutputChannels] = useState<1 | 2>(2);
  const [normalizePeak, setNormalizePeak] = useState<boolean>(true);
  const [outputName, setOutputName] = useState<string>('SpliceLab_Master_Mix');

  // Status & Merged output
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isDecoding, setIsDecoding] = useState<boolean>(false);
  const [isMerging, setIsMerging] = useState<boolean>(false);
  const [mergeSuccessBanner, setMergeSuccessBanner] = useState<string | null>(
    null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mergedOutput, setMergedOutput] = useState<MergedOutputState | null>(
    null
  );

  // Playback state (either a single track ID or 'master')
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playheadProgress, setPlayheadProgress] = useState<number>(0);

  const { isOnline } = usePWAInstall();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const masterSectionRef = useRef<HTMLElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const playbackStartRef = useRef<number>(0);
  const playbackDurationRef = useRef<number>(0);

  const getAudioContext = (): AudioContext => {
    if (!audioCtxRef.current) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioCtxRef.current = new AudioContextClass();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  };

  const stopPlayback = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // Ignore if already stopped
      }
      sourceNodeRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setPlayingId(null);
    setPlayheadProgress(0);
  };

  useEffect(() => {
    return () => {
      stopPlayback();
      if (mergedOutput?.blobUrl) {
        URL.revokeObjectURL(mergedOutput.blobUrl);
      }
    };
  }, []);

  // Automatically determine effective sample rate
  const effectiveSampleRate = useMemo(() => {
    if (sampleRateOption !== 'auto') return sampleRateOption;
    if (tracks.length === 0) return 48000;
    return Math.max(...tracks.map((t) => t.sampleRate));
  }, [sampleRateOption, tracks]);

  // Real-time calculated total duration and lossless file size
  const estimatedDuration = useMemo(
    () =>
      calculateMergedDuration(
        tracks,
        transitionMode,
        transitionMode === 'seamless' ? 0 : transitionSec
      ),
    [tracks, transitionMode, transitionSec]
  );

  const estimatedSize = useMemo(
    () =>
      estimateWavFileSize(
        estimatedDuration,
        effectiveSampleRate,
        outputChannels,
        bitDepth
      ),
    [estimatedDuration, effectiveSampleRate, outputChannels, bitDepth]
  );

  // Play any Float32Array buffer through Web Audio API
  const startBufferPlayback = (
    id: string,
    channelsData: Float32Array[],
    sampleRate: number,
    offsetRatio = 0
  ) => {
    stopPlayback();
    try {
      const ctx = getAudioContext();
      const totalSamples = channelsData[0]?.length ?? 0;
      if (totalSamples === 0) return;

      const audioBuffer = ctx.createBuffer(
        channelsData.length,
        totalSamples,
        sampleRate
      );
      for (let ch = 0; ch < channelsData.length; ch++) {
        audioBuffer.copyToChannel(channelsData[ch], ch);
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const duration = audioBuffer.duration;
      const startOffset = Math.max(
        0,
        Math.min(duration - 0.05, offsetRatio * duration)
      );

      playbackStartRef.current = ctx.currentTime - startOffset;
      playbackDurationRef.current = duration;
      sourceNodeRef.current = source;
      setPlayingId(id);
      setPlayheadProgress(offsetRatio);

      const updatePlayhead = () => {
        if (!audioCtxRef.current || !sourceNodeRef.current) return;
        const elapsed =
          audioCtxRef.current.currentTime - playbackStartRef.current;
        const ratio = Math.min(1, elapsed / playbackDurationRef.current);
        setPlayheadProgress(ratio);
        if (elapsed < playbackDurationRef.current) {
          animFrameRef.current = requestAnimationFrame(updatePlayhead);
        } else {
          setPlayingId(null);
          setPlayheadProgress(0);
        }
      };

      source.onended = () => {
        if (sourceNodeRef.current === source) {
          stopPlayback();
        }
      };

      source.start(0, startOffset);
      animFrameRef.current = requestAnimationFrame(updatePlayhead);
    } catch {
      setPlayingId(null);
    }
  };

  const handleToggleTrackPlay = (trackId: string) => {
    if (playingId === trackId) {
      stopPlayback();
      return;
    }
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;

    const startSample = Math.floor(track.trimStart * track.sampleRate);
    const endSample = Math.floor(track.trimEnd * track.sampleRate);
    const gain = dbToLinear(track.gainDb);

    const slicedChannels = track.channels.map((ch) => {
      const sub = ch.slice(startSample, endSample);
      const out = new Float32Array(sub.length);
      for (let i = 0; i < sub.length; i++) {
        out[i] = sub[i] * gain;
      }
      return out;
    });

    startBufferPlayback(trackId, slicedChannels, track.sampleRate, 0);
  };

  const handleToggleMasterPlay = (scrubRatio?: number) => {
    if (!mergedOutput) return;
    if (playingId === 'master' && scrubRatio === undefined) {
      stopPlayback();
      return;
    }
    startBufferPlayback(
      'master',
      mergedOutput.channelsData,
      mergedOutput.sampleRate,
      scrubRatio ?? 0
    );
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMessage(null);
    setMergeSuccessBanner(null);
    setIsDecoding(true);

    try {
      const decodedItems: AudioTrackItem[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const item = await decodeUploadedAudioFile(file);
        decodedItems.push(item);
      }
      setTracks((prev) => [...prev, ...decodedItems]);
      if (decodedItems.length > 0) {
        setExpandedTrackId(decodedItems[0].id);
        setActiveMobileTab('tracks');
      }
    } catch {
      setErrorMessage(
        lang === 'bn'
          ? 'Audio file decode kora jayni. Dayakore valid WAV, MP3, FLAC, M4A, AAC ba OGG file select korun.'
          : 'Could not decode one or more audio files. Please select valid WAV, MP3, FLAC, M4A, AAC, or OGG files.'
      );
    } finally {
      setIsDecoding(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleMoveTrack = (index: number, direction: 'up' | 'down') => {
    setTracks((prev) => {
      const copy = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= copy.length) return prev;
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  const handleDuplicateTrack = (trackId: string) => {
    setTracks((prev) => {
      const idx = prev.findIndex((t) => t.id === trackId);
      if (idx === -1) return prev;
      const orig = prev[idx];
      const clone: AudioTrackItem = {
        ...orig,
        id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: `${orig.name.replace(/\.[^/.]+$/, '')}_copy.wav`,
        channels: orig.channels.map((ch) => new Float32Array(ch)),
      };
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      return next;
    });
  };

  const handleRemoveTrack = (trackId: string) => {
    if (playingId === trackId) stopPlayback();
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
  };

  const handleUpdateTrack = (
    trackId: string,
    updates: Partial<
      Pick<
        AudioTrackItem,
        'trimStart' | 'trimEnd' | 'gainDb' | 'fadeInSec' | 'fadeOutSec'
      >
    >
  ) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, ...updates } : t))
    );
  };

  const handleLoadDemoTracks = () => {
    stopPlayback();
    setErrorMessage(null);
    const demos = generateStudioDemoTracks();
    setTracks(demos);
    setExpandedTrackId(demos[0].id);
    setActiveMobileTab('tracks');
  };

  const performMergeComputation = (isUserTriggered: boolean) => {
    if (tracks.length === 0) {
      if (isUserTriggered) {
        setErrorMessage(
          lang === 'bn'
            ? 'Merge korar jonno ontoto 1ti audio file upload korun.'
            : 'Please add at least one audio track to merge.'
        );
      }
      return;
    }

    if (isUserTriggered) {
      stopPlayback();
      setErrorMessage(null);
      setIsMerging(true);
    }

    try {
      const spliced = spliceAudioTracks(
        tracks.map((t) => ({
          channels: t.channels,
          sampleRate: t.sampleRate,
          trimStart: t.trimStart,
          trimEnd: t.trimEnd,
          gainDb: t.gainDb,
          fadeInSec: t.fadeInSec,
          fadeOutSec: t.fadeOutSec,
        })),
        effectiveSampleRate,
        outputChannels,
        transitionMode,
        transitionMode === 'seamless' ? 0 : transitionSec,
        normalizePeak
      );

      const wavBuffer = encodeWavBuffer(
        spliced.channels,
        spliced.sampleRate,
        bitDepth
      );
      const blob = new Blob([wavBuffer], { type: 'audio/wav' });
      const blobUrl = URL.createObjectURL(blob);

      if (mergedOutput?.blobUrl) {
        URL.revokeObjectURL(mergedOutput.blobUrl);
      }

      const sanitizedName =
        outputName.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '') ||
        'SpliceLab_Master_Mix';
      const fileName = sanitizedName.toLowerCase().endsWith('.wav')
        ? sanitizedName
        : `${sanitizedName}.wav`;

      const nextOutput: MergedOutputState = {
        blob,
        blobUrl,
        fileName,
        fileSize: wavBuffer.byteLength,
        duration: spliced.duration,
        sampleRate: spliced.sampleRate,
        bitDepth,
        channelsCount: outputChannels,
        peakDb: spliced.peakDb,
        peaks: computeWaveformPeaks(spliced.channels[0], 160),
        channelsData: spliced.channels,
        mergedAt: Date.now(),
      };

      setMergedOutput(nextOutput);

      if (isUserTriggered) {
        setActiveMobileTab('master');
        setMergeSuccessBanner(
          lang === 'bn'
            ? `${tracks.length}ti Audio Track safolbhabe 1ti file-e Merge hoyeche (${formatTimecode(spliced.duration)})! Ekhon play ba download korun.`
            : `Successfully merged ${tracks.length} tracks into ${fileName} (${formatTimecode(spliced.duration)})! Ready to play or download.`
        );
        setTimeout(() => {
          masterSectionRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
          });
        }, 60);
      }
    } catch {
      if (isUserTriggered) {
        setErrorMessage(
          lang === 'bn'
            ? 'Audio merge korar somoy ekti somossa hoyeche.'
            : 'An error occurred while merging the audio tracks.'
        );
      }
    } finally {
      if (isUserTriggered) {
        setIsMerging(false);
      }
    }
  };

  // Live-sync merged master whenever tracks or mastering settings change
  useEffect(() => {
    if (tracks.length > 0) {
      performMergeComputation(false);
    } else {
      setMergedOutput(null);
    }
  }, [
    tracks,
    transitionMode,
    transitionSec,
    effectiveSampleRate,
    bitDepth,
    outputChannels,
    normalizePeak,
    outputName,
  ]);

  // Programmatic Download handler that works reliably across mobile WebViews & desktop browsers
  const handleTriggerDownload = () => {
    if (!mergedOutput) return;
    const link = document.createElement('a');
    link.href = mergedOutput.blobUrl;
    link.download = mergedOutput.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Native Mobile Share / Save to Files handler
  const handleNativeMobileShare = async () => {
    if (!mergedOutput) return;
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };
    const file = new File([mergedOutput.blob], mergedOutput.fileName, {
      type: 'audio/wav',
    });

    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share({
          title: mergedOutput.fileName,
          text: 'Merged lossless audio created with SpliceLab Studio',
          files: [file],
        });
        return;
      } catch {
        // User cancelled share sheet or fallback to download
      }
    }
    handleTriggerDownload();
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-slate-100 pb-24 lg:pb-8">
      {/* Compact Sticky Top App Bar (Strict 3-Zone Contract on Desktop & Mobile App Header) */}
      <header className="flex items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 h-14 border-b border-slate-800/90 bg-[#0B0F17]/95 sticky top-0 z-30 backdrop-blur-md">
        <a
          href="#workstation"
          className="text-base sm:text-lg font-bold tracking-tight text-slate-100 font-display whitespace-nowrap shrink-0"
        >
          SpliceLab Studio
        </a>

        <nav
          aria-label="Primary Navigation"
          className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-400"
        >
          <a
            href="#workstation"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            {lang === 'bn' ? 'Track Queue' : 'Splicer Queue'}
          </a>
          <a
            href="#mastering-rack"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            {lang === 'bn' ? 'Mastering Rack' : 'Mastering Settings'}
          </a>
          <a
            href="#master-output"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            {lang === 'bn' ? 'Instant Download' : 'Master Output'}
          </a>
          <a
            href="#quality-architecture"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            {lang === 'bn' ? 'Quality Guarantee' : 'Lossless Engine'}
          </a>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 rounded-xl hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>{lang === 'bn' ? 'Add Audio' : 'Upload Audio'}</span>
          </button>
        </div>
      </header>

      {/* Offline Connectivity Banner */}
      {!isOnline && (
        <div
          role="status"
          className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-300 flex items-center justify-center gap-2"
        >
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>
            Offline Mode Active — Local browser audio merging and WAV export
            continue to work 100% offline.
          </span>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1320px] w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
        {/* Hero & Language Switcher Row */}
        <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-4 border-b border-slate-800/80">
          <div className="space-y-1.5 max-w-2xl">
            <p className="text-[11px] sm:text-xs font-mono text-amber-400 tracking-wide">
              {lang === 'bn'
                ? 'MOBILE & DESKTOP LOSSLESS AUDIO JOINER · 24-BIT STUDIO WAV'
                : 'ZERO-COMPRESSION DSP · 24-BIT & 32-BIT FLOAT STUDIO WAV'}
            </p>
            <h1
              className="text-xl sm:text-3xl font-bold tracking-tight text-slate-100 font-display"
              style={{ textWrap: 'balance' }}
            >
              {lang === 'bn'
                ? 'Akaadhik Audio File Eksathe Jora Lagan Nikhut Sound Quality-te'
                : 'Join Multiple Audio Tracks with Zero Quality Loss'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              {lang === 'bn'
                ? 'Phone ba computer theke akaadhik gaan, voice recording ba audio clip upload kore 1 click-e Merge ebong Instant Download korun.'
                : 'Combine songs, voice recordings, and studio stems directly on your phone or desktop with 32-bit floating-point signal processing and instant WAV download.'}
            </p>
          </div>

          {/* Interactive Language Switcher & Mobile App Install Action */}
          <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-end">
            <PWAInstallButton lang={lang} />
            <div
              role="group"
              aria-label="Interface Language"
              className="flex items-center gap-1 p-1 bg-[#111722] border border-slate-800 rounded-xl"
            >
              <button
                type="button"
                onClick={() => setLang('en')}
                className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  lang === 'en'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                English Studio
              </button>
              <button
                type="button"
                onClick={() => setLang('bn')}
                className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  lang === 'bn'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Banglish (Bangla)
              </button>
            </div>
          </div>
        </section>

        {/* Error Alert Banner */}
        {errorMessage && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs sm:text-sm"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="min-h-[40px] px-2 text-xs font-medium underline hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              {lang === 'bn' ? 'Bondho Korun' : 'Dismiss'}
            </button>
          </div>
        )}

        {/* Merge Confirmation Banner when user taps Merge */}
        {mergeSuccessBanner && (
          <div
            role="status"
            data-testid="merge-success-banner"
            className="flex items-center justify-between gap-3 p-4 rounded-xl bg-emerald-950/70 border border-emerald-500/50 text-emerald-200 text-xs sm:text-sm"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span className="font-medium">{mergeSuccessBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setMergeSuccessBanner(null)}
              className="min-h-[40px] px-2 text-xs font-medium underline hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              OK
            </button>
          </div>
        )}

        {/* Master Output & Instant Download Section (Visible on Desktop Always, and on Mobile when in 'master' or 'tracks' tab) */}
        {mergedOutput && (
          <section
            ref={masterSectionRef}
            id="master-output"
            data-testid="master-output-card"
            className={`${
              activeMobileTab === 'settings' ? 'hidden lg:block' : 'block'
            } bg-[#111722] border border-emerald-500/40 rounded-2xl p-4 sm:p-5 space-y-4`}
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    {lang === 'bn'
                      ? `Merged Master Ready (${tracks.length} Tracks Joined · 0% Quality Loss)`
                      : `Lossless Master Audio Ready (${tracks.length} Tracks Joined · 0% Compression Loss)`}
                  </span>
                </div>
                <h2 className="text-base sm:text-lg font-bold text-slate-100 font-display">
                  {mergedOutput.fileName}
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
                  <span>
                    {mergedOutput.bitDepth === 32
                      ? '32-bit IEEE Float WAV'
                      : `${mergedOutput.bitDepth}-bit Uncompressed PCM WAV`}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{(mergedOutput.sampleRate / 1000).toFixed(1)} kHz</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {mergedOutput.channelsCount === 2 ? 'Stereo' : 'Mono'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Duration:{' '}
                    <strong className="text-slate-200">
                      {formatTimecode(mergedOutput.duration)}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Peak:{' '}
                    <strong className="text-emerald-400">
                      {mergedOutput.peakDb} dBFS
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Size:{' '}
                    <strong className="text-amber-400">
                      {formatFileSize(mergedOutput.fileSize)}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Master Playback, Instant Download & Native Phone Share Buttons */}
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleToggleMasterPlay()}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {playingId === 'master' ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current text-amber-400" />
                      <span>
                        {lang === 'bn'
                          ? 'Stop Preview'
                          : 'Stop Master Preview'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current text-amber-400" />
                      <span>
                        {lang === 'bn'
                          ? 'Play Merged Audio'
                          : 'Play Merged Master'}
                      </span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleTriggerDownload}
                  data-testid="download-master-btn"
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span>
                    {lang === 'bn'
                      ? `Instant Download WAV (${formatFileSize(mergedOutput.fileSize)})`
                      : `Instant Download WAV (${formatFileSize(mergedOutput.fileSize)})`}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleNativeMobileShare}
                  aria-label="Share or Save Merged Audio to Phone"
                  className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Share2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{lang === 'bn' ? 'Save to Phone' : 'Share / Save'}</span>
                </button>
              </div>
            </div>

            {/* Interactive Master Waveform with Scrubbing */}
            <div className="space-y-1.5">
              <WaveformCanvas
                peaks={mergedOutput.peaks}
                duration={mergedOutput.duration}
                playheadProgress={
                  playingId === 'master' ? playheadProgress : 0
                }
                accentColor="#10B981"
                height={64}
                onScrub={(ratio) => handleToggleMasterPlay(ratio)}
                testId="waveform-master"
              />
              <div className="flex items-center justify-between gap-4 text-[11px] font-mono text-slate-400">
                <span className="shrink-0">00:00.00</span>
                <span className="text-center truncate">
                  {lang === 'bn'
                    ? 'Waveform-e tap kore scrub korun'
                    : 'Tap waveform to scrub playback'}
                </span>
                <span className="shrink-0">
                  {formatTimecode(mergedOutput.duration)}
                </span>
              </div>
            </div>
          </section>
        )}

        {/* Primary 2-Column Studio Layout (Responsive Mobile Tabs + Full Desktop Split) */}
        <section
          id="workstation"
          className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
        >
          {/* Left 8 Columns: Upload Dropzone + Multi-Track Queue */}
          <div
            className={`lg:col-span-8 space-y-5 ${
              activeMobileTab === 'settings' ? 'hidden lg:block' : 'block'
            }`}
          >
            {/* Hidden Native File Input (Supports all mobile audio & video-audio formats) */}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*,.wav,.mp3,.flac,.m4a,.aac,.ogg,.opus,.mp4"
              multiple
              onChange={(e) => handleFilesSelected(e.target.files)}
              className="hidden"
              aria-label="Upload audio files"
            />

            {/* Drag-and-Drop Multi-File Upload Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                handleFilesSelected(e.dataTransfer.files);
              }}
              className={`border border-dashed rounded-2xl p-4 sm:p-5 transition-colors ${
                isDragging
                  ? 'border-amber-400 bg-amber-500/10'
                  : 'border-slate-700/90 bg-[#111722]/70 hover:border-slate-600'
              }`}
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-sm sm:text-base font-semibold text-slate-100">
                      {lang === 'bn'
                        ? 'Akaadhik Audio File Select Korun (2ba Taro Beshi)'
                        : 'Select or Drop Multiple Audio Files to Join'}
                    </h2>
                    <p className="text-xs text-slate-400">
                      {lang === 'bn'
                        ? 'Supports WAV, MP3, M4A, AAC, FLAC, OGG, Voice Notes · 100% Original Quality'
                        : 'Supports WAV, FLAC, MP3, M4A, AAC, OGG · Decoded directly into 32-bit float PCM'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end shrink-0">
                  <button
                    type="button"
                    onClick={handleLoadDemoTracks}
                    className="min-h-[44px] px-3.5 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Load Demo Tracks</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isDecoding}
                    className="min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>
                      {isDecoding
                        ? 'Decoding...'
                        : lang === 'bn'
                        ? 'Add Audio Files'
                        : 'Add Audio Files'}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* Track Queue Header & Summary Metrics */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              <div className="flex items-center gap-2.5">
                <Layers className="w-4 h-4 text-amber-400" />
                <h2 className="text-base font-semibold text-slate-100">
                  {lang === 'bn'
                    ? `Audio Track Queue (${tracks.length} Files)`
                    : `Splice Track Queue (${tracks.length} Tracks)`}
                </h2>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                <span>
                  Total Duration:{' '}
                  <strong className="text-slate-100">
                    {formatTimecode(estimatedDuration)}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Est. WAV Size:{' '}
                  <strong className="text-amber-400">
                    {formatFileSize(estimatedSize)}
                  </strong>
                </span>
                {tracks.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => {
                        stopPlayback();
                        setTracks([]);
                        setMergedOutput(null);
                        setMergeSuccessBanner(null);
                      }}
                      className="min-h-[36px] text-rose-400 hover:text-rose-300 underline cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Clear All
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Track List or Empty State */}
            {tracks.length === 0 ? (
              <div className="border border-slate-800 rounded-2xl bg-[#111722]/40 p-8 sm:p-10 text-center space-y-4">
                <FileAudio className="w-10 h-10 text-slate-500 mx-auto" />
                <div className="space-y-1 max-w-md mx-auto">
                  <h3 className="text-base font-semibold text-slate-200">
                    {lang === 'bn'
                      ? 'Kono Audio Track Jog Kora Hoyni'
                      : 'No Audio Tracks in the Splice Queue'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {lang === 'bn'
                      ? 'Apnar phone ba computer theke 2ba taro beshi audio file select korun othoba 3ti demo track load korun.'
                      : 'Upload two or more audio files from your device or load our 3 studio demo tracks to test instant lossless merging.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[44px] px-4 py-2 text-xs font-semibold bg-amber-500 text-slate-950 rounded-xl hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Select Audio Files
                  </button>
                  <button
                    type="button"
                    onClick={handleLoadDemoTracks}
                    className="min-h-[44px] px-4 py-2 text-xs font-medium bg-slate-800 text-slate-200 rounded-xl hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Load 3 Studio Demo Tracks
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3" data-testid="track-queue-list">
                {tracks.map((track, idx) => (
                  <TrackCard
                    key={track.id}
                    track={track}
                    index={idx}
                    totalTracks={tracks.length}
                    isPlaying={playingId === track.id}
                    playheadProgress={
                      playingId === track.id ? playheadProgress : 0
                    }
                    isExpanded={expandedTrackId === track.id}
                    lang={lang}
                    onTogglePlay={handleToggleTrackPlay}
                    onMoveTrack={handleMoveTrack}
                    onDuplicateTrack={handleDuplicateTrack}
                    onRemoveTrack={handleRemoveTrack}
                    onToggleExpand={(id) =>
                      setExpandedTrackId((prev) => (prev === id ? null : id))
                    }
                    onUpdateTrack={handleUpdateTrack}
                  />
                ))}

                {/* Prominent Mobile & Desktop Merge Action Card right below the tracks */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => performMergeComputation(true)}
                    disabled={isMerging || tracks.length === 0}
                    data-testid="primary-merge-tracks-btn"
                    className="w-full min-h-[52px] py-3.5 px-6 rounded-2xl bg-amber-500 hover:bg-amber-400 active:scale-[0.99] disabled:opacity-40 text-slate-950 font-bold text-sm transition-all flex items-center justify-center gap-2.5 shadow-lg shadow-amber-500/15 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Volume2 className="w-5 h-5 shrink-0" />
                    <span>
                      {isMerging
                        ? 'Merging Audio Tracks...'
                        : lang === 'bn'
                        ? `Merge ${tracks.length} Audio Tracks Now (${formatTimecode(estimatedDuration)})`
                        : `Merge ${tracks.length} Audio Tracks Losslessly (${formatTimecode(estimatedDuration)})`}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right 4 Columns: Mastering & Lossless Output Settings Rack */}
          <aside
            id="mastering-rack"
            className={`lg:col-span-4 bg-[#111722] border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5 lg:sticky lg:top-20 ${
              activeMobileTab === 'settings' ? 'block' : 'hidden lg:block'
            }`}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                <h2 className="text-base font-semibold text-slate-100">
                  Lossless Join & Mastering Rack
                </h2>
              </div>
            </div>

            {/* 1. Track Transition Mode */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-300">
                {lang === 'bn'
                  ? 'Track Transition Mode (Jora Laganor Dhoron)'
                  : 'Track Transition Mode'}
              </label>
              <div
                role="group"
                aria-label="Track Transition Mode"
                className="grid grid-cols-3 gap-1.5 p-1 bg-[#090D14] border border-slate-800 rounded-xl"
              >
                <button
                  type="button"
                  onClick={() => setTransitionMode('seamless')}
                  className={`min-h-[40px] py-2 px-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    transitionMode === 'seamless'
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Seamless
                </button>
                <button
                  type="button"
                  onClick={() => setTransitionMode('crossfade')}
                  className={`min-h-[40px] py-2 px-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    transitionMode === 'crossfade'
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Crossfade
                </button>
                <button
                  type="button"
                  onClick={() => setTransitionMode('gap')}
                  className={`min-h-[40px] py-2 px-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    transitionMode === 'gap'
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Silence Gap
                </button>
              </div>

              {transitionMode !== 'seamless' && (
                <div className="pt-1.5">
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>
                      {transitionMode === 'crossfade'
                        ? 'Equal-Power Crossfade Overlap'
                        : 'Silence Duration Between Tracks'}
                    </span>
                    <span className="font-mono text-amber-400">
                      {transitionSec.toFixed(2)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Transition duration in seconds"
                    min={0.1}
                    max={3.0}
                    step={0.05}
                    value={transitionSec}
                    onChange={(e) => setTransitionSec(Number(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>
              )}
            </div>

            {/* 2. Bit Depth Selector */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-300">
                {lang === 'bn'
                  ? 'Lossless WAV Bit Depth (Audio Quality)'
                  : 'Lossless WAV Bit Depth'}
              </label>
              <div
                role="group"
                aria-label="WAV Bit Depth"
                className="grid grid-cols-3 gap-1.5 p-1 bg-[#090D14] border border-slate-800 rounded-xl"
              >
                {([16, 24, 32] as BitDepth[]).map((depth) => (
                  <button
                    key={depth}
                    type="button"
                    onClick={() => setBitDepth(depth)}
                    className={`min-h-[40px] py-2 px-2 text-xs font-mono rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      bitDepth === depth
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {depth === 32 ? '32-bit Float' : `${depth}-bit PCM`}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400">
                {bitDepth === 24
                  ? 'Studio Mastering Standard (144 dB dynamic range, zero loss)'
                  : bitDepth === 32
                  ? 'IEEE 32-bit Floating Point (infinite headroom, bit-exact)'
                  : 'CD-Standard 16-bit Uncompressed PCM (universal compatibility)'}
              </p>
            </div>

            {/* 3. Sample Rate & Channels */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="sample-rate-select"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Sample Rate
                </label>
                <select
                  id="sample-rate-select"
                  value={sampleRateOption}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSampleRateOption(
                      val === 'auto' ? 'auto' : (Number(val) as 48000 | 44100)
                    );
                  }}
                  className="w-full min-h-[42px] bg-[#090D14] border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="auto">
                    Auto ({(effectiveSampleRate / 1000).toFixed(1)} kHz)
                  </option>
                  <option value="48000">48.0 kHz (Studio)</option>
                  <option value="44100">44.1 kHz (CD)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="channel-mode-select"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Channels
                </label>
                <select
                  id="channel-mode-select"
                  value={outputChannels}
                  onChange={(e) =>
                    setOutputChannels(Number(e.target.value) as 1 | 2)
                  }
                  className="w-full min-h-[42px] bg-[#090D14] border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value={2}>Stereo (2.0 L/R)</option>
                  <option value={1}>Mono (1.0 Summed)</option>
                </select>
              </div>
            </div>

            {/* 4. Auto Peak Normalization Toggle */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <div>
                <label
                  htmlFor="normalize-peak-checkbox"
                  className="text-xs font-medium text-slate-200 block cursor-pointer"
                >
                  True-Peak Level Normalization (-0.3 dBFS)
                </label>
                <span className="text-[11px] text-slate-400">
                  {lang === 'bn'
                    ? 'Sob track-er volume soman o distortion mukto rakhe'
                    : 'Prevents clipping and balances volume across joined tracks'}
                </span>
              </div>
              <input
                id="normalize-peak-checkbox"
                type="checkbox"
                checked={normalizePeak}
                onChange={(e) => setNormalizePeak(e.target.checked)}
                className="w-5 h-5 accent-amber-500 rounded cursor-pointer shrink-0"
              />
            </div>

            {/* 5. Custom Output Filename */}
            <div>
              <label
                htmlFor="output-filename-input"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Output File Name
              </label>
              <div className="flex items-center bg-[#090D14] border border-slate-800 rounded-xl overflow-hidden focus-within:border-amber-500">
                <input
                  id="output-filename-input"
                  type="text"
                  value={outputName}
                  onChange={(e) => setOutputName(e.target.value)}
                  placeholder="SpliceLab_Master_Mix"
                  className="w-full min-h-[42px] bg-transparent px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none"
                />
                <span className="px-3 text-xs font-mono text-slate-500 select-none">
                  .wav
                </span>
              </div>
            </div>

            {/* Primary Action Button: Merge Audio */}
            <button
              type="button"
              onClick={() => performMergeComputation(true)}
              disabled={isMerging || tracks.length === 0}
              className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-semibold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Volume2 className="w-4 h-4" />
              <span>
                {isMerging
                  ? 'Rendering Lossless Master...'
                  : lang === 'bn'
                  ? 'Merge Audio & Prepare Download'
                  : 'Merge Audio Tracks Losslessly'}
              </span>
            </button>
          </aside>
        </section>

        {/* Audio Engineering Quality Proof Section */}
        <section
          id="quality-architecture"
          className="pt-6 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-slate-200">
              01. Uncompressed 24-Bit & 32-Bit PCM
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {lang === 'bn'
                ? 'Sadharon online joiner audio-ke punoray low-bitrate MP3-te compress kore fele. SpliceLab apnar audio-ke sorasori uncompressed RIFF WAVE stream-e jora lagay, fole sound quality 100% thik thake.'
                : 'Unlike basic joiners that re-compress your tracks into lossy MP3 streams, SpliceLab processes raw 32-bit floating-point samples and exports pure uncompressed RIFF WAVE.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-slate-200">
              02. Equal-Power Crossfade & Peak Guard
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {lang === 'bn'
                ? 'Dui track-er majhe jeno kono click sound ba volume drop na hoy, sejonno cosine equal-power curve ebong -0.3 dBFS true-peak normalization babohar kora hoyeche.'
                : 'Eliminates pops and volume dips at splice points using trigonometric equal-power envelopes and automatic -0.3 dBFS headroom normalization.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-slate-200">
              03. 100% Local Mobile & Desktop DSP
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {lang === 'bn'
                ? 'Apnar audio file-gulo kokhonoi kono server-e upload hoy na. Sob processing apnar phone ba computer-er memory-te somponno hoy, tai instant download kora jay.'
                : 'Your audio files never leave your device. All decoding, splicing, and WAV encoding run locally in memory for instant zero-wait downloads.'}
            </p>
          </div>
        </section>
      </main>

      {/* Fixed Bottom Tab Navigation Bar for Mobile Touch Ergonomics (< 1024px) */}
      <nav
        aria-label="Mobile App Tab Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0B0F17]/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-3 items-center h-16 px-2"
      >
        <button
          type="button"
          onClick={() => setActiveMobileTab('tracks')}
          className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors cursor-pointer ${
            activeMobileTab === 'tracks'
              ? 'text-amber-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-5 h-5" />
          <span className="text-[11px] mt-0.5 whitespace-nowrap">
            Tracks ({tracks.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMobileTab('settings')}
          className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors cursor-pointer ${
            activeMobileTab === 'settings'
              ? 'text-amber-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-5 h-5" />
          <span className="text-[11px] mt-0.5 whitespace-nowrap">
            Quality ({bitDepth}-bit)
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            performMergeComputation(true);
          }}
          className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors cursor-pointer ${
            activeMobileTab === 'master'
              ? 'text-emerald-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Disc className="w-5 h-5" />
          <span className="text-[11px] mt-0.5 whitespace-nowrap">
            Merge & Save
          </span>
        </button>
      </nav>

      {/* Quiet Studio Footer */}
      <footer className="border-t border-slate-800/80 py-5 px-6 text-center text-xs text-slate-500">
        SpliceLab Lossless Audio Merger · Installable Mobile PWA & Web Audio
        Workstation
      </footer>
    </div>
  );
}
