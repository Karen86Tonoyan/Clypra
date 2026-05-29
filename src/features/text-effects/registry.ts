/**
 * Clypra Text Effect Registry
 *
 * The single source of truth for all registered text effects.
 *
 * ─── How to add a new effect ──────────────────────────────────────────────────
 *
 *  1. Paste the studio-generated file into src/features/text-effects/effects/
 *  2. Add exactly two lines at the bottom of the "REGISTERED EFFECTS" section:
 *
 *       import { MyEffectEngine, MyEffectDefinition } from "./effects/MyEffect";
 *       register(MyEffectDefinition, MyEffectEngine);
 *
 *  That's it. The renderer, allTextEffects, and everything else update automatically.
 *
 * ─── Studio known issue ───────────────────────────────────────────────────────
 *  If the generated drawFrame references an undefined `className` variable, remove
 *  or guard that block. This is a bug in the studio generator, not in your code.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { TextEffectDefinition } from "./types/types";
import { resolveFontFamilyName } from "./lib/helpers";


// ─── Internal registry state ──────────────────────────────────────────────────

type EffectConfig = Record<string, unknown> & { width: number; height: number; text: string };
type EngineInstance = { drawFrame(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, ghostFrames?: ImageData[]): void };
type EffectEngineClass = new (config: EffectConfig) => EngineInstance;

const _engines = new Map<string, EffectEngineClass>();
const _definitions: TextEffectDefinition[] = [];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register an effect. Call once per effect — see the header for the two-line pattern.
 */
export function register(definition: TextEffectDefinition, Engine: EffectEngineClass): void {
  _engines.set(definition.id, Engine);
  _definitions.push(definition);
}

/**
 * All registered effect definitions — replaces the old allEffects / allTextEffects export.
 * The array is mutated by register() at module init time, so all imports see the full list.
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
 */
export function renderRegisteredEffect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, effect: TextEffectDefinition, text: string, fontSize: number, canvasWidth: number, canvasHeight: number): void {
  const Engine = _engines.get(effect.id);
  if (!Engine) return;
  const config = _buildConfig(effect, text, fontSize, canvasWidth, canvasHeight);
  new Engine(config).drawFrame(ctx);
}

// ─── Generic TextEffectDefinition → flat engine config bridge ─────────────────
// All studio-generated engines share the same flat config shape (SolarisInkConfig-style).
// This function maps the structured definition once, so individual engine classes
// never need a fromDefinition method.
export function _buildConfig(effect: TextEffectDefinition, text: string, fontSize: number, canvasWidth: number, canvasHeight: number): EffectConfig {
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

    // Font — resolve to exact Fontsource name (bare, no quotes — engines quote it themselves)
    fontFamily: resolveFontFamilyName(effect.font.family),
    fontWeight: effect.font.weight,
    fontStyle: effect.font.style,
    fontSize,
    letterSpacing: effect.font.letterSpacing,
    lineHeight: effect.font.lineHeight,
  };

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

  // 2. Auto-forward unrecognized Top-Level keys (e.g. isGlitchEffect, decaySpeed)
  const standardKeys = new Set(["id", "name", "category", "description", "tags", "font", "fills", "strokes", "shadows", "glows", "bevel", "panel"]);
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

// ─── REGISTERED EFFECTS ───────────────────────────────────────────────────────
// Add new effects below. Pattern per effect:
//   import { MyEngine, MyDefinition } from "./effects/MyEffect";
//   register(MyDefinition, MyEngine);
// ─────────────────────────────────────────────────────────────────────────────

// SolarisInk
import { SolarisInkEngine, SolarisInkDefinition } from "./effects/SolarisInk";
register(SolarisInkDefinition, SolarisInkEngine);

// BiolumeTrench
import { BiolumeTrenchEngine, BiolumeTrenchDefinition } from "./effects/BiolumeTrench";
register(BiolumeTrenchDefinition, BiolumeTrenchEngine);

// BitDecay
import { BitDecayEngine, BitDecayDefinition } from "./effects/BitDecay";
register(BitDecayDefinition, BitDecayEngine);

// NeonCrimson
import { NeonCrimsonEngine, NeonCrimsonDefinition } from "./effects/NeonCrimson";
register(NeonCrimsonDefinition, NeonCrimsonEngine);

