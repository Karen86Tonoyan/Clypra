/**
 * Clypra Text Effect Registry
 *
 * The single source of truth for all registered text effects.
 *
 * ─── How to add a new effect ──────────────────────────────────────────────────
 *
 *  1. Paste the studio-generated file into src/features/text-effects/effects/
 *  2. Add exactly one line at the bottom of the "REGISTERED EFFECTS" section:
 *
 *       import { MyEffectEngine } from "./effects/MyEffect";
 *       register("my-effect-id", MyEffectEngine);
 *
 *  That's it. The renderer and everything else update automatically.
 *  Effect definitions are now fetched dynamically from the API.
 *
 * ─── Studio known issue ───────────────────────────────────────────────────────
 *  If the generated drawFrame references an undefined `className` variable, remove
 *  or guard that block. This is a bug in the studio generator, not in your code.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { TextEffectDefinition } from "./types/types";
import { resolveFontFamilyName, wrapText } from "./lib/helpers";

// ─── Internal registry state ──────────────────────────────────────────────────

type EffectConfig = Record<string, unknown> & { width: number; height: number; text: string };
type EngineInstance = { drawFrame(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, ghostFrames?: ImageData[]): void };
type EffectEngineClass = new (config: EffectConfig) => EngineInstance;

const _engines = new Map<string, EffectEngineClass>();
const _definitions: TextEffectDefinition[] = []; // Empty - definitions now fetched from API

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register an effect engine by ID.
 * Definitions are fetched dynamically from the API; only engines are registered locally.
 */
export function register(id: string, Engine: EffectEngineClass): void {
  _engines.set(id, Engine);
}

/**
 * All registered effect definitions.
 * @deprecated This array is now empty. Use effectsStore to fetch definitions from the API.
 */
export const allTextEffects: TextEffectDefinition[] = _definitions;

/** @deprecated use allTextEffects */
export const allEffects = allTextEffects;

/**
 * Returns true when a registered engine exists for the given effect id.
 */
export function hasRegisteredEngine(id: string): boolean {
  return _engines.has(id);
}

/**
 * Renders a registered effect to any 2D canvas context.
 * Internally maps TextEffectDefinition → flat engine config and calls drawFrame.
 * The effect definition must be provided (typically fetched from the API).
 */
export function renderRegisteredEffect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: TextEffectDefinition, text: string, fontSize: number, canvasWidth: number, canvasHeight: number, time?: number, clipStartTime?: number, clipDuration?: number): void {
  const Engine = _engines.get(effect.id);
  if (!Engine) return;

  // Dynamic Bounding Box Word-Wrapping: Wrap sentences to fit canvasWidth * 0.8 boundary!
  ctx.save();
  ctx.font = `${effect.font?.style || "normal"} ${effect.font?.weight || "bold"} ${fontSize}px "${resolveFontFamilyName(effect.font?.family || "Arial")}"`;
  if (typeof (ctx as any).letterSpacing !== "undefined") {
    (ctx as any).letterSpacing = `${effect.font?.letterSpacing || 0}px`;
  }
  const maxWidth = canvasWidth * 0.8;
  const rawLines = text.split("\n");
  const wrappedLines: string[] = [];
  rawLines.forEach((rl) => {
    wrappedLines.push(...wrapText(ctx, rl, maxWidth));
  });
  ctx.restore();
  const wrappedText = wrappedLines.join("\n");

  const config = _buildConfig(effect, wrappedText, fontSize, canvasWidth, canvasHeight, time, clipStartTime, clipDuration);
  new Engine(config).drawFrame(ctx);
}

