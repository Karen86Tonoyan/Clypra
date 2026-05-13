/**
 * Timeline Store
 *
 * OWNERSHIP: Editable timeline domain state (single source of truth)
 * PERSISTENCE: Persistent (saved/loaded by projectStore)
 * MUTABILITY: Mutable (user edits, operations)
 *
 * Responsibilities:
 * - Own all timeline composition state (tracks, clips, selections)
 * - Provide mutation operations (add/remove/update clips/tracks)
 * - Maintain timeline view state (zoom, scroll)
 * - Emit epoch changes for render invalidation
 *
 * Does NOT:
 * - Persist to disk (projectStore handles serialization)
 * - Manage runtime resources (ProjectSession handles playback/scheduler)
 * - Reset itself (only projectStore loads/clears on project switch)
 *
 * Architecture principle:
 * This is the authoritative source for "what is on the timeline right now"
 * All other systems (render, playback, export) consume this as immutable input
 */

import { create } from "zustand";
import type { Track, Clip } from "@/types";
import { generateId, getCounter } from "@/lib/id";
import { useUIStore } from "./uiStore";
import { useProjectStore } from "./projectStore";
import { clampTimelinePixelsPerSecond, clampTimelineZoom, TIMELINE_PPS_PER_ZOOM, TIMELINE_ZOOM_DEFAULT } from "../lib/timelineZoom";
import { getTimelineContentEnd, normalizeClipTiming } from "@/lib/timelineClip";
import { autoSaveMiddleware } from "./middleware/autoSaveMiddleware";

interface TimelineStore {
  tracks: Track[];
  clips: Clip[];
  /**
   * First created video track - UI metadata only.
   * Used for: default drop target, visual highlighting, user expectations.
   * NOT used for: enforcement, validation, or blocking operations.
   * The compositor resolves frames by time, not by track constraints.
   */
  mainVideoTrackId: string | null;
  /**
   * Timeline epoch - increments on every timeline mutation.
   * Used for cache invalidation in render engine and evaluation.
   */
  epoch: number;
  zoomLevel: number;
  scrollLeft: number;
  pixelsPerSecond: number;
  rippleEditEnabled: boolean;
  /** @internal Batch nesting depth — do not read directly */
  _batchDepth: number;
  /** @internal Deferred epoch flag — do not read directly */
  _pendingEpochIncrement: boolean;
  /** Begin a batch of mutations. Epoch increment is deferred until endBatch(). */
  beginBatch: () => void;
  /** End a batch. If any mutation requested an epoch increment, it fires now. */
  endBatch: () => void;
  /** Increment epoch (for cache invalidation) */
  incrementEpoch: () => void;
  /** Hydrate timeline state from project load (atomic operation) */
  hydrateFromProject: (payload: { tracks?: any[]; clips?: any[] }) => void;
  addTrack: (type: "video" | "audio" | "text") => void;
  /** Inserts a track at index (clamped); returns the new track id. */
  insertTrackAt: (type: "video" | "audio" | "text", index: number) => string;
  removeTrack: (trackId: string) => void;
  toggleTrackLock: (trackId: string) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackVisibility: (trackId: string) => void;
  addClip: (clip: Clip) => void;
  removeClip: (clipId: string) => void;
  updateClip: (clipId: string, updates: Partial<Clip>) => void;
  moveClip: (clipId: string, startTime: number) => void;
  setZoom: (level: number) => void;
  /** Clamps to the SRP zoom range and syncs `zoomLevel` to `pixelsPerSecond / 100`. */
  setPixelsPerSecond: (pps: number) => void;
  setScrollLeft: (left: number) => void;
  getTimelineEndTime: () => number;
  swapClips: () => { error: string | null };
  toggleRippleEdit: () => void;
  rippleTrimClip: (clipId: string, side: "left" | "right", deltaTime: number) => void;
  // Sequence-based operations
  insertClipAtIndex: (clipId: string, trackId: string, index: number) => void;
  normalizeTrack: (trackId: string) => void;
  getTrackClips: (trackId: string) => Clip[];
  removeEmptyNonMainTracks: (candidateTrackIds?: string[]) => void;
}

const trackHeights: Record<string, number> = {
  video: 68,
  audio: 52,
  text: 56,
};

/** Where to insert a new row when dropping off-track: video/text at top; audio under first video (or append if no video). */
export function getInsertIndexForNewTrack(tracks: Track[], trackType: "video" | "audio" | "text"): number {
  if (trackType === "video" || trackType === "text") {
    return 0;
  }
  const mainIdx = tracks.findIndex((t) => t.type === "video");
  if (mainIdx >= 0) {
    return mainIdx + 1;
  }
  return tracks.length;
}

