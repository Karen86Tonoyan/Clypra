import { useState, useEffect, useCallback, useRef, useMemo, RefObject } from "react";
import { useTimelineStore, getInsertIndexForNewTrack } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import { usePlayback } from "@/hooks/usePlayback";
import type { Clip } from "@/types";
import { suspendAutoSave, resumeAutoSave } from "@/store/middleware/autoSaveMiddleware";
import { calculateGapStartTime, calculateDraggedBlockDuration, findInsertionIndex } from "@/lib/clipPositions";

const DRAG_RENDER_EPSILON_PX = 0.25;
const HYSTERESIS_THRESHOLD_PX = 8;
const TIME_SNAP_EPSILON_SEC = 0.06;

function resolveTrackAtClientY(
  container: HTMLElement,
  tracks: Array<{ id: string }>,
  clientY: number,
): {
  targetTrackId: string | null;
  willCreateNewTrack: boolean;
  newTrackPosition: "above" | "below" | null;
} {
  if (tracks.length === 0) {
    return { targetTrackId: null, willCreateNewTrack: true, newTrackPosition: "below" };
  }

  const rects: { id: string; top: number; bottom: number }[] = [];
  for (const track of tracks) {
    const row = container.querySelector<HTMLElement>(`[data-track-id="${track.id}"]`);
    if (!row) continue;
    const r = row.getBoundingClientRect();
    rects.push({ id: track.id, top: r.top, bottom: r.bottom });
  }

  if (rects.length === 0) {
    return { targetTrackId: null, willCreateNewTrack: false, newTrackPosition: null };
  }

  const firstTop = Math.min(...rects.map((x) => x.top));
  const lastBottom = Math.max(...rects.map((x) => x.bottom));

  if (clientY < firstTop) {
    return { targetTrackId: null, willCreateNewTrack: true, newTrackPosition: "above" };
  }
  if (clientY >= lastBottom) {
    return { targetTrackId: null, willCreateNewTrack: true, newTrackPosition: "below" };
  }

  for (const track of tracks) {
    const row = container.querySelector<HTMLElement>(`[data-track-id="${track.id}"]`);
    if (!row) continue;
    const r = row.getBoundingClientRect();
    if (clientY >= r.top && clientY < r.bottom) {
      return { targetTrackId: track.id, willCreateNewTrack: false, newTrackPosition: null };
    }
  }

  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const rect of rects) {
    const mid = (rect.top + rect.bottom) / 2;
    const d = Math.abs(clientY - mid);
    if (d < bestDist) {
      bestDist = d;
      bestId = rect.id;
    }
  }
  return { targetTrackId: bestId, willCreateNewTrack: false, newTrackPosition: null };
}

export interface DragState {
  draggingClipId: string | null;
  draggedClipIds: string[];
  offsetX: number;
  offsetY: number;
  pointerXContentStart: number;
  pointerClientYStart: number;
  visualLeftAnchorDelta: number;
  originalTrackId: string;
  originalIndex: number;
  originalStartTime: number;
  originalPlacements: Record<string, { trackId: string; startTime: number; index: number }>;
  targetTrackId: string | null;
  insertionIndex: number | null;
  gapStartTime: number | null;
  gapDuration: number | null;
  targetStartTime: number | null;
  isInvalidPosition?: boolean;
  willCreateNewTrack?: boolean;
  newTrackPosition?: "above" | "below" | null;
  pointerOffsetFromLeft?: number; // Where user clicked within the clip
}

