/**
 * Scene Rasterizer
 *
 * Deterministic pixel generation from EvaluatedScene.
 * This is the SINGLE SOURCE OF TRUTH for visual output.
 *
 * Architecture:
 *   EvaluatedScene → rasterizeScene() → RasterFrame
 *
 * Key principles:
 * - Evaluation: what exists? (evaluator.ts)
 * - Rasterization: how do pixels get produced? (this file)
 * - Preview and export MUST use the same rasterization
 * - Coordinates are source-resolution absolute (not viewport-relative)
 * - Rasterizer NEVER fetches/decodes (uses pre-resolved resources)
 */

import type { EvaluatedScene, EvaluatedMediaLayer, EvaluatedTextLayer } from "../evaluation/types";
import { getResourceManager } from "../resources/ResourceManager";

/**
 * Raster target configuration.
 * Defines the output framebuffer properties.
 */
export interface RasterTarget {
  /** Output width in pixels */
  width: number;

  /** Output height in pixels */
  height: number;

  /** Pixel ratio (for high-DPI displays) */
  pixelRatio?: number;

  /** Color space */
  colorSpace?: "srgb" | "display-p3";

  /** Background color */
  backgroundColor?: string;

  /** Active video elements (bypass decoding) */
  videoElements?: Map<string, HTMLVideoElement>;
}

/**
 * Rasterized frame result.
 * Contains the pixel data and metadata.
 */
export interface RasterFrame {
  /** Canvas element (for preview) or OffscreenCanvas (for export) */
  canvas: HTMLCanvasElement | OffscreenCanvas;

  /** 2D rendering context */
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  /** Output dimensions */
  width: number;
  height: number;

  /** Scale factors (target size / scene size) */
  scaleX: number;
  scaleY: number;

  /** Rasterization time in ms */
  rasterTimeMs: number;
}

/**
 * Rasterize an evaluated scene to pixels.
 *
 * This is the canonical rasterization function.
 * Preview and export MUST use this.
 *
 * @param scene - Evaluated scene
 * @param target - Raster target configuration
 * @param canvas - Optional canvas to reuse (for preview)
 * @returns Rasterized frame
 */
export async function rasterizeScene(scene: EvaluatedScene, target: RasterTarget, canvas?: HTMLCanvasElement | OffscreenCanvas): Promise<RasterFrame> {
  const startTime = performance.now();

  const { width, height, pixelRatio = 1, colorSpace = "srgb", backgroundColor = "#000000" } = target;

  // Create or reuse canvas
  const outputCanvas = canvas || (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width * pixelRatio, height * pixelRatio) : document.createElement("canvas"));

  if (!canvas) {
    outputCanvas.width = width * pixelRatio;
    outputCanvas.height = height * pixelRatio;
  }

  const ctx = outputCanvas.getContext("2d", {
    alpha: true,
    colorSpace,
  }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (!ctx) {
    throw new Error("Failed to get 2D context");
  }

  // Scale for pixel ratio
  if (pixelRatio !== 1) {
    ctx.scale(pixelRatio, pixelRatio);
  }

  // Clear with background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Calculate scale factors (target size / scene size)
  const scaleX = width / scene.metadata.canvasWidth;
  const scaleY = height / scene.metadata.canvasHeight;

  // Rasterize all visual layers
  for (const layer of scene.visualLayers) {
    await rasterizeLayer(ctx, layer, scaleX, scaleY, target);
  }

  const rasterTimeMs = performance.now() - startTime;

  return {
    canvas: outputCanvas,
    ctx,
    width,
    height,
    scaleX,
    scaleY,
    rasterTimeMs,
  };
}

/**
 * Rasterize a single visual layer.
 */
async function rasterizeLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: EvaluatedMediaLayer | EvaluatedTextLayer, scaleX: number, scaleY: number, target: RasterTarget): Promise<void> {
  ctx.save();

  // Apply transform
  const x = layer.x * scaleX;
  const y = layer.y * scaleY;
  const width = layer.width * scaleX;
  const height = layer.height * scaleY;

  // Translate to layer center
  ctx.translate(x + width / 2, y + height / 2);

  // Apply rotation
  if (layer.rotation !== 0) {
    ctx.rotate((layer.rotation * Math.PI) / 180);
  }

  // Apply opacity
  ctx.globalAlpha = layer.opacity;

  // Apply blend mode
  ctx.globalCompositeOperation = mapBlendMode(layer.blendMode);

  // Rasterize based on layer type
  if (layer.layerType === "media") {
    await rasterizeMediaLayer(ctx, layer, width, height, target);
  } else if (layer.layerType === "text") {
    rasterizeTextLayer(ctx, layer, width, height, scaleX, scaleY);
  }

  ctx.restore();
}

/**
 * Rasterize a media layer.
 * Uses pre-resolved resources when available.
 */
async function rasterizeMediaLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: EvaluatedMediaLayer, width: number, height: number, target: RasterTarget): Promise<void> {
  try {
    // 1. Try to use active video element (bypasses decoding)
    if (layer.mediaType === "video" && target.videoElements) {
      const key = `${layer.clipId}-${layer.mediaId}`;
      const video = target.videoElements.get(key);
      if (video && video.readyState >= 2) {
        // HAVE_CURRENT_DATA
        ctx.drawImage(video, -width / 2, -height / 2, width, height);
        return;
      }
    }

    let imageBitmap: ImageBitmap | null = null;

    // 2. Try to use pre-resolved resource
    if (layer.resourceHandle) {
      const resourceManager = getResourceManager();
      const resource = resourceManager.get(layer.resourceHandle);

      if (resource && resource.data instanceof ImageBitmap) {
        imageBitmap = resource.data;
      }
    }

    // Fallback: load on-demand (legacy path, should be avoided)
    if (!imageBitmap) {
      const response = await fetch(layer.sourcePath);
      const blob = await response.blob();
      imageBitmap = await createImageBitmap(blob);
    }

    // Draw centered (after rotation transform)
    ctx.drawImage(imageBitmap, -width / 2, -height / 2, width, height);

    // Only close if we created it (not from resource manager)
    if (!layer.resourceHandle && imageBitmap) {
      imageBitmap.close();
    }
  } catch (error) {
    // Fallback: draw placeholder
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(-width / 2, -height / 2, width, height);

    // Draw error border
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.strokeRect(-width / 2, -height / 2, width, height);
  }
}

