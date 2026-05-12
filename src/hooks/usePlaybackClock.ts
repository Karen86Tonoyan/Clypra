/**
 * Playback Clock Hook
 *
 * Provides UI snapshots of playback state (throttled to 10fps).
 * For render loops, read clock.time imperatively instead.
 *
 * Phase 2: Uses session-owned playback clock when available,
 * falls back to global singleton for backward compatibility.
 *
 * Usage:
 *   // For UI (timecode display, scrubber position)
 *   const { time, state } = usePlaybackClock();
 *
 *   // For render loops (canvas, etc.)
 *   const clock = getPlaybackClock();
 *   requestAnimationFrame(() => {
 *     const time = clock.time; // Imperative read
 *     render(time);
 *   });
 */

import { useEffect, useState, useMemo } from "react";
import { getPlaybackClock, type PlaybackClockState } from "../core/playback";
import { getActiveSessionOrNull } from "../core/runtime/ProjectSession";

/**
 * Get playback clock (session-aware).
 * Uses session-owned clock when available, falls back to global singleton.
 */
function getSessionAwarePlaybackClock() {
  const session = getActiveSessionOrNull();
  if (session && session.state === "active") {
    return session.playback;
  }
  // Fallback to global singleton for backward compatibility
  return getPlaybackClock();
}

/**
 * Hook for UI snapshots of playback state.
 * Updates are throttled to 10fps to avoid React render storms.
 *
 * For high-frequency reads (render loops), use getSessionAwarePlaybackClock() directly.
 */
export function usePlaybackClock(): PlaybackClockState {
  const clock = getSessionAwarePlaybackClock();
  const [state, setState] = useState<PlaybackClockState>(clock.getState());

  useEffect(() => {
    // Subscribe to throttled updates (10fps max)
    const unsubscribe = clock.subscribe((newState) => {
      setState(newState);
    });

    return unsubscribe;
  }, [clock]);

  return state;
}

/**
 * Hook for playback controls.
 * Returns imperative control functions (no state).
 * Functions are memoized to prevent unnecessary re-renders.
 */
export function usePlaybackControls() {
  const clock = getSessionAwarePlaybackClock();

  return useMemo(
    () => ({
      play: () => clock.play(),
      pause: () => clock.pause(),
      stop: () => clock.stop(),
      seek: (time: number) => clock.seek(time),
      setSpeed: (speed: number) => clock.setSpeed(speed),
      setDuration: (duration: number) => clock.setDuration(duration),
      setFrameRate: (fps: number) => clock.setFrameRate(fps),
    }),
    [clock],
  );
}

/**
 * Get playback clock for imperative reads (session-aware).
 * Exported for backward compatibility and render loops.
 */
export { getSessionAwarePlaybackClock as getPlaybackClock };

/**
 * Format time as timecode.
 */
export function formatTimecode(seconds: number, frameRate: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const frames = Math.floor((seconds % 1) * frameRate);

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}
