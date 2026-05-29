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

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, Expand, Shrink, Volume2, VolumeX } from "lucide-react";
import { usePlaybackClock, usePlaybackControls, useTransportControls, getPlaybackClock } from "@/hooks/usePlaybackClock";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { evaluateSceneCached } from "@/core/evaluation/evaluator";
import { getFrameScheduler } from "@/core/scheduler/FrameScheduler";
import { getActiveSessionOrNull, subscribeToSessionChanges } from "@/core/runtime/ProjectSession";
import { SourcePreview } from "./SourcePreview";
import { PreviewTransport } from "./PreviewTransport";
import { TransformOverlayMemoized as TransformOverlay } from "./transform/TransformOverlay";
import { useViewportKeyboardShortcuts, useViewportWheelZoom, useViewportPan } from "./ViewportControls";
import { calculateDisplayTransform } from "@/lib/coordinateSystem";
import { GPUTextureCache } from "@/lib/gpuTextureCache";
import { PreviewQualityManager, PreviewQualityTier } from "@/lib/preview/PreviewQualityManager";
import { cn } from "@/lib/utils";
// import type { EvaluatedMediaLayer } from "@/core/evaluation/types";
import { AspectRatio, PREVIEW_ASPECT_LABEL } from "@/types";
import { AspectMenuRow } from "../ui/AspectRatio";
import { formatTime } from "@/lib/timeFormatting";

const PREVIEW_ASPECT_RATIO: Record<AspectRatio, number | null> = {
  original: null, // Uses project canvas
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
};

// Canvas dimensions for each preset (based on common resolutions)
const CANVAS_DIMENSIONS: Record<Exclude<AspectRatio, "original">, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

// function previewAspectWidthOverHeight(preset: AspectRatio, canvasWidth: number, canvasHeight: number): number {
//   const ch = Math.max(1, canvasHeight);
//   if (preset === "original") {
//     return canvasWidth / ch;
//   }
//   return PREVIEW_ASPECT_RATIO[preset] ?? canvasWidth / ch;
// }

// function resolveOriginalPreviewAspect(layers: readonly { mediaId: string }[], mediaAssets: Array<{ id: string; width?: number; height?: number }>, canvasWidth: number, canvasHeight: number): number {
//   // Always return sequence aspect ratio
//   // The sequence is the coordinate universe - it doesn't change based on clips
//   return canvasWidth / Math.max(1, canvasHeight);
// }

// /** Largest rectangle with aspect W/H = R inside the panel. */
// function previewViewportSize(panelWidth: number, panelHeight: number, widthOverHeight: number): { vw: number; vh: number } {
//   const R = widthOverHeight;
//   let vw = Math.min(panelWidth, panelHeight * R);
//   let vh = vw / R;
//   if (vh > panelHeight + 0.5) {
//     vh = panelHeight;
//     vw = vh * R;
//   }
//   return { vw: Math.max(1, vw), vh: Math.max(1, vh) };
// }

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

export const PreviewPanel: React.FC = () => {
  const { previewMode } = useUIStore();

  // If in source mode, show SourcePreview
  if (previewMode === "source") {
    return <SourcePreview />;
  }

  return <ProgramPreview />;
};

