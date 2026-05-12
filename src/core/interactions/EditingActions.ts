/**
 * Editing Actions - Interaction → Command Bridge Layer
 *
 * This is the unified interaction abstraction layer that bridges
 * user interactions (keyboard, mouse, playhead) to the command system.
 *
 * Architecture:
 *   User Interaction → Intent → Command → History → Store
 *
 * Key principles:
 * - All editing operations flow through commands (no direct store mutations)
 * - Interactions define intent, not implementation
 * - Commands are the single source of truth for mutations
 * - History system captures all edits automatically
 *
 * This prevents:
 * - Dual mutation paths (UI → store vs UI → command → store)
 * - Inconsistent undo/redo behavior
 * - Fragmented interaction models
 * - Replay/automation issues
 */

import { useHistoryStore } from "../../store/historyStore";
import { useTimelineStore } from "../../store/timelineStore";
import { getPlaybackClock } from "../../hooks/usePlaybackClock";
import { useUIStore } from "../../store/uiStore";
import { SplitClipCommand } from "../history/commands";
import type { Clip } from "../../types";

/**
 * Split interaction context.
 * Defines the intent to split, not the implementation.
 */
export interface SplitIntent {
  /** Clip to split */
  clipId: string;
  /** Time to split at (timeline time) */
  time: number;
  /** Source of the split action (for telemetry/debugging) */
  source: "keyboard" | "click" | "playhead" | "context-menu";
}

/**
 * Split interaction result.
 */
export interface SplitResult {
  success: boolean;
  error?: string;
  leftClipId?: string;
  rightClipId?: string;
}

/**
 * Editing Actions - Unified interaction layer.
 *
 * All editing operations should flow through this layer.
 * This ensures consistent command execution and history tracking.
 */
export class EditingActions {
  /**
   * Execute a split operation.
   *
   * This is the ONLY way split should be triggered from UI.
   * Direct calls to splitClipAtTime() are deprecated.
   *
   * @param intent - Split intent (what to split, where, why)
   * @returns Split result
   */
  static executeSplit(intent: SplitIntent): SplitResult {
    const { clipId, time, source } = intent;

    // Get current state
    const timelineState = useTimelineStore.getState();
    const clip = timelineState.clips.find((c) => c.id === clipId);

    // Validate clip exists
    if (!clip) {
      return {
        success: false,
        error: `Clip ${clipId} not found`,
      };
    }

    // Validate split time is within clip bounds
    const clipEndTime = clip.startTime + clip.duration;
    if (time <= clip.startTime || time >= clipEndTime) {
      return {
        success: false,
        error: `Split time ${time.toFixed(2)}s is outside clip bounds [${clip.startTime.toFixed(2)}s, ${clipEndTime.toFixed(2)}s]`,
      };
    }

    // Validate clip is not locked
    const track = timelineState.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) {
      return {
        success: false,
        error: "Cannot split clip on locked track",
      };
    }

    // Create and execute command
    const command = new SplitClipCommand(clipId, time, clip);

    try {
      useHistoryStore.getState().execute(command);

      // Find the new clip IDs (original clip + new clip)
      const newState = useTimelineStore.getState();
      const leftClip = newState.clips.find((c) => c.id === clipId);
      const rightClip = newState.clips.find((c) => c.trackId === clip.trackId && c.startTime === time && c.mediaId === clip.mediaId);

      return {
        success: true,
        leftClipId: leftClip?.id,
        rightClipId: rightClip?.id,
      };
    } catch (error) {
      console.error("[EditingActions] Split failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Split clip at playhead position.
   *
   * Splits the currently selected clip(s) at the playhead.
   * If no clips are selected, finds clips under the playhead.
   *
   * @returns Split results for all affected clips
   */
  static splitAtPlayhead(): SplitResult[] {
    const currentTime = getPlaybackClock().time;
    const selectedClipIds = useUIStore.getState().selectedClipIds;
    const clips = useTimelineStore.getState().clips;

    // If clips are selected, split those
    if (selectedClipIds.length > 0) {
      const results: SplitResult[] = [];

      for (const clipId of selectedClipIds) {
        const clip = clips.find((c) => c.id === clipId);
        if (!clip) continue;

        // Check if playhead is within clip bounds
        const clipEndTime = clip.startTime + clip.duration;
        if (currentTime > clip.startTime && currentTime < clipEndTime) {
          const result = this.executeSplit({
            clipId,
            time: currentTime,
            source: "playhead",
          });
          results.push(result);
        }
      }

      return results;
    }

    // No selection - find all clips under playhead
    const clipsUnderPlayhead = clips.filter((clip) => {
      const clipEndTime = clip.startTime + clip.duration;
      return currentTime > clip.startTime && currentTime < clipEndTime;
    });

    return clipsUnderPlayhead.map((clip) =>
      this.executeSplit({
        clipId: clip.id,
        time: currentTime,
        source: "playhead",
      }),
    );
  }

  /**
   * Split clip at specific position (click/cursor).
   *
   * @param clipId - Clip to split
   * @param time - Time to split at
   * @returns Split result
   */
  static splitAtPosition(clipId: string, time: number): SplitResult {
    return this.executeSplit({
      clipId,
      time,
      source: "click",
    });
  }

  /**
   * Get clips under playhead.
   *
   * Utility for finding clips that can be split at current playhead position.
   *
   * @returns Clips under playhead
   */
  static getClipsUnderPlayhead(): Clip[] {
    const currentTime = getPlaybackClock().time;
    const clips = useTimelineStore.getState().clips;

    return clips.filter((clip) => {
      const clipEndTime = clip.startTime + clip.duration;
      return currentTime > clip.startTime && currentTime < clipEndTime;
    });
  }

  /**
   * Check if split is possible at playhead.
   *
   * @returns True if at least one clip can be split at playhead
   */
  static canSplitAtPlayhead(): boolean {
    return this.getClipsUnderPlayhead().length > 0;
  }
}