export const useTimelineStore = create<TimelineStore>(
  autoSaveMiddleware((set, get) => ({
    tracks: [],
    clips: [],
    mainVideoTrackId: null,
    epoch: 0,
    zoomLevel: TIMELINE_ZOOM_DEFAULT,
    scrollLeft: 0,
    pixelsPerSecond: TIMELINE_ZOOM_DEFAULT * TIMELINE_PPS_PER_ZOOM,
    rippleEditEnabled: false,
    _batchDepth: 0,
    _pendingEpochIncrement: false,

    beginBatch: () => {
      set((state) => ({ _batchDepth: state._batchDepth + 1 }));
    },

    endBatch: () => {
      set((state) => {
        const newDepth = Math.max(0, state._batchDepth - 1);
        if (newDepth === 0 && state._pendingEpochIncrement) {
          return { _batchDepth: 0, _pendingEpochIncrement: false, epoch: state.epoch + 1 };
        }
        return { _batchDepth: newDepth };
      });
    },

    incrementEpoch: () => {
      set((state) => {
        if (state._batchDepth > 0) {
          return { _pendingEpochIncrement: true };
        }
        return { epoch: state.epoch + 1 };
      });
    },

    hydrateFromProject: (payload) => {
      const finalTracks = payload?.tracks ?? [];
      const finalClipsRaw = payload?.clips ?? [];

      // Normalize clip timing with media asset data
      const mediaAssets = useProjectStore.getState().mediaAssets;

      const normalizedClips = finalClipsRaw.map((clip: Clip) => {
        const asset = mediaAssets.find((a) => a.id === clip.mediaId);
        return normalizeClipTiming(clip, asset);
      });

      // Atomic state update - all or nothing
      set({
        tracks: finalTracks,
        clips: normalizedClips,
        scrollLeft: 0,
        zoomLevel: TIMELINE_ZOOM_DEFAULT,
        pixelsPerSecond: TIMELINE_ZOOM_DEFAULT * TIMELINE_PPS_PER_ZOOM,
        epoch: 0, // Reset epoch on project load
      });
    },

    addTrack: (type) => {
      const newTrack: Track = {
        id: generateId("track"),
        type,
        name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${getCounter() % 100}`,
        muted: false,
        locked: false,
        visible: true,
        height: trackHeights[type],
      };
      set((state) => ({
        tracks: [...state.tracks, newTrack],
        mainVideoTrackId: state.mainVideoTrackId ?? (type === "video" ? newTrack.id : null),
      }));
    },

    insertTrackAt: (type, index) => {
      const newTrack: Track = {
        id: generateId("track"),
        type,
        name: `${type.charAt(0).toUpperCase() + type.slice(1)} ${getCounter() % 100}`,
        muted: false,
        locked: false,
        visible: true,
        height: trackHeights[type],
      };
      const id = newTrack.id;
      set((state) => {
        const clamped = Math.max(0, Math.min(index, state.tracks.length));
        const next = [...state.tracks];
        next.splice(clamped, 0, newTrack);
        return {
          tracks: next,
          mainVideoTrackId: state.mainVideoTrackId ?? (type === "video" ? newTrack.id : null),
        };
      });
      return id;
    },

    removeTrack: (trackId) => {
      set((state) => ({
        tracks: state.tracks.filter((t) => t.id !== trackId),
        clips: state.clips.filter((c) => c.trackId !== trackId),
      }));
    },

    toggleTrackLock: (trackId) => {
      set((state) => ({
        tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, locked: !track.locked } : track)),
      }));
    },

    toggleTrackMute: (trackId) => {
      set((state) => ({
        tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, muted: !track.muted } : track)),
      }));
    },

    toggleTrackVisibility: (trackId) => {
      set((state) => ({
        tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, visible: !track.visible } : track)),
      }));
    },

    addClip: (clip) => {
      set((state) => ({
        clips: [...state.clips, clip],
      }));
    },

    removeClip: (clipId) => {
      set((state) => {
        const next: Partial<TimelineStore> = {
          clips: state.clips.filter((c) => c.id !== clipId),
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });
    },

    updateClip: (clipId, updates) => {
      set((state) => {
        const next: Partial<TimelineStore> = {
          clips: state.clips.map((c) => (c.id === clipId ? { ...c, ...updates } : c)),
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });
    },

    moveClip: (clipId, startTime) => {
      set((state) => {
        const next: Partial<TimelineStore> = {
          clips: state.clips.map((c) => (c.id === clipId ? { ...c, startTime } : c)),
        };
        if (state._batchDepth > 0) {
          next._pendingEpochIncrement = true;
        } else {
          next.epoch = state.epoch + 1;
        }
        return next;
      });
    },

    setPixelsPerSecond: (pps) => {
      const clamped = clampTimelinePixelsPerSecond(pps);
      set({
        pixelsPerSecond: clamped,
        zoomLevel: clamped / TIMELINE_PPS_PER_ZOOM,
      });
    },

    setZoom: (level) => {
      get().setPixelsPerSecond(TIMELINE_PPS_PER_ZOOM * clampTimelineZoom(level));
    },

    setScrollLeft: (left) => {
      set({ scrollLeft: left });
    },

    getTimelineEndTime: () => {
      const state = get();
      return getTimelineContentEnd(state.clips);
    },

    swapClips: () => {
      const { selectedClipIds } = useUIStore.getState();

      // Guard: exactly 2 clips must be selected
      if (selectedClipIds.length !== 2) {
        return { error: "Select exactly 2 clips to swap" };
      }

      const state = get();
      const clipA = state.clips.find((c) => c.id === selectedClipIds[0]);
      const clipB = state.clips.find((c) => c.id === selectedClipIds[1]);

      if (!clipA || !clipB) {
        return { error: "Selected clips not found" };
      }

      // Case: different tracks — simple position + track swap
      if (clipA.trackId !== clipB.trackId) {
        set((state) => ({
          clips: state.clips.map((c) => {
            if (c.id === clipA.id) {
              return { ...c, startTime: clipB.startTime, trackId: clipB.trackId };
            }
            if (c.id === clipB.id) {
              return { ...c, startTime: clipA.startTime, trackId: clipA.trackId };
            }
            return c;
          }),
        }));

        return { error: null };
      }

      // Case: same track — recalculate positions flush
      // Ensure left is always the leftmost clip
      const [left, right] = clipA.startTime < clipB.startTime ? [clipA, clipB] : [clipB, clipA];

      const newLeftStart = left.startTime; // left clip stays at same start
      const newRightStart = left.startTime + right.duration; // right fills left's old spot
      const newLeftEnd = newRightStart + left.duration;

      // Collision check: does the swapped left clip overlap anything after it?
      const trackClips = state.clips.filter((c) => c.trackId === left.trackId && c.id !== left.id && c.id !== right.id).sort((a, b) => a.startTime - b.startTime);

      const clipAfterRight = trackClips.find((c) => c.startTime >= right.startTime);

      if (clipAfterRight && newLeftEnd > clipAfterRight.startTime) {
        return { error: "Not enough space to swap — clips would overlap" };
      }

      set((state) => ({
        clips: state.clips.map((c) => {
          if (c.id === left.id) return { ...c, startTime: newRightStart };
          if (c.id === right.id) return { ...c, startTime: newLeftStart };
          return c;
        }),
      }));

      return { error: null };
    },

    toggleRippleEdit: () => {
      set((state) => ({ rippleEditEnabled: !state.rippleEditEnabled }));
    },

    rippleTrimClip: (clipId, side, deltaTime) => {
      const state = get();
      const clip = state.clips.find((c) => c.id === clipId);
      if (!clip) return;

      const track = state.tracks.find((t) => t.id === clip.trackId);
      if (track?.locked) return;

      // Clamp trimming to underlying media duration when available.
      // Falls back to Infinity (no cap) when the media asset cannot be resolved.
      let mediaDurationBound = Infinity;
      try {
        // Lazy import to avoid circular deps during store init.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const asset = useProjectStore.getState().mediaAssets?.find((a: any) => a.id === clip.mediaId);
        if (asset?.duration && Number.isFinite(asset.duration) && asset.duration > 0) {
          mediaDurationBound = asset.duration;
        }
      } catch {
        // ignore; keep Infinity bound
      }

      const minDuration = 0.1;

      // Calculate the new clip dimensions
      let newStartTime = clip.startTime;
      let newDuration = clip.duration;
      let rippleAmount = 0;

      if (side === "right") {
        // Trimming right edge - changes duration
        const maxDuration = Math.max(minDuration, mediaDurationBound - clip.trimIn);
        const desiredDuration = clip.duration + deltaTime;
        newDuration = Math.max(minDuration, Math.min(desiredDuration, maxDuration));
        rippleAmount = newDuration - clip.duration;
      } else {
        // Trimming left edge - changes both start time and duration
        const maxTrimIn = Math.min(mediaDurationBound, clip.trimOut - 0.001);
        const desiredStartTime = clip.startTime + deltaTime;
        const desiredDelta = desiredStartTime - clip.startTime;

        const minDelta = -clip.startTime;
        const maxDeltaByDuration = clip.duration - minDuration;
        const maxDeltaByMedia = maxTrimIn - clip.trimIn;
        const clampedDelta = Math.max(minDelta, Math.min(desiredDelta, maxDeltaByDuration, maxDeltaByMedia));

        newStartTime = clip.startTime + clampedDelta;
        newDuration = clip.duration - clampedDelta;
        rippleAmount = clampedDelta;
      }

      // Find all clips downstream on the same track
      const downstreamClips = state.clips
        .filter((c) => {
          if (c.id === clipId) return false;
          if (c.trackId !== clip.trackId) return false;

          // For right edge trim: clips that start after the clip's end
          if (side === "right") {
            return c.startTime >= clip.startTime + clip.duration;
          }
          // For left edge trim: clips that start after the clip's start
          return c.startTime >= clip.startTime;
        })
        .sort((a, b) => a.startTime - b.startTime);

      // Update the trimmed clip and all downstream clips
      set((state) => ({
        clips: state.clips.map((c) => {
          if (c.id === clipId) {
            // Update the clip being trimmed
            const updates: Partial<Clip> = {
              startTime: newStartTime,
              duration: newDuration,
            };

            // Update trim points for media
            if (side === "left") {
              updates.trimIn = clip.trimIn + (newStartTime - clip.startTime);
              updates.duration = clip.trimOut - updates.trimIn;
            } else {
              updates.trimOut = Math.min(clip.trimIn + newDuration, mediaDurationBound);
              updates.duration = updates.trimOut - clip.trimIn;
            }

            return { ...c, ...updates };
          }

          // Shift downstream clips
          const downstream = downstreamClips.find((dc) => dc.id === c.id);
          if (downstream) {
            return {
              ...c,
              startTime: c.startTime + rippleAmount,
            };
          }

          return c;
        }),
      }));
    },

    // Sequence-based operations for gap engine
    getTrackClips: (trackId) => {
      const state = get();
      return state.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.startTime - b.startTime);
    },

    insertClipAtIndex: (clipId, trackId, index) => {
      const state = get();
      const clip = state.clips.find((c) => c.id === clipId);
      if (!clip) return;

      // Get all clips on target track (excluding the dragged clip)
      const trackClips = state.clips.filter((c) => c.trackId === trackId && c.id !== clipId).sort((a, b) => a.startTime - b.startTime);

      // Insert clip at index
      trackClips.splice(index, 0, clip);

      // Recalculate all positions (no gaps, no overlaps)
      let currentTime = 0;
      const updatedClips = trackClips.map((c) => {
        const updated = { ...c, startTime: currentTime, trackId };
        currentTime += c.duration;
        return updated;
      });

      // Update state with normalized positions
      set((state) => ({
        clips: state.clips.map((c) => {
          const updated = updatedClips.find((uc) => uc.id === c.id);
          return updated || c;
        }),
      }));
    },

    normalizeTrack: (trackId) => {
      const state = get();
      const trackClips = state.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.startTime - b.startTime);

      let currentTime = 0;
      const normalized = trackClips.map((clip) => {
        const updated = { ...clip, startTime: currentTime };
        currentTime += clip.duration;
        return updated;
      });

      set((state) => ({
        clips: state.clips.map((c) => {
          const norm = normalized.find((n) => n.id === c.id);
          return norm || c;
        }),
      }));
    },

    removeEmptyNonMainTracks: (candidateTrackIds) => {
      set((state) => {
        const mainVideoTrackId = state.mainVideoTrackId ?? state.tracks.find((t) => t.type === "video")?.id ?? null;
        const candidateSet = candidateTrackIds ? new Set(candidateTrackIds) : null;
        const nextTracks = state.tracks.filter((track) => {
          if (track.id === mainVideoTrackId) return true;
          if (candidateSet && !candidateSet.has(track.id)) return true;
          return state.clips.some((c) => c.trackId === track.id);
        });
        return {
          tracks: nextTracks,
          mainVideoTrackId,
        };
      });
    },
  })),
);
