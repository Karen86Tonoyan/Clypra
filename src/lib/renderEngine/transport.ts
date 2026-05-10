/**
 * transport.ts — Tauri IPC transport layer for the Render Engine
 *
 * Responsibilities:
 *   1. Epoch registry — tracks which epochId is active per clipId
 *   2. RGBA → ImageBitmap conversion (SAB fast-path or copy-path)
 *   3. requestRenderArtifacts — single timestamp, epoch-gated delivery
 *   4. requestBatchArtifacts  — concurrent multi-timestamp, epoch-gated
 *   5. requestProgressiveTiers — L0 fast-paint → target tier upgrade sequence
 *
 * All artifact delivery is silently dropped when the epoch has become stale.
 */

import { invoke, Channel } from "@tauri-apps/api/core";
import { SpatialTier, SPATIAL_TIER_DIMS } from "./types";
import type { RenderEpochId } from "./types";

// ─── SAB Detection ────────────────────────────────────────────────────────────

/**
 * True when SharedArrayBuffer is available and cross-origin-isolated.
 * Evaluated once at module load so it's toggleable via vi.stubGlobal in tests.
 */
export const SAB_SUPPORTED: boolean = (() => {
  try {
    return typeof crossOriginIsolated !== "undefined" && crossOriginIsolated === true && typeof SharedArrayBuffer !== "undefined";
  } catch {
    return false;
  }
})();

// ─── Spatial Tier Label Conversion ────────────────────────────────────────────

/**
 * Convert SpatialTier enum to Rust-compatible string label.
 * L0 → "l0", L1 → "l1", L2 → "l2", L3 → "l3"
 */
