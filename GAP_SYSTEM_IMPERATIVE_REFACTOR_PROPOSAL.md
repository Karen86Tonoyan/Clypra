# Gap System Imperative Architecture Refactor Proposal

**Status:** PROPOSED  
**Priority:** HIGH (Critical for undo/redo support)  
**Estimated Effort:** 2-3 days

---

## Current Issues with Gap System

### 1. ❌ No Undo/Redo Support

**Problem:** Gap operations bypass the history system  
**Location:** `Timeline.tsx`, `GapIndicator.tsx`  
**Impact:** Users cannot undo gap insertions/removals

```typescript
// Current (WRONG):
store.insertGap(trackId, 5, 2);
store.removeGap(gapId);
store.toggleGapProtection(gapId);

// These bypass the command system!
```

### 2. ❌ Inconsistent Architecture

**Problem:** Clips use imperative commands, gaps use direct store mutations  
**Example:**

- ✅ Clips: `execute(new DeleteClipCommand(clipId))`
- ❌ Gaps: `store.removeGap(gapId)`

### 3. ❌ Mixed Concerns

**Problem:** Business logic scattered across store, engine, and UI  
**Issues:**

- Gap validation in `gapEngine.ts`
- Gap state in `timelineStore.ts`
- Gap operations triggered from `Timeline.tsx`
- No central controller/manager

### 4. ❌ Poor Testability

**Problem:** Difficult to test gap operations in isolation  
**Issues:**

- Store mutations not observable
- No way to mock gap operations
- Command tests exist but commands are unused

---

## Proposed Imperative Architecture

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   UI Components                          │
│  (Timeline.tsx, GapIndicator.tsx, TrackList.tsx)       │
└──────────────────────┬──────────────────────────────────┘
                       │ calls
                       ↓
┌─────────────────────────────────────────────────────────┐
│              GapManager (Singleton)                      │
│  • insertGap(trackId, startTime, duration)              │
│  • removeGap(gapId)                                      │
│  • resizeGap(gapId, newDuration)                        │
│  • toggleProtection(gapId)                               │
│  • packTrack(trackId)                                    │
│  • detectAndSync(trackId?)                               │
└──────────────────────┬──────────────────────────────────┘
                       │ executes
                       ↓
┌─────────────────────────────────────────────────────────┐
│           History System (Command Pattern)               │
│  • InsertGapCommand                                      │
│  • RemoveGapCommand                                      │
│  • ResizeGapCommand                                      │
│  • ToggleGapProtectionCommand                            │
│  • PackTrackCommand (new)                                │
└──────────────────────┬──────────────────────────────────┘
                       │ mutates
                       ↓
┌─────────────────────────────────────────────────────────┐
│               TimelineStore (State)                      │
│  • gaps: Gap[]                                           │
│  • clips: Clip[]                                         │
│  • tracks: Track[]                                       │
└──────────────────────┬──────────────────────────────────┘
                       │ uses
                       ↓
┌─────────────────────────────────────────────────────────┐
│          GapEngine (Pure Functions)                      │
│  • detectGaps()                                          │
│  • validateGap()                                         │
│  • insertGapWithRipple()                                 │
│  • removeGapWithRipple()                                 │
│  • mergeAdjacentGaps()                                   │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Create GapManager (Similar to CacheManager)

**File:** `src/lib/gapManager.ts`

