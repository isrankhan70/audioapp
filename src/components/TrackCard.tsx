import React from 'react';
import {
  Play,
  Square,
  ArrowUp,
  ArrowDown,
  Trash2,
  Sliders,
  Copy,
} from 'lucide-react';
import { AudioTrackItem } from '../utils/demoAudio';
import {
  formatFileSize,
  formatTimecode,
  getActiveTrackDuration,
} from '../utils/audioMath';
import { WaveformCanvas } from './WaveformCanvas';

interface TrackCardProps {
  track: AudioTrackItem;
  index: number;
  totalTracks: number;
  isPlaying: boolean;
  playheadProgress: number;
  isExpanded: boolean;
  lang: 'en' | 'bn';
  onTogglePlay: (trackId: string) => void;
  onMoveTrack: (index: number, direction: 'up' | 'down') => void;
  onDuplicateTrack: (trackId: string) => void;
  onRemoveTrack: (trackId: string) => void;
  onToggleExpand: (trackId: string) => void;
  onUpdateTrack: (
    trackId: string,
    updates: Partial<
      Pick<
        AudioTrackItem,
        'trimStart' | 'trimEnd' | 'gainDb' | 'fadeInSec' | 'fadeOutSec'
      >
    >
  ) => void;
}

export const TrackCard: React.FC<TrackCardProps> = ({
  track,
  index,
  totalTracks,
  isPlaying,
  playheadProgress,
  isExpanded,
  lang,
  onTogglePlay,
  onMoveTrack,
  onDuplicateTrack,
  onRemoveTrack,
  onToggleExpand,
  onUpdateTrack,
}) => {
  const activeDuration = getActiveTrackDuration(track);
  const trackOrderNumber = String(index + 1).padStart(2, '0');

  return (
    <div
      data-testid={`track-item-${index}`}
      className="bg-[#111722] border border-slate-800 rounded-lg p-4 transition-colors hover:border-slate-700"
    >
      {/* Top row: Track Index, Title & Metadata, Action Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-xs font-semibold text-amber-400 select-none">
            {trackOrderNumber}.
          </span>

          <button
            type="button"
            onClick={() => onTogglePlay(track.id)}
            aria-label={
              isPlaying
                ? `Stop preview for ${track.name}`
                : `Play preview for ${track.name}`
            }
            className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
              isPlaying
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            {isPlaying ? (
              <Square className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            )}
          </button>

          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-100 truncate max-w-[220px] sm:max-w-[360px]">
              {track.name}
            </h3>
            {/* Clean unboxed metadata with typographic separators */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 font-mono">
              <span>{track.formatLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{formatFileSize(track.fileSize)}</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300">
                {lang === 'bn' ? 'Active Length:' : 'Active:'}{' '}
                {formatTimecode(activeDuration)}
              </span>
              <span aria-hidden="true">·</span>
              <span>Peak {track.peakDb} dBFS</span>
            </div>
          </div>
        </div>

        {/* Right Action Toolbar */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onToggleExpand(track.id)}
            aria-expanded={isExpanded}
            aria-label={`Trim and fade settings for ${track.name}`}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isExpanded
                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                : 'bg-slate-800/90 text-slate-300 hover:bg-slate-700 border border-transparent'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'Trim & Fade' : 'Trim & Gain'}</span>
          </button>

          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMoveTrack(index, 'up')}
            aria-label={`Move ${track.name} up`}
            className="p-2 rounded-md bg-slate-800/90 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            disabled={index === totalTracks - 1}
            onClick={() => onMoveTrack(index, 'down')}
            aria-label={`Move ${track.name} down`}
            className="p-2 rounded-md bg-slate-800/90 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onDuplicateTrack(track.id)}
            aria-label={`Duplicate ${track.name}`}
            className="p-2 rounded-md bg-slate-800/90 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onRemoveTrack(track.id)}
            aria-label={`Remove ${track.name}`}
            className="p-2 rounded-md bg-slate-800/90 text-rose-400 hover:bg-rose-950/60 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Waveform Visualizer */}
      <WaveformCanvas
        peaks={track.peaks}
        duration={track.originalDuration}
        trimStart={track.trimStart}
        trimEnd={track.trimEnd}
        fadeInSec={track.fadeInSec}
        fadeOutSec={track.fadeOutSec}
        gainDb={track.gainDb}
        playheadProgress={playheadProgress}
        accentColor="#F59E0B"
        height={56}
        testId={`waveform-track-${index}`}
      />

      {/* Expandable Precision Trim, Fade & Gain Drawer */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
          <div>
            <label
              htmlFor={`trim-start-${track.id}`}
              className="flex items-center justify-between gap-2 text-slate-400 mb-1 whitespace-nowrap"
            >
              <span>Trim Start</span>
              <span className="font-mono text-slate-200">
                {track.trimStart.toFixed(2)}s
              </span>
            </label>
            <input
              id={`trim-start-${track.id}`}
              type="range"
              min={0}
              max={Math.max(0, Number((track.trimEnd - 0.1).toFixed(2)))}
              step={0.05}
              value={track.trimStart}
              onChange={(e) =>
                onUpdateTrack(track.id, {
                  trimStart: Math.min(
                    Number(e.target.value),
                    track.trimEnd - 0.1
                  ),
                })
              }
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          <div>
            <label
              htmlFor={`trim-end-${track.id}`}
              className="flex items-center justify-between gap-2 text-slate-400 mb-1 whitespace-nowrap"
            >
              <span>Trim End</span>
              <span className="font-mono text-slate-200">
                {track.trimEnd.toFixed(2)}s
              </span>
            </label>
            <input
              id={`trim-end-${track.id}`}
              type="range"
              min={Number((track.trimStart + 0.1).toFixed(2))}
              max={Number(track.originalDuration.toFixed(2))}
              step={0.05}
              value={track.trimEnd}
              onChange={(e) =>
                onUpdateTrack(track.id, {
                  trimEnd: Math.max(
                    Number(e.target.value),
                    track.trimStart + 0.1
                  ),
                })
              }
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          <div>
            <label
              htmlFor={`gain-db-${track.id}`}
              className="flex items-center justify-between gap-2 text-slate-400 mb-1 whitespace-nowrap"
            >
              <span>Track Gain</span>
              <span className="font-mono text-slate-200">
                {track.gainDb > 0 ? `+${track.gainDb}` : track.gainDb} dB
              </span>
            </label>
            <input
              id={`gain-db-${track.id}`}
              type="range"
              min={-12}
              max={6}
              step={0.5}
              value={track.gainDb}
              onChange={(e) =>
                onUpdateTrack(track.id, { gainDb: Number(e.target.value) })
              }
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          <div>
            <label
              htmlFor={`fade-in-${track.id}`}
              className="flex items-center justify-between gap-2 text-slate-400 mb-1 whitespace-nowrap"
            >
              <span>Fade In</span>
              <span className="font-mono text-slate-200">
                {track.fadeInSec.toFixed(2)}s
              </span>
            </label>
            <input
              id={`fade-in-${track.id}`}
              type="range"
              min={0}
              max={Math.min(3, Number((activeDuration / 2).toFixed(2)))}
              step={0.05}
              value={track.fadeInSec}
              onChange={(e) =>
                onUpdateTrack(track.id, { fadeInSec: Number(e.target.value) })
              }
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          <div>
            <label
              htmlFor={`fade-out-${track.id}`}
              className="flex items-center justify-between gap-2 text-slate-400 mb-1 whitespace-nowrap"
            >
              <span>Fade Out</span>
              <span className="font-mono text-slate-200">
                {track.fadeOutSec.toFixed(2)}s
              </span>
            </label>
            <input
              id={`fade-out-${track.id}`}
              type="range"
              min={0}
              max={Math.min(3, Number((activeDuration / 2).toFixed(2)))}
              step={0.05}
              value={track.fadeOutSec}
              onChange={(e) =>
                onUpdateTrack(track.id, { fadeOutSec: Number(e.target.value) })
              }
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>
        </div>
      )}
    </div>
  );
};
