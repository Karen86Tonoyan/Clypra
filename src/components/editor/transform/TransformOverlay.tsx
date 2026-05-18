/**
 * Transform Overlay
 *
 * Renders transform controls (border + handles) for selected clips in the preview.
 *
 * Coordinate System Contract:
 * - All mouse events arrive in screen space (clientX/clientY).
 * - We subtract the overlay's bounding rect to get overlay-local coordinates.
 * - Then convert to canvas space via screenToCanvas (which accounts for viewport zoom/pan).
 * - Transform calculations operate exclusively in canvas space.
 * - The overlay div already occupies displayWidth × displayHeight, so displayOffset
 *   relative to the overlay itself is (0, 0).
 */

import React, { useCallback, useRef, useState } from "react";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { TransformClipCommand } from "@/core/history/commands/TransformCommand";
import { calculateTransform, getDefaultConstraints } from "@/lib/transform/calculator";
import { screenToCanvas, canvasToScreen, hitTestClip, type ViewportTransform } from "@/lib/coordinateSystem";
import type { TransformHandle } from "@/types";

const SELECT_TRACE = import.meta.env.DEV;
const traceSelect = (...args: unknown[]) => {
  if (!SELECT_TRACE) return;
  console.log("[SelectTrace][TransformOverlay]", ...args);
};
const CENTER_GUIDE_SNAP_PX = 8;

interface TransformOverlayProps {
  /** Canvas dimensions for coordinate conversion */
  canvasWidth: number;
  canvasHeight: number;
  /** Scale factor for preview (1 = 100%) */
  scale: number;
  /** Viewport transform (editor zoom/pan) */
  viewport: ViewportTransform;
  /** Display offset for letterboxing */
  displayOffset: { x: number; y: number };
  /** Display dimensions (from calculateDisplayTransform) */
  displayWidth: number;
  displayHeight: number;
  /** Current playhead time in seconds (program context) */
  currentTime: number;
}

/**
 * Convert a mouse event to canvas coordinates, properly accounting for
 * the overlay's position on screen. The overlay is already positioned
 * inside the display viewport div, so the letterbox offset relative to
 * the overlay is always (0, 0).
 */
function mouseToCanvas(
  clientX: number,
  clientY: number,
  overlayRect: DOMRect,
  viewport: ViewportTransform,
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
): { x: number; y: number } {
  // Step 1: Screen → overlay-local (subtract overlay's screen position)
  const localX = clientX - overlayRect.left;
  const localY = clientY - overlayRect.top;

  // Step 2: Overlay-local → canvas (the overlay sits at displayOffset=(0,0)
  // relative to itself, so pass zero offset)
  return screenToCanvas(localX, localY, viewport, { width: canvasWidth, height: canvasHeight }, scale, { x: 0, y: 0 });
}