/**
 * Rasterize a text layer.
 *
 * CRITICAL: This is the canonical text rendering.
 * Preview MUST use this same code path.
 */
function rasterizeTextLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: EvaluatedTextLayer, width: number, height: number, scaleX: number, scaleY: number): void {
  // Build font string
  const fontWeight = typeof layer.fontWeight === "number" ? layer.fontWeight : layer.fontWeight === "bold" ? "700" : "400";
  const fontStyle = layer.fontStyle === "italic" ? "italic" : "normal";
  const fontSize = layer.fontSize * scaleY;
  const fontFamily = layer.fontFamily;

  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = layer.color;

  // Apply letter spacing if specified
  if (layer.letterSpacing !== 0) {
    ctx.letterSpacing = `${layer.letterSpacing * scaleX}px`;
  }

  // Split text into lines and wrap if needed
  const lines = wrapText(ctx, layer.text, width, fontSize, layer.lineHeight);
  const lineHeight = fontSize * layer.lineHeight;

  // Calculate total text height
  const totalHeight = lines.length * lineHeight;

  // Calculate vertical alignment offset
  let startY: number;
  switch (layer.verticalAlign) {
    case "top":
      startY = -height / 2 + lineHeight / 2;
      break;
    case "bottom":
      startY = height / 2 - totalHeight + lineHeight / 2;
      break;
    case "middle":
    default:
      startY = -totalHeight / 2 + lineHeight / 2;
      break;
  }

  // Set text alignment
  ctx.textAlign = layer.textAlign;
  ctx.textBaseline = "middle";

  // Calculate horizontal alignment offset
  let textX: number;
  switch (layer.textAlign) {
    case "left":
      textX = -width / 2;
      break;
    case "right":
      textX = width / 2;
      break;
    case "center":
    default:
      textX = 0;
      break;
  }

  // Enable clipping to prevent text overflow
  ctx.save();
  ctx.beginPath();
  ctx.rect(-width / 2, -height / 2, width, height);
  ctx.clip();

  // Draw each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const y = startY + i * lineHeight;

    // Draw text shadow if specified
    if (layer.shadow) {
      ctx.save();
      ctx.shadowColor = layer.shadow.color;
      ctx.shadowBlur = layer.shadow.blur * scaleY;
      ctx.shadowOffsetX = layer.shadow.offsetX * scaleX;
      ctx.shadowOffsetY = layer.shadow.offsetY * scaleY;
      ctx.fillText(line, textX, y);
      ctx.restore();
    }

    // Draw text stroke if specified
    if (layer.stroke) {
      ctx.strokeStyle = layer.stroke.color;
      ctx.lineWidth = layer.stroke.width * scaleY;
      ctx.strokeText(line, textX, y);
    }

    // Draw text fill
    ctx.fillText(line, textX, y);
  }

  ctx.restore();

  // Reset letter spacing
  if (layer.letterSpacing !== 0) {
    ctx.letterSpacing = "0px";
  }
}

/**
 * Wrap text to fit within a maximum width.
 * Handles manual line breaks (\n) and automatic word wrapping.
 */
function wrapText(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, maxWidth: number, fontSize: number, lineHeight: number): string[] {
  const lines: string[] = [];

  // Split by manual line breaks first
  const paragraphs = text.split("\n");

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }

    // Measure paragraph width
    const metrics = ctx.measureText(paragraph);

    // If paragraph fits, add it as-is
    if (metrics.width <= maxWidth) {
      lines.push(paragraph);
      continue;
    }

    // Wrap paragraph into multiple lines
    const words = paragraph.split(" ");
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testMetrics = ctx.measureText(testLine);

      if (testMetrics.width > maxWidth && currentLine) {
        // Line is too long, push current line and start new one
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    // Push remaining text
    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

/**
 * Map blend mode to canvas composite operation.
 */
function mapBlendMode(blendMode: string): GlobalCompositeOperation {
  const map: Record<string, GlobalCompositeOperation> = {
    normal: "source-over",
    multiply: "multiply",
    screen: "screen",
    overlay: "overlay",
    darken: "darken",
    lighten: "lighten",
    add: "lighter",
  };

  return map[blendMode] || "source-over";
}

/**
 * Measure text dimensions (for layout validation).
 *
 * This allows evaluator to include measured bounds in EvaluatedTextLayer.
 * Future enhancement.
 */
export function measureText(text: string, fontFamily: string, fontSize: number, fontWeight: string | number, fontStyle: string): { width: number; height: number } {
  // Create temporary canvas for measurement
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");

  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    return { width: 0, height: 0 };
  }

  const weight = typeof fontWeight === "number" ? fontWeight : fontWeight === "bold" ? "700" : "400";
  ctx.font = `${fontStyle} ${weight} ${fontSize}px ${fontFamily}`;

  const metrics = ctx.measureText(text);

  return {
    width: metrics.width,
    height: fontSize * 1.2, // Approximate height
  };
}
