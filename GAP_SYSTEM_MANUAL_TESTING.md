# Gap System Manual & Stress Testing Guide

**Version:** 1.0  
**Date:** 2026-06-10  
**Status:** ⚠️ **Gaps do NOT support undo/redo** (commands exist but unused)

---

## Table of Contents

1. [Setup & Prerequisites](#setup--prerequisites)
2. [Basic Functionality Tests](#basic-functionality-tests)
3. [Visual & Interaction Tests](#visual--interaction-tests)
4. [Edge Cases & Boundary Tests](#edge-cases--boundary-tests)
5. [Stress Tests](#stress-tests)
6. [Multi-Track Tests](#multi-track-tests)
7. [Performance Tests](#performance-tests)
8. [Known Limitations](#known-limitations)

---

## Setup & Prerequisites

### Required Setup

1. Open Clypra project
2. Create a new project or open existing
3. Add at least 2 video clips to timeline with gaps between them
4. Ensure clips are on different tracks for multi-track tests

### Test Environment

- [ ] Test on macOS
- [ ] Test on Windows
- [ ] Test on Linux
- [ ] Test with different canvas sizes (1080p, 4K)
- [ ] Test with different zoom levels

---

## Basic Functionality Tests

### TEST 1: Insert Gap with Keyboard Shortcut

**Objective:** Verify gap insertion at playhead position

**Steps:**

1. Position playhead between two clips (e.g., at 5 seconds)
2. Press `I` key
3. Observe a 2-second gap is inserted
4. Verify clips after playhead shift right by 2 seconds

**Expected:**

- ✅ Gap appears as diagonal stripe pattern
- ✅ Clips shift correctly
- ✅ Timeline duration increases by 2 seconds
- ✅ Playhead remains at original position

**Edge Cases:**

- [ ] Insert gap at t=0 (start of timeline)
- [ ] Insert gap at end of timeline
- [ ] Insert gap with no clips on track
- [ ] Insert gap on locked track (should fail gracefully)

---

### TEST 2: Remove Gap with Keyboard Shortcut

**Objective:** Verify gap removal with ripple delete

**Steps:**

1. Create a gap using `I` key
2. Position playhead inside the gap
3. Press `,` (comma) key
4. Observe gap is removed and clips shift left

**Expected:**

- ✅ Gap disappears
- ✅ Clips ripple left to close the space
- ✅ Timeline duration decreases
- ✅ No visual artifacts

**Edge Cases:**

- [ ] Remove gap when playhead not in any gap (should do nothing)
- [ ] Remove protected gap (should fail)
- [ ] Remove gap on locked track (should fail)

---

### TEST 3: Remove Gap via Selection

**Objective:** Verify gap removal via selection + Delete key

**Steps:**

1. Click on a gap to select it (should show accent ring)
2. Press `Delete` or `Backspace` key
3. Observe gap is removed with ripple

**Expected:**

- ✅ Gap removes correctly
- ✅ Selection clears after removal
- ✅ Clips ripple properly

---

### TEST 4: Double-Click to Remove Gap

**Objective:** Verify quick removal via double-click

**Steps:**

1. Double-click on an unprotected gap
2. Observe gap is removed immediately

**Expected:**

- ✅ Gap removes without confirmation
- ✅ Ripple happens smoothly
- ✅ Protected gaps do NOT remove on double-click

---

### TEST 5: Gap Selection & Visual Feedback

**Objective:** Verify selection state and visual indicators

**Steps:**

1. Click on a gap
2. Observe visual changes
3. Click on a clip
4. Observe gap deselects

**Expected:**

- ✅ Selected gap shows accent ring (cyan border)
- ✅ Hover shows lighter background
- ✅ Gap and clip selection are mutually exclusive
- ✅ Tooltip shows duration in MM:SS:FF format

---

### TEST 6: Gap Context Menu

**Objective:** Verify right-click context menu operations

**Steps:**

1. Right-click on a gap
2. Verify menu shows correct options
3. Test each menu option

**Expected Menu Options:**

- ✅ "Remove Gap" - removes gap with ripple
- ✅ "Protect Gap" / "Unprotect Gap" - toggles protection
- ✅ Protected gaps show lock icon
- ✅ Menu items disabled for locked tracks

---

### TEST 7: Gap Protection Toggle

**Objective:** Verify gap protection state

**Steps:**

1. Create a gap (automatically protected)
2. Right-click → "Unprotect Gap"
3. Verify lock icon disappears
4. Right-click → "Protect Gap"
5. Verify lock icon appears

**Expected:**

- ✅ Protected gaps show lock icon
- ✅ Protection persists across app restart
- ✅ Pack Track skips protected gaps
- ✅ Double-click on protected gap does nothing

---

### TEST 8: Pack Track Button

**Objective:** Verify Pack Track removes all unprotected gaps

**Steps:**

1. Create multiple gaps on a track (mix protected/unprotected)
2. Hover over track header
3. Click "Pack Track" button (Minimize2 icon)
4. Observe unprotected gaps removed

**Expected:**

- ✅ Button only appears when track has gaps
- ✅ All unprotected gaps removed
- ✅ Protected gaps preserved
- ✅ Clips pack tightly with no spaces
- ✅ Button disappears after packing

**Test Variations:**

- [ ] Track with only protected gaps (button should appear but have no effect)
- [ ] Track with only unprotected gaps (all removed)
- [ ] Track with no gaps (button should not appear)

---

## Visual & Interaction Tests

### TEST 9: Gap Visual Rendering

**Objective:** Verify gap appearance and styling

**Checklist:**

- [ ] Gap shows diagonal stripe pattern (bg-muted with opacity-50)
- [ ] Gap has rounded corners (rounded-sm)
- [ ] Gap has 1px border (border-border)
- [ ] Hover state shows lighter background
- [ ] Selected state shows accent ring
- [ ] Protected gap shows lock icon (top-left)
- [ ] Lock icon has dark background for visibility

---

### TEST 10: Gap Tooltip

**Objective:** Verify hover tooltip information

**Steps:**

1. Hover over a gap
2. Wait for tooltip to appear
3. Verify information displayed

**Expected:**

- ✅ Shows "Gap" label
- ✅ Shows duration in MM:SS:FF format (e.g., "00:02:00")
- ✅ Tooltip appears above gap
- ✅ Tooltip has proper styling

---

### TEST 11: Gap Width at Different Zoom Levels

**Objective:** Verify gap renders correctly at various zoom levels

**Steps:**

1. Create a 2-second gap
2. Zoom in to max level
3. Verify gap width scales correctly
4. Zoom out to min level
5. Verify gap still visible

**Expected:**

- ✅ Gap width = duration \* pixelsPerSecond
- ✅ Minimum width of 2px even for tiny gaps
- ✅ No visual glitches during zoom
- ✅ Gap position updates correctly

---

## Edge Cases & Boundary Tests

### TEST 12: Zero-Duration Gaps

**Objective:** Verify system handles zero/negative durations

**Manual Test:**

- Cannot create directly, but test with automation:
  ```javascript
  // This should fail in gapEngine validation
  insertGapWithRipple(trackId, 10, 0, clips);
  insertGapWithRipple(trackId, 10, -1, clips);
  ```

**Expected:**

- ✅ Validation prevents zero/negative gaps
- ✅ No crashes or visual glitches

---

### TEST 13: Very Small Gaps (<0.1 seconds)

**Objective:** Test tiny gap handling

**Steps:**

1. Use automation to create 0.001 second gap
2. Verify visual rendering
3. Try to select and interact with it

**Expected:**

- ✅ Gap renders at minimum 2px width
- ✅ Can still be selected and removed
- ✅ Tooltip shows correct duration (00:00:00)

---

### TEST 14: Very Large Gaps (>1 hour)

**Objective:** Test extreme duration handling

**Steps:**

1. Create gap at position 3600 (1 hour)
2. Verify rendering and interaction
3. Test removal and ripple

**Expected:**

- ✅ Gap renders correctly
- ✅ Tooltip shows correct time (01:00:00:00)
- ✅ Removal ripples correctly (may take moment for large shift)

---

### TEST 15: Gap at Timeline Start (t=0)

**Objective:** Verify gap insertion at beginning

**Steps:**

1. Add clip starting at t=5
2. Insert gap at t=0 with 3-second duration
3. Verify clip shifts to t=8

**Expected:**

- ✅ Gap created at t=0
- ✅ All clips shift right
- ✅ No negative positions

---

### TEST 16: Gap at Timeline End

**Objective:** Verify gap insertion after all clips

**Steps:**

1. Add clip at t=0-5
2. Insert gap at t=10 (after clip)
3. Verify gap created

**Expected:**

- ✅ Gap created successfully
- ✅ No clips affected (none after gap position)
- ✅ Timeline extends if needed

---

### TEST 17: Overlapping Clip Positions

**Objective:** Test gap insertion into overlapped clips area

**Note:** This is a theoretical edge case - UI should prevent clip overlaps

**Steps:**

1. Manually create overlapping clips (if possible)
2. Try to insert gap between them
3. Verify behavior

**Expected:**

- ✅ Gap engine detects overlaps
- ✅ System handles gracefully (no crash)

---

### TEST 18: Empty Track Gap Operations

**Objective:** Verify gap behavior on empty tracks

**Steps:**

1. Create empty track (no clips)
2. Try to insert gap with `I` key
3. Verify behavior

**Expected:**

- ✅ Gap insertion fails gracefully (returns null)
- ✅ No error messages shown to user
- ✅ System remains stable

**Note:** Current implementation auto-removes empty tracks, so gap insertion will fail because track doesn't exist.

---

## Stress Tests

### TEST 19: Rapid Gap Operations

**Objective:** Test system stability under rapid actions

**Steps:**

1. Rapidly press `I` key 20 times in 5 seconds
2. Observe timeline state
3. Rapidly press `,` key 20 times
4. Verify no crashes

**Expected:**

- ✅ System handles rapid input gracefully
- ✅ No duplicate gaps created
- ✅ No memory leaks
- ✅ UI remains responsive

---

### TEST 20: Many Gaps on Single Track

**Objective:** Test performance with many gaps

**Steps:**

1. Create 50+ gaps on a single track using automation
2. Scroll through timeline
3. Select and interact with gaps
4. Pack track

**Expected:**

- ✅ Rendering remains smooth (<16ms frame time)
- ✅ Selection works correctly
- ✅ Pack Track removes all efficiently
- ✅ No UI lag or stuttering

**Performance Metrics:**

- Render time: < 100ms for 50 gaps
- Selection response: < 50ms
- Pack operation: < 200ms

---

### TEST 21: Long-Duration Timeline (>1 hour)

**Objective:** Test gap operations on long timelines

**Steps:**

1. Create timeline with clips spanning 2+ hours
2. Insert gaps at various positions
3. Test navigation and interaction

**Expected:**

- ✅ Gap insertion at any position works
- ✅ Scrolling remains smooth
- ✅ No integer overflow issues
- ✅ Time formatting correct for large values

---

### TEST 22: Continuous Gap Creation/Deletion Loop

**Objective:** Test for memory leaks and state corruption

**Steps:**

1. Create automation to insert/remove gap 1000 times
2. Monitor memory usage
3. Verify timeline state after loop

**Expected:**

- ✅ Memory usage stable (no leak)
- ✅ Timeline state consistent
- ✅ No zombie gaps or corrupted state

---

## Multi-Track Tests

### TEST 23: Gap Isolation Between Tracks

**Objective:** Verify gaps on one track don't affect others

**Steps:**

1. Create 3 tracks with clips
2. Insert gap on Track 1 at t=5
3. Verify Track 2 and Track 3 clips unchanged

**Expected:**

- ✅ Only Track 1 clips shift
- ✅ Other tracks remain untouched
- ✅ Gap only visible on Track 1

---

### TEST 24: Pack Track Independence

**Objective:** Verify Pack Track only affects target track

**Steps:**

1. Create gaps on Track 1 and Track 2
2. Click Pack Track on Track 1 only
3. Verify Track 2 gaps preserved

**Expected:**

- ✅ Track 1 gaps removed
- ✅ Track 2 gaps unchanged
- ✅ Track 3 (if exists) unchanged

---

### TEST 25: Simultaneous Gap Operations on Multiple Tracks

**Objective:** Test concurrent gap operations

**Steps:**

1. Quickly insert gaps on Track 1, Track 2, Track 3
2. Verify all created correctly
3. Quickly remove gaps from multiple tracks
4. Verify state consistency

**Expected:**

- ✅ All operations execute correctly
- ✅ No race conditions
- ✅ State remains consistent
- ✅ Epoch increments properly for cache invalidation

---

### TEST 26: Gap Protection Across Tracks

**Objective:** Verify protection state is track-specific

**Steps:**

1. Create gap on Track 1 (protected)
2. Create gap on Track 2 (unprotected)
3. Pack both tracks
4. Verify only Track 1 gap remains

**Expected:**

- ✅ Protection state independent per track
- ✅ Pack operation respects protection
- ✅ No cross-track interference

---

## Performance Tests

### TEST 27: Frame Rate During Gap Operations

**Objective:** Verify UI remains smooth during operations

**Tools:** Browser DevTools Performance tab

**Steps:**

1. Open Performance tab
2. Start recording
3. Perform 20 gap insert/remove operations
4. Stop recording
5. Analyze frame times

**Expected:**

- ✅ Frame rate stays above 55 FPS (< 18ms frames)
- ✅ No long tasks blocking main thread
- ✅ Smooth animations throughout

---

### TEST 28: Memory Usage Monitoring

**Objective:** Verify no memory leaks

**Tools:** Browser DevTools Memory tab

**Steps:**

1. Take heap snapshot (baseline)
2. Perform 100 gap operations
3. Take heap snapshot (after operations)
4. Clear gaps and take final snapshot
5. Compare snapshots

**Expected:**

- ✅ Memory returns to baseline after clearing
- ✅ No detached DOM nodes
- ✅ No retained gap objects
- ✅ Garbage collection cleans up properly

---

### TEST 29: Large Timeline Scrolling

**Objective:** Test scrolling performance with many gaps

**Steps:**

1. Create timeline with 100+ clips and 50+ gaps
2. Scroll left to right rapidly
3. Monitor frame rate
4. Test zoom in/out during scroll

**Expected:**

- ✅ Scrolling remains smooth (60 FPS)
- ✅ No visual glitches or tearing
- ✅ Gaps render correctly during scroll
- ✅ Virtualization works if implemented

---

## Known Limitations

### ⚠️ CRITICAL: No Undo/Redo Support

**Issue:** Gap operations do NOT integrate with history/command system  
**Impact:** High - Users expect undo/redo for all timeline operations  
**Status:** Commands exist (`InsertGapCommand`, `RemoveGapCommand`, etc.) but are UNUSED

**Affected Operations:**

- ❌ Insert gap (`I` key)
- ❌ Remove gap (`,` key, Delete, double-click)
- ❌ Toggle gap protection (context menu)
- ❌ Resize gap (if implemented)
- ❌ Pack track

**Current Implementation:**

```typescript
// Timeline.tsx - WRONG (no undo support)
store.insertGap(trackId, currentTime, gapDuration);
store.removeGap(selectedGapId);

// Should be:
execute(new InsertGapCommand(trackId, currentTime, gapDuration));
execute(new RemoveGapCommand(selectedGapId));
```

**Test to Verify Issue:**

1. Insert a gap with `I` key
2. Press `Ctrl+Z` (undo)
3. ❌ Gap is NOT removed (undo doesn't work)
4. Press `Ctrl+Shift+Z` (redo)
5. ❌ Nothing happens

---

### Other Limitations

1. **Gap Auto-Detection Not Enabled**
   - `detectAndSyncGaps()` exists but not called automatically
   - Gaps only created manually by user
2. **No Gap Resize UI**
   - `ResizeGapCommand` exists but no UI to trigger it
   - Cannot drag gap edges to resize

3. **No Gap Drag-and-Drop**
   - Gaps are static, cannot be moved by dragging
4. **No Gap Merge**
   - Adjacent gaps don't automatically merge
   - `mergeAdjacentGaps()` exists but unused

5. **Empty Track Gap Limitation**
   - Cannot insert gaps on tracks with no clips
   - Empty tracks auto-remove when last clip deleted

---

## Test Results Template

### Test Session Info

- **Date:** ****\_\_\_****
- **Tester:** ****\_\_\_****
- **Build:** ****\_\_\_****
- **Platform:** ****\_\_\_****

### Results Summary

| Test # | Test Name            | Status        | Notes |
| ------ | -------------------- | ------------- | ----- |
| 1      | Insert Gap Keyboard  | ☐ Pass ☐ Fail |       |
| 2      | Remove Gap Keyboard  | ☐ Pass ☐ Fail |       |
| 3      | Remove Gap Selection | ☐ Pass ☐ Fail |       |
| ...    | ...                  | ...           |       |

### Critical Bugs Found

1. ***
2. ***
3. ***

### Performance Issues

1. ***
2. ***

### Recommendations

1. ***
2. ***

---

## Appendix: Automation Scripts

### Quick Test Script (Browser Console)

```javascript
// Test gap insertion and removal
const store = useTimelineStore.getState();
const trackId = store.tracks[0].id;

// Insert gap
const gap = store.insertGap(trackId, 5, 2);
console.log("Gap created:", gap);

// Wait 1 second
setTimeout(() => {
  store.removeGap(gap.id);
  console.log("Gap removed");
}, 1000);
```

### Stress Test Script

```javascript
// Create 50 gaps rapidly
const store = useTimelineStore.getState();
const trackId = store.tracks[0].id;

for (let i = 0; i < 50; i++) {
  const startTime = i * 5;
  store.insertGap(trackId, startTime, 1);
}

console.log("Created 50 gaps");
console.log("Total gaps:", store.gaps.length);
```

---

**End of Manual Testing Guide**
