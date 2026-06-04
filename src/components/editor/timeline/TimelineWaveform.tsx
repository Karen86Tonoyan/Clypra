import React, { useRef, useEffect, useState } from "react";
import { platform } from "@/core/platform";
import { drawRoundedRect, getThemeAccentRgb } from "@/lib/canvasUtils";

interface TimelineWaveformProps {
  audioPath: string;
  clipWidthPx: number;
  duration: number;
  className?: string;
}

const waveformCache = new Map<string, number[]>();

export const TimelineWaveform: React.FC<TimelineWaveformProps> = ({ audioPath, clipWidthPx, duration, className = "" }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [themeRevision, setThemeRevision] = useState(0);

  // Calculate optimal sample count based on clip width
  // Professional NLE behavior: more zoom = more detail
  const sampleCount = Math.min(Math.max(Math.floor(clipWidthPx / 1.5), 200), 2000);

  // Watch for theme changes on document element and trigger redraw
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeRevision((r) => r + 1);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => observer.disconnect();
  }, []);

  // Decode audio and generate waveform data
  useEffect(() => {
    const resolvedPath = audioPath.startsWith("asset://") ? audioPath : platform.convertFileSrc(audioPath);

    // Create cache key that includes sample count for zoom-responsive caching
    const cacheKey = `${resolvedPath}:${sampleCount}`;

    // Check cache first
    if (waveformCache.has(cacheKey)) {
      setWaveformData(waveformCache.get(cacheKey)!);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;

    const generateWaveform = async () => {
      try {
        setIsLoading(true);

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass();

        const response = await fetch(resolvedPath);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        if (isCancelled) {
          audioContext.close();
          return;
        }

        const channelData = audioBuffer.getChannelData(0);
        const samples = sampleCount; // Dynamic based on zoom level
        const blockSize = Math.floor(channelData.length / samples);
        const waveform: number[] = [];

        // Calculate RMS for each block
        for (let i = 0; i < samples; i++) {
          const start = i * blockSize;
          const end = start + blockSize;
          let sum = 0;
          for (let j = start; j < end && j < channelData.length; j++) {
            sum += channelData[j] * channelData[j];
          }
          const rms = Math.sqrt(sum / blockSize);
          waveform.push(rms);
        }

        const max = Math.max(...waveform);
        const normalized = waveform.map((v) => (max > 0 ? v / max : 0));

        if (!isCancelled) {
          waveformCache.set(cacheKey, normalized);
          setWaveformData(normalized);
          setIsLoading(false);
        }

        audioContext.close();
      } catch (error) {
        // Generate fallback pattern
        if (!isCancelled) {
          const fallback = Array.from({ length: sampleCount }, (_, i) => {
            const seed = Math.sin(i * 0.15) * 0.5 + 0.5;
            return seed * (0.3 + Math.random() * 0.7);
          });
          waveformCache.set(cacheKey, fallback);
          setWaveformData(fallback);
          setIsLoading(false);
        }
      }
    };

    generateWaveform();

    return () => {
      isCancelled = true;
    };
  }, [audioPath, sampleCount]);

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Read theme accent color
    const accentRgb = getThemeAccentRgb();

    ctx.clearRect(0, 0, rect.width, rect.height);

    const barCount = waveformData.length;
    const barWidth = rect.width / barCount;

    // CapCut-style: No gaps, continuous bars for dense visualization
    const actualBarWidth = Math.max(1, Math.ceil(barWidth));

    for (let i = 0; i < barCount; i++) {
      const value = waveformData[i];
      const minHeight = 2;
      const maxHeight = rect.height * 0.95; // Use more vertical space
      const barHeight = Math.max(minHeight, value * maxHeight);

      const x = i * barWidth;
      const y = rect.height - barHeight; // Grow from bottom

      // Gradient effect for visual depth (like CapCut)
      const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
      gradient.addColorStop(0, `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.95)`);
      gradient.addColorStop(0.5, `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 1)`);
      gradient.addColorStop(1, `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.95)`);

      ctx.fillStyle = gradient;
      drawRoundedRect(ctx, x, y, actualBarWidth, barHeight, 0.5);
    }
  }, [waveformData, themeRevision]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full block ${className}`}
      style={{
        opacity: isLoading ? 0.3 : 1,
        transition: "opacity 150ms ease",
      }}
    />
  );
};
