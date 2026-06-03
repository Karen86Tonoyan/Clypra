import React, { useRef, useEffect, useCallback } from "react";
import { LottiePlayer } from "@/features/text-templates/LottiePlayer";
import { renderTextEffectToContext } from "@/features/text-effects/renderer";
import { getFontLoader } from "@/core/fonts/FontLoader";
import type { EffectFullDefinition } from "@/features/text-effects/types/types";

// Effects are designed for this banner canvas size (800×200).
// Using the engine's canonical defaults keeps preview ↔ export consistent.
const PREVIEW_CANVAS_W = 800;
const PREVIEW_CANVAS_H = 200;

interface TextSourcePreviewProps {
  preset: (EffectFullDefinition & { presetType?: "effect" | "template" }) | null;
}

/**
 * Source-mode preview for text effects and Lottie templates.
 *
 * Effect rendering:
 *  - Uses renderTextEffectToContext (full @clypra/engine pipeline)
 *  - Drives a rAF animation loop for animated effects
 *  - Cancels the loop cleanly on unmount or preset change
 *  - Pre-loads the effect's font before the first draw
 *  - Canvas is sized to the effect's native dimensions (800×200 default)
 *
 * Template rendering:
 *  - Delegates to LottiePlayer
 */
export const TextSourcePreview: React.FC<TextSourcePreviewProps> = ({ preset }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const mountedRef = useRef(true);

  // Keep a ref to the latest preset so the rAF closure always sees it
  // without needing to be recreated on every render.
  const presetRef = useRef(preset);
  presetRef.current = preset;

  const isTemplate = preset?.presetType === "template" || !!(preset as any)?.lottieData;
  const effectDefinition = !isTemplate && preset?.font ? preset : null;

  // Stable canvas ref callback
  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    // React 19 refs are mutable by default — assign directly
    (canvasRef as { current: HTMLCanvasElement | null }).current = node;
    if (node) {
      node.width = PREVIEW_CANVAS_W;
      node.height = PREVIEW_CANVAS_H;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !effectDefinition) return;

    // Cancel any previous animation loop
    cancelAnimationFrame(rafRef.current);

    let aborted = false;

    const effectDef = effectDefinition;
    const previewText = (preset as any)?.text || (preset as any)?.defaultText || "CLYPRA";
    const fontSize = 80; // matches DEFAULT_FONT_SIZE — fills 800×200 correctly

    const durationSec = (effectDef.durationMs ?? 2000) / 1000;
    const hasAnimation = !!effectDef.animation && effectDef.animation.type !== "none";

    async function start() {
      // 1. Pre-load the effect's font so the first frame is correct
      if (effectDef.font?.family) {
        try {
          await getFontLoader().ensureFont({
            family: effectDef.font.family,
            weight: effectDef.font.weight,
            style: effectDef.font.style,
          });
        } catch {
          // Font failed — proceed with fallback; still render rather than blank
        }
      }

      if (typeof document !== "undefined" && document.fonts) {
        await document.fonts.ready;
      }

      if (aborted || !mountedRef.current) return;

      const ctx = canvas!.getContext("2d");
      if (!ctx) return;

      if (hasAnimation) {
        // ── Animated: rAF loop ──────────────────────────────────────
        const startTime = performance.now();

        const loop = (now: number) => {
          if (aborted || !mountedRef.current) return;

          const elapsed = (now - startTime) / 1000;
          const loopTime = durationSec > 0 ? elapsed % durationSec : elapsed;

          ctx.clearRect(0, 0, PREVIEW_CANVAS_W, PREVIEW_CANVAS_H);
          renderTextEffectToContext(ctx, previewText, effectDef, fontSize, PREVIEW_CANVAS_W / 2, PREVIEW_CANVAS_H / 2, PREVIEW_CANVAS_W, PREVIEW_CANVAS_H, loopTime, 0, durationSec);

          rafRef.current = requestAnimationFrame(loop);
        };

        rafRef.current = requestAnimationFrame(loop);
      } else {
        // ── Static: single draw ─────────────────────────────────────
        ctx.clearRect(0, 0, PREVIEW_CANVAS_W, PREVIEW_CANVAS_H);
        renderTextEffectToContext(ctx, previewText, effectDef, fontSize, PREVIEW_CANVAS_W / 2, PREVIEW_CANVAS_H / 2, PREVIEW_CANVAS_W, PREVIEW_CANVAS_H);
      }
    }

    start();

    return () => {
      aborted = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [effectDefinition, (preset as any)?.text, preset?.name]);

  if (!preset) return null;

  // ── Lottie template ──────────────────────────────────────────────────────
  if (isTemplate) {
    return (
      <div className="w-full aspect-video bg-black flex items-center justify-center relative p-8 shadow-[0_0_40px_rgba(0,0,0,0.8)] border border-white/5 overflow-hidden">
        <LottiePlayer lottieData={(preset as any).injectedData || (preset as any).lottieData} autoplay={true} loop={true} className="w-full h-full object-contain" />
      </div>
    );
  }

  // ── Canvas effect ────────────────────────────────────────────────────────
  // Aspect ratio matches the canvas: 800×200 = 4:1
  return (
    <div className="w-full flex items-center justify-center relative overflow-hidden checkerboard" style={{ aspectRatio: `${PREVIEW_CANVAS_W} / ${PREVIEW_CANVAS_H}` }}>
      <canvas ref={setCanvasRef} className="w-full h-full block select-none pointer-events-none" />
    </div>
  );
};