// VoltSector
import { VoltSectorEngine, VoltSectorDefinition } from "./effects/VoltSector";
register(VoltSectorDefinition, VoltSectorEngine);

// MintGlacé
import { MintGlacéEngine, MintGlacéDefinition } from "./effects/MintGlacé";
register(MintGlacéDefinition, MintGlacéEngine);

// LiquidObsidianPlasmaChrome
import { LiquidObsidianPlasmaChromeEngine, LiquidObsidianPlasmaChromeDefinition } from "./effects/LiquidObsidianPlasmaChrome";
register(LiquidObsidianPlasmaChromeDefinition, LiquidObsidianPlasmaChromeEngine);

import { VibrantComicExplosionEngine, VibrantComicExplosionDefinition } from "./effects/VibrantComicExplosion";
register(VibrantComicExplosionDefinition, VibrantComicExplosionEngine);

import { NeonCyberStickerEngine, NeonCyberStickerDefinition } from "./effects/NeonCyberSticker";
register(NeonCyberStickerDefinition, NeonCyberStickerEngine);

import { GlossyYellowBubbleGelEngine, GlossyYellowBubbleGelDefinition } from "./effects/GlossyYellowBubbleGel";
register(GlossyYellowBubbleGelDefinition, GlossyYellowBubbleGelEngine);

import { RetroComicEngine, RetroComicDefinition } from "./effects/RetroComic";
register(RetroComicDefinition, RetroComicEngine);

import { EditorialVellumEngine, EditorialVellumDefinition } from "./effects/EditorialVellum";
register(EditorialVellumDefinition, EditorialVellumEngine);

import { CarbonShiftEngine, CarbonShiftDefinition } from "./effects/CarbonShift";
register(CarbonShiftDefinition, CarbonShiftEngine);

import { StealthContourEngine, StealthContourDefinition } from "./effects/StealthContour";
register(StealthContourDefinition, StealthContourEngine);

import { ToxBrimEngine, ToxBrimDefinition } from "./effects/ToxBrim";
register(ToxBrimDefinition, ToxBrimEngine);

import { VoltKineticChalkStrokeEngine, VoltKineticChalkStrokeDefinition } from "./effects/VoltKineticChalkStroke";
register(VoltKineticChalkStrokeDefinition, VoltKineticChalkStrokeEngine);

import { InfraredDriftNoiseGlowEngine, InfraredDriftNoiseGlowDefinition } from "./effects/InfraredDriftNoiseGlow";
register(InfraredDriftNoiseGlowDefinition, InfraredDriftNoiseGlowEngine);

import { CrimsonKineticHalftoneGlowEngine, CrimsonKineticHalftoneGlowDefinition } from "./effects/CrimsonKineticHalftoneGlow";
register(CrimsonKineticHalftoneGlowDefinition, CrimsonKineticHalftoneGlowEngine);

import { CrimsonNeueSolidShadowEngine, CrimsonNeueSolidShadowDefinition } from "./effects/CrimsonNeueSolidShadow";
register(CrimsonNeueSolidShadowDefinition, CrimsonNeueSolidShadowEngine);

import { StarkContourEmptyStrokeEngine, StarkContourEmptyStrokeDefinition } from "./effects/StarkContourEmptyStroke";
register(StarkContourEmptyStrokeDefinition, StarkContourEmptyStrokeEngine);

import { InfraContourAestheticEngine, InfraContourAestheticDefinition } from "./effects/InfraContourAesthetic";
register(InfraContourAestheticDefinition, InfraContourAestheticEngine);

import { LumenBrimVividGradientEngine, LumenBrimVividGradientDefinition } from "./effects/LumenBrimVividGradient";
register(LumenBrimVividGradientDefinition, LumenBrimVividGradientEngine);

import { SolarisShiftClassicSolidBevelEngine, SolarisShiftClassicSolidBevelDefinition } from "./effects/SolarisShiftClassicSolidBevel";
register(SolarisShiftClassicSolidBevelDefinition, SolarisShiftClassicSolidBevelEngine);

import { AmberPunchVividGradientBevelEngine, AmberPunchVividGradientBevelDefinition } from "./effects/AmberPunchVividGradientBevel";
register(AmberPunchVividGradientBevelDefinition, AmberPunchVividGradientBevelEngine);
