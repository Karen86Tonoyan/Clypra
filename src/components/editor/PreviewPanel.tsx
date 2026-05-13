import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Expand, Pause, Play, Shrink, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { usePlaybackClock, usePlaybackControls, getPlaybackClock } from "../../hooks/usePlaybackClock";
import { useProjectStore } from "../../store/projectStore";
import { useTimelineStore } from "../../store/timelineStore";
import { useUIStore } from "../../store/uiStore";
import { evaluateSceneCached } from "../../core/evaluation/evaluator";
import { getFrameScheduler } from "../../core/scheduler/FrameScheduler";
import { getActiveSessionOrNull } from "../../core/runtime/ProjectSession";
import { SourcePreview } from "./SourcePreview";
import { GPUTextureCache } from "../../lib/gpuTextureCache";
import { cn } from "../../lib/utils";
import type { EvaluatedMediaLayer } from "../../core/evaluation/types";

/** Format time in seconds to MM:SS or HH:MM:SS */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** Program preview “viewer” aspect (width / height). */
type PreviewAspectPreset = "original" | "custom" | "16:9" | "4:3" | "2.35:1" | "2:1" | "1.85:1" | "9:16" | "3:4" | "5.8-inch" | "1:1";

const PREVIEW_ASPECT_LABEL: Record<PreviewAspectPreset, string> = {
  original: "Original",
  custom: "Custom",
  "16:9": "16:9",
  "4:3": "4:3",
  "2.35:1": "2.35:1",
  "2:1": "2:1",
  "1.85:1": "1.85:1",
  "9:16": "9:16",
  "3:4": "3:4",
  "5.8-inch": "5.8-inch",
  "1:1": "1:1",
};

const PREVIEW_ASPECT_RATIO: Partial<Record<PreviewAspectPreset, number>> = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "2.35:1": 2.35,
  "2:1": 2,
  "1.85:1": 1.85,
  "9:16": 9 / 16,
  "3:4": 3 / 4,
  "5.8-inch": 1170 / 2532,
  "1:1": 1,
};

function previewAspectWidthOverHeight(preset: PreviewAspectPreset, canvasWidth: number, canvasHeight: number): number {
  const ch = Math.max(1, canvasHeight);
  if (preset === "original" || preset === "custom") {
    return canvasWidth / ch;
  }
  return PREVIEW_ASPECT_RATIO[preset] ?? canvasWidth / ch;
}

/**
 * Resolve aspect ratio for "Original" preview mode.
 *
 * IMPORTANT: In professional NLEs, "Original" means the SEQUENCE aspect ratio,
 * NOT the source media aspect ratio. The sequence defines the render universe.
 *
 * The program monitor always visualizes sequence space, never adapts to clips.
 * This maintains stability for:
 * - Overlays and graphics
 * - Text positioning
 * - Motion graphics
 * - Transitions
 * - Export consistency
 *
 * If users want to see source media aspect ratio, they should use Source Preview mode.
 */
function resolveOriginalPreviewAspect(layers: readonly { mediaId: string }[], mediaAssets: Array<{ id: string; width?: number; height?: number }>, canvasWidth: number, canvasHeight: number): number {
  // Always return sequence aspect ratio
  // The sequence is the coordinate universe - it doesn't change based on clips
  return canvasWidth / Math.max(1, canvasHeight);
}

/** Largest rectangle with aspect W/H = R inside the panel. */
function previewViewportSize(panelWidth: number, panelHeight: number, widthOverHeight: number): { vw: number; vh: number } {
  const R = widthOverHeight;
  let vw = Math.min(panelWidth, panelHeight * R);
  let vh = vw / R;
  if (vh > panelHeight + 0.5) {
    vh = panelHeight;
    vw = vh * R;
  }
  return { vw: Math.max(1, vw), vh: Math.max(1, vh) };
}

function PreviewAspectShapeIcon({ widthOverHeight }: { widthOverHeight: number }) {
  const max = 22;
  const min = 8;
  let w: number;
  let h: number;
  if (widthOverHeight >= 1) {
    h = 12;
    w = Math.round(Math.min(max, Math.max(min, h * widthOverHeight)));
  } else {
    w = 12;
    h = Math.round(Math.min(max, Math.max(min, w / widthOverHeight)));
  }
  return <span className="inline-flex shrink-0 rounded-sm border border-border-soft bg-bg" style={{ width: w, height: h }} aria-hidden />;
}

