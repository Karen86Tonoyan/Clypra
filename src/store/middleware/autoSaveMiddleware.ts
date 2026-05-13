/**
 * Auto-Save Middleware
 *
 * OWNERSHIP: Store middleware (cross-cutting concern)
 * PERSISTENCE: Non-persistent (behavior only)
 *
 * Automatically triggers project auto-save when timeline or project state changes.
 * Eliminates 15+ manual scheduleAutoSave() calls throughout the codebase.
 *
 * Usage:
 * ```typescript
 * export const useTimelineStore = create(
 *   autoSaveMiddleware((set, get) => ({
 *     // ... store implementation
 *   }))
 * );
 * ```
 */

import type { StateCreator, StoreMutatorIdentifier } from "zustand";
import { useProjectStore } from "../projectStore";

type AutoSave = <T, Mps extends [StoreMutatorIdentifier, unknown][] = [], Mcs extends [StoreMutatorIdentifier, unknown][] = []>(f: StateCreator<T, Mps, Mcs>) => StateCreator<T, Mps, Mcs>;

type AutoSaveImpl = <T>(f: StateCreator<T, [], []>) => StateCreator<T, [], []>;

// Transaction support: suspend auto-save during drag operations
let _suspended = false;
let _pendingSave = false;

/** Suspend auto-save (e.g., during drag). Call resumeAutoSave() when done. */
export function suspendAutoSave(): void {
  _suspended = true;
  _pendingSave = false;
}

/** Resume auto-save. If any mutations occurred while suspended, triggers one save. */
export function resumeAutoSave(): void {
  _suspended = false;
  if (_pendingSave) {
    _pendingSave = false;
    useProjectStore.getState().scheduleAutoSave();
  }
}

const autoSaveImpl: AutoSaveImpl = (f) => (set, get, store) => {
  // Wrap the set function to trigger auto-save after state changes
  const wrappedSet: typeof set = (partial, replace) => {
    // Call the original set with proper arguments
    set(partial, replace as any);

    // If suspended (e.g., during drag), defer save until resume
    if (_suspended) {
      _pendingSave = true;
      return;
    }

    // Synchronous call — no async side effects in middleware
    useProjectStore.getState().scheduleAutoSave();
  };

  return f(wrappedSet, get, store);
};

export const autoSaveMiddleware = autoSaveImpl as AutoSave;
