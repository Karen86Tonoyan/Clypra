import React, { useEffect } from "react";
import { usePlaybackClock, usePlaybackControls } from "./usePlaybackClock";
import { useTimelineStore } from "../store/timelineStore";
import { useUIStore } from "../store/uiStore";
import { useProjectStore } from "../store/projectStore";
import { useHistoryStore } from "../store/historyStore";
import { EditingActions } from "../core/interactions";

export const useKeyboardShortcuts = () => {
  const clockState = usePlaybackClock();
  const { play, pause, seek } = usePlaybackControls();
  const { zoomLevel, setZoom, swapClips, rippleEditEnabled, toggleRippleEdit } = useTimelineStore();
  const { selectedClipIds, selectClip, selectTrack, previewMode, exitSourceMode, markSourceIn, markSourceOut } = useUIStore();
  const { undo, redo } = useHistoryStore();
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);

  const isPlaying = clockState.state === "playing";
  const currentTime = clockState.time;
  const frameRate = clockState.frameRate;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture shortcuts when typing in input fields
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (isTyping) return; // Let the user type normally

      const isMeta = e.ctrlKey || e.metaKey;

      // Source preview shortcuts
      if (previewMode === "source") {
        if (e.key === "i") {
          e.preventDefault();
          // Get current time from video element
          const video = document.querySelector("video") as HTMLVideoElement;
          if (video) markSourceIn(video.currentTime);
          return;
        } else if (e.key === "o") {
          e.preventDefault();
          const video = document.querySelector("video") as HTMLVideoElement;
          if (video) markSourceOut(video.currentTime);
          return;
        } else if (e.key === "Escape") {
          e.preventDefault();
          exitSourceMode();
          return;
        }
      }

      // Program mode shortcuts
      if (e.code === "Space") {
        e.preventDefault();
        isPlaying ? pause() : play();
      } else if (e.key === "k") {
        e.preventDefault();
        pause();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const frameTime = 1 / frameRate;
        seek(Math.max(0, currentTime - frameTime));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const frameTime = 1 / frameRate;
        seek(currentTime + frameTime);
      } else if (isMeta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((isMeta && e.shiftKey && e.key === "z") || (isMeta && e.key === "y")) {
        e.preventDefault();
        redo();
      } else if (isMeta && e.key === "s") {
        e.preventDefault();
        // Cmd+S: Auto-save handles saving automatically, no manual action needed
        // Just prevent browser's default save dialog
      } else if (isMeta && e.key === "i") {
        e.preventDefault();
      } else if (isMeta && e.shiftKey && e.key === "S") {
        // Ctrl+Shift+S — swap selected clips
        e.preventDefault();
        const result = swapClips();
        if (result.error) {
          setToastMessage(result.error);
          setTimeout(() => setToastMessage(null), 3000);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        selectClip(null);
        selectTrack(null);
      } else if (isMeta && e.key === "=") {
        e.preventDefault();
        setZoom(Math.min(5, zoomLevel + 0.1));
      } else if (isMeta && e.key === "-") {
        e.preventDefault();
        setZoom(Math.max(0.5, zoomLevel - 0.1));
      } else if (e.key === "r" && !isMeta) {
        // R key - toggle ripple edit mode
        e.preventDefault();
        toggleRippleEdit();
        setToastMessage(rippleEditEnabled ? "Ripple Edit: OFF" : "Ripple Edit: ON");
        setTimeout(() => setToastMessage(null), 2000);
      } else if (e.key === "s" && !isMeta) {
        // S key - split clip(s) at playhead
        e.preventDefault();
        const results = EditingActions.splitAtPlayhead();

        if (results.length === 0) {
          setToastMessage("No clips under playhead to split");
        } else {
          const successCount = results.filter((r) => r.success).length;
          const failCount = results.length - successCount;

          if (successCount > 0) {
            setToastMessage(`Split ${successCount} clip${successCount > 1 ? "s" : ""}`);
          } else if (failCount > 0) {
            setToastMessage(results[0].error || "Split failed");
          }
        }
        setTimeout(() => setToastMessage(null), 2000);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, currentTime, frameRate, zoomLevel, selectedClipIds, previewMode, rippleEditEnabled, play, pause, seek, setZoom, selectClip, selectTrack, exitSourceMode, markSourceIn, markSourceOut, swapClips, toggleRippleEdit, undo, redo]);

  return { toastMessage };
};
