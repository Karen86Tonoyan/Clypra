/**
 * Frame Time Utilities
 *
 * Provides deterministic frame boundary calculations to ensure
 * splits, seeks, and playback align with real decoder frame positions.
 */

/**
 * Snap a time to the nearest frame boundary.
 *
 * @param timeSeconds - Arbitrary time in seconds
 * @param frameRate - Project frame rate (fps)
 * @returns Time snapped to nearest frame boundary
 */
export function snapToFrameBoundary(timeSeconds: number, frameRate: number): number {
  const frameIndex = Math.round(timeSeconds * frameRate);
  return frameIndex / frameRate;
}

/**
 * Snap a time to the previous frame boundary (floor).
 */
export function snapToFrameFloor(timeSeconds: number, frameRate: number): number {
  const frameIndex = Math.floor(timeSeconds * frameRate);
  return frameIndex / frameRate;
}

/**
 * Snap a time to the next frame boundary (ceil).
 */
export function snapToFrameCeil(timeSeconds: number, frameRate: number): number {
  const frameIndex = Math.ceil(timeSeconds * frameRate);
  return frameIndex / frameRate;
}

/**
 * Get the frame index for a given time.
 */
export function getFrameIndex(timeSeconds: number, frameRate: number): number {
  return Math.round(timeSeconds * frameRate);
}

/**
 * Get time from frame index.
 */
export function getTimeFromFrame(frameIndex: number, frameRate: number): number {
  return frameIndex / frameRate;
}