export function useTimelineDrag(containerRef: RefObject<HTMLDivElement | null>) {
  const { tracks, clips, updateClip, withBatch, normalizeTrack, insertClipAtIndex, removeEmptyNonMainTracks } = useTimelineStore();
  const { currentTime } = usePlayback();

  const [dragState, setDragState] = useState<DragState | null>(null);

  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  const dragMoveRafRef = useRef<number | null>(null);
  const dragMovePointerRef = useRef<{ clipId: string; clientX: number; clientY: number } | null>(null);

  // ── Lookup maps: O(n) once per clip/track change, O(1) during drag ──
  const clipMapRef = useRef<Map<string, Clip>>(new Map());
  const trackClipsMapRef = useRef<Map<string, Clip[]>>(new Map());

  useMemo(() => {
    clipMapRef.current = new Map(clips.map((c) => [c.id, c]));

    const tcMap = new Map<string, Clip[]>();
    for (const track of tracks) {
      tcMap.set(
        track.id,
        clips.filter((c) => c.trackId === track.id).sort((a, b) => a.startTime - b.startTime),
      );
    }
    trackClipsMapRef.current = tcMap;
  }, [clips, tracks]);

  const handleClipDragStart = useCallback(
    (clipId: string, startX: number, startY: number, pointerOffsetFromLeft?: number) => {
      const clip = clipMapRef.current.get(clipId);
      if (!clip) return;
      suspendAutoSave();
      const selectedClipIds = useUIStore.getState().selectedClipIds;
      const draggedClipIds = selectedClipIds.includes(clipId) ? selectedClipIds : [clipId];

      // Find clip's index in its track
      const trackClips = trackClipsMapRef.current.get(clip.trackId) ?? [];
      const originalIndex = trackClips.findIndex((c) => c.id === clipId);
      const originalPlacements: Record<string, { trackId: string; startTime: number; index: number }> = {};
      for (const draggedId of draggedClipIds) {
        const dragged = clipMapRef.current.get(draggedId);
        if (!dragged) continue;
        const draggedTrackClips = trackClipsMapRef.current.get(dragged.trackId) ?? [];
        originalPlacements[dragged.id] = {
          trackId: dragged.trackId,
          startTime: dragged.startTime,
          index: draggedTrackClips.findIndex((c) => c.id === dragged.id),
        };
      }

      const container = containerRef.current;
      let pointerXContentStart = startX;
      const pointerClientYStart = startY;
      if (container) {
        const cr = container.getBoundingClientRect();
        pointerXContentStart = startX - cr.left + container.scrollLeft;
      }

      // Calculate dragged block duration (for multi-clip selections)
      const draggedBlockDuration = calculateDraggedBlockDuration(clips, draggedClipIds);

      const nextDragState: DragState = {
        draggingClipId: clipId,
        draggedClipIds,
        offsetX: 0,
        offsetY: 0,
        pointerXContentStart,
        pointerClientYStart,
        visualLeftAnchorDelta: 0,
        originalTrackId: clip.trackId,
        originalIndex,
        originalStartTime: clip.startTime,
        originalPlacements,
        targetTrackId: null,
        insertionIndex: null,
        gapStartTime: null,
        gapDuration: draggedBlockDuration,
        targetStartTime: null,
        isInvalidPosition: false,
        willCreateNewTrack: false,
        newTrackPosition: null,
        pointerOffsetFromLeft,
      };
      dragStateRef.current = nextDragState;
      setDragState(nextDragState);
    },
    [clips, containerRef],
  );

  const flushQueuedClipDragMove = useCallback(() => {
    dragMoveRafRef.current = null;
    const pointer = dragMovePointerRef.current;
    if (!pointer) return;
    const { clipId, clientX, clientY } = pointer;
    const ds = dragStateRef.current;
    if (!ds || ds.draggingClipId !== clipId) return;

    const container = containerRef.current;
    if (!container) return;

    const cr = container.getBoundingClientRect();
    const pointerXContent = clientX - cr.left + container.scrollLeft;
    const contentDeltaPx = pointerXContent - ds.pointerXContentStart;
    // Calculate offsetX so clip stays under cursor at the clicked point
    // Subtract pointerOffsetFromLeft so the clicked point stays under cursor
    const pointerOffset = ds.pointerOffsetFromLeft ?? 0;
    const offsetX = contentDeltaPx - pointerOffset;
    const offsetY = clientY - ds.pointerClientYStart;

    const { clips: liveClips, tracks: liveTracks } = useTimelineStore.getState();
    const clip = clipMapRef.current.get(clipId) ?? liveClips.find((c) => c.id === clipId);
    if (!clip) return;

    const { targetTrackId, willCreateNewTrack, newTrackPosition } = resolveTrackAtClientY(container, liveTracks, clientY);

    // If creating new track, show indicator and skip insertion calculation.
    if (willCreateNewTrack) {
      const next: DragState = {
        ...ds,
        offsetX,
        offsetY,
        isInvalidPosition: false,
        targetTrackId: null,
        insertionIndex: null,
        gapStartTime: null,
        gapDuration: null,
        targetStartTime: null,
        willCreateNewTrack: true,
        newTrackPosition,
      };
      const visualChanged = Math.abs((next.offsetX ?? 0) - (ds.offsetX ?? 0)) > DRAG_RENDER_EPSILON_PX || Math.abs((next.offsetY ?? 0) - (ds.offsetY ?? 0)) > DRAG_RENDER_EPSILON_PX;
      dragStateRef.current = next;
      if (visualChanged || ds.willCreateNewTrack !== next.willCreateNewTrack || ds.newTrackPosition !== next.newTrackPosition) {
        setDragState(next);
      }
      return;
    }

    const targetTrack = liveTracks.find((t) => t.id === targetTrackId);

    // Validate ALL dragged clips against target track, not just primary
    let isTrackTypeMismatch = false;
    if (targetTrack) {
      for (const draggedId of ds.draggedClipIds) {
        const draggedClip = clipMapRef.current.get(draggedId) ?? liveClips.find((c) => c.id === draggedId);
        if (!draggedClip) continue;
        const isTextClip = "text" in draggedClip;
        if (isTextClip ? targetTrack.type !== "text" : targetTrack.type === "text") {
          isTrackTypeMismatch = true;
          break;
        }
      }
    }

    const isInvalidPosition = targetTrack?.locked || isTrackTypeMismatch || false;
    if (isInvalidPosition) {
      const next: DragState = {
        ...ds,
        offsetX,
        offsetY,
        isInvalidPosition: true,
        targetTrackId: null,
        insertionIndex: null,
        gapStartTime: null,
        gapDuration: null,
        targetStartTime: null,
        willCreateNewTrack: false,
        newTrackPosition: null,
      };
      const visualChanged = Math.abs((next.offsetX ?? 0) - (ds.offsetX ?? 0)) > DRAG_RENDER_EPSILON_PX || Math.abs((next.offsetY ?? 0) - (ds.offsetY ?? 0)) > DRAG_RENDER_EPSILON_PX;
      dragStateRef.current = next;
      if (visualChanged || ds.isInvalidPosition !== next.isInvalidPosition) {
        setDragState(next);
      }
      return;
    }

    if (!targetTrackId) {
      const next: DragState = { ...ds, offsetX, offsetY };
      const visualChanged = Math.abs((next.offsetX ?? 0) - (ds.offsetX ?? 0)) > DRAG_RENDER_EPSILON_PX || Math.abs((next.offsetY ?? 0) - (ds.offsetY ?? 0)) > DRAG_RENDER_EPSILON_PX;
      dragStateRef.current = next;
      if (visualChanged) {
        setDragState(next);
      }
      return;
    }

    // Get track clips excluding dragged clips
    const { pixelsPerSecond: livePps } = useTimelineStore.getState();
    const pps = Math.max(1, livePps);
    const pointerX = clientX - cr.left + container.scrollLeft;

    const trackClips = trackClipsMapRef.current.get(targetTrackId) ?? [];
    const draggedSet = new Set(ds.draggedClipIds);
    const restClips = trackClips.filter((c) => !draggedSet.has(c.id));

    // Find insertion index using edge-based detection with hysteresis
    const insertionIndex = findInsertionIndex({
      restClips,
      pointerX,
      pixelsPerSecond: pps,
      currentInsertionIndex: ds.insertionIndex,
      hysteresisThreshold: HYSTERESIS_THRESHOLD_PX,
    });

    // Calculate gap start time (where dragged clip will render)
    const gapStartTime = calculateGapStartTime({
      trackClips,
      draggedClipIds: ds.draggedClipIds,
      draggedBlockDuration: ds.gapDuration ?? clip.duration,
      insertionIndex,
    });
    const next: DragState = {
      ...ds,
      offsetX,
      offsetY,
      isInvalidPosition: false,
      targetTrackId,
      insertionIndex,
      gapStartTime,
      gapDuration: ds.gapDuration ?? clip.duration,
      targetStartTime: gapStartTime,
      willCreateNewTrack: false,
      newTrackPosition: null,
    };
    const visualChanged = Math.abs((next.offsetX ?? 0) - (ds.offsetX ?? 0)) > DRAG_RENDER_EPSILON_PX || Math.abs((next.offsetY ?? 0) - (ds.offsetY ?? 0)) > DRAG_RENDER_EPSILON_PX;
    const targetChanged = ds.targetTrackId !== next.targetTrackId || ds.targetStartTime !== next.targetStartTime || ds.insertionIndex !== next.insertionIndex || ds.isInvalidPosition !== next.isInvalidPosition || ds.willCreateNewTrack !== next.willCreateNewTrack || ds.newTrackPosition !== next.newTrackPosition;
    dragStateRef.current = next;
    if (visualChanged || targetChanged) setDragState(next);
  }, [containerRef, currentTime]);

  const handleClipDragMove = useCallback(
    (clipId: string, _deltaX: number, _deltaY: number, clientX: number, clientY: number) => {
      const ds = dragStateRef.current;
      if (!ds || ds.draggingClipId !== clipId) return;
      dragMovePointerRef.current = { clipId, clientX, clientY };
      if (dragMoveRafRef.current !== null) return;
      dragMoveRafRef.current = requestAnimationFrame(flushQueuedClipDragMove);
    },
    [flushQueuedClipDragMove],
  );

  const clearQueuedDragMove = useCallback(() => {
    if (dragMoveRafRef.current !== null) {
      cancelAnimationFrame(dragMoveRafRef.current);
      dragMoveRafRef.current = null;
    }
    dragMovePointerRef.current = null;
  }, []);

  const handleClipDragEnd = useCallback(
    (clipId: string) => {
      flushQueuedClipDragMove();
      const dragSnapshot = dragStateRef.current;
      if (!dragSnapshot) {
        clearQueuedDragMove();
        return;
      }

      const sourceTrackIds = Array.from(new Set(Object.values(dragSnapshot.originalPlacements).map((p) => p.trackId)));

      if (dragSnapshot.isInvalidPosition) {
        // No restoration needed - we never mutated state during drag start
        dragStateRef.current = null;
        setDragState(null);
        clearQueuedDragMove();
        resumeAutoSave();
        return;
      }

      const clip = useTimelineStore.getState().clips.find((c) => c.id === clipId);
      if (!clip) {
        dragStateRef.current = null;
        setDragState(null);
        clearQueuedDragMove();
        resumeAutoSave();
        return;
      }

      // Handle new track creation
      if (dragSnapshot.willCreateNewTrack && dragSnapshot.newTrackPosition) {
        const isTextClip = "text" in clip;
        const mediaAsset = useProjectStore.getState().mediaAssets.find((a) => a.id === clip.mediaId);
        const trackType = isTextClip ? "text" : mediaAsset?.type === "audio" ? "audio" : "video";

        const store = useTimelineStore.getState();
        const insertIndex = getInsertIndexForNewTrack(store.tracks, trackType);
        const newTrackId = store.insertTrackAt(trackType, insertIndex);
        const orderedDragged = [...dragSnapshot.draggedClipIds].sort((a, b) => {
          const pa = dragSnapshot.originalPlacements[a];
          const pb = dragSnapshot.originalPlacements[b];
          if (!pa || !pb) return a.localeCompare(b);
          if (pa.startTime !== pb.startTime) return pa.startTime - pb.startTime;
          return a.localeCompare(b);
        });
        const baseStartTime = dragSnapshot.targetStartTime ?? 0;
        const primaryDraggedId = dragSnapshot.draggingClipId ?? dragSnapshot.draggedClipIds[0];
        const primaryOriginalStart = (primaryDraggedId ? dragSnapshot.originalPlacements[primaryDraggedId]?.startTime : undefined) ?? 0;
        withBatch(() => {
          orderedDragged.forEach((id) => {
            const placement = dragSnapshot.originalPlacements[id];
            if (!placement) return;
            const relativeStartOffset = placement.startTime - primaryOriginalStart;
            updateClip(id, {
              trackId: newTrackId,
              startTime: Math.max(0, baseStartTime + relativeStartOffset),
            });
          });
        });
        removeEmptyNonMainTracks(sourceTrackIds);

        dragStateRef.current = null;
        setDragState(null);
        clearQueuedDragMove();
        resumeAutoSave();
        return;
      }

      const { pixelsPerSecond: livePps } = useTimelineStore.getState();

      // All drops use insertion index (no free positioning)
      if (dragSnapshot.targetTrackId && dragSnapshot.insertionIndex !== null) {
        const orderedDragged = [...dragSnapshot.draggedClipIds].sort((a, b) => {
          const pa = dragSnapshot.originalPlacements[a];
          const pb = dragSnapshot.originalPlacements[b];
          if (!pa || !pb) return a.localeCompare(b);
          if (pa.startTime !== pb.startTime) return pa.startTime - pb.startTime;
          return a.localeCompare(b);
        });
        orderedDragged.forEach((id, i) => insertClipAtIndex(id, dragSnapshot.targetTrackId!, dragSnapshot.insertionIndex! + i));
        // Always normalize track to close gaps
        normalizeTrack(dragSnapshot.targetTrackId);
        removeEmptyNonMainTracks(sourceTrackIds);
        dragStateRef.current = null;
        setDragState(null);
        clearQueuedDragMove();
        resumeAutoSave();
        return;
      }

      // Fallback: No valid drop target (should not happen in normal operation)
      dragStateRef.current = null;
      setDragState(null);
      clearQueuedDragMove();
      resumeAutoSave();
    },
    [flushQueuedClipDragMove, clearQueuedDragMove, updateClip, insertClipAtIndex, normalizeTrack, removeEmptyNonMainTracks, withBatch],
  );

  // Handle ESC key to cancel drag
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      clearQueuedDragMove();
      const ds = dragStateRef.current;
      if (!ds) return;

      // No restoration needed - we never mutated state during drag start
      dragStateRef.current = null;
      setDragState(null);
      resumeAutoSave();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearQueuedDragMove]);

  useEffect(() => {
    return () => {
      clearQueuedDragMove();
    };
  }, [clearQueuedDragMove]);

  return {
    dragState,
    handleClipDragStart,
    handleClipDragMove,
    handleClipDragEnd,
  };
}
