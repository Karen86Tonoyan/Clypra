/**
 * CanvasRenderer - FFmpeg-based frame extraction for Tauri desktop app
 *
 * Replaces HTML5 video seeking with native FFmpeg frame extraction.
 * Provides frame-accurate preview with lower memory footprint.
 */

import React, { useRef, useEffect, useCallback, useState } from "react";
import { useTimelineStore } from "../../timeline/store/timelineStore";
import { FrameResolver } from "../utils/FrameResolver";
import { RenderEngine } from "../utils/RenderEngine";
import { FrameExtractor, type ActiveClip } from "../utils/FrameExtractor";

export interface CanvasRendererProps {
  baseWidth: number;
  baseHeight: number;
  className?: string;
}

/**
 * CanvasRenderer component - FFmpeg-based video preview
 * Uses Rust backend for frame-accurate extraction
 */
const CanvasRendererComponent: React.FC<CanvasRendererProps> = ({ baseWidth, baseHeight, className }) => {
  const [canvasDimensions] = useState({ width: baseWidth, height: baseHeight });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameExtractorRef = useRef<FrameExtractor | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const isRenderingRef = useRef<boolean>(false);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const activeClipsRef = useRef<ActiveClip[]>([]);

  // Hybrid playback: video element for smooth playback, FFmpeg for accurate paused frames
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const lastFrameTimeRef = useRef<number>(0);
  const frameSkipCounterRef = useRef<number>(0);

  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const playhead = useTimelineStore((state) => state.playhead);
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const duration = useTimelineStore((state) => state.duration);

  const frameResolver = React.useMemo(() => {
    return new FrameResolver(clips, tracks);
  }, [clips, tracks]);

  // Initialize canvas and FrameExtractor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width, height } = canvasDimensions;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = "";
    canvas.style.height = "";

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error("Failed to get 2D context");
      return;
    }

    ctx.scale(dpr, dpr);
    contextRef.current = ctx;

    // Initialize FrameExtractor
    frameExtractorRef.current = new FrameExtractor(width, height, 30);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      frameExtractorRef.current?.dispose();

      // Clean up audio elements
      audioElementsRef.current.forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
      audioElementsRef.current.clear();

      // Clean up video elements
      videoElementsRef.current.forEach((video) => {
        video.pause();
        video.src = "";
      });
      videoElementsRef.current.clear();
    };
  }, [canvasDimensions]);

  // Render when playhead changes or clips change
  useEffect(() => {
    if (!isPlaying) {
      renderFrame(playhead);
    }
  }, [playhead, clips, tracks, isPlaying]);

  // Handle playback state
  useEffect(() => {
    // Set FrameExtractor playback mode for performance optimization
    frameExtractorRef.current?.setPlaybackMode(isPlaying);

    if (isPlaying) {
      startPlayback();
    } else {
      stopPlayback();
      stopAudioPlayback();
      stopVideoPlayback();
      // When pausing, render the exact frame via FFmpeg for accuracy
      renderFrame(playhead);
    }

    return () => {
      stopPlayback();
      stopAudioPlayback();
      stopVideoPlayback();
    };
  }, [isPlaying, playhead]);

  /**
   * Setup audio element for a clip
   */
  const setupAudioElement = (sourceMediaPath: string): HTMLAudioElement | null => {
    let audioElement = audioElementsRef.current.get(sourceMediaPath);

    if (!audioElement) {
      try {
        audioElement = document.createElement("audio");
        audioElement.src = sourceMediaPath;
        audioElement.preload = "auto";
        audioElement.crossOrigin = "anonymous";
        document.body.appendChild(audioElement);
        audioElementsRef.current.set(sourceMediaPath, audioElement);

        // Log when audio is ready
        audioElement.addEventListener("canplay", () => {
          console.log("[Audio] Ready:", sourceMediaPath);
        });

        audioElement.addEventListener("error", (e) => {
          console.error("[Audio] Error:", sourceMediaPath, e);
        });
      } catch (error) {
        console.error("Failed to create audio element:", error);
        return null;
      }
    }

    return audioElement;
  };

  /**
   * Start audio playback
   */
  const startAudioPlayback = async (clips: ActiveClip[]) => {
    if (clips.length === 0) return;

    const currentTimelineTime = useTimelineStore.getState().playhead;

    for (const clip of clips) {
      const audioElement = setupAudioElement(clip.sourceMediaPath);

      if (!audioElement) continue;

      const timeIntoClip = currentTimelineTime - clip.startTime;
      const audioStartTime = clip.sourceStart + timeIntoClip;

      try {
        // Wait for audio to be ready
        if (audioElement.readyState < 2) {
          console.log("[Audio] Waiting for canplay...");
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Audio load timeout")), 5000);
            const onCanPlay = () => {
              clearTimeout(timeout);
              audioElement.removeEventListener("canplay", onCanPlay);
              resolve();
            };
            audioElement.addEventListener("canplay", onCanPlay);
          });
        }

        audioElement.currentTime = audioStartTime;
        audioElement.playbackRate = 1.0;
        await audioElement.play();
        console.log("[Audio] Started at", audioStartTime);
      } catch (error: any) {
        if (error.name === "AbortError") {
          console.log("[Audio] Play aborted (user paused or switched)");
        } else {
          console.error("[Audio] Failed to start:", error);
        }
      }
    }
  };

  /**
   * Stop audio playback
   */
  const stopAudioPlayback = () => {
    for (const audio of audioElementsRef.current.values()) {
      if (!audio.paused) {
        audio.pause();
      }
    }
  };

  /**
   * Get current audio time for sync
   */
  const getAudioTime = (): number | null => {
    // Use first playing audio element as master clock
    for (const [path, audio] of audioElementsRef.current.entries()) {
      if (!audio.paused && audio.currentTime > 0) {
        const clip = activeClipsRef.current.find((c) => c.sourceMediaPath === path);
        if (clip) {
          // Convert audio time back to timeline time
          return clip.startTime + (audio.currentTime - clip.sourceStart);
        }
      }
    }
    return null;
  };

  /**
   * Setup video element for a clip (for smooth playback)
   */
  const setupVideoElement = (sourceMediaPath: string): HTMLVideoElement | null => {
    let videoElement = videoElementsRef.current.get(sourceMediaPath);

    if (!videoElement) {
      try {
        videoElement = document.createElement("video");
        videoElement.src = sourceMediaPath;
        videoElement.preload = "auto";
        videoElement.muted = true; // We'll use separate audio
        videoElement.style.display = "none";
        document.body.appendChild(videoElement);
        videoElementsRef.current.set(sourceMediaPath, videoElement);
      } catch (error) {
        console.error("Failed to create video element:", error);
        return null;
      }
    }

    return videoElement;
  };

  /**
   * Start video playback (for smooth canvas rendering)
   */
  const startVideoPlayback = async (clips: ActiveClip[]) => {
    if (clips.length === 0) return;

    const currentTimelineTime = useTimelineStore.getState().playhead;

    for (const clip of clips) {
      const videoElement = setupVideoElement(clip.sourceMediaPath);

      if (!videoElement) continue;

      const timeIntoClip = currentTimelineTime - clip.startTime;
      const videoStartTime = clip.sourceStart + timeIntoClip;

      try {
        // Wait for video to be ready
        if (videoElement.readyState < 2) {
          console.log("[Video] Waiting for canplay...");
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Video load timeout")), 5000);
            const onCanPlay = () => {
              clearTimeout(timeout);
              videoElement.removeEventListener("canplay", onCanPlay);
              resolve();
            };
            videoElement.addEventListener("canplay", onCanPlay);
          });
        }

        videoElement.currentTime = videoStartTime;
        videoElement.playbackRate = 1.0;
        await videoElement.play();
        console.log("[Video] Started at", videoStartTime);
      } catch (error: any) {
        if (error.name === "AbortError") {
          console.log("[Video] Play aborted (user paused or switched)");
        } else {
          console.error("[Video] Failed to start:", error);
        }
      }
    }
  };

  /**
   * Stop video playback
   */
  const stopVideoPlayback = () => {
    for (const video of videoElementsRef.current.values()) {
      if (!video.paused) {
        video.pause();
      }
    }
  };

  /**
   * Get current video time for sync
   */
  const getVideoTime = (): number | null => {
    // Use first playing video element as master clock
    for (const [path, video] of videoElementsRef.current.entries()) {
      if (!video.paused && video.currentTime > 0) {
        const clip = activeClipsRef.current.find((c) => c.sourceMediaPath === path);
        if (clip) {
          // Convert video time back to timeline time
          return clip.startTime + (video.currentTime - clip.sourceStart);
        }
      }
    }
    return null;
  };

  /**
   * Render video frames to canvas (smooth playback) with aspect ratio preservation
   */
  const renderVideoFrames = () => {
    if (!contextRef.current) return;

    const ctx = contextRef.current;
    const { width, height } = canvasDimensions;

    // Clear canvas with black background
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);

    // Draw each video element with aspect ratio preservation
    const sortedClips = [...activeClipsRef.current].sort((a, b) => a.trackIndex - b.trackIndex);

    for (const clip of sortedClips) {
      const video = videoElementsRef.current.get(clip.sourceMediaPath);
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        // Calculate aspect-ratio-preserving draw dimensions
        const videoAspect = video.videoWidth / video.videoHeight;
        const canvasAspect = width / height;

        let drawWidth = width;
        let drawHeight = height;
        let drawX = 0;
        let drawY = 0;

        if (videoAspect > canvasAspect) {
          // Video is wider - fit to width, center vertically
          drawHeight = width / videoAspect;
          drawY = (height - drawHeight) / 2;
        } else {
          // Video is taller - fit to height, center horizontally
          drawWidth = height * videoAspect;
          drawX = (width - drawWidth) / 2;
        }

        ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
      }
    }
  };

  // Timeline update interval ref
  const timelineIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Start playback - video on RAF, timeline on setInterval (decoupled)
   */
  const startPlayback = () => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }
    if (timelineIntervalRef.current) {
      clearInterval(timelineIntervalRef.current);
    }

    console.log("[Playback] Starting...");

    // Get active clips
    const activeClips = frameResolver.getActiveClips(playhead);
    if (activeClips.length > 0) {
      activeClipsRef.current = activeClips as ActiveClip[];
      // Start async (don't block RAF)
      startVideoPlayback(activeClips as ActiveClip[]);
      startAudioPlayback(activeClips as ActiveClip[]);
    }

    // Video render loop - runs at 30fps
    let frameSkipCounter = 0;
    const videoLoop = () => {
      frameSkipCounter++;
      if (frameSkipCounter % 2 === 0) {
        renderVideoFrames();
      }
      rafIdRef.current = requestAnimationFrame(videoLoop);
    };
    rafIdRef.current = requestAnimationFrame(videoLoop);

    // Timeline update loop - completely decoupled from RAF
    // Runs at 10fps, doesn't block video/audio
    timelineIntervalRef.current = setInterval(() => {
      const videoTime = getVideoTime();
      const audioTime = getAudioTime();
      let currentTime: number;

      if (videoTime !== null) {
        currentTime = videoTime;
      } else if (audioTime !== null) {
        currentTime = audioTime;
      } else {
        return; // No media playing, skip update
      }

      // Stop if at end
      if (currentTime >= duration) {
        useTimelineStore.getState().setPlayhead(duration);
        useTimelineStore.getState().setIsPlaying(false);
        return;
      }

      useTimelineStore.getState().setPlayhead(currentTime, false);
    }, 100); // 10fps
  };

  /**
   * Stop playback
   */
  const stopPlayback = () => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (timelineIntervalRef.current) {
      clearInterval(timelineIntervalRef.current);
      timelineIntervalRef.current = null;
    }
    console.log("[Playback] Stopped");
  };

  /**
   * Render a frame at the specified timeline time
   */
  const renderFrame = useCallback(
    async (timelineTime: number) => {
      if (!contextRef.current || !frameExtractorRef.current) {
        return;
      }

      if (isRenderingRef.current) {
        return; // Skip if already rendering
      }

      isRenderingRef.current = true;

      const ctx = contextRef.current;
      const frameExtractor = frameExtractorRef.current;
      const renderEngine = new RenderEngine(ctx, canvasDimensions.width, canvasDimensions.height);

      const clampedTime = Math.max(0, Math.min(timelineTime, duration));

      try {
        // Get active clips at this time
        const activeClipsData = frameResolver.getActiveClips(clampedTime);

        if (activeClipsData.length === 0) {
          renderEngine.drawNoClipsMessage();
          isRenderingRef.current = false;
          return;
        }

        // Get frames for each clip
        const framePromises = activeClipsData.map(async (clipData) => {
          const clip: ActiveClip = {
            ...clipData,
            trackIndex: 0,
            clipTime: 0,
          };
          const bitmap = await frameExtractor.getFrame(clip, clampedTime);
          return { clip, bitmap };
        });

        const frames = await Promise.all(framePromises);

        // Clear canvas
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvasDimensions.width, canvasDimensions.height);

        // Draw frames (lower tracks first)
        frames
          .filter(({ bitmap }) => bitmap !== null)
          .sort((a, b) => a.clip.trackIndex - b.clip.trackIndex)
          .forEach(({ bitmap }) => {
            if (bitmap) {
              ctx.drawImage(bitmap, 0, 0, canvasDimensions.width, canvasDimensions.height);
            }
          });

        // Update active clips ref for audio sync
        activeClipsRef.current = frames.map(({ clip }) => clip);
      } catch (error) {
        console.error("Failed to render frame:", error);
        renderEngine.drawLoadingIndicator("Error loading frame");
      } finally {
        isRenderingRef.current = false;
      }
    },
    [frameResolver, canvasDimensions, duration],
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <canvas
        ref={canvasRef}
        className={className}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          aspectRatio: `${canvasDimensions.width}/${canvasDimensions.height}`,
        }}
        data-testid="canvas-renderer"
      />
    </div>
  );
};

export const CanvasRenderer = React.memo(CanvasRendererComponent);