export const TransformOverlay: React.FC<TransformOverlayProps> = ({ canvasWidth, canvasHeight, scale, viewport, displayOffset, displayWidth, displayHeight, currentTime }) => {
  const { selectedClipIds, activeTransform, startTransform, endTransform, selectClip, toggleClipSelection } = useUIStore();
  const { clips, tracks, updateClip } = useTimelineStore();
  const { execute } = useHistoryStore();

  const [isDragging, setIsDragging] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const clickCycleRef = useRef<{ signature: string; index: number }>({ signature: "", index: -1 });
  const dragCursorRef = useRef<string | null>(null);
  /** Start angle (radians) for rotation drag — prevents initial snap */
  const startAngleRef = useRef<number | undefined>(undefined);

  // Get the first selected clip (multi-select transform comes later)
  const selectedClip = clips.find((c) => c.id === selectedClipIds[0]);

  // Handle canvas mousedown to select/deselect clips.
  // Using mousedown (instead of click) avoids click-tail races after drag.
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      traceSelect("canvas mousedown", {
        target: (e.target as HTMLElement)?.tagName,
        selectedClipIds,
        isDragging,
        currentTime,
      });
      // Don't handle if clicking on a handle or during drag
      if (isDragging || (e.target as HTMLElement).closest("[data-transform-handle]")) {
        traceSelect("canvas mousedown ignored", { reason: "dragging-or-handle" });
        return;
      }

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Convert screen coordinates to canvas coordinates using overlay-local mapping
      const canvasCoords = mouseToCanvas(e.clientX, e.clientY, rect, viewport, canvasWidth, canvasHeight, scale);

      // If user mousedown is inside the currently selected clip, keep selection stable.
      // This avoids deselect-on-second-mousedown when playhead/time filtering excludes
      // the clip from the generic hit-candidate list.
      if (selectedClip && hitTestClip(canvasCoords.x, canvasCoords.y, selectedClip)) {
        traceSelect("mousedown inside selected clip", { clipId: selectedClip.id, modifiers: { shift: e.shiftKey, meta: e.metaKey, ctrl: e.ctrlKey } });
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          toggleClipSelection(selectedClip.id);
        } else {
          selectClip(selectedClip.id);
        }
        return;
      }

      const trackIndexMap = new Map(tracks.map((t, idx) => [t.id, idx]));
      const visibleTrackIds = new Set(tracks.filter((t) => t.visible !== false).map((t) => t.id));

      // Selectable clips in program preview:
      // - visible track
      // - active at playhead
      // - non-degenerate bounds
      const selectable = clips
        .map((clip, idx) => ({ clip, idx }))
        .filter(({ clip }) => {
          if (!visibleTrackIds.has(clip.trackId)) return false;
          if (!(clip.width > 0 && clip.height > 0)) return false;
          const end = clip.startTime + clip.duration;
          return clip.startTime <= currentTime && currentTime < end;
        });

      // Topmost-first ordering for hit-selection.
      // Lower track index is visually higher in current compositor ordering.
      const hitCandidates = selectable
        .filter(({ clip }) => hitTestClip(canvasCoords.x, canvasCoords.y, clip))
        .sort((a, b) => {
          const ta = trackIndexMap.get(a.clip.trackId) ?? Number.MAX_SAFE_INTEGER;
          const tb = trackIndexMap.get(b.clip.trackId) ?? Number.MAX_SAFE_INTEGER;
          if (ta !== tb) return ta - tb;
          // Same track: later clip in state wins by default
          return b.idx - a.idx;
        })
        .map(({ clip }) => clip);

      if (hitCandidates.length > 0) {
        traceSelect("hitCandidates", { ids: hitCandidates.map((c) => c.id) });
        // Multi-select modifier: toggle topmost hit only.
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          toggleClipSelection(hitCandidates[0].id);
          return;
        }

        // Single-click cycling through overlapping clips:
        // repeated clicks at same overlap set iterate through stack.
        const signature = hitCandidates.map((c) => c.id).join("|");
        let nextIndex = 0;
        if (clickCycleRef.current.signature === signature) {
          nextIndex = (clickCycleRef.current.index + 1) % hitCandidates.length;
        }
        clickCycleRef.current = { signature, index: nextIndex };
        selectClip(hitCandidates[nextIndex].id);
      } else {
        // Clicked on empty area - deselect
        traceSelect("empty area deselect");
        clickCycleRef.current = { signature: "", index: -1 };
        selectClip(null);
      }
    },
    [clips, tracks, currentTime, scale, viewport, canvasWidth, canvasHeight, isDragging, selectClip, toggleClipSelection, selectedClip, selectedClipIds],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handle: TransformHandle) => {
      if (!selectedClip) return;

      e.preventDefault();
      e.stopPropagation();
      traceSelect("transform handle mousedown", { handle, clipId: selectedClip.id, selectedClipIds });
      setIsDragging(true);

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Convert screen coordinates to canvas coordinates using overlay-local mapping
      const canvasCoords = mouseToCanvas(e.clientX, e.clientY, rect, viewport, canvasWidth, canvasHeight, scale);

      // Capture start angle for rotation handle
      if (handle === "rotate") {
        const centerX = selectedClip.x + selectedClip.width / 2;
        const centerY = selectedClip.y + selectedClip.height / 2;
        startAngleRef.current = Math.atan2(canvasCoords.y - centerY, canvasCoords.x - centerX);
      } else {
        startAngleRef.current = undefined;
      }

      const dragCursor: Record<TransformHandle, string> = {
        move: "move",
        nw: "nw-resize",
        ne: "ne-resize",
        sw: "sw-resize",
        se: "se-resize",
        n: "n-resize",
        s: "s-resize",
        e: "e-resize",
        w: "w-resize",
        rotate: "grabbing",
      };
      dragCursorRef.current = dragCursor[handle] ?? null;
      if (dragCursorRef.current) {
        document.body.style.cursor = dragCursorRef.current;
      }

      startTransform({
        clipId: selectedClip.id,
        handle,
        startTransform: {
          x: selectedClip.x,
          y: selectedClip.y,
          width: selectedClip.width,
          height: selectedClip.height,
          rotation: selectedClip.rotation,
        },
        startMousePos: canvasCoords,
        aspectRatioLocked: selectedClip.aspectRatioLocked ?? true,
        sourceAspectRatio: selectedClip.sourceAspectRatio ?? selectedClip.width / selectedClip.height,
      });
    },
    [selectedClip, scale, viewport, canvasWidth, canvasHeight, startTransform],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !activeTransform) return;

      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Convert screen coordinates to canvas coordinates using overlay-local mapping
      const canvasCoords = mouseToCanvas(e.clientX, e.clientY, rect, viewport, canvasWidth, canvasHeight, scale);

      // Calculate new transform from the ORIGINAL start state (not current clip state)
      // This prevents transform drift / acceleration during drag.
      const constraints = getDefaultConstraints(canvasWidth, canvasHeight, activeTransform.aspectRatioLocked);

      // Build a synthetic "clip" from the start transform to apply delta against.
      // This ensures delta is always relative to the original position.
      const startClip = {
        ...activeTransform.startTransform,
        opacity: 1,
        id: activeTransform.clipId,
        trackId: "",
        mediaId: "",
        startTime: 0,
        duration: 0,
        trimIn: 0,
        trimOut: 0,
        aspectRatioLocked: activeTransform.aspectRatioLocked,
        sourceAspectRatio: activeTransform.sourceAspectRatio,
      };

      const newTransform = calculateTransform(startClip, activeTransform.handle, activeTransform.startMousePos, canvasCoords, constraints, startAngleRef.current);
      traceSelect("transform mousemove", { clipId: activeTransform.clipId, handle: activeTransform.handle, x: newTransform.x, y: newTransform.y, width: newTransform.width, height: newTransform.height });

      // Optimistic update (no history yet)
      updateClip(activeTransform.clipId, newTransform);
    },
    [isDragging, activeTransform, scale, viewport, canvasWidth, canvasHeight, updateClip],
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging || !activeTransform) return;
    traceSelect("transform mouseup", { clipId: activeTransform.clipId, selectedClipIds });

    setIsDragging(false);
    if (dragCursorRef.current) {
      document.body.style.cursor = "";
      dragCursorRef.current = null;
    }

    // Read final clip state from store for history
    const finalClip = useTimelineStore.getState().clips.find((c) => c.id === activeTransform.clipId);
    if (!finalClip) {
      endTransform();
      return;
    }

    // Commit to history
    const oldTransform = activeTransform.startTransform;
    const newTransform = {
      x: finalClip.x,
      y: finalClip.y,
      width: finalClip.width,
      height: finalClip.height,
      rotation: finalClip.rotation,
    };


    // Only create command if something actually changed
    const hasChanged = oldTransform.x !== newTransform.x || oldTransform.y !== newTransform.y || oldTransform.width !== newTransform.width || oldTransform.height !== newTransform.height || oldTransform.rotation !== newTransform.rotation;

    if (hasChanged) {
      execute(new TransformClipCommand(activeTransform.clipId, oldTransform, newTransform));
    }

    endTransform();
  }, [isDragging, activeTransform, execute, endTransform, selectedClipIds]);

  // Attach global mouse listeners during drag
  React.useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Convert clip bounds to screen coordinates for handle rendering
  if (!selectedClip) {
    return (
      <div
        ref={overlayRef}
        className="absolute inset-0 pointer-events-auto z-50"
        style={{
          width: displayWidth,
          height: displayHeight,
        }}
      >
        {/* Click capture layer - always active for selection/deselection */}
        <div
          className="absolute inset-0"
          onMouseDown={handleCanvasMouseDown}
          style={{
            background: "transparent",
            pointerEvents: "auto",
            zIndex: 1,
          }}
        />
      </div>
    );
  }

  // Use canvasToScreen for proper coordinate conversion.
  // Pass zero offset because we're positioning within the overlay div itself
  // (which is already placed at displayOffset by the parent layout).
  const zeroOffset = { x: 0, y: 0 };
  const topLeft = canvasToScreen(selectedClip.x, selectedClip.y, viewport, { width: canvasWidth, height: canvasHeight }, scale, zeroOffset);

  const bottomRight = canvasToScreen(selectedClip.x + selectedClip.width, selectedClip.y + selectedClip.height, viewport, { width: canvasWidth, height: canvasHeight }, scale, zeroOffset);

  const handleDisplayX = topLeft.x;
  const handleDisplayY = topLeft.y;
  const handleDisplayWidth = bottomRight.x - topLeft.x;
  const handleDisplayHeight = bottomRight.y - topLeft.y;
  const rotation = selectedClip.rotation ?? 0;
  const clipCenterX = selectedClip.x + selectedClip.width / 2;
  const clipCenterY = selectedClip.y + selectedClip.height / 2;
  const canvasCenterX = canvasWidth / 2;
  const canvasCenterY = canvasHeight / 2;
  const showVerticalCenterGuide = isDragging && Math.abs(clipCenterX - canvasCenterX) <= CENTER_GUIDE_SNAP_PX;
  const showHorizontalCenterGuide = isDragging && Math.abs(clipCenterY - canvasCenterY) <= CENTER_GUIDE_SNAP_PX;
  const centerScreen = canvasToScreen(canvasCenterX, canvasCenterY, viewport, { width: canvasWidth, height: canvasHeight }, scale, zeroOffset);

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-auto z-50"
      style={{
        width: displayWidth,
        height: displayHeight,
      }}
    >
      {/* Click capture layer - always active for selection/deselection.
          Sits behind the transform border (lower z-index) so handle clicks
          pass through, but covers the entire overlay so empty-area clicks
          trigger deselection even when a clip is selected. */}
      <div
        className="absolute inset-0"
        onMouseDown={handleCanvasMouseDown}
        style={{
          background: "transparent",
          pointerEvents: "auto",
          zIndex: 1,
        }}
      />

      {/* Transform border - visual only */}
      <div
        className="absolute border-2 border-white pointer-events-none shadow-lg"
        style={{
          left: handleDisplayX,
          top: handleDisplayY,
          width: handleDisplayWidth,
          height: handleDisplayHeight,
          transform: `rotate(${rotation}deg)`,
          transformOrigin: "center",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
          zIndex: 10,
        }}
      />

      {/* Center alignment guides (visible during move/resize near center) */}
      {showVerticalCenterGuide && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: centerScreen.x,
            top: 0,
            width: 1,
            height: displayHeight,
            background: "rgba(59,130,246,0.95)",
            boxShadow: "0 0 0 1px rgba(59,130,246,0.3)",
            zIndex: 14,
          }}
        />
      )}
      {showHorizontalCenterGuide && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: 0,
            top: centerScreen.y,
            width: displayWidth,
            height: 1,
            background: "rgba(59,130,246,0.95)",
            boxShadow: "0 0 0 1px rgba(59,130,246,0.3)",
            zIndex: 14,
          }}
        />
      )}

      {/* Move surface - explicit drag target across full selected bounds */}
      <div
        className="absolute cursor-move"
        data-transform-handle="move"
        style={{
          left: handleDisplayX,
          top: handleDisplayY,
          width: handleDisplayWidth,
          height: handleDisplayHeight,
          transform: `rotate(${rotation}deg)`,
          transformOrigin: "center",
          background: "transparent",
          pointerEvents: "auto",
          zIndex: 15,
        }}
        onMouseDown={(e) => handleMouseDown(e, "move")}
      />

      {/* Corner handles */}
      <Handle position="nw" onMouseDown={(e) => handleMouseDown(e, "nw")} left={handleDisplayX} top={handleDisplayY} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />
      <Handle position="ne" onMouseDown={(e) => handleMouseDown(e, "ne")} left={handleDisplayX} top={handleDisplayY} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />
      <Handle position="sw" onMouseDown={(e) => handleMouseDown(e, "sw")} left={handleDisplayX} top={handleDisplayY} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />
      <Handle position="se" onMouseDown={(e) => handleMouseDown(e, "se")} left={handleDisplayX} top={handleDisplayY} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />

      {/* Rotation handle */}
      <Handle position="rotate" onMouseDown={(e) => handleMouseDown(e, "rotate")} scale={scale} left={handleDisplayX} top={handleDisplayY} width={handleDisplayWidth} height={handleDisplayHeight} rotation={rotation} />
    </div>
  );
};