```typescript
/**
 * GapManager - Central controller for all gap operations
 *
 * Follows imperative architecture pattern used by:
 * - CacheManager
 * - AudioCacheManager
 * - PreviewQualityManager
 * - GlobalGPUCacheManager
 */

import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { InsertGapCommand, RemoveGapCommand, ResizeGapCommand, ToggleGapProtectionCommand } from "@/core/history/commands/GapCommands";
import type { Gap } from "@/types/gap";

class GapManagerImpl {
  private static instance: GapManagerImpl;

  private constructor() {}

  static getInstance(): GapManagerImpl {
    if (!GapManagerImpl.instance) {
      GapManagerImpl.instance = new GapManagerImpl();
    }
    return GapManagerImpl.instance;
  }

  /**
   * Insert a gap at specified position (with undo support)
   */
  insertGap(trackId: string, startTime: number, duration: number): Gap | null {
    const { execute } = useHistoryStore.getState();
    const command = new InsertGapCommand(trackId, startTime, duration);

    execute(command);

    return command.insertedGap ?? null;
  }

  /**
   * Remove a gap (with undo support)
   */
  removeGap(gapId: string): void {
    const { execute } = useHistoryStore.getState();
    execute(new RemoveGapCommand(gapId));
  }

  /**
   * Resize a gap (with undo support)
   */
  resizeGap(gapId: string, newDuration: number): void {
    const { execute } = useHistoryStore.getState();
    execute(new ResizeGapCommand(gapId, newDuration));
  }

  /**
   * Toggle gap protection (with undo support)
   */
  toggleProtection(gapId: string): void {
    const { execute } = useHistoryStore.getState();
    execute(new ToggleGapProtectionCommand(gapId));
  }

  /**
   * Pack track - remove all unprotected gaps
   *
   * Note: Implemented as batch transaction of RemoveGapCommands
   * to support undo (single "Pack Track" undo restores all gaps)
   */
  packTrack(trackId: string): void {
    const { gaps } = useTimelineStore.getState();
    const { beginTransaction, commitTransaction, execute } = useHistoryStore.getState();

    // Find all unprotected gaps on this track
    const trackGaps = gaps.filter((g) => g.trackId === trackId && !g.protected);

    if (trackGaps.length === 0) return;

    // Execute as single undoable transaction
    beginTransaction(`Pack Track (${trackGaps.length} gaps)`);

    try {
      for (const gap of trackGaps) {
        execute(new RemoveGapCommand(gap.id));
      }
      commitTransaction();
    } catch (error) {
      console.error("[GapManager] Pack track failed:", error);
      // Transaction will auto-rollback on error
    }
  }

  /**
   * Detect and sync gaps for a track or all tracks
   * (Does NOT use commands - this is a sync operation, not user action)
   */
  detectAndSync(trackId?: string): void {
    const store = useTimelineStore.getState();
    store.detectAndSyncGaps(trackId);
  }

  /**
   * Get gap at specific time position on track
   */
  getGapAtPosition(trackId: string, time: number): Gap | null {
    const { gaps } = useTimelineStore.getState();

    return (
      gaps.find((g) => {
        if (g.trackId !== trackId) return false;
        const gapEnd = g.startTime + g.duration;
        return time >= g.startTime && time < gapEnd;
      }) ?? null
    );
  }

  /**
   * Get all gaps for a specific track
   */
  getTrackGaps(trackId: string): Gap[] {
    const { gaps } = useTimelineStore.getState();
    return gaps.filter((g) => g.trackId === trackId);
  }

  /**
   * Check if track has any gaps
   */
  hasGaps(trackId: string): boolean {
    return this.getTrackGaps(trackId).length > 0;
  }

  /**
   * Validate if gap can be inserted at position
   */
  canInsertGap(
    trackId: string,
    startTime: number,
    duration: number,
  ): {
    valid: boolean;
    reason?: string;
  } {
    const { tracks, clips } = useTimelineStore.getState();

    const track = tracks.find((t) => t.id === trackId);
    if (!track) {
      return { valid: false, reason: "Track not found" };
    }

    if (track.locked) {
      return { valid: false, reason: "Track is locked" };
    }

    if (duration <= 0) {
      return { valid: false, reason: "Duration must be positive" };
    }

    if (startTime < 0) {
      return { valid: false, reason: "Start time cannot be negative" };
    }

    // Check for clip overlaps (gaps shouldn't overlap clips)
    const trackClips = clips.filter((c) => c.trackId === trackId);
    const gapEnd = startTime + duration;

    for (const clip of trackClips) {
      const clipEnd = clip.startTime + clip.duration;
      if (startTime < clipEnd && gapEnd > clip.startTime) {
        return { valid: false, reason: "Gap would overlap with clip" };
      }
    }

    return { valid: true };
  }
}

/**
 * Global singleton instance
 * Usage: import { GapManager } from '@/lib/gapManager';
 */
export const GapManager = GapManagerImpl.getInstance();
```

---

### Phase 2: Update UI Components to Use GapManager

#### Timeline.tsx Updates

```typescript
// BEFORE (direct store access):
import { useTimelineStore } from "@/store/timelineStore";

const store = useTimelineStore.getState();
store.insertGap(trackId, currentTime, 2);
store.removeGap(selectedGapId);

// AFTER (via GapManager):
import { GapManager } from "@/lib/gapManager";

GapManager.insertGap(trackId, currentTime, 2);
GapManager.removeGap(selectedGapId);
```

#### GapIndicator.tsx Updates