const ProgramPreview: React.FC = () => {
  // =========================================================================
  // 1. SELECTORS & STATE SUBSCRIPTIONS (Strictly first)
  // =========================================================================
  const project = useProjectStore((s) => s.project);
  const updateProject = useProjectStore((s) => s.updateProject);
  const mediaAssets = useProjectStore((s) => s.mediaAssets);
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const epoch = useTimelineStore((s) => s.epoch);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const { previewViewport } = useUIStore();
  const activeSession = useSyncExternalStore(subscribeToSessionChanges, getActiveSessionOrNull, () => null);

  // =========================================================================
  // 2. CORE REACT & PLAYBACK HOOKS
  // =========================================================================
  const clockState = usePlaybackClock();
  const clock = getPlaybackClock();
  const { seek, setSpeed, setDuration, setFrameRate } = usePlaybackControls();
  const { play: transportPlay, pause: transportPause, setActiveContext } = useTransportControls();

  // =========================================================================
  // 3. STATE DECLARATIONS (useState)
  // =========================================================================
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [previewScaleMode, setPreviewScaleMode] = useState<"fit" | "fill">("fit");
  const [previewAspectPreset, setPreviewAspectPreset] = useState<AspectRatio>("original");
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [useCanvasPreview] = useState(true);
  const [telemetryStats, setTelemetryStats] = useState<{
    avgEvaluationTimeMs: number;
    avgRasterTimeMs: number;
    avgTotalTimeMs: number;
    cacheHitRate: number;
    active: number;
    droppedFrames: number;
    driftMagnitude: number;
  } | null>(null);

  // =========================================================================
  // 4. REF DECLARATIONS (useRef)
  // =========================================================================
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aspectMenuRef = useRef<HTMLDivElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const gpuCacheRef = useRef<GPUTextureCache | null>(null);
  const gpuFallbackRef = useRef(false);
  const qualityManagerRef = useRef<PreviewQualityManager | null>(null);
  const qualityManagerSigRef = useRef<string>("");
  const telemetryRef = useRef(telemetryStats);
  const lastTelemetryFlushRef = useRef(0);
  const showTelemetryRef = useRef(showTelemetry);
  const droppedFramesRef = useRef(0);
  const maxDriftRef = useRef(0);
  const originalCanvasDimsRef = useRef<{ width: number; height: number } | null>(null);
  const prevDurationRef = useRef<number>(0);
  const prevFrameRateRef = useRef<number>(0);
  
  const renderStateRef = useRef({
    clips,
    tracks,
    mediaAssets,
    project,
    epoch,
    clock,
    clockState,
    canvasWidth: project?.canvasWidth ?? 1920,
    canvasHeight: project?.canvasHeight ?? 1080,
    displayWidth: 0,
    displayHeight: 0,
    dpr: window.devicePixelRatio || 1,
  });

  // Sync refs on every render
  showTelemetryRef.current = showTelemetry;
  renderStateRef.current.clips = clips;
  renderStateRef.current.tracks = tracks;
  renderStateRef.current.mediaAssets = mediaAssets;
  renderStateRef.current.project = project;
  renderStateRef.current.epoch = epoch;
  renderStateRef.current.clock = clock;
  renderStateRef.current.clockState = clockState;
  renderStateRef.current.dpr = window.devicePixelRatio || 1;

  // =========================================================================
  // 5. VIEWPORT CONTROL HOOKS & DERIVATIONS
  // =========================================================================
  const canvasWidth = project?.canvasWidth ?? 1920;
  const canvasHeight = project?.canvasHeight ?? 1080;

  useViewportKeyboardShortcuts(canvasWidth, canvasHeight, dimensions.width, dimensions.height);
  useViewportWheelZoom(containerRef as React.RefObject<HTMLElement>);
  const { isPanning, spacePressed } = useViewportPan(containerRef as React.RefObject<HTMLElement>);

  // =========================================================================
  // 6. DERIVED MEMOIZED VALUES (useMemo)
  // =========================================================================
  const displayTransform = useMemo(() => {
    return calculateDisplayTransform(
      { width: canvasWidth, height: canvasHeight },
      previewViewport,
      dimensions.width,
      dimensions.height,
      previewScaleMode
    );
  }, [canvasWidth, canvasHeight, previewViewport, dimensions.width, dimensions.height, previewScaleMode]);

  const { scale, offsetX, offsetY, displayWidth, displayHeight } = displayTransform;

  // Sync derived display width/height to the render state ref
  renderStateRef.current.displayWidth = displayWidth;
  renderStateRef.current.displayHeight = displayHeight;
  renderStateRef.current.canvasWidth = canvasWidth;
  renderStateRef.current.canvasHeight = canvasHeight;

  const scene = useMemo(() => {
    return evaluateSceneCached(clockState.time, clips, tracks, mediaAssets, project ?? null, epoch);
  }, [tracks, clips, mediaAssets, clockState.time, project, epoch]);

  // =========================================================================
  // 7. EVENT HANDLERS & CALLBACKS (useCallback)
  // =========================================================================
  const handlePreviewPointerDownCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (isPanning || spacePressed) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-transform-handle]")) return;
      if (target.closest("[data-playhead]")) return;
      clearSelection();
    },
    [clearSelection, isPanning, spacePressed]
  );

  const selectAspectPreset = useCallback(
    (p: AspectRatio) => {
      setPreviewAspectPreset(p);
      setAspectMenuOpen(false);

      if (!project) return;

      if (p === "original") {
        if (originalCanvasDimsRef.current) {
          updateProject({
            canvasWidth: originalCanvasDimsRef.current.width,
            canvasHeight: originalCanvasDimsRef.current.height,
            aspectRatio: "original",
          });
        }
      } else {
        const dims = CANVAS_DIMENSIONS[p];
        updateProject({
          canvasWidth: dims.width,
          canvasHeight: dims.height,
          aspectRatio: p,
        });
      }
    },
    [project, updateProject]
  );

  // =========================================================================
  // 8. SIDE EFFECTS (useEffect & useLayoutEffect)
  // =========================================================================

  useEffect(() => {
    if (project && !originalCanvasDimsRef.current) {
      originalCanvasDimsRef.current = {
        width: project.canvasWidth,
        height: project.canvasHeight,
      };
    }
  }, [project?.id]);

  useEffect(() => {
    if (project?.aspectRatio) {
      setPreviewAspectPreset(project.aspectRatio);
    }
  }, [project?.id, project?.aspectRatio]);

  useEffect(() => {
    if (!project) return;
    const maxEndTime = clips.reduce((max, clip) => {
      const endTime = clip.startTime + clip.duration;
      return Math.max(max, endTime);
    }, 0);
    const newDuration = Math.max(maxEndTime, 10);
    const newFrameRate = project.frameRate || 30;
    if (newDuration !== prevDurationRef.current) {
      setDuration(newDuration);
      prevDurationRef.current = newDuration;
    }
    if (newFrameRate !== prevFrameRateRef.current) {
      setFrameRate(newFrameRate);
      prevFrameRateRef.current = newFrameRate;
    }
  }, [project, clips, setDuration, setFrameRate]);

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
    const resizeObserver = new ResizeObserver(updateDimensions);
    const handleFullscreenChange = () => {
      setTimeout(updateDimensions, 100);
      setTimeout(updateDimensions, 300);
    };
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    window.addEventListener("resize", updateDimensions);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateDimensions);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!project) return;
    const qmSig = `${project.id}:${canvasWidth}x${canvasHeight}`;
    const dprVal = window.devicePixelRatio || 1;
    if (!qualityManagerRef.current || qualityManagerSigRef.current !== qmSig) {
      qualityManagerRef.current = new PreviewQualityManager({
        sequenceWidth: canvasWidth,
        sequenceHeight: canvasHeight,
        viewportWidth: Math.floor(displayWidth),
        viewportHeight: Math.floor(displayHeight),
        dpr: dprVal,
      });
      qualityManagerSigRef.current = qmSig;
    } else {
      qualityManagerRef.current.updateViewport(Math.floor(displayWidth), Math.floor(displayHeight), dprVal);
    }
  }, [project, canvasWidth, canvasHeight, displayWidth, displayHeight]);

  useEffect(() => {
    if (!useCanvasPreview || !canvasRef.current || gpuFallbackRef.current) return;
    if (gpuCacheRef.current) return;
    try {
      gpuCacheRef.current = new GPUTextureCache(canvasRef.current);
    } catch {
      gpuFallbackRef.current = true;
    }
  }, [useCanvasPreview]);

  useEffect(() => {
    return () => {
      if (gpuCacheRef.current) {
        gpuCacheRef.current.dispose();
        gpuCacheRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!useCanvasPreview || !canvasRef.current || !project) return;
    const canvas = canvasRef.current;
    if (displayWidth === 0 || displayHeight === 0) return;
    const canvasDpr = window.devicePixelRatio || 1;
    const backingW = Math.round(displayWidth * canvasDpr);
    const backingH = Math.round(displayHeight * canvasDpr);
    if (canvas.width !== backingW || canvas.height !== backingH) {
      canvas.width = backingW;
      canvas.height = backingH;
    }
    const gpuCache = gpuCacheRef.current;
    let ctx2d: CanvasRenderingContext2D | null = null;
    if (!gpuCache) {
      ctx2d = canvas.getContext("2d");
      if (ctx2d) {
        ctx2d.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
        ctx2d.clearRect(0, 0, displayWidth, displayHeight);
      }
    }
    const scheduler = getFrameScheduler();
    let rafId: number | null = null;
    let isActive = true;
    let isRendering = false;
    let lastJobId: string | null = null;
    const GPU_MEMORY_LIMIT_MB = 128;
    const renderLoop = () => {
      if (!isActive) return;
      rafId = requestAnimationFrame(renderLoop);
      if (isRendering) {
        droppedFramesRef.current++;
        return;
      }
      isRendering = true;
      const state = renderStateRef.current;
      const timeToRender = state.clock.time;
      scheduler.updateTimeline(state.clips, state.tracks, state.mediaAssets, state.project, state.epoch);
      const qm = qualityManagerRef.current;
      const isPlaying = state.clockState.state === "playing";
      const qualityTier = qm ? qm.selectTierForInteraction(isPlaying, false, false) : PreviewQualityTier.Idle;
      const profile = qm ? qm.getRenderProfile(qualityTier) : { maxWidth: state.canvasWidth, maxHeight: state.canvasHeight, dprScale: state.dpr, useDpr: true };
      if (gpuCache) {
        const renderW = profile.maxWidth;
        const renderH = profile.maxHeight;
        const cacheKey = `preview:${state.project?.id}:${state.epoch}:${timeToRender.toFixed(3)}:${renderW}x${renderH}:${state.dpr}`;
        if (gpuCache.hasTexture(cacheKey)) {
          gpuCache.clear();
          gpuCache.renderTexture(cacheKey, 0, 0, state.displayWidth, state.displayHeight);
          isRendering = false;
          return;
        }
      }
      if (lastJobId) scheduler.cancel(lastJobId);
      const session = getActiveSessionOrNull();
      const activeVideoElements = session?.getPreviewVideoElements() ?? new Map<string, HTMLVideoElement>();
      const jobId = scheduler.schedule({
        time: timeToRender,
        resolution: { width: profile.maxWidth, height: profile.maxHeight },
        pixelRatio: profile.useDpr ? profile.dprScale : 1.0,
        outputFormat: "imagebitmap",
        priority: "realtime",
        videoElements: activeVideoElements,
      });
      lastJobId = jobId;
      scheduler.wait(jobId).then((result) => {
        isRendering = false;
        if (!isActive) return;
        const latestState = renderStateRef.current;
        if (result.data instanceof ImageBitmap) {
          if (gpuCache) {
            const cacheKey = `preview:${latestState.project?.id}:${latestState.epoch}:${timeToRender.toFixed(3)}:${profile.maxWidth}x${profile.maxHeight}:${latestState.dpr}`;
            gpuCache.uploadTexture(cacheKey, result.data, result.data.width, result.data.height);
            gpuCache.clear();
            gpuCache.renderTexture(cacheKey, 0, 0, latestState.displayWidth, latestState.displayHeight);
            result.data.close();
            gpuCache.evictLRU(GPU_MEMORY_LIMIT_MB);
          } else if (ctx2d) {
            const bitmapW = result.data.width;
            const bitmapH = result.data.height;
            const fitScale = Math.min(latestState.displayWidth / bitmapW, latestState.displayHeight / bitmapH);
            const drawW = bitmapW * fitScale;
            const drawH = bitmapH * fitScale;
            const ox = (latestState.displayWidth - drawW) / 2;
            const oy = (latestState.displayHeight - drawH) / 2;
            ctx2d.clearRect(0, 0, latestState.displayWidth, latestState.displayHeight);
            ctx2d.drawImage(result.data, ox, oy, drawW, drawH);
            result.data.close();
          }
        }
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
      }).catch((error: Error) => {
        isRendering = false;
        if (error.message !== "Job cancelled" && isActive) console.error("Failed to render frame:", error);
      });
    };
    rafId = requestAnimationFrame(renderLoop);
    return () => {
      isActive = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (lastJobId) scheduler.cancel(lastJobId);
    };
  }, [useCanvasPreview, project, displayWidth, displayHeight]);

  useLayoutEffect(() => {
    const session = activeSession;
    if (!session) return;
    try {
      session.syncPreviewMedia(clips, mediaAssets, tracks, {
        time: clock.time,
        state: clockState.state,
        speed: clockState.speed,
        muted: isMuted,
        volume,
      });
    } catch (error) {
      console.error(`[PreviewPanel ERROR] Exception calling syncPreviewMedia:`, error);
    }
  }, [activeSession, clips, mediaAssets, tracks, clockState.state, clockState.speed, isMuted, volume, clock.time, clockState.time]);

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

  const currentTime = clockState.time;
  const duration = clockState.duration;
  const isPlaying = clockState.state === "playing";
  const playbackSpeed = clockState.speed;
  const frameRate = clockState.frameRate;
  const step = 1 / Math.max(1, frameRate);

  return (
    <div className="flex-1 bg-bg flex flex-col min-h-0 rounded-tl-xl border-l border-t border-white/3">
      <div className="flex items-center px-4 h-10 shrink-0 gap-2">
        <span className="text-[13px] font-semibold text-text-primary tracking-tight">Program Preview</span>
        <span className="text-[13px] text-text-muted">— Timeline</span>
        <button onClick={() => setShowTelemetry((s) => !s)} className={cn("ml-auto px-2 h-6 rounded text-[10px] font-medium transition-colors", showTelemetry ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary hover:bg-white/6")} title="Toggle render telemetry" aria-label="Toggle render telemetry">
          Stats
        </button>
      </div>

      {/* ── Video Area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#06080a] relative">
        <div ref={containerRef} onPointerDownCapture={handlePreviewPointerDownCapture} className={cn("w-full h-full flex items-center justify-center relative z-10 overflow-hidden", isPanning && "cursor-grabbing", spacePressed && !isPanning && "cursor-grab")}>
          <div data-testid="program-preview-viewport" className="relative flex shrink-0 items-center justify-center overflow-hidden shadow-[0_0_40px_rgba(0, 0, 0, 0.36)]" style={{ width: displayWidth, height: displayHeight }}>
            <>
              {/* Canvas-based preview (matches export rendering) */}
              <canvas
                ref={canvasRef}
                data-testid="program-preview-canvas"
                /* Backing-store size is set dynamically in the render-loop effect
                   to displayWidth*dpr × displayHeight*dpr for crisp HiDPI rendering.
                   CSS size controls layout. */
                style={{
                  width: displayWidth,
                  height: displayHeight,
                  imageRendering: "auto",
                }}
                className="bg-black"
              />

              {/* Transform overlay for selected clips */}
              <TransformOverlay canvasWidth={canvasWidth} canvasHeight={canvasHeight} scale={scale} viewport={previewViewport} displayOffset={{ x: offsetX, y: offsetY }} displayWidth={displayWidth} displayHeight={displayHeight} currentTime={currentTime} />
            </>
          </div>
        </div>

        {/* Professional empty state - shows sequence context when no clips. Applied same width and height has canvas, so that it's always fit-in professionally*/}
        {clips.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none mx-auto" style={{ width: displayWidth, height: displayHeight }}>
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

      <PreviewTransport
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        disabled={clips.length === 0}
        onPlayPause={() => {
          if (clips.length === 0) return; // Disable playback when timeline is empty
          // Ensure program context is active before playing timeline
          setActiveContext?.("program");
          isPlaying ? transportPause() : transportPlay();
        }}
        onSeek={(time) => {
          if (clips.length === 0) return; // Disable seeking when timeline is empty
          seek(time);
        }}
        formatTime={formatTime}
        onStepBack={() => {
          if (clips.length === 0) return; // Disable frame stepping when timeline is empty
          seek(Math.max(0, currentTime - step));
        }}
        onStepForward={() => {
          if (clips.length === 0) return; // Disable frame stepping when timeline is empty
          seek(Math.min(duration, currentTime + step));
        }}
        leftActions={
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
        }
        rightActions={
          <>
            {/* Aspect menu */}
            <div className="relative shrink-0" ref={aspectMenuRef}>
              <button onClick={() => setAspectMenuOpen((o) => !o)} className="flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors" title="Preview aspect ratio" aria-expanded={aspectMenuOpen}>
                <span className="max-w-18 truncate">{PREVIEW_ASPECT_LABEL[previewAspectPreset]}</span>
                <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
              </button>
              {aspectMenuOpen && (
                <div className="absolute bottom-full right-0 z-50 mb-1 w-[200px] overflow-hidden rounded-lg border border-border bg-surface py-1 text-text-primary shadow-xl" role="listbox">
                  <div className="px-1">
                    <AspectMenuRow preset="original" selected={previewAspectPreset} onSelect={selectAspectPreset} icon={<PreviewAspectShapeIcon widthOverHeight={canvasWidth / Math.max(1, canvasHeight)} />} />
                  </div>
                  <div className="my-1 h-px bg-border" />
                  <div className="px-1">
                    {(["16:9", "9:16", "1:1", "4:5"] as const).map((p) => (
                      <AspectMenuRow key={p} preset={p} selected={previewAspectPreset} onSelect={selectAspectPreset} icon={<PreviewAspectShapeIcon widthOverHeight={PREVIEW_ASPECT_RATIO[p]!} />} />
                    ))}
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
          </>
        }
      />
    </div>
  );
};