interface HandleProps {
  position: TransformHandle;
  onMouseDown: (e: React.MouseEvent) => void;
  /** Current display scale — used to keep rotation handle at a constant visual distance */
  scale?: number;
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
}

const Handle: React.FC<HandleProps> = ({ position, onMouseDown, scale = 1, left, top, width, height, rotation }) => {
  const getHandleStyle = (): React.CSSProperties => {
    const handleSize = 14;
    const handleRadius = handleSize / 2;
    const baseStyle: React.CSSProperties = {
      position: "absolute",
      width: `${handleSize}px`,
      height: `${handleSize}px`,
      backgroundColor: "white",
      border: "2px solid #3b82f6",
      borderRadius: "50%",
      cursor: "default",
      transform: "translate(-50%, -50%)",
      boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
      zIndex: 20,
      pointerEvents: "auto",
    };

    switch (position) {
      case "nw":
        return { ...baseStyle, left: left + handleRadius, top: top + handleRadius, cursor: "nw-resize" };
      case "ne":
        return { ...baseStyle, left: left + width - handleRadius, top: top + handleRadius, cursor: "ne-resize" };
      case "sw":
        return { ...baseStyle, left: left + handleRadius, top: top + height - handleRadius, cursor: "sw-resize" };
      case "se":
        return { ...baseStyle, left: left + width - handleRadius, top: top + height - handleRadius, cursor: "se-resize" };
      case "rotate": {
        // Scale-compensated offset so the rotation handle stays at a constant
        // visual distance (~30px) regardless of viewport zoom.
        const offset = Math.max(20, Math.min(60, 30 / Math.max(0.1, scale)));
        return {
          ...baseStyle,
          left: left + width / 2,
          top: top - offset,
          backgroundColor: "#3b82f6",
          cursor: "grab",
          width: "16px",
          height: "16px",
        };
      }
      default:
        return baseStyle;
    }
  };

  return (
    <div
      style={{
        ...getHandleStyle(),
        transform: `${getHandleStyle().transform ?? "translate(-50%, -50%)"} rotate(${rotation}deg)`,
        transformOrigin: "center",
      }}
      onMouseDown={onMouseDown}
      data-transform-handle={position}
    />
  );
};

// Memoize to prevent unnecessary re-renders
export const TransformOverlayMemoized = React.memo(TransformOverlay);
