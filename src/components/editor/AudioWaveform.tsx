import React, { useRef, useEffect, useState } from "react";
import { Music } from "lucide-react";

interface AudioWaveformProps {
  audioElement: HTMLAudioElement | null;
  isPlaying: boolean;
  coverImage?: string;
  audioName?: string;
  className?: string;
}

/**
 * Audio waveform visualizer component - CapCut style
 * Full-screen blurred background with centered artwork and waveform below
 */
export const AudioWaveform: React.FC<AudioWaveformProps> = ({ audioElement, isPlaying, coverImage, audioName, className = "" }) => {
  const canvasLeftRef = useRef<HTMLCanvasElement>(null);
  const canvasRightRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize Web Audio API
  useEffect(() => {
    if (!audioElement || isInitialized) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaElementSource(audioElement);

      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;

      source.connect(analyser);
      analyser.connect(audioContext.destination);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      analyserRef.current = analyser;
      dataArrayRef.current = dataArray;
      audioContextRef.current = audioContext;
      setIsInitialized(true);
    } catch (err) {
      console.error("[AudioWaveform] Failed to initialize:", err);
    }

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
      }
    };
  }, [audioElement, isInitialized]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying || !analyserRef.current || !dataArrayRef.current) return;

    const canvasLeft = canvasLeftRef.current;
    const canvasRight = canvasRightRef.current;
    if (!canvasLeft || !canvasRight) return;

    const ctxLeft = canvasLeft.getContext("2d");
    const ctxRight = canvasRight.getContext("2d");
    if (!ctxLeft || !ctxRight) return;

    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;

    const draw = () => {
      analyser.getByteFrequencyData(dataArray);

      ctxLeft.clearRect(0, 0, canvasLeft.width, canvasLeft.height);
      ctxRight.clearRect(0, 0, canvasRight.width, canvasRight.height);

      const barCount = 24;
      const barWidth = canvasLeft.width / barCount;
      const barGap = barWidth * 0.3;
      const actualBarWidth = barWidth - barGap;

      // Draw left waveform (reversed)
      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i / barCount) * dataArray.length);
        const value = dataArray[dataIndex];
        const normalizedValue = value / 255;

        const minHeight = 3;
        const maxHeight = canvasLeft.height * 0.7;
        const barHeight = Math.max(minHeight, normalizedValue * maxHeight);

        const x = (barCount - 1 - i) * barWidth + barGap / 2;
        const y = (canvasLeft.height - barHeight) / 2;

        const opacity = 0.4 + (i / barCount) * 0.6;
        ctxLeft.fillStyle = `rgba(148, 163, 184, ${opacity})`;

        drawRoundedRect(ctxLeft, x, y, actualBarWidth, barHeight, 2);
      }

      // Draw right waveform
      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i / barCount) * dataArray.length);
        const value = dataArray[dataIndex];
        const normalizedValue = value / 255;

        const minHeight = 3;
        const maxHeight = canvasRight.height * 0.7;
        const barHeight = Math.max(minHeight, normalizedValue * maxHeight);

        const x = i * barWidth + barGap / 2;
        const y = (canvasRight.height - barHeight) / 2;

        const opacity = 0.6 - (i / barCount) * 0.6;
        ctxRight.fillStyle = `rgba(148, 163, 184, ${opacity})`;

        drawRoundedRect(ctxRight, x, y, actualBarWidth, barHeight, 2);
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying]);

  // Draw static waveform when not playing
  useEffect(() => {
    if (isPlaying) return;

    const canvasLeft = canvasLeftRef.current;
    const canvasRight = canvasRightRef.current;
    if (!canvasLeft || !canvasRight) return;

    const ctxLeft = canvasLeft.getContext("2d");
    const ctxRight = canvasRight.getContext("2d");
    if (!ctxLeft || !ctxRight) return;

    ctxLeft.clearRect(0, 0, canvasLeft.width, canvasLeft.height);
    ctxRight.clearRect(0, 0, canvasRight.width, canvasRight.height);

    const barCount = 24;
    const barWidth = canvasLeft.width / barCount;
    const barGap = barWidth * 0.3;
    const actualBarWidth = barWidth - barGap;

    // Draw static left waveform
    for (let i = 0; i < barCount; i++) {
      const seed = Math.sin(i * 0.5) * 0.5 + 0.5;
      const minHeight = 3;
      const maxHeight = canvasLeft.height * 0.4;
      const barHeight = Math.max(minHeight, seed * maxHeight);

      const x = (barCount - 1 - i) * barWidth + barGap / 2;
      const y = (canvasLeft.height - barHeight) / 2;

      const opacity = 0.2 + (i / barCount) * 0.3;
      ctxLeft.fillStyle = `rgba(100, 116, 139, ${opacity})`;

      drawRoundedRect(ctxLeft, x, y, actualBarWidth, barHeight, 2);
    }

    // Draw static right waveform
    for (let i = 0; i < barCount; i++) {
      const seed = Math.sin(i * 0.5) * 0.5 + 0.5;
      const minHeight = 3;
      const maxHeight = canvasRight.height * 0.4;
      const barHeight = Math.max(minHeight, seed * maxHeight);

      const x = i * barWidth + barGap / 2;
      const y = (canvasRight.height - barHeight) / 2;

      const opacity = 0.3 - (i / barCount) * 0.3;
      ctxRight.fillStyle = `rgba(100, 116, 139, ${opacity})`;

      drawRoundedRect(ctxRight, x, y, actualBarWidth, barHeight, 2);
    }
  }, [isPlaying]);

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      {/* Full-screen blurred background */}
      <div className="absolute inset-0 overflow-hidden">
        {coverImage ? (
          <>
            {/* Full-size blurred artwork background */}
            <img src={coverImage} alt="" className="absolute inset-0 w-full h-full object-cover blur-xl" />
            {/* Dark vignette overlay */}
            <div className="absolute inset-0 bg-background/60" />
          </>
        ) : (
          /* Solid dark background if no artwork */
          <div className="absolute inset-0 bg-gradient-to-br from-background to-card" />
        )}
      </div>

      {/* Content layer */}
      <div className="relative z-10 flex flex-col items-center justify-center w-full h-full gap-12 px-12 py-8">
        {/* Top: Album artwork or music icon */}
        <div className="shrink-0">
          {coverImage ? (
            <img src={coverImage} alt={audioName || "Album artwork"} className="w-52 h-52 rounded-md shadow-[var(--elev-shadow)] ring-1 ring-border object-cover" />
          ) : (
            <div className="w-80 h-80 rounded-3xl bg-card/50 backdrop-blur-sm flex items-center justify-center ring-1 ring-border">
              <Music className="w-32 h-32 text-muted-foreground" strokeWidth={1.5} />
            </div>
          )}
        </div>
      </div>

      {/* Playing indicator */}
      {isPlaying && (
        <div className="absolute top-2 right-2 z-20">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/20 backdrop-blur-sm ring-1 ring-accent/30">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-xs font-medium text-accent-foreground">Playing</span>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Helper function to draw rounded rectangles
 */
function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}