function AspectMenuRow({ preset, selected, onSelect, icon, disabled }: { preset: PreviewAspectPreset; selected: PreviewAspectPreset; onSelect: (p: PreviewAspectPreset) => void; icon: React.ReactNode; disabled?: boolean }) {
  const isSel = selected === preset;
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSel}
      disabled={disabled}
      title={preset === "custom" ? "Custom size (coming soon)" : PREVIEW_ASPECT_LABEL[preset]}
      className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-raised", isSel && "bg-surface-raised", disabled && "cursor-not-allowed opacity-45 hover:bg-transparent")}
      onClick={() => {
        if (!disabled) onSelect(preset);
      }}
    >
      <span className="flex w-5 shrink-0 justify-center">{isSel ? <Check className="h-3.5 w-3.5 text-accent" /> : null}</span>
      <span className="min-w-0 flex-1 truncate">{PREVIEW_ASPECT_LABEL[preset]}</span>
      <span className="flex shrink-0 items-center justify-end text-text-muted">{icon}</span>
    </button>
  );
}

export const PreviewPanel: React.FC = () => {
  const { previewMode } = useUIStore();

  // If in source mode, show SourcePreview
  if (previewMode === "source") {
    return <SourcePreview />;
  }

  // Otherwise show program (timeline) preview
  return <ProgramPreview />;
};

