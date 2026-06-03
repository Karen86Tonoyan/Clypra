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
import { getResourceCache } from "../resources/ResourceCache";
import { _buildConfig } from "../../features/text-effects/registry";
import { defaultConfig as engineDefaultConfig, evaluateScene as engineEvaluateScene, textEffectConfigToScene, supportsCtxFilter, supportsOffscreenCanvas, type TextEffectConfig, WebGLCompositor } from "@clypra/engine";
import { useEffectsStore } from "../../features/text-effects/store/effectsStore";

// Shared WebGLCompositor for rasterizer — used when ctx.filter is unsupported (WKWebView).
let _rasterizerCompositor: WebGLCompositor | null = null;
function getRasterizerCompositor(): WebGLCompositor | null {
  if (_rasterizerCompositor !== null) return _rasterizerCompositor;
  if (typeof document === "undefined") return null;
  _rasterizerCompositor = new WebGLCompositor();
  return _rasterizerCompositor.isSupported ? _rasterizerCompositor : null;
}

/**
 * Global pool for OffscreenCanvas to prevent GC stalls during rendering/export.
 */
class OffscreenCanvasPool {
  private canvases: OffscreenCanvas[] = [];
  private maxPoolSize = 5;

  acquire(width: number, height: number): OffscreenCanvas {
    let canvas: OffscreenCanvas;
    if (this.canvases.length > 0) {
      canvas = this.canvases.pop()!;
      // Only resize if necessary
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    } else {
      if (typeof OffscreenCanvas !== "undefined") {
        canvas = new OffscreenCanvas(width, height);
      } else {
        canvas = document.createElement("canvas") as any as OffscreenCanvas;
        canvas.width = width;
        canvas.height = height;
      }
    }
    return canvas;
  }

  release(canvas: OffscreenCanvas) {
    if (this.canvases.length < this.maxPoolSize) {
      this.canvases.push(canvas);
    }
  }
}

