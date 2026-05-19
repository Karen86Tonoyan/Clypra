import React, { useRef, useState, useEffect, useCallback } from "react";
import { Plus, X, RotateCcw, Play } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useUIStore } from "@/store/uiStore";
import { getInsertIndexForNewTrack, useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { createClipFromAsset } from "@/lib/timelineClip";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { autoAdaptSequenceForFirstVisualClip } from "@/lib/sequenceAutoAspect";
import { DEFAULT_PLACEMENT_POLICY, resolveAddToTimelinePlacement, resolveDefaultFitModeForAsset } from "@/lib/placementPolicy";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import type { SourcePlaybackContext } from "@/core/playback";
import { GPUPreview } from "./GPUPreview";
import { AudioWaveform } from "./AudioWaveform";
import { PreviewTransport } from "./PreviewTransport";

// GPU preview for scrubbing only (precise frame-accurate seeking)
// Use HTML5 video for playback (hardware decode, buffering, smooth playback)
const USE_GPU_PREVIEW = false;

export const SourcePreview: React.FC = () => {
  const { sourceAsset, sourceInPoint, sourceOutPoint, exitSourceMode, markSourceIn, markSourceOut } = useUIStore();
  const { tracks, clips, addClip, addTrack, insertTrackAt, getTimelineEndTime } = useTimelineStore();
  const { project, updateProject } = useProjectStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [useGPU, setUseGPU] = useState(USE_GPU_PREVIEW && sourceAsset?.type === "video");
  const [gpuFailed, setGpuFailed] = useState(false);
  const sourceCtxRef = useRef<SourcePlaybackContext | null>(null);

  // Get source context from active session and bind media element
  useEffect(() => {
    const session = getActiveSessionOrNull();
    const ctx = session?.sourceContext;
    if (!ctx) return;

    sourceCtxRef.current = ctx;

    // Bind appropriate media element
    if (sourceAsset?.type === "audio" && audioRef.current) {
      ctx.setMediaElement(audioRef.current);
    } else if (sourceAsset?.type === "video" && videoRef.current && !useGPU) {
      ctx.setMediaElement(videoRef.current);
    } else {
      ctx.setMediaElement(null);
    }

    // Subscribe to context state
    const unsub = ctx.subscribe((snapshot) => {
      setCurrentTime(snapshot.time);
      setDuration(snapshot.duration);
      setIsPlaying(snapshot.state === "playing");
    });

    return () => {
      unsub();
      ctx.setMediaElement(null);
      sourceCtxRef.current = null;
    };
  }, [sourceAsset?.id, sourceAsset?.type, useGPU]);

  // Reset when asset changes
  useEffect(() => {
    setUseGPU(USE_GPU_PREVIEW && sourceAsset?.type === "video");
    setGpuFailed(false);
  }, [sourceAsset?.id]);

  const handleSeek = useCallback((time: number) => {
    sourceCtxRef.current?.seek(time);
  }, []);

  const handlePlayPause = useCallback(() => {
    const ctx = sourceCtxRef.current;
    if (!ctx) return;
    if (useGPU) {
      setIsPlaying((prev) => !prev);
    } else {
      const state = ctx.getState();
      if (state === "playing") {
        ctx.pause();
      } else {
        ctx.play();
      }
    }
  }, [useGPU]);

  const handlePlayMarkedRegion = useCallback(() => {
    sourceCtxRef.current?.playMarkedRegion();
  }, []);

  const handleClearMarks = useCallback(() => {
    markSourceIn(null);
    markSourceOut(null);
    sourceCtxRef.current?.clearMarks();
  }, [markSourceIn, markSourceOut]);

  const handleMarkIn = useCallback(() => {
    const t = sourceCtxRef.current?.getTime() ?? 0;
    markSourceIn(t);
    sourceCtxRef.current?.setInPoint(t);
  }, [markSourceIn]);

  const handleMarkOut = useCallback(() => {
    const t = sourceCtxRef.current?.getTime() ?? 0;
    markSourceOut(t);
    sourceCtxRef.current?.setOutPoint(t);
  }, [markSourceOut]);

  if (!sourceAsset) return null;

  const handleAddToTimeline = () => {
    if (!project) return;
    const placement = resolveAddToTimelinePlacement({
      asset: sourceAsset,
      tracks,
      clips,
      playheadTime: getPlaybackClock().time,
      sequenceEndTime: getTimelineEndTime(),
    });
    let targetTrackId = placement.targetTrackId;
    if (placement.shouldCreateTrack || !targetTrackId) {
      const latestTracks = useTimelineStore.getState().tracks;
      const insertIndex = getInsertIndexForNewTrack(latestTracks, placement.trackType);
      targetTrackId = insertTrackAt(placement.trackType, insertIndex);
    }
    if (!targetTrackId) return;

    if (DEFAULT_PLACEMENT_POLICY.autoAdaptSequenceForFirstVisualClip) {
      autoAdaptSequenceForFirstVisualClip({
        project,
        existingClips: clips,
        asset: sourceAsset,
        updateProject,
      });
    }
    const nextProject = useProjectStore.getState().project;

    const newClip = createClipFromAsset({
      asset: sourceAsset,
      trackId: targetTrackId,
      startTime: placement.startTime,
      width: nextProject?.canvasWidth ?? project.canvasWidth,
      height: nextProject?.canvasHeight ?? project.canvasHeight,
      fitMode: resolveDefaultFitModeForAsset(sourceAsset),
    });

    const trimIn = sourceInPoint ?? 0;
    const trimOut = sourceOutPoint ?? newClip.duration;
    newClip.trimIn = trimIn;
    newClip.trimOut = trimOut;
    newClip.duration = trimOut - trimIn;

    addClip(newClip);
    exitSourceMode();

    // Switch transport authority back to program context
    const session = getActiveSessionOrNull();
    session?.transportAuthority?.setActiveContext("program");
  };

  /** Format time as HH:MM:SS:FF (frame-accurate) */
  const formatTC = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * 30);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
  };

  // Calculate marked duration
  const markedDuration = sourceInPoint !== null && sourceOutPoint !== null ? sourceOutPoint - sourceInPoint : null;
  const hasMarks = sourceInPoint !== null || sourceOutPoint !== null;
  const hasCompleteMarks = sourceInPoint !== null && sourceOutPoint !== null;

  const sourcePath = convertFileSrc(sourceAsset.path);
  const mediaLabel = sourceAsset.type === "video" ? "video" : sourceAsset.type === "audio" ? "audio" : "image";

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 h-10 shrink-0 border-b border-border/50">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-text-primary tracking-tight">Previewing</span>
          <span className="text-[13px] text-text-muted">— {mediaLabel}</span>
        </div>
        <button
          onClick={() => {
            exitSourceMode();
            const session = getActiveSessionOrNull();
            session?.transportAuthority?.setActiveContext("program");
          }}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/6 transition-colors text-text-muted hover:text-text-primary"
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Mark Info Bar ──────────────────────────────────────────── */}
      {hasMarks && (
        <div className="px-4 py-2 bg-surface/50 border-b border-border/30 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-4">
            {sourceInPoint !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-text-muted">In:</span>
                <span className="font-mono text-accent">{formatTC(sourceInPoint)}</span>
              </div>
            )}
            {sourceOutPoint !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-text-muted">Out:</span>
                <span className="font-mono text-accent">{formatTC(sourceOutPoint)}</span>
              </div>
            )}
            {hasCompleteMarks && markedDuration !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-text-muted">Duration:</span>
                <span className="font-mono text-text-primary font-semibold">{markedDuration.toFixed(2)}s</span>
              </div>
            )}
          </div>
          <button onClick={handleClearMarks} className="flex items-center gap-1 px-2 h-5 rounded text-[10px] font-medium text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors" title="Clear marks">
            <RotateCcw className="w-3 h-3" />
            Clear
          </button>
        </div>
      )}

      {/* ── Video Area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-[#06080a] relative">
        <div className="absolute inset-0 checkerboard opacity-[0.15] pointer-events-none" />
        <div className="w-full h-full flex items-center justify-center relative z-10">
          {sourceAsset.type === "video" ? (
            useGPU && !gpuFailed ? (
              <GPUPreview
                videoPath={sourceAsset.path}
                currentTime={currentTime}
                isPlaying={isPlaying}
                width={sourceAsset.width || 1920}
                height={sourceAsset.height || 1080}
                duration={sourceAsset.duration}
                frameRate={30}
                onTimeUpdate={(time) => {
                  setCurrentTime(time);
                  // Stop playing when reaching end
                  if (time >= duration && duration > 0) {
                    setIsPlaying(false);
                  }
                }}
                className="max-w-full max-h-full shadow-[0_0_40px_rgba(0,0,0,0.8)] ring-1 ring-white/10 bg-black"
              />
            ) : (
              <video ref={videoRef} src={sourcePath} className="max-w-full max-h-full shadow-[0_0_40px_rgba(0,0,0,0.8)] ring-1 ring-white/10 bg-black" playsInline preload="auto" />
            )
          ) : sourceAsset.type === "image" ? (
            <img src={sourcePath} alt={sourceAsset.name} className="max-w-full max-h-full rounded shadow-[0_0_40px_rgba(0,0,0,0.8)] ring-1 ring-white/10 bg-black object-contain" />
          ) : (
            <AudioWaveform audioElement={audioRef.current} isPlaying={isPlaying} coverImage={sourceAsset.coverArt} audioName={sourceAsset.name} className="w-full h-full" />
          )}
        </div>
        {/* Hidden audio element for audio playback */}
        {sourceAsset.type === "audio" && <audio ref={audioRef} src={sourcePath} preload="auto" style={{ display: "none" }} />}
      </div>

      <PreviewTransport
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        onPlayPause={handlePlayPause}
        onSeek={handleSeek}
        formatTime={formatTC}
        inPoint={sourceInPoint}
        outPoint={sourceOutPoint}
        rightActions={
          <>
            <button onClick={handleMarkIn} className={`px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer ${sourceInPoint !== null && Math.abs(currentTime - sourceInPoint) < 0.1 ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-white/6"}`} title="Mark In (I)">
              IN
            </button>
            <button onClick={handleMarkOut} className={`px-2 h-6 rounded text-[10px] font-medium transition-colors cursor-pointer ${sourceOutPoint !== null && Math.abs(currentTime - sourceOutPoint) < 0.1 ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-white/6"}`} title="Mark Out (O)">
              OUT
            </button>
            {hasCompleteMarks && (
              <button onClick={handlePlayMarkedRegion} className="flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium text-text-muted hover:text-text-primary hover:bg-white/6 transition-colors cursor-pointer" title="Play marked region">
                <Play className="w-3 h-3" />
                Play
              </button>
            )}
            <div className="w-px h-4 bg-white/10 mx-1" />
            <button onClick={handleAddToTimeline} disabled={!hasCompleteMarks} className={`flex items-center gap-1 px-2.5 h-6 rounded text-[10px] font-semibold transition-colors ${hasCompleteMarks ? "bg-green-600/90 hover:bg-green-600 text-white cursor-pointer" : "bg-text-muted/70 hover:bg-text-muted/90 text-white cursor-not-allowed"}`} title={hasCompleteMarks ? `Add ${markedDuration?.toFixed(2)}s to Timeline` : "Add to Track"}>
              <Plus className="w-3 h-3" />
              Add
            </button>
          </>
        }
      />
    </div>
  );
};
