import React, { useMemo } from "react";
import { Lock } from "lucide-react";
import { useDrop } from "react-dnd";
import { useUIStore } from "@/store/uiStore";
import { useTimeline } from "@/hooks/useTimeline";
import { Clip } from "./Clip";
import { handleDropOnTrack } from "@/lib/timelineUtils";
import { calculateDisplayPositions } from "@/lib/clipPositions";
import type { Clip as ClipType, Track as TrackType, DragItem } from "@/types";

interface TrackProps {
  track: TrackType;
  pixelsPerSecond: number;
  clips: any[];
  onClipDragStart?: (clipId: string, startX: number, startY: number) => void;
  onClipDragMove?: (clipId: string, deltaX: number, deltaY: number, clientX: number, clientY: number) => void;
  onClipDragEnd?: (clipId: string) => void;
  dragState?: {
    draggingClipId: string | null;
    draggedClipIds?: string[];
    offsetX: number;
    offsetY: number;
    isInvalidPosition?: boolean;
    targetTrackId?: string | null;
    insertionIndex?: number | null;
    gapStartTime?: number | null;
    gapDuration?: number | null;
  };
}

const TrackInner: React.FC<TrackProps> = ({ track, pixelsPerSecond, clips, onClipDragStart, onClipDragMove, onClipDragEnd, dragState }) => {
  const { selectedClipIds, selectedTrackId } = useUIStore();
  const { getMediaAsset } = useTimeline();

  // Drop handler for media assets from MediaTab
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: ["MEDIA_ASSET"],
      drop: (item: DragItem, monitor: any) => {
        if (!track.locked && track.type !== "text") {
          handleDropOnTrack(item, monitor, track.id);
        }
      },
      canDrop: () => !track.locked && track.type !== "text",
      collect: (monitor: any) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [track.id, track.locked, track.type],
  );

  // Get all clips for this track (stable array ref when clips + track.id unchanged — helps memoized children)
  const trackClips = useMemo(() => clips.filter((c) => c.trackId === track.id), [clips, track.id]);

  // Chronological order for gap shifts
  const sortedTrackClips = useMemo(() => [...trackClips].sort((a, b) => a.startTime - b.startTime), [trackClips]);

  // Calculate display positions using shared utility (single source of truth)
  const displayPositions = useMemo(() => {
    if (!dragState || dragState.targetTrackId !== track.id || dragState.insertionIndex === null || dragState.gapDuration === null) {
      // No drag affecting this track: clips render at actual positions
      return null;
    }

    const draggedClipIds = dragState.draggedClipIds ?? (dragState.draggingClipId ? [dragState.draggingClipId] : []);

    return calculateDisplayPositions({
      trackClips: sortedTrackClips,
      draggedClipIds,
      draggedBlockDuration: dragState.gapDuration as number, // Type-safe: null check above
      insertionIndex: dragState.insertionIndex as number, // Type-safe: null check above
    });
  }, [dragState, track.id, sortedTrackClips]);

  return (
    <div
      ref={(node) => {
        drop(node);
      }}
      data-track-id={track.id}
      className={`relative transition-colors mb-1 bg-surface-raised/40 ${selectedTrackId === track.id ? "bg-timeline-track-active" : ""} ${isOver && canDrop ? "bg-accent/10" : ""} ${track.locked ? "bg-slate-900/45" : ""}`}
      style={{ height: `${track.height}px` }}
    >
      {/* Clips layer */}
      {track.visible &&
        trackClips.map((clip) => {
          const isDragging = dragState?.draggingClipId === clip.id;

          // Dragged clip uses original position + offsetX transform (NOT displayPositions map)
          // Other clips use displayPositions map (which handles gap opening/closing)
          let displayStartTime = clip.startTime;
          if (!isDragging && displayPositions) {
            displayStartTime = displayPositions.get(clip.id) ?? clip.startTime;
          }
          const isShifted = displayStartTime !== clip.startTime;

          // Override clip's startTime for display if shifted
          const displayClip = isShifted ? { ...clip, startTime: displayStartTime } : clip;

          return (
            <Clip
              key={clip.id}
              clip={displayClip}
              mediaAsset={getMediaAsset(clip.mediaId)}
              pixelsPerSecond={pixelsPerSecond}
              selected={selectedClipIds.includes(clip.id)}
              locked={track.locked}
              onDragStart={onClipDragStart}
              onDragMove={onClipDragMove}
              onDragEnd={onClipDragEnd}
              dragState={
                isDragging
                  ? {
                      isDragging: true,
                      offsetX: dragState?.offsetX || 0,
                      offsetY: dragState?.offsetY || 0,
                      isInvalidPosition: dragState?.isInvalidPosition,
                    }
                  : undefined
              }
            />
          );
        })}

      {/* Gap indicator (gray background) */}
      {dragState?.targetTrackId === track.id && dragState?.gapStartTime !== null && dragState?.gapDuration !== null && (
        <div
          className="absolute top-0 pointer-events-none z-5"
          style={{
            left: `${Math.round(dragState.gapStartTime! * pixelsPerSecond)}px`,
            width: `${Math.round(dragState.gapDuration! * pixelsPerSecond)}px`,
            height: "100%",
            background: "rgba(150, 150, 150, 0.3)",
            borderRadius: "4px",
            transition: "left 100ms ease-out, width 100ms ease-out",
          }}
        />
      )}

      {track.locked && (
        <div className="pointer-events-none absolute inset-0 z-40 bg-[repeating-linear-gradient(135deg,rgba(148,163,184,0.08)_0px,rgba(148,163,184,0.08)_8px,rgba(15,23,42,0.08)_8px,rgba(15,23,42,0.08)_16px)]">
          <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-slate-900/70 px-2 py-1 text-[10px] font-medium text-slate-200">
            <Lock className="h-3 w-3" />
            <span>Locked</span>
          </div>
        </div>
      )}
    </div>
  );
};

export const Track = React.memo(TrackInner);