const canvasPool = new OffscreenCanvasPool();

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

  /** Release the canvas back to the pool (if applicable) */
  releaseCanvas?: () => void;
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

  const targetWidth = width * pixelRatio;
  const targetHeight = height * pixelRatio;

  // Create or reuse canvas
  // callerSupplied: canvas was provided by the caller (not drawn from pool)
  const callerSupplied = canvas != null;
  const outputCanvas = canvas ?? canvasPool.acquire(targetWidth, targetHeight);

  // Resize caller-supplied canvases when dimensions changed.
  // Pool canvases are always sized correctly by acquire().
  if (callerSupplied && (outputCanvas.width !== targetWidth || outputCanvas.height !== targetHeight)) {
    outputCanvas.width = targetWidth;
    outputCanvas.height = targetHeight;
  }

  const ctx = outputCanvas.getContext("2d", {
    alpha: true,
    colorSpace,
  }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (!ctx) {
    throw new Error("Failed to get 2D context");
  }

  // Reset transform on every frame (critical when reusing pooled canvases —
  // without this, ctx.scale() accumulates and pushes drawing off-screen).
  // Guard for test environments where mock canvas contexts may not implement setTransform.
  if (typeof ctx.setTransform === "function") {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Scale for pixel ratio
  if (pixelRatio !== 1) {
    ctx.scale(pixelRatio, pixelRatio);
  }

  // Clear with background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Calculate scale factors (target size / scene size)
  // Use uniform scaling to preserve aspect ratio
  const scaleX = width / scene.metadata.canvasWidth;
  const scaleY = height / scene.metadata.canvasHeight;
  const scale = Math.min(scaleX, scaleY); // Uniform scale (letterbox if needed)

  // Calculate letterbox/pillarbox offsets to center content
  const scaledCanvasWidth = scene.metadata.canvasWidth * scale;
  const scaledCanvasHeight = scene.metadata.canvasHeight * scale;
  const offsetX = (width - scaledCanvasWidth) / 2;
  const offsetY = (height - scaledCanvasHeight) / 2;

  // Apply centering offset
  ctx.save();
  ctx.translate(offsetX, offsetY);

  // Rasterize all visual layers with uniform scaling
  for (const layer of scene.visualLayers) {
    await rasterizeLayer(ctx, layer, scale, scale, target);
  }

  ctx.restore();

  const rasterTimeMs = performance.now() - startTime;

  // Caller must invoke releaseCanvas() after extracting ImageBitmap/ImageData
  // to return the pooled OffscreenCanvas for reuse.
  return {
    canvas: outputCanvas,
    ctx,
    width,
    height,
    scaleX: scale,
    scaleY: scale,
    rasterTimeMs,
    releaseCanvas: () => {
      if (!callerSupplied && outputCanvas instanceof OffscreenCanvas) {
        canvasPool.release(outputCanvas);
      }
    },
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

/** Throttle state for video element warnings (prevent log flood at 60fps). */
let _lastVideoWarnTime = 0;
const VIDEO_WARN_INTERVAL_MS = 5000;

async function rasterizeMediaLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: EvaluatedMediaLayer, width: number, height: number, target: RasterTarget): Promise<void> {
  try {
    // 1. Try to use active video element (bypasses decoding)
    if (layer.mediaType === "video" && target.videoElements) {
      const key = `${layer.clipId}-${layer.mediaId}`;
      const video = target.videoElements.get(key);

      if (video) {
        if (video.readyState >= 2) {
          // HAVE_CURRENT_DATA — element is loaded, draw it
          ctx.drawImage(video, -width / 2, -height / 2, width, height);
          return;
        }
        // Element exists but still loading — draw silent placeholder (no error)
        drawLoadingPlaceholder(ctx, width, height);
        return;
      } else {
        // Only log warning occasionally to avoid spam
        const now = performance.now();
        if (now - _lastVideoWarnTime > VIDEO_WARN_INTERVAL_MS) {
          _lastVideoWarnTime = now;
          console.warn(`[Rasterizer] No video element for clip ${layer.clipId}`);
        }
      }
    }

    let imageBitmap: ImageBitmap | null = null;

    // 2. Try to use pre-resolved resource
    if (layer.resourceHandle) {
      const resourceCache = getResourceCache();
      const resource = resourceCache.get(layer.resourceHandle);

      if (resource && resource.data instanceof ImageBitmap) {
        imageBitmap = resource.data;
      }
    }

    // Fallback: load on-demand (legacy path, should be avoided)
    if (!imageBitmap) {
      if (layer.mediaType === "video") {
        // Cannot decode video without video element — draw placeholder silently
        // Throttle the warning to prevent log flood at 60fps
        const now = performance.now();
        if (now - _lastVideoWarnTime > VIDEO_WARN_INTERVAL_MS) {
          _lastVideoWarnTime = now;
          console.warn(`[Rasterizer] No video element for clip ${layer.clipId} — video pool may not have synced yet`);
        }
        drawLoadingPlaceholder(ctx, width, height);
        return;
      }

      // Only attempt fetch for images
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
    // Fallback: draw error placeholder
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(-width / 2, -height / 2, width, height);

    // Draw error border
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.strokeRect(-width / 2, -height / 2, width, height);

    // Draw error text
    ctx.save();
    ctx.fillStyle = "#ff4444";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Media decode error", 0, -10);
    ctx.font = "10px monospace";
    ctx.fillStyle = "#ff8888";
    ctx.fillText(layer.mediaType === "video" ? "Missing video element" : "Load failed", 0, 10);
    ctx.restore();

    console.error(`[Rasterizer] Failed to render media layer:`, error);
  }
}

/**
 * Draw a non-alarming loading placeholder (dark frame with spinner indicator).
 * Used when a video element exists but hasn't loaded yet, or during pool sync.
 */
function drawLoadingPlaceholder(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(-width / 2, -height / 2, width, height);
}

/**
 * Rasterize a text layer.
 *
 * CRITICAL: This is the canonical text rendering path.
 * Preview and export MUST use the same code path.
 *
 * Styled layers (styleId present) always go through engineEvaluateScene,
 * which is the authoritative pipeline for stroke-blur, glow, bevel, and
 * all post-fx. When ctx.filter is unsupported (WKWebView on macOS),
 * rendering is routed through the WebGLCompositor fallback so visual
 * output is consistent across platforms.
 *
 * Plain text layers (no styleId) use a minimal Canvas 2D path that
 * respects the same baseline alignment as the engine (fontSize * 0.82).
 */
function rasterizeTextLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: EvaluatedTextLayer, width: number, height: number, scaleX: number, scaleY: number): void {
  // ── Styled text: full engine pipeline ────────────────────────────────────
  if (layer.styleId) {
    const effectDef = useEffectsStore.getState().definitions[layer.styleId];
    if (effectDef) {
      // fontSize for rendering: scaled to match the layer's on-canvas pixel size.
      const fontSize = layer.fontSize * scaleY;

      // fontSize for _buildConfig ratio: use the AUTHORED fontSize (layer.fontSize,
      // unscaled). _buildConfig computes ratio = fontSize / 100 to proportionally
      // scale blur, spread, stroke widths, etc. relative to the studio's 100px
      // reference. If we pass the render-resolution fontSize (which can be 2-4×
      // larger on high-res canvases), all blur and spread values get multiplied by
      // that same factor — producing the blown-out glow visible in the editor vs
      // studio. The canvas dimensions (offW/offH) already encode the correct render
      // size; the engine centers text within them independently of this ratio.
      const authoredFontSize = layer.fontSize;

      const effectPadding = fontSize * 0.5;
      const offW = Math.max(1, Math.ceil(width + effectPadding * 2));
      const offH = Math.max(1, Math.ceil(height + effectPadding * 2));

      const builtCfg = _buildConfig(effectDef, layer.text, authoredFontSize, offW, offH, layer.time, layer.clipStartTime, layer.clipDuration);
      const engineConfig: TextEffectConfig = {
        ...engineDefaultConfig,
        ...builtCfg,
        // _buildConfig writes width/height (local engine keys).
        // @clypra/engine uses canvasWidth/canvasHeight for centering.
        canvasWidth: offW,
        canvasHeight: offH,
        // Override fontSize with the render-resolution value so text fills
        // the on-canvas layer bounds correctly. Effect parameters (blur,
        // spread, strokes) remain at authored scale from builtCfg above.
        fontSize,
        fontFamily: layer.fontFamily || effectDef.font?.family,
      } as TextEffectConfig;

      const sceneDoc = textEffectConfigToScene(engineConfig);

      if (!supportsCtxFilter()) {
        // WKWebView: ctx.filter is a no-op. Render to offscreen then composite
        // via WebGLCompositor which applies blur/bloom as WebGL post-fx.
        const compositor = getRasterizerCompositor();
        const offscreen = canvasPool.acquire(offW, offH);
        const offCtx = offscreen.getContext("2d", { alpha: true }) as OffscreenCanvasRenderingContext2D | null;
        if (offCtx) {
          offCtx.setTransform(1, 0, 0, 1, 0, 0);
          offCtx.clearRect(0, 0, offW, offH);
          engineEvaluateScene(sceneDoc, layer.time ?? 0, offCtx as unknown as CanvasRenderingContext2D, { skipPostFx: true });

          if (compositor) {
            // WebGL handles blur/bloom pass then blits back to a temp canvas we draw from
            const blitCanvas = document.createElement("canvas");
            blitCanvas.width = offW;
            blitCanvas.height = offH;
            const blitCtx = blitCanvas.getContext("2d")!;
            compositor.renderToContext(blitCtx, offscreen, { blur: 0, bloom: 0, bloomThreshold: 0.6 });
            ctx.drawImage(blitCanvas, 0, 0, offW, offH, -width / 2 - effectPadding, -height / 2 - effectPadding, offW, offH);
            blitCanvas.width = 0; // release backing store
          } else {
            // No WebGL — flat blit, no blur/bloom
            ctx.drawImage(offscreen, 0, 0, offW, offH, -width / 2 - effectPadding, -height / 2 - effectPadding, offW, offH);
          }
        }
        canvasPool.release(offscreen);
        return;
      }

      // ctx.filter supported — evaluate directly onto an offscreen buffer then blit
      const offscreen = canvasPool.acquire(offW, offH);
      const offCtx = offscreen.getContext("2d", { alpha: true }) as OffscreenCanvasRenderingContext2D | null;
      if (offCtx) {
        offCtx.setTransform(1, 0, 0, 1, 0, 0);
        offCtx.clearRect(0, 0, offW, offH);
        engineEvaluateScene(sceneDoc, layer.time ?? 0, offCtx as unknown as CanvasRenderingContext2D);
        ctx.drawImage(offscreen, 0, 0, offW, offH, -width / 2 - effectPadding, -height / 2 - effectPadding, offW, offH);
      }
      canvasPool.release(offscreen);
      return;
    }
    // styleId present but definition not yet in cache — silent miss, will redraw
    // once prefetchEffect resolves. Fallthrough to plain text to show something.
  }

  // ── Plain text: minimal Canvas 2D path ───────────────────────────────────
  // Baseline alignment matches the engine: textBaseline = "alphabetic",
  // startY offset = fontSize * 0.82, which is the engine's convention in
  // textLayout.ts::layoutWithFontSize.
  const fontWeight = typeof layer.fontWeight === "number" ? layer.fontWeight : layer.fontWeight === "bold" ? "700" : "400";
  const fontStyle = layer.fontStyle === "italic" ? "italic" : "normal";
  const fontSize = layer.fontSize * scaleY;
  const fontFamily = layer.fontFamily;

  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "alphabetic";

  if (layer.letterSpacing !== 0) {
    (ctx as any).letterSpacing = `${layer.letterSpacing * scaleX}px`;
  }

  const lines = wrapText(ctx, layer.text, width, fontSize, layer.lineHeight);
  const lineHeight = fontSize * layer.lineHeight;
  // Total block height: first line baseline to last line baseline + descender allowance
  const totalHeight = (lines.length - 1) * lineHeight + fontSize;

  // Vertical alignment using alphabetic baseline (engine convention: startY = top_of_block + fontSize * 0.82)
  // 0.82 approximates the cap-height-to-size ratio, matching textLayout.ts::layoutWithFontSize
  let blockTopY: number;
  switch (layer.verticalAlign) {
    case "top":
      blockTopY = -height / 2;
      break;
    case "bottom":
      blockTopY = height / 2 - totalHeight;
      break;
    case "middle":
    default:
      blockTopY = -totalHeight / 2;
      break;
  }
  const firstBaselineY = blockTopY + fontSize * 0.82;

  ctx.textAlign = layer.textAlign;
  // textBaseline stays "alphabetic" as set above

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

  // Gradient fill: only treat as multi-stop when the color contains " | " separator
  // (explicit multi-stop format). Plain CSS colors including rgba(r,g,b,a) contain
  // commas but are NOT gradient strings — the includes(",") check is insufficient.
  const colorStops = layer.color.includes(" | ") ? layer.color.split(" | ") : null;
  if (colorStops && colorStops.length >= 2) {
    const gradient = ctx.createLinearGradient(0, blockTopY, 0, blockTopY + totalHeight);
    colorStops.forEach((color, idx) => {
      gradient.addColorStop(idx / (colorStops.length - 1), color.trim());
    });
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = layer.color;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(-width / 2, -height / 2, width, height);
  ctx.clip();

  // Draw background box if specified
  if (layer.background) {
    const bgPadding = (layer.background.padding ?? 12) * scaleX;
    const bgRadius = (layer.background.borderRadius ?? 6) * scaleX;
    const maxLineWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), 10);
    const bgWidth = maxLineWidth + bgPadding * 2;
    const bgHeight = totalHeight + bgPadding * 2;

    let bgX: number;
    switch (layer.textAlign) {
      case "left":
        bgX = -width / 2 - bgPadding;
        break;
      case "right":
        bgX = width / 2 - maxLineWidth - bgPadding;
        break;
      case "center":
      default:
        bgX = -maxLineWidth / 2 - bgPadding;
        break;
    }

    const bgY = blockTopY - bgPadding;

    ctx.save();
    ctx.fillStyle = layer.background.color;
    ctx.beginPath();
    // Use manual rounded rect drawing for universal compatibility (OffscreenCanvas in older webviews)
    ctx.moveTo(bgX + bgRadius, bgY);
    ctx.lineTo(bgX + bgWidth - bgRadius, bgY);
    ctx.quadraticCurveTo(bgX + bgWidth, bgY, bgX + bgWidth, bgY + bgRadius);
    ctx.lineTo(bgX + bgWidth, bgY + bgHeight - bgRadius);
    ctx.quadraticCurveTo(bgX + bgWidth, bgY + bgHeight, bgX + bgWidth - bgRadius, bgY + bgHeight);
    ctx.lineTo(bgX + bgRadius, bgY + bgHeight);
    ctx.quadraticCurveTo(bgX, bgY + bgHeight, bgX, bgY + bgHeight - bgRadius);
    ctx.lineTo(bgX, bgY + bgRadius);
    ctx.quadraticCurveTo(bgX, bgY, bgX + bgRadius, bgY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Draw each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const y = firstBaselineY + i * lineHeight;

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
    (ctx as any).letterSpacing = "0px";
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
    mask: "source-in",
    "mask-inverted": "source-out",
    "source-in": "source-in",
    "source-out": "source-out",
    "destination-in": "destination-in",
    "destination-out": "destination-out",
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