function spatialTierToLabel(tier: SpatialTier): string {
  return `l${tier}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Raw artifact arriving from the Rust backend over the Channel.
 * snake_case matches Tauri's serde serialization.
 */
export interface BackendRenderArtifact {
  frame_id: string;
  content_hash: string;
  spatial_tier: SpatialTier;
  /** RGBA bytes — length must equal width * height * 4 */
  rgba_data: number[] | Uint8ClampedArray;
  width: number;
  height: number;
  timestamp_ms: number;
  /** Optional: present when epoch is embedded in the response */
  epoch_id?: string;
  source?: string;
}

/**
 * Frontend-ready artifact: RGBA decoded into an ImageBitmap,
 * stamped with the requesting epoch for downstream validation.
 */
export interface TransportArtifact {
  frameId: string;
  contentHash: string;
  spatialTier: SpatialTier;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  timestampMs: number;
  epochId: RenderEpochId;
  // Optional source identifier for debugging / test assertions
  source?: string;
}

// ─── Epoch Registry ───────────────────────────────────────────────────────────

/**
 * Maps clipId → currently active epochId.
 * Used to gate artifact delivery: any artifact arriving after the epoch has
 * changed is silently dropped.
 */
// Export type for tests

const _activeEpochs = new Map<string, RenderEpochId>();

/** Register (or replace) the active epoch for a clip. */
export function registerActiveEpoch(clipId: string, epochId: RenderEpochId): void {
  _activeEpochs.set(clipId, epochId);
}

/** Unregister the active epoch when a clip is unmounted. */
export function unregisterActiveEpoch(clipId: string): void {
  _activeEpochs.delete(clipId);
}

/**
 * Returns true if the given epochId is still the active epoch for ANY clip.
 * This allows shared epochs across clips (e.g. multi-clip scrubbing).
 */
export function isEpochStillValid(epochId: RenderEpochId): boolean {
  for (const active of _activeEpochs.values()) {
    if (active === epochId) return true;
  }
  return false;
}

// ─── RGBA → ImageBitmap ───────────────────────────────────────────────────────

/**
 * Convert raw RGBA bytes to an ImageBitmap.
 * Uses SAB zero-copy path when available, otherwise copies into ImageData.
 */
async function rgbaToImageBitmap(rgba: number[] | Uint8ClampedArray, width: number, height: number): Promise<ImageBitmap> {
  // Always create a regular Uint8ClampedArray copy for ImageData compatibility.
  // This works for plain number arrays, Uint8ClampedArray, and SharedArrayBuffer buffers.
  const clamped = new Uint8ClampedArray(rgba as any);

  const imageData = new ImageData(clamped, width, height);
  return createImageBitmap(imageData);
}

// ─── requestRenderArtifacts ───────────────────────────────────────────────────

export interface RequestRenderArtifactsOptions {
  videoPath: string;
  timestampMs: number;
  spatialTiers: SpatialTier[];
  epochId: RenderEpochId;
  clipId: string;
  onArtifact: (artifact: TransportArtifact) => void;
  onComplete?: () => void;
  onError?: (err: unknown) => void;
}

/**
 * Request render artifacts for a single timestamp from the Rust backend.
 * Returns a cancel() function — calling it prevents any further delivery
 * from this request even if artifacts are already in-flight.
 */
export function requestRenderArtifacts(opts: RequestRenderArtifactsOptions): () => void {
  const { videoPath, timestampMs, spatialTiers, epochId, clipId, onArtifact, onComplete, onError } = opts;

  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };

  const channel = new Channel<BackendRenderArtifact>();
  channel.onmessage = async (raw) => {
    if (cancelled) return;
    if (!isEpochStillValid(epochId)) return;

    try {
      const bitmap = await rgbaToImageBitmap(raw.rgba_data, raw.width, raw.height);
      if (cancelled || !isEpochStillValid(epochId)) {
        bitmap.close();
        return;
      }
      onArtifact({
        frameId: raw.frame_id,
        contentHash: raw.content_hash,
        spatialTier: raw.spatial_tier,
        bitmap,
        width: raw.width,
        height: raw.height,
        timestampMs,
        epochId,
      });
    } catch (err) {
      onError?.(err);
    }
  };

  invoke("get_render_artifact", {
    videoPath,
    timestampMs,
    spatialTiers: spatialTiers.map(spatialTierToLabel),
    effectGraphVersion: 0,
    onArtifact: channel,
  })
    .then(() => {
      if (!cancelled) onComplete?.();
    })
    .catch((err) => {
      if (!cancelled) onError?.(err);
    });

  return cancel;
}

// ─── requestBatchArtifacts ────────────────────────────────────────────────────

export interface RequestBatchArtifactsOptions {
  videoPath: string;
  timestampsMs: number[];
  spatialTiers: SpatialTier[];
  epochId: RenderEpochId;
  clipId: string;
  onArtifact: (artifact: TransportArtifact) => void;
  onComplete?: () => void;
  onError?: (err: unknown) => void;
  /** Max concurrent invoke calls. Default: 4 */
  concurrency?: number;
}

/**
 * Request artifacts for multiple timestamps concurrently, with a concurrency cap.
 * Returns a cancel() that stops all in-flight requests.
 */
export function requestBatchArtifacts(opts: RequestBatchArtifactsOptions): () => void {
  const { videoPath, timestampsMs, spatialTiers, epochId, clipId, onArtifact, onComplete, onError, concurrency = 4 } = opts;

  if (timestampsMs.length === 0) {
    onComplete?.();
    return () => {};
  }

  let cancelled = false;
  const cancels: Array<() => void> = [];
  const cancel = () => {
    cancelled = true;
    cancels.forEach((fn) => fn());
  };

  let completed = 0;
  const total = timestampsMs.length;

  const handleComplete = () => {
    completed++;
    if (completed >= total && !cancelled) {
      onComplete?.();
    }
  };

  // Dispatch with concurrency window using a simple queue
  const queue = [...timestampsMs];
  let active = 0;

  const dispatch = () => {
    while (active < concurrency && queue.length > 0 && !cancelled) {
      const ts = queue.shift()!;
      active++;
      const c = requestRenderArtifacts({
        videoPath,
        timestampMs: ts,
        spatialTiers,
        epochId,
        clipId,
        onArtifact,
        onComplete: () => {
          active--;
          handleComplete();
          dispatch(); // fill the slot
        },
        onError: (err) => {
          active--;
          onError?.(err);
          handleComplete();
          dispatch();
        },
      });
      cancels.push(c);
    }
  };

  dispatch();
  return cancel;
}

// ─── requestProgressiveTiers ──────────────────────────────────────────────────

export interface RequestProgressiveTiersOptions {
  videoPath: string;
  timestampsMs: number[];
  /** First tier to request (always L0 for fast-paint). */
  startTier: SpatialTier;
  /** Final tier to converge to. */
  targetTier: SpatialTier;
  epochId: RenderEpochId;
  clipId: string;
  onArtifact: (artifact: TransportArtifact) => void;
  onComplete?: () => void;
  onError?: (err: unknown) => void;
  concurrency?: number;
}

// Export type for tests – alias to the request options interface
export type ProgressiveTierRequest = RequestProgressiveTiersOptions;

/**
 * Progressive tier upgrade: delivers startTier first (fast-paint), then
 * upgrades through each intermediate tier until targetTier.
 *
 * Each tier waits for the previous to complete before starting.
 * Epoch is re-validated before each tier batch begins.
 * Returns a cancel() that stops the entire sequence.
 */
export function requestProgressiveTiers(opts: RequestProgressiveTiersOptions): () => void {
  const { videoPath, timestampsMs, startTier, targetTier, epochId, clipId, onArtifact, onComplete, onError, concurrency } = opts;

  let cancelled = false;
  let currentCancel: (() => void) | null = null;

  const cancel = () => {
    cancelled = true;
    currentCancel?.();
  };

  // Build the tier sequence: startTier → ... → targetTier (inclusive)
  const tiers: SpatialTier[] = [];
  for (let t = startTier; t <= targetTier; t++) {
    tiers.push(t as SpatialTier);
  }

  const runTier = (idx: number) => {
    if (cancelled || idx >= tiers.length) {
      if (!cancelled) onComplete?.();
      return;
    }

    const tier = tiers[idx];

    // Re-validate epoch before each tier batch
    if (!isEpochStillValid(epochId)) return;

    const [width, height] = SPATIAL_TIER_DIMS[tier];

    currentCancel = requestBatchArtifacts({
      videoPath,
      timestampsMs,
      spatialTiers: [tier],
      epochId,
      clipId,
      onArtifact,
      concurrency,
      onComplete: () => {
        if (!cancelled) runTier(idx + 1);
      },
      onError,
    });

    // Suppress unused variable warning — width/height used by Rust side via spatialTiers
    void width;
    void height;
  };

  runTier(0);
  return cancel;
}
