/**
 * SplitClipCommand Tests
 *
 * Tests clip splitting with frame snapping to ensure smooth cuts
 * and proper trimOut setting.
 */

import { describe, it, expect } from "vitest";
import { SplitClipCommand } from "../SplitClipCommand";
import type { Clip } from "@/types";

describe("SplitClipCommand", () => {
  const createTestClip = (overrides?: Partial<Clip>): Clip => ({
    id: "clip-1",
    trackId: "track-1",
    mediaId: "media-1",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
    ...overrides,
  });

  describe("basic splitting", () => {
    it("splits clip into two pieces", () => {
      const clip = createTestClip();
      const command = new SplitClipCommand("clip-1", 5.0, 30, clip);

      const state = {
        clips: [clip],
        epoch: 0,
      };

      const newState = command.apply(state);

      expect(newState.clips).toHaveLength(2);
      expect(newState.epoch).toBe(1);
    });

    it("sets trimOut correctly on left clip", () => {
      const clip = createTestClip({
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
      });

      const command = new SplitClipCommand("clip-1", 5.0, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      const leftClip = newState.clips.find((c) => c.id === "clip-1");
      expect(leftClip?.trimOut).toBe(5.0);
      expect(leftClip?.duration).toBe(5.0);
    });

    it("sets trimIn and trimOut correctly on right clip", () => {
      const clip = createTestClip({
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
      });

      const command = new SplitClipCommand("clip-1", 5.0, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      const rightClip = newState.clips.find((c) => c.id !== "clip-1");
      expect(rightClip?.trimIn).toBe(5.0);
      expect(rightClip?.trimOut).toBe(10.0);
      expect(rightClip?.startTime).toBe(5.0);
      expect(rightClip?.duration).toBe(5.0);
    });
  });

  describe("frame snapping", () => {
    it("snaps split time to nearest frame boundary", () => {
      const clip = createTestClip({
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
      });

      // Split at non-frame boundary: 5.467s at 30fps
      const command = new SplitClipCommand("clip-1", 5.467, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      const rightClip = newState.clips.find((c) => c.id !== "clip-1");

      // Should snap to nearest frame: 5.467 * 30 = 164.01 → 164 frames → 5.4667s
      const expectedSnap = Math.round(5.467 * 30) / 30;
      expect(rightClip?.startTime).toBeCloseTo(expectedSnap, 4);
    });

    it("maintains coherence: left.trimOut === right.trimIn", () => {
      const clip = createTestClip({
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
      });

      const command = new SplitClipCommand("clip-1", 5.467, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      const leftClip = newState.clips.find((c) => c.id === "clip-1");
      const rightClip = newState.clips.find((c) => c.id !== "clip-1");

      // Critical: must be identical for smooth cuts
      expect(leftClip?.trimOut).toBe(rightClip?.trimIn);
    });
  });

  describe("split with existing trim", () => {
    it("handles clips with non-zero trimIn", () => {
      const clip = createTestClip({
        startTime: 0,
        duration: 6,
        trimIn: 2, // Clip starts 2s into media
        trimOut: 8,
      });

      const command = new SplitClipCommand("clip-1", 3.0, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      const leftClip = newState.clips.find((c) => c.id === "clip-1");
      const rightClip = newState.clips.find((c) => c.id !== "clip-1");

      // Left: trimIn 2 → trimOut 5 (3s into clip from trimIn 2)
      expect(leftClip?.trimIn).toBe(2);
      expect(leftClip?.trimOut).toBe(5);

      // Right: trimIn 5 → trimOut 8
      expect(rightClip?.trimIn).toBe(5);
      expect(rightClip?.trimOut).toBe(8);
    });

    it("handles already-split clips (middle piece)", () => {
      // Simulates the bug case from the issue
      const middleClip = createTestClip({
        startTime: 36.94,
        duration: 2.0,
        trimIn: 36.94,
        trimOut: 38.94,
      });

      const command = new SplitClipCommand("clip-1", 37.5, 30, middleClip);
      const newState = command.apply({ clips: [middleClip], epoch: 0 });

      const leftClip = newState.clips.find((c) => c.id === "clip-1");
      const rightClip = newState.clips.find((c) => c.id !== "clip-1");

      // Both pieces should have valid trimOut
      expect(leftClip?.trimOut).toBeDefined();
      expect(rightClip?.trimOut).toBeDefined();
      expect(leftClip?.trimOut).toBeLessThanOrEqual(middleClip.trimOut);
      expect(rightClip?.trimOut).toBe(middleClip.trimOut);
    });
  });

  describe("validation", () => {
    it("rejects split outside clip bounds", () => {
      const clip = createTestClip({
        startTime: 10,
        duration: 5,
      });

      const beforeClip = new SplitClipCommand("clip-1", 9, 30, clip);
      const afterClip = new SplitClipCommand("clip-1", 16, 30, clip);

      const state = { clips: [clip], epoch: 0 };

      // Should return state unchanged
      expect(beforeClip.apply(state)).toEqual(state);
      expect(afterClip.apply(state)).toEqual(state);
    });

    it("rejects split at exact clip boundaries", () => {
      const clip = createTestClip({
        startTime: 10,
        duration: 5,
      });

      const atStart = new SplitClipCommand("clip-1", 10, 30, clip);
      const atEnd = new SplitClipCommand("clip-1", 15, 30, clip);

      const state = { clips: [clip], epoch: 0 };

      expect(atStart.apply(state)).toEqual(state);
      expect(atEnd.apply(state)).toEqual(state);
    });

    it("handles missing clip gracefully", () => {
      const clip = createTestClip();
      const command = new SplitClipCommand("nonexistent", 5, 30, clip);

      const state = { clips: [clip], epoch: 0 };
      expect(command.apply(state)).toEqual(state);
    });
  });

  describe("serialization", () => {
    it("serializes and deserializes correctly", () => {
      const clip = createTestClip();
      const command = new SplitClipCommand("clip-1", 5.0, 30, clip);

      const json = command.toJSON();
      expect(json).toHaveProperty("type", "SplitClip");
      expect(json).toHaveProperty("frameRate", 30);

      const restored = SplitClipCommand.fromJSON(json);
      expect(restored).toBeInstanceOf(SplitClipCommand);
    });
  });

  describe("undo/redo", () => {
    it("creates invertible command", () => {
      const clip = createTestClip();
      const command = new SplitClipCommand("clip-1", 5.0, 30, clip);

      const state = { clips: [clip], epoch: 0 };
      const afterSplit = command.apply(state);

      const undoCommand = command.invert();
      const afterUndo = undoCommand.apply(afterSplit);

      // Should restore original clip (though IDs may differ)
      expect(afterUndo.clips).toHaveLength(1);
      expect(afterUndo.clips[0].duration).toBe(clip.duration);
    });
  });

  describe("edge cases", () => {
    it("handles split at 1 frame duration", () => {
      const clip = createTestClip({
        startTime: 0,
        duration: 0.066, // 2 frames at 30fps
      });

      const command = new SplitClipCommand("clip-1", 0.033, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      expect(newState.clips).toHaveLength(2);
    });

    it("handles very large timecodes", () => {
      const clip = createTestClip({
        startTime: 3600, // 1 hour
        duration: 600, // 10 minutes
      });

      const command = new SplitClipCommand("clip-1", 3900, 30, clip);
      const newState = command.apply({ clips: [clip], epoch: 0 });

      expect(newState.clips).toHaveLength(2);
    });
  });
});