// ─── Generic TextEffectDefinition → flat engine config bridge ─────────────────
// All studio-generated engines share the same flat config shape (SolarisInkConfig-style).
// This function maps the structured definition once, so individual engine classes
// never need a fromDefinition method.
export function _buildConfig(effect: TextEffectDefinition, text: string, fontSize: number, canvasWidth: number, canvasHeight: number, time?: number, clipStartTime?: number, clipDuration?: number): EffectConfig {
  const fill = effect.fills?.[0];
  const stroke = effect.strokes?.[0];
  const shadow = effect.shadows?.[0];
  const bevel = effect.bevel;
  const panel = effect.panel;

  // Font size ratio for proportional scaling (based on 100px studio reference)
  const ratio = fontSize / 100;

  // 1. Build the base standard configuration
  const config: any = {
    // Canvas / text
    width: canvasWidth,
    height: canvasHeight,
    text,
    time: time ?? 0,
    clipStartTime: clipStartTime ?? 0,
    clipDuration: clipDuration ?? 5.0,

    // Font — resolve to exact Fontsource name (bare, no quotes — engines quote it themselves)
    fontFamily: resolveFontFamilyName(effect.font.family),
    fontWeight: effect.font.weight,
    fontStyle: effect.font.style,
    fontSize,
    letterSpacing: effect.font.letterSpacing,
    lineHeight: effect.font.lineHeight,
  };

  if (effect.animation) {
    config.animation = effect.animation;
  }

  // Fill — default to "none" when no fills are defined (not "solid")
  if (fill) {
    if (fill.type !== undefined) config.fillType = fill.type;
    if (fill.color !== undefined) config.fillColor = fill.color;
    if (fill.gradient?.angle !== undefined) config.fillGradientAngle = fill.gradient.angle;
    if (fill.gradient?.stops !== undefined) config.fillGradientStops = fill.gradient.stops;
  } else {
    config.fillType = "none";
  }

  // Stroke — only include optional properties when they are explicitly defined on the stroke object
  config.strokeEnabled = !!stroke;
  if (stroke) {
    if (stroke.color !== undefined) config.strokeColor = stroke.color;
    if (stroke.width !== undefined) config.strokeWidth = stroke.width * ratio;
    if (stroke.position !== undefined) config.strokePosition = stroke.position;
    if (stroke.opacity !== undefined) config.strokeOpacity = stroke.opacity;
    if (stroke.lineJoin !== undefined) config.strokeLineJoin = stroke.lineJoin;
  }

  // Drop / inner shadow — only include optional properties when they are explicitly defined on the shadow object
  config.shadowEnabled = !!shadow && shadow.type === "drop";
  if (shadow) {
    if (shadow.color !== undefined) config.shadowColor = shadow.color;
    if (shadow.blur !== undefined) config.shadowBlur = shadow.blur * ratio;
    if (shadow.offsetX !== undefined) config.shadowOffsetX = shadow.offsetX * ratio;
    if (shadow.offsetY !== undefined) config.shadowOffsetY = shadow.offsetY * ratio;
    if (shadow.opacity !== undefined) config.shadowOpacity = shadow.opacity;
    if (shadow.type !== undefined) config.shadowType = shadow.type;
  }

  // Bevel — only include optional properties when they are explicitly defined on the bevel object
  config.bevelEnabled = !!bevel;
  if (bevel) {
    if (bevel.depth !== undefined) config.bevelDepth = Math.round(bevel.depth * ratio);
    if (bevel.highlightColor !== undefined) config.bevelHighlight = bevel.highlightColor;
    if (bevel.shadowColor !== undefined) config.bevelShadow = bevel.shadowColor;
    if (bevel.direction !== undefined) config.bevelDirection = bevel.direction;
  }

  // Panel / background — only include optional properties when they are explicitly defined on the panel object
  config.panelEnabled = !!panel;
  if (panel) {
    if (panel.color !== undefined) config.panelColor = panel.color;
    if (panel.opacity !== undefined) config.panelOpacity = panel.opacity;
    if (panel.radius !== undefined) config.panelRadius = panel.radius;
    if (panel.paddingX !== undefined) config.panelPaddingX = panel.paddingX * ratio;
    if (panel.paddingY !== undefined) config.panelPaddingY = panel.paddingY * ratio;
    if (panel.stroke !== undefined) {
      config.panelStrokeEnabled = !!panel.stroke;
      if (panel.stroke.color !== undefined) config.panelStrokeColor = panel.stroke.color;
      if (panel.stroke.width !== undefined) config.panelStrokeWidth = panel.stroke.width * ratio;
    }
  }

  // Glow layers — proportionally scale blur and spread based on font size ratio
  if (effect.glows) {
    config.glowLayers = effect.glows.map((g: Record<string, unknown>) => {
      const mappedGlow: any = {
        enabled: true,
        color: g.color,
        blur: typeof g.blur === "number" ? g.blur * ratio : (g.blur ?? 0),
        opacity: g.opacity,
        type: (g.type ?? "outer") as "inner" | "outer",
      };
      if (g.strength !== undefined) mappedGlow.strength = g.strength;
      if (g.spread !== undefined) mappedGlow.spread = (g.spread as number) * ratio;
      return mappedGlow;
    });
  }

  // Auto-forward unrecognised top-level keys (e.g. isGlitchEffect, decaySpeed).
  // Keys handled explicitly above are excluded to avoid double-assignment.
  const standardKeys = new Set([
    "id",
    "name",
    "category",
    "description",
    "tags",
    "font",
    "fills",
    "strokes",
    "shadows",
    "glows",
    "bevel",
    "panel",
    "text",
    "animation", // handled explicitly above
  ]);
  for (const key of Object.keys(effect)) {
    if (!standardKeys.has(key)) {
      config[key] = (effect as any)[key];
    }
  }

  // 3. Dynamic Sub-Object Flattening: Pass through custom/future variables inside nested elements
  if (fill && typeof fill === "object") {
    const knownFillKeys = new Set(["type", "color", "gradient"]);
    for (const key of Object.keys(fill)) {
      if (!knownFillKeys.has(key)) {
        config[key] = fill[key];
      }
    }
  }

  if (stroke && typeof stroke === "object") {
    const knownStrokeKeys = new Set(["color", "width", "position", "opacity", "lineJoin"]);
    for (const key of Object.keys(stroke)) {
      if (!knownStrokeKeys.has(key)) {
        config[key] = stroke[key];
      }
    }
  }

  if (shadow && typeof shadow === "object") {
    const knownShadowKeys = new Set(["color", "blur", "offsetX", "offsetY", "opacity", "type"]);
    for (const key of Object.keys(shadow)) {
      if (!knownShadowKeys.has(key)) {
        config[key] = shadow[key];
      }
    }
  }

  if (bevel && typeof bevel === "object") {
    const knownBevelKeys = new Set(["depth", "highlightColor", "shadowColor", "direction"]);
    for (const key of Object.keys(bevel)) {
      if (!knownBevelKeys.has(key)) {
        config[key] = bevel[key];
      }
    }
  }

  if (panel && typeof panel === "object") {
    const knownPanelKeys = new Set(["color", "opacity", "radius", "paddingX", "paddingY", "stroke"]);
    for (const key of Object.keys(panel)) {
      if (!knownPanelKeys.has(key)) {
        config[key] = panel[key];
      }
    }
  }

  return config;
}
