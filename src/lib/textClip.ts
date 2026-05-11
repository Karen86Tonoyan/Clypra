/**
 * Text Clip Creation Utilities
 *
 * Helpers for creating text clips with sensible defaults.
 */

import type { TextClip } from "../types";

export interface CreateTextClipOptions {
  /** Track ID to place the clip on */
  trackId: string;

  /** Start time on timeline */
  startTime: number;

  /** Duration in seconds */
  duration?: number;

  /** Text content */
  text?: string;

  /** Canvas dimensions for positioning */
  canvasWidth: number;
  canvasHeight: number;

  /** Font size */
  fontSize?: number;

  /** Font family */
  fontFamily?: string;

  /** Text color */
  color?: string;

  /** Bold */
  bold?: boolean;

  /** Italic */
  italic?: boolean;

  /** Position preset */
  position?: "center" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

/**
 * Create a text clip with sensible defaults.
 */
export function createTextClip(options: CreateTextClipOptions): TextClip {
  const { trackId, startTime, duration = 5.0, text = "Text", canvasWidth, canvasHeight, fontSize = 48, fontFamily = "Inter, system-ui, sans-serif", color = "#ffffff", bold = false, italic = false, position = "center" } = options;

  // Calculate position based on preset
  const { x, y, width, height } = calculateTextPosition(position, canvasWidth, canvasHeight, fontSize);

  return {
    id: `text-clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    trackId,
    mediaId: "", // Text clips don't have media assets
    startTime,
    duration,
    trimIn: 0,
    trimOut: duration,
    x,
    y,
    width,
    height,
    opacity: 1.0,
    rotation: 0,
    text,
    fontSize,
    fontFamily,
    color,
    fontWeight: bold ? "bold" : "normal",
    fontStyle: italic ? "italic" : "normal",
    align: "center",
    valign: "middle",
    lineHeight: 1.2,
    letterSpacing: 0,
    paddingX: 16,
    paddingY: 16,
  };
}

/**
 * Calculate text position based on preset.
 */
function calculateTextPosition(position: "center" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right", canvasWidth: number, canvasHeight: number, fontSize: number): { x: number; y: number; width: number; height: number } {
  const textHeight = fontSize * 2; // Approximate height for text box
  const textWidth = canvasWidth * 0.8; // 80% of canvas width
  const margin = 40; // Margin from edges

  switch (position) {
    case "center":
      return {
        x: (canvasWidth - textWidth) / 2,
        y: (canvasHeight - textHeight) / 2,
        width: textWidth,
        height: textHeight,
      };

    case "top":
      return {
        x: (canvasWidth - textWidth) / 2,
        y: margin,
        width: textWidth,
        height: textHeight,
      };

    case "bottom":
      return {
        x: (canvasWidth - textWidth) / 2,
        y: canvasHeight - textHeight - margin,
        width: textWidth,
        height: textHeight,
      };

    case "top-left":
      return {
        x: margin,
        y: margin,
        width: textWidth / 2,
        height: textHeight,
      };

    case "top-right":
      return {
        x: canvasWidth - textWidth / 2 - margin,
        y: margin,
        width: textWidth / 2,
        height: textHeight,
      };

    case "bottom-left":
      return {
        x: margin,
        y: canvasHeight - textHeight - margin,
        width: textWidth / 2,
        height: textHeight,
      };

    case "bottom-right":
      return {
        x: canvasWidth - textWidth / 2 - margin,
        y: canvasHeight - textHeight - margin,
        width: textWidth / 2,
        height: textHeight,
      };

    default:
      return {
        x: (canvasWidth - textWidth) / 2,
        y: (canvasHeight - textHeight) / 2,
        width: textWidth,
        height: textHeight,
      };
  }
}

/**
 * Text preset configurations.
 */
export const TEXT_PRESETS = {
  title: {
    fontSize: 72,
    bold: true,
    position: "center" as const,
  },
  subtitle: {
    fontSize: 48,
    bold: false,
    position: "center" as const,
  },
  lowerThird: {
    fontSize: 32,
    bold: false,
    position: "bottom-left" as const,
  },
  caption: {
    fontSize: 24,
    bold: false,
    position: "bottom" as const,
  },
  headline: {
    fontSize: 64,
    bold: true,
    position: "top" as const,
  },
  quote: {
    fontSize: 36,
    italic: true,
    position: "center" as const,
  },
} as const;
