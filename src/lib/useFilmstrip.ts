/**
 * useFilmstrip — hook for ClipFilmstrip
 *
 * Replaces the inline extraction orchestration in ClipFilmstrip.
 * ClipFilmstrip becomes a pure canvas consumer.
 *
 * Responsibilities:
 *   - Subscribe to RenderRuntime epoch for this clip
 *   - Request artifacts via transport layer (requestBatchArtifacts)
 *   - Re-request on epoch change (triggers on zoom-tier-commit, scroll, trim)
 *   - Cancel in-flight requests on epoch change or unmount
 *   - Return sorted TransportArtifacts for RasterSurface to render
 *
 * Non-responsibilities (intentionally excluded):
 *   - Tile layout math (RasterSurface handles this)
 *   - Canvas drawing (RasterSurface handles this)
 *   - Zoom level → tier mapping (SRP via RenderRuntime handles this)
 *   - Epoch computation (RenderRuntime handles this)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useRenderEngineStore } from "../store/renderEngineStore";
import { useRenderState } from "./renderEngine/hooks";
import { SpatialTier, InteractionState } from "./renderEngine/types";
import { requestProgressiveTiers, type TransportArtifact } from "./renderEngine/transport";
import { generateTimestampGrid } from "./timelineUtils";

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_SECS = 1.0;

function getExtractionInterval(durationSecs: number): number {
  if (durationSecs <= 60) return 0.5;
  if (durationSecs <= 300) return 1.0;
  if (durationSecs <= 600) return 2.0;
  return Math.ceil(durationSecs / 200);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseFilmstripOptions {
  clipId: string;
  videoPath: string;
  trimIn: number;
  trimOut: number;
  duration: number;
  posterFrame?: string;
  enabled?: boolean;
}

export interface UseFilmstripResult {
  /** Sorted TransportArtifacts ready to pass to RasterSurface.drawFilmstrip() */
  artifacts: readonly TransportArtifact[];
  /** True while the first batch is loading */
  isLoading: boolean;
  /** True if no tier has been decoded yet — show posterFrame fallback */
  isFallback: boolean;
  /** Current interaction state — surface can dim during ballistic scroll */
  interactionState: InteractionState;
}

export function useFilmstrip(opts: UseFilmstripOptions): UseFilmstripResult {
  const { clipId, videoPath, trimIn, trimOut, duration, enabled = true } = opts;

  const runtime = useRenderEngineStore((s) => s.runtime);
  const renderState = useRenderState(clipId);
  const cancelRef = useRef<(() => void) | null>(null);

  // Sorted artifacts, keyed by timestamp+tier so we never duplicate
  const [artifacts, setArtifacts] = useState<readonly TransportArtifact[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Track previous epoch to avoid re-requesting when epoch hasn't changed
  const prevEpochRef = useRef<string>("");

  // Clear previous bitmaps on unmount or re-request
  const disposePrev = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  useEffect(() => {
    // Don't request frames if we're still in fallback state (waiting for real runtime state)
    if (!enabled || !videoPath || !duration || !runtime || renderState.isFallback) return;

    const { epochId, currentTier, interactionState } = renderState;

    // Skip re-request if epoch hasn't changed
    if (epochId === prevEpochRef.current) return;
    prevEpochRef.current = epochId;

    // Cancel any in-flight request for the previous epoch
    disposePrev();

    // Don't request during ballistic scroll — wait for Converging state
    if (interactionState === InteractionState.Scrubbing) return;

    const { spatialTier } = currentTier;
    const interval = getExtractionInterval(duration);
    const timestampsSecs = generateTimestampGrid(trimIn, trimOut, interval, duration);
    if (timestampsSecs.length === 0) return;

    const timestampsMs = timestampsSecs.map((t) => Math.round(t * 1000));

    // Keep previous artifacts visible during upgrade (don't clear on re-request)
    setIsLoading(true);

    // Accumulated artifacts for this epoch — keyed by `${timestampMs}:${spatialTier}`
    // Higher-tier arrivals naturally replace lower-tier entries for the same timestamp.
    const accumulated = new Map<string, TransportArtifact>();

    // Progressive tier sequence: always start at L0 for fast-paint.
    // Scrubbing returns early above (line 104), so here we're always Idle/Converging/Zooming.
    // Upgrade all the way to the SRP-committed tier.
    const startTier = SpatialTier.L0;
    const targetTier = spatialTier;

    cancelRef.current = requestProgressiveTiers({
      videoPath,
      timestampsMs,
      startTier,
      targetTier,
      epochId,
      clipId,
      onArtifact: (artifact) => {
        // Log first artifact to diagnose stretching
        if (accumulated.size === 0) {
          console.log("[Filmstrip] First artifact received:", {
            width: artifact.width,
            height: artifact.height,
            bitmapWidth: artifact.bitmap.width,
            bitmapHeight: artifact.bitmap.height,
            spatialTier: artifact.spatialTier,
            timestampMs: artifact.timestampMs,
          });
        }
        const key = `${artifact.timestampMs}:${artifact.spatialTier}`;
        accumulated.set(key, artifact);
        // For each timestamp, keep only the highest tier received so far
        const bestByTime = new Map<number, TransportArtifact>();
        for (const a of accumulated.values()) {
          const existing = bestByTime.get(a.timestampMs);
          if (!existing || a.spatialTier > existing.spatialTier) {
            bestByTime.set(a.timestampMs, a);
          }
        }
        const sorted = Array.from(bestByTime.values()).sort((a, b) => a.timestampMs - b.timestampMs);
        setArtifacts(sorted);
        setIsLoading(false);
      },
      onComplete: () => setIsLoading(false),
    });

    return () => disposePrev();
  }, [
    enabled,
    videoPath,
    duration,
    trimIn,
    trimOut,
    // Re-run when epoch changes (covers zoom-tier, scroll, trim)
    renderState.epochId,
    runtime,
    clipId,
    disposePrev,
  ]);

  // Unmount cleanup
  useEffect(() => () => disposePrev(), [disposePrev]);

  return {
    artifacts,
    isLoading,
    isFallback: renderState.isFallback || artifacts.length === 0,
    interactionState: renderState.interactionState,
  };
}