```typescript
// BEFORE:
const { removeGap, toggleGapProtection } = useTimelineStore();

const handleRemove = () => {
  removeGap(gap.id);
};

const handleToggleProtection = () => {
  toggleGapProtection(gap.id);
};

// AFTER:
import { GapManager } from "@/lib/gapManager";

const handleRemove = () => {
  GapManager.removeGap(gap.id);
};

const handleToggleProtection = () => {
  GapManager.toggleProtection(gap.id);
};
```

#### TrackList.tsx Updates

```typescript
// BEFORE:
const handlePackTrack = () => {
  store.packTrackGaps(track.id);
};

// AFTER:
import { GapManager } from "@/lib/gapManager";

const handlePackTrack = () => {
  GapManager.packTrack(track.id);
};
```

---

### Phase 3: Add PackTrackCommand

**File:** `src/core/history/commands/GapCommands.ts`

```typescript
/**
 * Pack Track Command - Remove all unprotected gaps
 *
 * Note: This is a composite command that internally uses
 * RemoveGapCommand for each gap, wrapped in a transaction.
 */
export class PackTrackCommand implements Command {
  readonly id: string;
  readonly label: string;

  private trackId: string;
  private removeCommands: RemoveGapCommand[] = [];

  constructor(trackId: string) {
    this.id = generateId("command");
    this.label = "Pack Track";
    this.trackId = trackId;
  }

  execute(): void {
    const { gaps } = useTimelineStore.getState();
    const trackGaps = gaps.filter((g) => g.trackId === this.trackId && !g.protected);

    // Execute each removal and store commands for undo
    for (const gap of trackGaps) {
      const cmd = new RemoveGapCommand(gap.id);
      cmd.execute();
      this.removeCommands.push(cmd);
    }
  }

  undo(): void {
    // Undo in reverse order to restore original state
    for (let i = this.removeCommands.length - 1; i >= 0; i--) {
      this.removeCommands[i].undo();
    }
  }

  invert(): Command {
    // Invert not needed - undo() handles restoration
    throw new Error("PackTrackCommand cannot be inverted (use undo)");
  }

  toJSON(): Record<string, any> {
    return {
      type: "PackTrackCommand",
      id: this.id,
      trackId: this.trackId,
      removeCommands: this.removeCommands.map((cmd) => cmd.toJSON()),
    };
  }

  static fromJSON(data: Record<string, any>): PackTrackCommand {
    const cmd = new PackTrackCommand(data.trackId);
    cmd.removeCommands = data.removeCommands.map((d: any) => RemoveGapCommand.fromJSON(d));
    return cmd;
  }
}
```

---

### Phase 4: Remove Direct Store Methods (Breaking Change)

**Option A: Deprecate then Remove (Safer)**

```typescript
// timelineStore.ts
insertGap: (trackId, startTime, duration) => {
  console.warn("[DEPRECATED] Use GapManager.insertGap() instead");
  // ... existing implementation
};
```

**Option B: Remove Immediately (Cleaner)**

```typescript
// timelineStore.ts - Remove these methods:
// - insertGap
// - removeGap
// - resizeGapDuration
// - toggleGapProtection
// - packTrackGaps

// Keep only:
// - detectAndSyncGaps (called by GapManager)
// - gaps array (state storage)
```

---

## Benefits of Imperative Approach

### 1. ✅ Undo/Redo Support

```typescript
GapManager.insertGap(trackId, 5, 2);
// User can press Ctrl+Z to undo
```

### 2. ✅ Consistent Architecture

```typescript
// Clips and Gaps now use same pattern:
ClipManager.deleteClip(clipId); // (if we create ClipManager)
GapManager.removeGap(gapId);
```

### 3. ✅ Better Testability

```typescript
// Mock GapManager in tests:
jest.mock("@/lib/gapManager");
GapManager.insertGap = jest.fn();
```

### 4. ✅ Centralized Business Logic

```typescript
// All gap validation in one place:
const result = GapManager.canInsertGap(trackId, 5, 2);
if (!result.valid) {
  showError(result.reason);
}
```

### 5. ✅ Transaction Support

```typescript
// Pack track as single undoable operation:
GapManager.packTrack(trackId);
// Undo once to restore ALL gaps
```

### 6. ✅ Better Error Handling

```typescript
try {
  GapManager.insertGap(trackId, 5, 2);
} catch (error) {
  handleGapError(error);
}
```

### 7. ✅ Easier to Extend

