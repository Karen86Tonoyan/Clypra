/**
 * ClipFilmstrip — Phase 3 refactor
 *
 * Pure canvas consumer. Zero orchestration logic.
 * All extraction, epoch management, and scheduling is handled by:
 *   useFilmstrip()     → requests artifacts via RenderRuntime + transport layer
 *   RasterSurface      → draws ImageBitmaps onto canvas (zero browser resampling)
 *
 * This component:
 *   - Renders a <canvas> backed by RasterSurface
 *   - Falls back to posterFrame <img> while artifacts load
 *   - Falls back to an empty div if no posterFrame available
 *   - Dims slightly during ballistic scroll (ISM hint)
 */

import { useEffect, useRef, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { cn } from '@/lib/utils';
import { InteractionState } from '../../../lib/renderEngine/types';
import { createRasterSurface, type AnyRasterSurface } from '../../../lib/renderEngine/webglRasterSurface';
import { useFilmstrip } from '../../../lib/useFilmstrip';
import { normalizePathForTauriInvoke } from '../../../lib/tauri';
import type { Clip, MediaAsset } from '../../../types';

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif)$/i;

/** Fixed visual tile width — never changes with zoom */
const TILE_WIDTH_PX = 60;

/**
 * No-op kept for test compatibility.
 */
export function clearFilmstripFrameCache(): void {}

export interface ClipFilmstripProps {
  clip: Clip;
  mediaAsset: MediaAsset;
  clipWidthPx: number;
  pixelsPerSecond: number;
  stripHeightPx?: number;
  className?: string;
}

export function ClipFilmstrip({
  clip,
  mediaAsset,
  clipWidthPx,
  pixelsPerSecond,
  stripHeightPx = 40,
  className,
}: ClipFilmstripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<AnyRasterSurface | null>(null);

  const isVideoSource = useMemo(() => {
    const path = mediaAsset.path ?? '';
    return mediaAsset.type === 'video' && path.length > 0 && !IMAGE_EXT.test(path);
  }, [mediaAsset.type, mediaAsset.path]);

  const videoPath = isVideoSource && mediaAsset.path
    ? normalizePathForTauriInvoke(mediaAsset.path)
    : '';

  // ── Filmstrip data (replaces all inline extraction orchestration) ─────────
  const { artifacts, isFallback, interactionState } = useFilmstrip({
    clipId: clip.id,
    videoPath,
    trimIn: clip.trimIn,
    trimOut: clip.trimOut,
    duration: mediaAsset.duration ?? 0,
    posterFrame: mediaAsset.posterFrame,
    enabled: isVideoSource && !!videoPath && !!mediaAsset.duration,
  });

  // ── RasterSurface lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    surfaceRef.current = createRasterSurface(canvasRef.current);
    return () => {
      surfaceRef.current?.dispose();
      surfaceRef.current = null;
    };
  }, []); // only on mount/unmount

  // ── Draw filmstrip whenever artifacts or layout changes ───────────────────
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const dpr = window.devicePixelRatio || 1;
    const layout = { clipWidthPx, stripHeightPx, dpr, tileWidthPx: TILE_WIDTH_PX };

    if (artifacts.length > 0) {
      surface.drawFilmstrip(artifacts, layout);
    } else {
      surface.drawPlaceholder(layout);
    }
  }, [artifacts, clipWidthPx, stripHeightPx]);

  // ── Dimming hint during ballistic scroll (ISM) ───────────────────────────
  const isBallistic = interactionState === InteractionState.Scrolling;
  const opacity = isBallistic ? 0.7 : 1;

  // ── Render ────────────────────────────────────────────────────────────────

  // Video filmstrip — canvas surface
  if (isVideoSource) {
    return (
      <div
        data-testid="clip-filmstrip"
        className={cn(
          'overflow-hidden rounded-[2px] border border-black/20 bg-[#0c2730]/40',
          className,
        )}
        style={{ height: stripHeightPx, width: '100%', opacity, transition: 'opacity 80ms linear' }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: '100%' }}
        />
        {/* Poster overlay while artifacts load — fades out once canvas has content */}
        {isFallback && mediaAsset.posterFrame && (
          <img
            src={
              mediaAsset.posterFrame.startsWith('data:')
                ? mediaAsset.posterFrame
                : convertFileSrc(mediaAsset.posterFrame)
            }
            alt=""
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center',
              pointerEvents: 'none',
            }}
            draggable={false}
          />
        )}
      </div>
    );
  }

  // Image asset — poster only
  if (mediaAsset.posterFrame) {
    return (
      <div
        data-testid="clip-filmstrip-fallback"
        className={cn('relative overflow-hidden rounded-[2px] border border-black/20', className)}
        style={{ height: stripHeightPx, width: '100%' }}
      >
        <img
          src={
            mediaAsset.posterFrame.startsWith('data:')
              ? mediaAsset.posterFrame
              : convertFileSrc(mediaAsset.posterFrame)
          }
          alt=""
          className="absolute inset-0 block h-full w-full object-cover select-none"
          draggable={false}
        />
      </div>
    );
  }

  // Empty placeholder
  return (
    <div
      data-testid="clip-filmstrip-empty"
      className={cn('w-full rounded-[2px] bg-[#0c2730]/60', className)}
      style={{ height: stripHeightPx }}
    />
  );
}
