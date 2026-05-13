/**
 * Frame Export Utilities
 *
 * High-level API for exporting single frames.
 * Uses the frame scheduler for consistency with preview.
 */

import { getFrameScheduler } from "../core/scheduler/FrameScheduler";
import type { Clip, Track, MediaAsset, Project } from "../types";

export interface ExportFrameOptions {
  /** Timeline time to export */
  time: number;

  /** Timeline clips */
  clips: Clip[];

  /** Timeline tracks */
  tracks: Track[];

  /** Media assets */
  assets: MediaAsset[];

  /** Project settings */
  project: Project | null;

  /** Timeline epoch (for cache) */
  epoch: number;

  /** Output width (defaults to project canvas width) */
  width?: number;

  /** Output height (defaults to project canvas height) */
  height?: number;

  /** Output format */
  format?: "png" | "jpeg";

  /** JPEG quality (0-1) */
  quality?: number;
}

/**
 * Export a single frame as PNG or JPEG.
 *
 * This uses the frame scheduler for consistency with preview rendering.
 * Ensures preview and export use the same pipeline.
 *
 * @param options - Export options
 * @returns Blob containing the exported frame
 */
export async function exportFrame(options: ExportFrameOptions): Promise<Blob> {
  const { time, clips, tracks, assets, project, epoch, width = project?.canvasWidth || 1920, height = project?.canvasHeight || 1080, format = "png", quality = 0.92 } = options;

  // Get scheduler and update timeline state
  const scheduler = getFrameScheduler();
  scheduler.updateTimeline(clips, tracks, assets, project, epoch);

  // Schedule frame render with export priority
  const jobId = scheduler.schedule({
    time,
    resolution: {
      width,
      height,
    },
    pixelRatio: 1,
    outputFormat: "blob",
    quality,
    priority: "export",
  });

  // Wait for result
  const result = await scheduler.wait(jobId);

  if (!(result.data instanceof Blob)) {
    throw new Error("Expected Blob output from scheduler");
  }

  return result.data;
}

/**
 * Export frame and download it.
 *
 * @param options - Export options
 * @param filename - Output filename
 */
export async function exportFrameAndDownload(options: ExportFrameOptions, filename?: string): Promise<void> {
  const blob = await exportFrame(options);

  // Generate filename if not provided
  const ext = options.format === "jpeg" ? "jpg" : "png";
  const name = filename || `frame-${options.time.toFixed(2)}s.${ext}`;

  // Create download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();

  // Cleanup
  URL.revokeObjectURL(url);
}

/**
 * Export frame via Tauri (save to disk).
 *
 * @param options - Export options
 * @param savePath - Path to save the file
 */
export async function exportFrameToFile(options: ExportFrameOptions, savePath: string): Promise<void> {
  const blob = await exportFrame(options);

  // Convert blob to array buffer
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Save via Tauri
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_file", {
      path: savePath,
      contents: Array.from(uint8Array),
    });
  } catch (err) {
    console.error("[ExportFrame] Failed to write file:", err);
    throw err;
  }
}