```typescript
// Adding new operations is simple:
class GapManagerImpl {
  // ... existing methods ...

  duplicateGap(gapId: string): Gap | null {
    const gap = this.getGap(gapId);
    if (!gap) return null;

    return this.insertGap(gap.trackId, gap.startTime + gap.duration, gap.duration);
  }

  mergeGaps(gapId1: string, gapId2: string): Gap | null {
    // Implementation...
  }
}
```

---

## Migration Strategy

### Step 1: Create GapManager (Non-Breaking)

- Add `src/lib/gapManager.ts`
- Keep existing store methods intact
- Add deprecation warnings

### Step 2: Update UI Components (Non-Breaking)

- Update all UI to use GapManager
- Test thoroughly
- Verify undo/redo works

### Step 3: Update Tests

- Update gap tests to use GapManager
- Verify all 116 tests still pass

### Step 4: Remove Store Methods (Breaking)

- Remove deprecated store methods
- Update any remaining references
- Final testing pass

---

## Comparison with Other Systems

### Similar Patterns in Codebase

#### CacheManager (src/lib/cacheManager.ts)

```typescript
class CacheManagerImpl {
  private static instance: CacheManagerImpl;

  static getInstance(): CacheManagerImpl {
    if (!CacheManagerImpl.instance) {
      CacheManagerImpl.instance = new CacheManagerImpl();
    }
    return CacheManagerImpl.instance;
  }

  invalidateClip(clipId: string): void {
    /* ... */
  }
  invalidateAll(): void {
    /* ... */
  }
}

export const CacheManager = CacheManagerImpl.getInstance();
```

#### AudioCacheManager (src/lib/audioCache.ts)

```typescript
class AudioCacheManagerImpl {
  private static instance: AudioCacheManagerImpl | null = null;

  static getInstance(): AudioCacheManagerImpl {
    if (!AudioCacheManagerImpl.instance) {
      AudioCacheManagerImpl.instance = new AudioCacheManagerImpl();
    }
    return AudioCacheManagerImpl.instance;
  }

  getAudioBuffer(mediaId: string): Promise<AudioBuffer> {
    /* ... */
  }
  clearCache(): void {
    /* ... */
  }
}

export const AudioCacheManager = AudioCacheManagerImpl.getInstance();
```

### GapManager Fits This Pattern Perfectly!

---

## Estimated Effort

### Time Breakdown

- **Phase 1: Create GapManager** - 4 hours
  - Core implementation: 2 hours
  - Validation logic: 1 hour
  - Documentation: 1 hour

- **Phase 2: Update UI Components** - 4 hours
  - Timeline.tsx: 1.5 hours
  - GapIndicator.tsx: 1 hour
  - TrackList.tsx: 0.5 hour
  - Testing: 1 hour

- **Phase 3: Add PackTrackCommand** - 2 hours
  - Implementation: 1 hour
  - Tests: 1 hour

- **Phase 4: Cleanup** - 2 hours
  - Remove store methods: 0.5 hour
  - Update tests: 1 hour
  - Final verification: 0.5 hour

**Total: 12 hours (1.5 days)**

---

## Risks & Mitigation

### Risk 1: Breaking Existing Code

**Mitigation:** Deprecation warnings first, then gradual migration

### Risk 2: Test Failures

**Mitigation:** Update tests incrementally, verify at each step

### Risk 3: Performance Regression

**Mitigation:** Benchmark before/after, GapManager is thin wrapper

### Risk 4: Undo/Redo Complexity

**Mitigation:** Commands already exist and tested, just need to be used

---

## Recommendation

**STRONGLY RECOMMEND** implementing this refactor because:

1. ✅ **Fixes Critical Bug** - Undo/redo support is essential UX
2. ✅ **Follows Existing Patterns** - Matches CacheManager architecture
3. ✅ **Low Risk** - Commands already tested, just need wiring
4. ✅ **High Value** - Makes system more maintainable and extensible
5. ✅ **Reasonable Effort** - 1.5 days for major improvement

---

## Next Steps

1. **Get Approval** - Review this proposal with team
2. **Create Branch** - `feature/gap-manager-imperative`
3. **Phase 1** - Implement GapManager
4. **Phase 2** - Update UI components
5. **Phase 3** - Add PackTrackCommand
6. **Phase 4** - Remove store methods
7. **Testing** - Verify all 116+ tests pass
8. **Manual Testing** - Use testing guide
9. **PR & Review**
10. **Merge & Deploy**

---

**End of Proposal**
