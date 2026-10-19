import React, { useEffect, useRef } from 'react';
import { dbToLinear } from '../utils/audioMath';

interface WaveformCanvasProps {
  peaks: number[];
  duration: number;
  trimStart?: number;
  trimEnd?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  gainDb?: number;
  playheadProgress?: number; // 0 to 1
  accentColor?: string;
  height?: number;
  onScrub?: (progress: number) => void;
  testId?: string;
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  peaks,
  duration,
  trimStart = 0,
  trimEnd,
  fadeInSec = 0,
  fadeOutSec = 0,
  gainDb = 0,
  playheadProgress = 0,
  accentColor = '#F59E0B',
  height = 68,
  onScrub,
  testId,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const effectiveTrimEnd = trimEnd ?? duration;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isHeadless =
      typeof navigator !== 'undefined' &&
      (navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent));
    const dpr = isHeadless ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 600;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    // Subtle center zero-crossing line
    const midY = height / 2;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    if (peaks.length === 0 || duration <= 0) return;

    const startRatio = Math.max(0, Math.min(1, trimStart / duration));
    const endRatio = Math.max(startRatio, Math.min(1, effectiveTrimEnd / duration));
    const gainScale = Math.min(1.6, dbToLinear(gainDb));

    const barCount = peaks.length;
    const barStep = width / barCount;
    const barWidth = Math.max(1.5, barStep * 0.66);

    for (let i = 0; i < barCount; i++) {
      const ratio = (i + 0.5) / barCount;
      const inTrimWindow = ratio >= startRatio && ratio <= endRatio;

      // Apply fade envelope preview visually
      let fadeMultiplier = 1;
      const timeSec = ratio * duration;
      if (inTrimWindow) {
        if (fadeInSec > 0 && timeSec - trimStart < fadeInSec) {
          fadeMultiplier *= Math.max(0.1, (timeSec - trimStart) / fadeInSec);
        }
        if (fadeOutSec > 0 && effectiveTrimEnd - timeSec < fadeOutSec) {
          fadeMultiplier *= Math.max(0.1, (effectiveTrimEnd - timeSec) / fadeOutSec);
        }
      }

      const rawAmp = Math.min(1, peaks[i] * gainScale * fadeMultiplier);
      const barHalfHeight = Math.max(2, rawAmp * (height * 0.43));
      const x = i * barStep + (barStep - barWidth) / 2;

      if (!inTrimWindow) {
        ctx.fillStyle = 'rgba(100, 116, 139, 0.22)';
      } else if (playheadProgress > 0 && ratio <= playheadProgress) {
        ctx.fillStyle = '#38BDF8';
      } else {
        ctx.fillStyle = accentColor;
      }

      ctx.beginPath();
      ctx.roundRect(x, midY - barHalfHeight, barWidth, barHalfHeight * 2, 1.5);
      ctx.fill();
    }

    // Dimmed trim masks on left and right if trimmed
    if (startRatio > 0.005) {
      const trimLeftX = startRatio * width;
      ctx.fillStyle = 'rgba(11, 15, 23, 0.65)';
      ctx.fillRect(0, 0, trimLeftX, height);
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(trimLeftX, 0);
      ctx.lineTo(trimLeftX, height);
      ctx.stroke();
    }

    if (endRatio < 0.995) {
      const trimRightX = endRatio * width;
      ctx.fillStyle = 'rgba(11, 15, 23, 0.65)';
      ctx.fillRect(trimRightX, 0, width - trimRightX, height);
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(trimRightX, 0);
      ctx.lineTo(trimRightX, height);
      ctx.stroke();
    }

    // Playhead cursor
    if (playheadProgress > 0 && playheadProgress <= 1) {
      const px = playheadProgress * width;
      ctx.strokeStyle = '#F8FAFC';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
  }, [peaks, duration, trimStart, effectiveTrimEnd, fadeInSec, fadeOutSec, gainDb, playheadProgress, accentColor, height]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onScrub || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    onScrub(ratio);
  };

  return (
    <canvas
      ref={canvasRef}
      data-testid={testId}
      onClick={handleClick}
      style={{ height: `${height}px` }}
      className={`w-full block rounded-md bg-[#090D14] border border-slate-800/80 ${
        onScrub ? 'cursor-pointer' : ''
      }`}
    />
  );
};