const ProgramPreview: React.FC = () => {
  // Imperative clock (throttled UI snapshots, 10fps)
  const clockState = usePlaybackClock();
  const { play, pause, seek, setSpeed, setDuration, setFrameRate } = usePlaybackControls();
  const clock = getPlaybackClock();

  const project = useProjectStore((s) => s.project);
  const mediaAssets = useProjectStore((s) => s.mediaAssets);
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const epoch = useTimelineStore((s) => s.epoch);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  /** Bumps after program <video> metadata loads so we re-seek once duration is valid. */
  const [previewVideoReadyTick, setPreviewVideoReadyTick] = useState(0);
  /** fit = letterbox full canvas; fill = zoom canvas to cover panel (crop edges). */
  const [previewScaleMode, setPreviewScaleMode] = useState<"fit" | "fill">("fit");
  const [previewAspectPreset, setPreviewAspectPreset] = useState<PreviewAspectPreset>("original");
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const aspectMenuRef = useRef<HTMLDivElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const [useCanvasPreview] = useState(true); // Canvas is authoritative visual output
  const gpuCacheRef = useRef<GPUTextureCache | null>(null);
  const gpuFallbackRef = useRef(false); // true if WebGL2 unavailable → use Canvas2D
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [telemetryStats, setTelemetryStats] = useState<{
    avgEvaluationTimeMs: number;
    avgRasterTimeMs: number;
    avgTotalTimeMs: number;
    cacheHitRate: number;
    active: number;
    droppedFrames: number;
    driftMagnitude: number;
  } | null>(null);
  const telemetryRef = useRef(telemetryStats);
  const lastTelemetryFlushRef = useRef(0);
  const showTelemetryRef = useRef(showTelemetry);
  showTelemetryRef.current = showTelemetry;

  const droppedFramesRef = useRef(0);
  const maxDriftRef = useRef(0);

  // Initialize clock with project settings (only when they actually change)
  const prevDurationRef = useRef<number>(0);
  const prevFrameRateRef = useRef<number>(0);

  useEffect(() => {
    if (!project) return;

    // Calculate timeline duration from clips
    const maxEndTime = clips.reduce((max, clip) => {
      const endTime = clip.startTime + clip.duration;
      return Math.max(max, endTime);
    }, 0);

    const newDuration = Math.max(maxEndTime, 10); // Minimum 10 seconds
    const newFrameRate = project.frameRate || 30;

    // Only update if values actually changed
    if (newDuration !== prevDurationRef.current) {
      setDuration(newDuration);
      prevDurationRef.current = newDuration;
    }

    if (newFrameRate !== prevFrameRateRef.current) {
      setFrameRate(newFrameRate);
      prevFrameRateRef.current = newFrameRate;
    }
  }, [project, clips]);

  useEffect(() => {
    if (!aspectMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (aspectMenuRef.current && !aspectMenuRef.current.contains(e.target as Node)) {
        setAspectMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [aspectMenuOpen]);

  useEffect(() => {
    if (!speedMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setSpeedMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [speedMenuOpen]);

  useEffect(() => {
    const updateDimensions = () => {
      if (!containerRef.current) return;
      setDimensions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
    };

    const resizeObserver = new ResizeObserver(() => {
      updateDimensions();
      // Force canvas to re-render current frame after resize
      // The canvas rendering effect will restart due to displayWidth/displayHeight changes
    });

    // Also listen to window resize and fullscreen events for more reliable updates
    const handleResize = () => {
      updateDimensions();
    };

    const handleFullscreenChange = () => {
      // Delay to ensure layout has settled after fullscreen transition
      setTimeout(updateDimensions, 100);
      // Additional update after animation completes
      setTimeout(updateDimensions, 300);
    };

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
      setTimeout(updateDimensions, 0);
    }

    window.addEventListener("resize", handleResize);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange); // Safari

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, [project]);

  // Scene evaluation (for UI and initial render)
  const scene = useMemo(() => evaluateSceneCached(clockState.time, clips, tracks, mediaAssets, project ?? null, epoch), [tracks, clips, mediaAssets, clockState.time, project, epoch]);

  // Calculate display dimensions for canvas
  const canvasWidth = project?.canvasWidth ?? 1920;
  const canvasHeight = project?.canvasHeight ?? 1080;
  const originalAspectR = resolveOriginalPreviewAspect(
    scene.visualLayers.filter((l) => l.layerType === "media"),
    mediaAssets,
    canvasWidth,
    canvasHeight,
  );
  const aspectR = previewAspectPreset === "original" ? originalAspectR : previewAspectWidthOverHeight(previewAspectPreset, canvasWidth, canvasHeight);
  const { vw, vh } = previewViewportSize(dimensions.width, dimensions.height, aspectR);
  const scaleFit = Math.min(vw / canvasWidth, vh / canvasHeight);
  const scaleFill = Math.max(vw / canvasWidth, vh / canvasHeight);
  const scale = previewScaleMode === "fit" ? scaleFit : scaleFill;
  const displayWidth = canvasWidth * scale;
  const displayHeight = canvasHeight * scale;

  // Canvas rendering - INDEPENDENT RAF LOOP (not tied to React state)
  // GPU-first: uploads ImageBitmaps as WebGL2 textures for zero-copy reuse.
  // Falls back to Canvas2D if WebGL2 is unavailable.
  useEffect(() => {
    if (!useCanvasPreview || !canvasRef.current || !project) return;

    const canvas = canvasRef.current;

    if (displayWidth === 0 || displayHeight === 0) return;

    // ── Initialize GPU or Canvas2D rendering context ──────────────────
    let gpuCache: GPUTextureCache | null = null;
    let ctx2d: CanvasRenderingContext2D | null = null;

    if (!gpuFallbackRef.current) {
      try {
        gpuCache = new GPUTextureCache(canvas);
        gpuCacheRef.current = gpuCache;
        gpuCache.clear();
      } catch {
        // WebGL2 unavailable — fall back to Canvas2D
        gpuFallbackRef.current = true;
        gpuCache = null;
      }
    }

    if (!gpuCache) {
      ctx2d = canvas.getContext("2d");
      if (ctx2d) {
        ctx2d.clearRect(0, 0, displayWidth, displayHeight);
      }
    }

    // Get scheduler and update timeline state
    const scheduler = getFrameScheduler();
    scheduler.updateTimeline(clips, tracks, mediaAssets, project, epoch);

    let rafId: number | null = null;
    let isActive = true;
    let isRendering = false;
    let lastJobId: string | null = null;

    // GPU memory limit for preview frame textures (128 MB)
    const GPU_MEMORY_LIMIT_MB = 128;

    // Independent render loop (reads clock imperatively)
    const renderLoop = () => {
      if (!isActive) return;

      // Schedule next tick regardless of whether we render this frame
      rafId = requestAnimationFrame(renderLoop);

      // Drop frame if still rendering a previous frame
      if (isRendering) {
        droppedFramesRef.current++;
        return;
      }

      isRendering = true;
      const timeToRender = clock.time;

      // Check GPU texture cache for this frame (skip scheduler entirely on cache hit)
      if (gpuCache) {
        const cacheKey = `preview:${epoch}:${timeToRender.toFixed(3)}:${displayWidth}x${displayHeight}`;
        if (gpuCache.hasTexture(cacheKey)) {
          gpuCache.clear();
          gpuCache.renderTexture(cacheKey, 0, 0, displayWidth, displayHeight);
          isRendering = false;
          return;
        }
      }

      // Cancel previous job if still pending to prevent queue buildup
      if (lastJobId) {
        scheduler.cancel(lastJobId);
      }

      // Build map of active video elements to bypass resource decoding
      const activeVideoElements = new Map<string, HTMLVideoElement>();
      for (const [key, video] of Object.entries(videoRefs.current)) {
        if (video) {
          activeVideoElements.set(key, video);
        }
      }

      // Schedule frame render
      const jobId = scheduler.schedule({
        time: timeToRender,
        resolution: {
          width: displayWidth,
          height: displayHeight,
        },
        pixelRatio: 1,
        outputFormat: "imagebitmap",
        priority: "realtime",
        videoElements: activeVideoElements,
      });
      lastJobId = jobId;

      scheduler
        .wait(jobId)
        .then((result) => {
          isRendering = false;
          if (!isActive) return;

          if (result.data instanceof ImageBitmap) {
            if (gpuCache) {
              // GPU path: upload bitmap as texture, render from GPU, close bitmap
              const cacheKey = `preview:${epoch}:${timeToRender.toFixed(3)}:${displayWidth}x${displayHeight}`;
              gpuCache.uploadTexture(cacheKey, result.data, result.data.width, result.data.height);
              gpuCache.clear();
              gpuCache.renderTexture(cacheKey, 0, 0, displayWidth, displayHeight);
              result.data.close();

              // Evict LRU textures if GPU memory exceeds limit
              gpuCache.evictLRU(GPU_MEMORY_LIMIT_MB);
            } else if (ctx2d) {
              // Canvas2D fallback path
              ctx2d.clearRect(0, 0, displayWidth, displayHeight);
              ctx2d.drawImage(result.data, 0, 0);
              result.data.close();
            }
          }

          // Update telemetry (throttled to 4fps, only when visible)
          const stats = scheduler.getStats();
          telemetryRef.current = {
            avgEvaluationTimeMs: stats.avgEvaluationTimeMs,
            avgRasterTimeMs: stats.avgRasterTimeMs,
            avgTotalTimeMs: stats.avgTotalTimeMs,
            cacheHitRate: stats.cacheHitRate,
            active: stats.active,
            droppedFrames: droppedFramesRef.current,
            driftMagnitude: maxDriftRef.current,
          };
          const now = performance.now();
          if (showTelemetryRef.current && now - lastTelemetryFlushRef.current > 250) {
            lastTelemetryFlushRef.current = now;
            setTelemetryStats(telemetryRef.current);
            maxDriftRef.current = 0;
          }
        })
        .catch((error: Error) => {
          isRendering = false;
          if (error.message !== "Job cancelled" && isActive) {
            console.error("Failed to render frame:", error);
          }
        });
    };

    // Start render loop
    rafId = requestAnimationFrame(renderLoop);

    // Cleanup
    return () => {
      isActive = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (lastJobId) {
        scheduler.cancel(lastJobId);
      }
      // Dispose GPU cache to release all WebGL textures and context
      if (gpuCache) {
        gpuCache.dispose();
        gpuCacheRef.current = null;
      }
    };
  }, [useCanvasPreview, clips, tracks, mediaAssets, project, epoch, clock, displayWidth, displayHeight]);

  // Video sync - EVENT DRIVEN (only on state changes, not every frame)
  useEffect(() => {
    const currentClockTime = clock.time;
    const session = getActiveSessionOrNull();

    Object.values(videoRefs.current).forEach((video) => {
      if (!video) return;

      // Register video element with session for lifecycle management
      if (session && session.state === "active") {
        const clipId = video.dataset.clipId;
        const mediaId = video.dataset.mediaId;
        if (clipId && mediaId) {
          const key = `${clipId}-${mediaId}`;
          session.registerVideoElement(key, video);
        }
      }

      // Audio settings
      video.muted = isMuted || volume === 0;
      video.volume = Math.max(0, Math.min(1, volume / 100));
      video.playbackRate = clockState.speed;

      // Set initial time when starting playback or when paused
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const clipId = video.dataset.clipId;
        const clip = clips.find((c) => c.id === clipId);

        if (clip) {
          const clipLocalTime = currentClockTime - clip.startTime;
          const trimIn = clip.trimIn || 0; // Default to 0 if undefined
          const sourceTime = trimIn + clipLocalTime;
          const targetTime = Math.max(0, Math.min(sourceTime, Math.max(0, video.duration - 0.01)));

          // Set time when paused or when starting playback
          if (clockState.state !== "playing") {
            video.currentTime = targetTime;
          } else if (video.paused) {
            // Starting playback - set initial time
            video.currentTime = targetTime;
          }
        }
      }

      // Play/pause based on clock state
      if (clockState.state === "playing") {
        if (video.paused && video.readyState >= 2) {
          // Only play if video has enough data (HAVE_CURRENT_DATA or better)
          const playPromise = video.play();
          if (playPromise !== undefined) {
            playPromise.catch((err) => {
              // Ignore AbortError - it's expected when rapidly seeking or changing state
              if (err.name !== "AbortError") {
                console.warn("video.play() failed:", err);
              }
            });
          }
        }
      } else {
        if (!video.paused) {
          video.pause();
        }
      }
    });

    // Cleanup: unregister video elements when effect cleans up
    return () => {
      if (session && session.state === "active") {
        Object.values(videoRefs.current).forEach((video) => {
          if (!video) return;
          const clipId = video.dataset.clipId;
          const mediaId = video.dataset.mediaId;
          if (clipId && mediaId) {
            const key = `${clipId}-${mediaId}`;
            session.unregisterVideoElement(key);
          }
        });
      }
    };
  }, [clockState.state, isMuted, volume, clockState.speed, clips, clock, previewVideoReadyTick, scene.metadata.activeMediaHash]);

  // Continuous drift correction via RAF (replaces 250ms interval for frame-accurate sync)
  useEffect(() => {
    if (clockState.state !== "playing") return;

    let rafId: number | null = null;

    const syncLoop = () => {
      const currentClockTime = clock.time; // Fresh time every frame

      Object.values(videoRefs.current).forEach((video) => {
        if (!video) return;

        const clipId = video.dataset.clipId;
        const clip = clips.find((c) => c.id === clipId);
        if (!clip) return;

        const clipLocalTime = currentClockTime - clip.startTime;
        if (clipLocalTime < 0 || clipLocalTime > clip.duration) {
          if (!video.paused) video.pause();
          return;
        }

        const trimIn = clip.trimIn || 0;
        const sourceTime = trimIn + clipLocalTime;

        if (Number.isFinite(video.duration) && video.duration > 0 && video.readyState >= 3) {
          const targetTime = Math.max(0, Math.min(sourceTime, Math.max(0, video.duration - 0.01)));
          const drift = Math.abs(video.currentTime - targetTime);

          maxDriftRef.current = Math.max(maxDriftRef.current, drift);

          if ("preservesPitch" in video) {
            (video as any).preservesPitch = false;
          }

          if (drift < 0.1) {
            // <100ms: Perfect sync — just ensure correct playbackRate
            if (Math.abs(video.playbackRate - clockState.speed) > 0.01) {
              video.playbackRate = clockState.speed;
            }
          } else if (drift <= 0.3) {
            // 100ms - 300ms: Soft playbackRate correction
            const correctionSpeed = video.currentTime < targetTime ? clockState.speed * 1.02 : clockState.speed * 0.98;
            if (Math.abs(video.playbackRate - correctionSpeed) > 0.01) {
              video.playbackRate = correctionSpeed;
            }
          } else if (drift <= 0.6) {
            // 300ms - 600ms: Hard seek
            video.currentTime = targetTime;
            video.playbackRate = clockState.speed;
          } else {
            // >600ms: Playback recovery reset
            video.pause();
            video.currentTime = targetTime;
            video.playbackRate = clockState.speed;
            const p = video.play();
            if (p && typeof p.catch === "function") p.catch(console.error);
          }
        }
      });

      rafId = requestAnimationFrame(syncLoop);
    };

    rafId = requestAnimationFrame(syncLoop);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [clockState.state, clockState.speed, clips, clock]);

  if (!project) return null;

  if (dimensions.width === 0 || dimensions.height === 0) {
    return (
      <div className="flex-1 bg-bg flex flex-col min-h-0 rounded-tl-xl border-l border-t border-white/3">
        <div className="flex-1 flex items-center justify-center p-4 md:p-6 overflow-hidden relative bg-[#06080a]">
          <div ref={containerRef} className="w-full h-full flex items-center justify-center">
            <div className="text-text-muted">Loading preview...</div>
          </div>
        </div>
      </div>
    );
  }

  const landscapePresets: PreviewAspectPreset[] = ["16:9", "4:3", "2.35:1", "2:1", "1.85:1"];
  const portraitPresets: PreviewAspectPreset[] = ["9:16", "3:4", "5.8-inch"];

  const selectAspectPreset = (p: PreviewAspectPreset) => {
    if (p === "custom") return;
    setPreviewAspectPreset(p);
    setAspectMenuOpen(false);
  };

  // Derive UI values from clock state
  const currentTime = clockState.time;
  const duration = clockState.duration;
  const isPlaying = clockState.state === "playing";
  const playbackSpeed = clockState.speed;
  const frameRate = clockState.frameRate;
  const step = 1 / Math.max(1, frameRate);

  return (
    <div className="flex-1 bg-bg flex flex-col min-h-0 rounded-tl-xl border-l border-t border-white/3">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center px-4 h-10 shrink-0 gap-2">
        <span className="text-[13px] font-semibold text-text-primary tracking-tight">Program Preview</span>
        <span className="text-[13px] text-text-muted">— Timeline</span>
        <button onClick={() => setShowTelemetry((s) => !s)} className={cn("ml-auto px-2 h-6 rounded text-[10px] font-medium transition-colors", showTelemetry ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary hover:bg-white/6")} title="Toggle render telemetry" aria-label="Toggle render telemetry">
          Stats
        </button>
      </div>

      {/* ── Video Area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#06080a] relative">
        <div className="absolute inset-0 checkerboard opacity-[0.15] pointer-events-none" />
        <div ref={containerRef} className="w-full h-full flex items-center justify-center relative z-10 overflow-hidden">
          <div data-testid="program-preview-viewport" className="relative flex shrink-0 items-center justify-center overflow-hidden shadow-[0_0_40px_rgba(0, 0, 0, 0.36)]" style={{ width: vw, height: vh }}>
            {useCanvasPreview ? (
              <>
                {/* Canvas-based preview (matches export rendering) */}
                <canvas
                  ref={canvasRef}
                  data-testid="program-preview-canvas"
                  width={displayWidth}
                  height={displayHeight}
                  style={{
                    width: displayWidth,
                    height: displayHeight,
                    imageRendering: "auto",
                  }}
                  className="bg-black"
                />
                {/* Hidden video elements for audio/video sync (ENGINE CLOCK IS MASTER). 
                    CRITICAL: Do NOT use width: 0, height: 0, or opacity: 0. 
                    Browsers throttle decoding for invisible videos, destroying A/V sync.
                    Keep them 1x1 pixel with near-zero opacity to force hardware decoding. */}
                <div className="absolute top-0 left-0 pointer-events-none -z-10" style={{ width: "1px", height: "1px", opacity: 0.001, overflow: "hidden" }}>
                  {scene.visualLayers
                    .filter((l): l is EvaluatedMediaLayer => l.layerType === "media" && l.mediaType === "video")
                    .map((layer) => (
                      <video
                        key={`audio-${layer.clipId}-${layer.mediaId}`}
                        data-media-id={layer.mediaId}
                        data-clip-id={layer.clipId}
                        ref={(el) => {
                          videoRefs.current[`${layer.clipId}-${layer.mediaId}`] = el;
                        }}
                        src={layer.sourcePath}
                        muted={isMuted || volume === 0}
                        playsInline
                        preload="auto"
                        onLoadedMetadata={() => setPreviewVideoReadyTick((n) => n + 1)}
                        className="w-full h-full"
                      />
                    ))}
                </div>
              </>
            ) : (
              // DOM-based preview (legacy, for comparison)
              <div data-testid="program-preview-canvas" className="relative shrink-0 bg-black" style={{ width: displayWidth, height: displayHeight }}>
                {scene.visualLayers.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-text-muted">Preview</div>
                ) : (
                  scene.visualLayers.map((layer) => {
                    // Render text layers
                    if (layer.layerType === "text") {
                      return (
                        <div
                          key={layer.layerId}
                          data-testid="preview-text-layer"
                          className="absolute overflow-hidden flex items-center justify-center"
                          style={{
                            left: layer.x * scale,
                            top: layer.y * scale,
                            width: layer.width * scale,
                            height: layer.height * scale,
                            opacity: Math.max(0, Math.min(1, layer.opacity > 1 ? layer.opacity / 100 : layer.opacity)),
                            transform: `rotate(${layer.rotation}deg)`,
                            transformOrigin: "center center",
                            zIndex: layer.zIndex + 1,
                          }}
                        >
                          <div
                            style={{
                              fontFamily: layer.fontFamily,
                              fontSize: `${layer.fontSize * scale}px`,
                              color: layer.color,
                              fontWeight: layer.fontWeight,
                              fontStyle: layer.fontStyle,
                              textAlign: layer.textAlign,
                              lineHeight: layer.lineHeight,
                              letterSpacing: `${layer.letterSpacing * scale}px`,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              width: "100%",
                              padding: "8px",
                            }}
                          >
                            {layer.text}
                          </div>
                        </div>
                      );
                    }

                    // Render media layers (video/image)
                    return (
                      <div
                        key={layer.layerId}
                        data-testid="preview-layer"
                        className="absolute overflow-hidden"
                        style={{
                          left: layer.x * scale,
                          top: layer.y * scale,
                          width: layer.width * scale,
                          height: layer.height * scale,
                          opacity: Math.max(0, Math.min(1, layer.opacity > 1 ? layer.opacity / 100 : layer.opacity)),
                          transform: `rotate(${layer.rotation}deg)`,
                          transformOrigin: "center center",
                          zIndex: layer.zIndex + 1,
                        }}
                      >
                        {layer.mediaType === "video" ? (
                          <video
                            data-media-id={layer.mediaId}
                            data-clip-id={layer.clipId}
                            ref={(el) => {
                              videoRefs.current[`${layer.clipId}-${layer.mediaId}`] = el;
                            }}
                            src={layer.sourcePath}
                            muted={isMuted || volume === 0}
                            playsInline
                            preload="auto"
                            onLoadedMetadata={() => setPreviewVideoReadyTick((n) => n + 1)}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <img src={layer.posterFrame || layer.sourcePath} alt={layer.mediaId} className="w-full h-full object-contain" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {/* Professional empty state - shows sequence context when no clips. Applied same width and height has canvas, so that it's always fit-in professionally*/}
        {clips.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none mx-auto" style={{ width: vw, height: vh }}>
            <div className="text-center space-y-3">
              <div className="text-sm font-medium text-text-muted">No clips in sequence</div>
              <div className="text-xs text-text-muted/80 space-y-1 font-mono">
                <div>
                  {canvasWidth}×{canvasHeight} • {frameRate}fps
                </div>
                <div className="text-text-muted/60">Rec.709</div>
              </div>
              <div className="text-xs text-text-muted/70 mt-4">Import media or drag clips to timeline</div>
            </div>
          </div>
        )}

        {/* Telemetry Overlay */}
        {showTelemetry && telemetryStats && (
          <div className="absolute top-4 left-4 z-20 bg-black/80 backdrop-blur-sm rounded-lg p-3 text-xs font-mono text-white/90 space-y-1 border border-white/10">
            <div className="font-semibold text-accent mb-2">Render Telemetry</div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Eval:</span>
              <span>{telemetryStats.avgEvaluationTimeMs.toFixed(2)}ms</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Raster:</span>
              <span>{telemetryStats.avgRasterTimeMs.toFixed(2)}ms</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Total:</span>
              <span>{telemetryStats.avgTotalTimeMs.toFixed(2)}ms</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Cache:</span>
              <span>{(telemetryStats.cacheHitRate * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Active:</span>
              <span>{telemetryStats.active}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Dropped:</span>
              <span className={telemetryStats.droppedFrames > 0 ? "text-yellow-400" : ""}>{telemetryStats.droppedFrames}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-white/60">Max Drift:</span>
              <span className={telemetryStats.driftMagnitude > 0.04 ? "text-yellow-400" : ""}>{(telemetryStats.driftMagnitude * 1000).toFixed(0)}ms</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Scrub Bar (thin, edge-to-edge) ────────────────────────── */}
      <div
        className="h-[5px] w-full cursor-pointer group relative shrink-0"
        onMouseDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const doSeek = (clientX: number) => {
            const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            seek(ratio * duration);
          };
          doSeek(e.clientX);
          const handleMove = (moveEvent: MouseEvent) => doSeek(moveEvent.clientX);
          const handleUp = () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", handleUp);
          };
          window.addEventListener("mousemove", handleMove);
          window.addEventListener("mouseup", handleUp);
        }}
      >
        <div className="absolute inset-0 bg-surface" />
        <div className="absolute top-0 bottom-0 left-0 bg-accent" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
        <div className="absolute top-1/2 -translate-y-1/2 w-[10px] h-[10px] rounded-full bg-accent border-2 border-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ left: `calc(${duration > 0 ? (currentTime / duration) * 100 : 0}% - 5px)` }} />
      </div>

      {/* ── Bottom Controls ────────────────────────────────────────── */}
      <div className="flex items-center h-10 px-3 shrink-0 relative">
        {/* Timecodes */}
        <div className="flex items-center gap-1">
          <div className="flex items-baseline gap-1 select-none w-[120px]" style={{ fontVariantNumeric: "tabular-nums" }}>
            <span className="text-[12px] font-medium text-accent">{formatTime(currentTime)}</span>
            <span className="text-[11px] text-text-muted/50">/</span>
            <span className="text-[12px] text-text-muted">{formatTime(duration)}</span>
          </div>

          {/* Speed menu */}
          <div className="relative" ref={speedMenuRef}>
            <button onClick={() => setSpeedMenuOpen((o) => !o)} className="flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors" title="Playback speed" aria-expanded={speedMenuOpen}>
              <span className="max-w-18 truncate">{playbackSpeed}x</span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
            </button>
            {speedMenuOpen && (
              <div className="absolute bottom-full right-0 z-50 mb-1 w-[140px] overflow-hidden rounded-lg border border-border bg-surface py-1 text-text-primary shadow-xl" role="listbox">
                <div className="px-1">
                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                    <button
                      key={speed}
                      type="button"
                      role="option"
                      aria-selected={playbackSpeed === speed}
                      className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-raised", playbackSpeed === speed && "bg-surface-raised")}
                      onClick={() => {
                        setSpeed(speed);
                        setSpeedMenuOpen(false);
                      }}
                    >
                      <span className="flex w-5 shrink-0 justify-center">{playbackSpeed === speed ? <Check className="h-3.5 w-3.5 text-accent" /> : null}</span>
                      <span className="min-w-0 flex-1 truncate">{speed}x</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center play controls */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1">
          <button onClick={() => seek(Math.max(0, currentTime - step))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/6 transition-colors text-text-muted hover:text-text-primary" title="Previous frame" aria-label="Previous frame">
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              isPlaying ? pause() : play();
            }}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/6 transition-colors text-text-primary mx-1"
            title={isPlaying ? "Pause" : "Play"}
            aria-label={isPlaying ? "Pause playback" : "Play playback"}
          >
            {isPlaying ? <Pause className="w-[18px] h-[18px]" /> : <Play className="w-[18px] h-[18px] ml-0.5" />}
          </button>
          <button onClick={() => seek(Math.min(duration, currentTime + step))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/6 transition-colors text-text-muted hover:text-text-primary" title="Next frame" aria-label="Next frame">
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right side actions */}
        <div className="ml-auto flex items-center gap-2">
          {/* Aspect menu */}
          <div className="relative shrink-0" ref={aspectMenuRef}>
            <button onClick={() => setAspectMenuOpen((o) => !o)} className="flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors" title="Preview aspect ratio" aria-expanded={aspectMenuOpen}>
              <span className="max-w-18 truncate">{PREVIEW_ASPECT_LABEL[previewAspectPreset]}</span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
            </button>
            {aspectMenuOpen && (
              <div className="absolute bottom-full right-0 z-50 mb-1 w-[220px] overflow-hidden rounded-lg border border-border bg-surface py-1 text-text-primary shadow-xl" role="listbox">
                <div className="px-1">
                  <AspectMenuRow preset="original" selected={previewAspectPreset} onSelect={selectAspectPreset} icon={<PreviewAspectShapeIcon widthOverHeight={canvasWidth / Math.max(1, canvasHeight)} />} />
                  <AspectMenuRow preset="custom" selected={previewAspectPreset} onSelect={selectAspectPreset} disabled icon={<span className="w-[22px]" />} />
                </div>
                <div className="my-1 h-px bg-border" />
                <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Landscape</div>
                <div className="px-1">
                  {landscapePresets.map((p) => (
                    <AspectMenuRow key={p} preset={p} selected={previewAspectPreset} onSelect={selectAspectPreset} icon={<PreviewAspectShapeIcon widthOverHeight={PREVIEW_ASPECT_RATIO[p]!} />} />
                  ))}
                </div>
                <div className="my-1 h-px bg-border" />
                <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Portrait</div>
                <div className="px-1">
                  {portraitPresets.map((p) => (
                    <AspectMenuRow key={p} preset={p} selected={previewAspectPreset} onSelect={selectAspectPreset} icon={<PreviewAspectShapeIcon widthOverHeight={PREVIEW_ASPECT_RATIO[p]!} />} />
                  ))}
                </div>
                <div className="my-1 h-px bg-border" />
                <div className="px-1">
                  <AspectMenuRow preset="1:1" selected={previewAspectPreset} onSelect={selectAspectPreset} icon={<PreviewAspectShapeIcon widthOverHeight={1} />} />
                </div>
              </div>
            )}
          </div>

          <button onClick={() => setPreviewScaleMode((m) => (m === "fit" ? "fill" : "fit"))} className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors" title={previewScaleMode === "fit" ? "Fill preview — scale to cover (crop edges)" : "Fit preview — show entire frame (letterbox)"} aria-label={previewScaleMode === "fit" ? "Fill preview" : "Fit preview"}>
            {previewScaleMode === "fit" ? <Expand className="w-3.5 h-3.5" /> : <Shrink className="w-3.5 h-3.5" />}
          </button>

          <div className="w-px h-4 bg-white/10 mx-1" />

          <button onClick={() => setIsMuted((m) => !m)} className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors" title={isMuted ? "Unmute" : "Mute"} aria-label={isMuted ? "Unmute audio" : "Mute audio"}>
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-16 h-1 bg-surface-raised rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent cursor-pointer" />
        </div>
      </div>
    </div>
  );
};
