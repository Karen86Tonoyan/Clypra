import { applyFontConfig } from "./lib/helpers";
import { TextEffectDefinition } from "./types/types";
import { hasRegisteredEngine, renderRegisteredEffect } from "./registry";

/**
 * Core Canvas 2D Text Effects Rendering Context Engine.
 * Renders full text layers onto any rendering context.
 *
 * Effect dispatch is driven entirely by the registry — no per-effect if-blocks here.
 * To add a new effect: drop its file in effects/ and add two lines to registry.ts.
 */
export const renderTextEffectToContext = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, effect: TextEffectDefinition, fontSize: number, _x: number, _y: number, canvasWidth: number, canvasHeight: number) => {
  // Registry dispatch — covers all studio-generated engine effects.
  // Registered engines set their own ctx.font and expect default textBaseline ("alphabetic").
  // Do NOT call applyFontConfig here — it sets textBaseline = "middle" which breaks
  // the engines' vertical centering math (fontSize * 0.8 offset assumes "alphabetic").
  if (hasRegisteredEngine(effect?.id)) {
    renderRegisteredEffect(ctx, effect, text, fontSize, canvasWidth, canvasHeight);
    return;
  }

  // Apply baseline font config only for the fallback generic renderer
  applyFontConfig(ctx, effect.font, fontSize);

  // ── Fallback generic renderer ────────────────────────────────────────────
  // Reached only for effects that are not registered in the registry.
  const lines = text.split("\n");
  const lineHeightPx = fontSize * effect.font.lineHeight;
  let textWidth = 0;
  lines.forEach((line) => {
    textWidth = Math.max(textWidth, ctx.measureText(line).width);
  });
  void lineHeightPx;
  void textWidth;
};

/**
 * Core Canvas 2D Text Effects Rendering Engine.
 * Renders full text layers in premium NLE composition order.
 * @param canvas - The HTMLCanvasElement to render onto.
 * @param text - The text string, supporting newlines.
 * @param effect - The text effect definition block.
 * @param fontSize - Master font size in pixels.
 */
export const renderTextEffect = (canvas: HTMLCanvasElement, text: string, effect: TextEffectDefinition, fontSize: number) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  console.log("RENDER TEXT: ", effect);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderTextEffectToContext(ctx, text, effect, fontSize, canvas.width / 2, canvas.height / 2, canvas.width, canvas.height);
};

/**
 * Renders the full text effect on a configurable offscreen canvas and returns a high-resolution export PNG data URL.
 * @param text - The text string.
 * @param effect - The text effect definition block.
 * @param fontSize - Master font size in pixels.
 * @param width - Canvas export width in px (default: 800).
 * @param height - Canvas export height in px (default: 400).
 * @returns A base64 PNG data URL string.
 */
export const renderTextEffectToDataURL = (text: string, effect: TextEffectDefinition, fontSize: number, width: number = 800, height: number = 400): string => {
  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;

  renderTextEffect(offscreen, text, effect, fontSize);
  return offscreen.toDataURL("image/png");
};
