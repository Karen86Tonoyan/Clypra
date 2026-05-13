/**
 * History Store
 *
 * OWNERSHIP: Undo/redo command journal (persistent domain state)
 * PERSISTENCE: Should be persistent (future: save with project)
 * MUTABILITY: Append-only command log
 *
 * Responsibilities:
 * - Execute commands against timelineStore
 * - Maintain undo/redo stacks
 * - Provide undo/redo operations
 * - Track history state (canUndo, canRedo)
 *
 * Does NOT:
 * - Directly mutate timeline (commands do that)
 * - Own timeline state (timelineStore is source of truth)
 * - Manage runtime resources (ProjectSession handles that)
 *
 * Architecture principle:
 * Commands are the single mutation path for timeline state.
 * This enables:
 * - Deterministic undo/redo
 * - Command replay for testing
 * - Future: collaborative editing (commands as CRDT operations)
 * - Future: AI orchestration (commands as operation primitives)
 *
 * Bridges the command-based history system with Zustand state management.
 *
 * Architecture:
 *   UI Action → historyStore.execute() → HistoryManager → timelineStore
 */

import { create } from "zustand";
import { HistoryManager } from "@/core/history";
import type { Command, HistoryState } from "@/core/history";
import { useTimelineStore } from "./timelineStore";
import { useProjectStore } from "./projectStore";

interface HistoryStore {
  // History manager instance
  manager: HistoryManager;

  // Current history state
  state: HistoryState;

  // Execute a command
  execute: (command: Command) => void;

  // Undo last command
  undo: () => void;

  // Redo last undone command
  redo: () => void;

  // Begin transaction
  beginTransaction: (label: string) => void;

  // Commit transaction
  commitTransaction: () => void;

  // Rollback transaction
  rollbackTransaction: () => void;

  // Clear history
  clear: () => void;
}

// Create history manager instance
const historyManager = new HistoryManager({
  maxSize: 100,
  enableCoalescing: true,
  coalescingWindowMs: 500,
});

export const useHistoryStore = create<HistoryStore>((set, get) => {
  // Subscribe to history manager changes
  historyManager.subscribe((state) => {
    set({ state });
  });

  return {
    manager: historyManager,
    state: historyManager.getState(),

    execute: (command) => {
      const { manager } = get();

      // Get current timeline state
      const timelineStore = useTimelineStore.getState();

      // Execute command
      const newState = manager.execute(command, timelineStore);

      // Update timeline store
      useTimelineStore.setState(newState);

      // Increment epoch for cache invalidation
      useTimelineStore.getState().incrementEpoch();

      // Trigger auto-save
      useProjectStore.getState().scheduleAutoSave();
    },

    undo: () => {
      const { manager } = get();

      if (!manager.canUndo()) return;

      // Get current timeline state
      const timelineStore = useTimelineStore.getState();

      // Undo
      const newState = manager.undo(timelineStore);

      // Update timeline store
      useTimelineStore.setState(newState);

      // Increment epoch for cache invalidation
      useTimelineStore.getState().incrementEpoch();

      // Trigger auto-save
      useProjectStore.getState().scheduleAutoSave();
    },

    redo: () => {
      const { manager } = get();

      if (!manager.canRedo()) return;

      // Get current timeline state
      const timelineStore = useTimelineStore.getState();

      // Redo
      const newState = manager.redo(timelineStore);

      // Update timeline store
      useTimelineStore.setState(newState);

      // Increment epoch for cache invalidation
      useTimelineStore.getState().incrementEpoch();

      // Trigger auto-save
      useProjectStore.getState().scheduleAutoSave();
    },

    beginTransaction: (label) => {
      const { manager } = get();
      manager.beginTransaction(label);
    },

    commitTransaction: () => {
      const { manager } = get();
      const timelineStore = useTimelineStore.getState();
      manager.commitTransaction(timelineStore);
    },

    rollbackTransaction: () => {
      const { manager } = get();
      const timelineStore = useTimelineStore.getState();
      const newState = manager.rollbackTransaction(timelineStore);
      useTimelineStore.setState(newState);
    },

    clear: () => {
      const { manager } = get();
      manager.clear();
    },
  };
});
