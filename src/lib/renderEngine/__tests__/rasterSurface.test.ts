/**
 * rasterSurface.test.ts — Canvas2D RasterSurface tests
 *
 * Tests cover:
 *   - Placeholder render when no artifacts
 *   - Cover-fit crop math (wide bitmap vs tall bitmap vs square)
 *   - DPR scaling of canvas backing store
 *   - N tile sampling from M≠N artifacts
 *   - Bitmap ownership + dispose()
 *   - Idempotent dispose
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RasterSurface, type FilmstripLayout } from '../rasterSurface';
import type { TransportArtifact } from '../transport';
import type { RenderEpochId } from '../types';
import { SpatialTier } from '../types';

/** Cast a plain string to the branded RenderEpochId type (test helper only). */
const eid = (s: string) => s as RenderEpochId;

// ─── Canvas stub ──────────────────────────────────────────────────────────────

function makeCanvas() {
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  const createLinearGradient = vi.fn(() => ({
    addColorStop: vi.fn(),
  }));

  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    fillRect,
    drawImage,
    createLinearGradient,
    imageSmoothingEnabled: true,
    fillStyle: '',
  };

  const canvas = {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext: vi.fn(() => ctx),
  };

  return { canvas: canvas as unknown as HTMLCanvasElement, ctx, drawImage, fillRect };
}

// ─── Artifact stub ────────────────────────────────────────────────────────────

function makeArtifact(
  timestampMs: number,
  width = 80,
  height = 45,
): TransportArtifact {
  return {
    frameId: `f-${timestampMs}`,
    contentHash: `h-${timestampMs}`,
    spatialTier: SpatialTier.L0,
    bitmap: { width, height, close: vi.fn() } as unknown as ImageBitmap,
    width,
    height,
    timestampMs,
    epochId: eid('epoch-1'),
    source: 'fresh-decode',
  };
}

function layout(overrides: Partial<FilmstripLayout> = {}): FilmstripLayout {
  return {
    clipWidthPx: 300,
    stripHeightPx: 40,
    dpr: 1,
    tileWidthPx: 60,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RasterSurface', () => {
  it('draws placeholder (fillRect) when no artifacts provided', () => {
    const { canvas, fillRect } = makeCanvas();
    const surface = new RasterSurface(canvas);
    surface.drawFilmstrip([], layout());
    expect(fillRect).toHaveBeenCalled();
    surface.dispose();
  });

  it('sets canvas backing store to clipWidthPx × dpr', () => {
    const { canvas } = makeCanvas();
    const surface = new RasterSurface(canvas);
    surface.drawPlaceholder(layout({ clipWidthPx: 240, stripHeightPx: 40, dpr: 2 }));
    expect(canvas.width).toBe(480);   // 240 × 2
    expect(canvas.height).toBe(80);   // 40 × 2
    surface.dispose();
  });

  it('draws N tiles when N artifacts are provided', () => {
    const { canvas, drawImage } = makeCanvas();
    const surface = new RasterSurface(canvas);
    const artifacts = [1000, 2000, 3000, 4000, 5000].map(t => makeArtifact(t));
    // 5 tiles at 60px each = 300px clip
    surface.drawFilmstrip(artifacts, layout({ clipWidthPx: 300, tileWidthPx: 60 }));
    expect(drawImage).toHaveBeenCalledTimes(5);
    surface.dispose();
  });

  it('samples M artifacts to fill N tiles (M < N)', () => {
    const { canvas, drawImage } = makeCanvas();
    const surface = new RasterSurface(canvas);
    // 2 artifacts, but 5 tile slots → sampling repeats artifacts
    const artifacts = [1000, 2000].map(t => makeArtifact(t));
    surface.drawFilmstrip(artifacts, layout({ clipWidthPx: 300, tileWidthPx: 60 }));
    // Still 5 drawImage calls (one per tile slot)
    expect(drawImage).toHaveBeenCalledTimes(5);
    surface.dispose();
  });

  it('does not call drawImage after dispose', () => {
    const { canvas, drawImage } = makeCanvas();
    const surface = new RasterSurface(canvas);
    surface.dispose();
    surface.drawFilmstrip([makeArtifact(1000)], layout());
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('dispose() is idempotent', () => {
    const { canvas } = makeCanvas();
    const surface = new RasterSurface(canvas);
    expect(() => {
      surface.dispose();
      surface.dispose(); // second call must not throw
    }).not.toThrow();
  });

  it('isDisposed returns true after dispose', () => {
    const { canvas } = makeCanvas();
    const surface = new RasterSurface(canvas);
    expect(surface.isDisposed).toBe(false);
    surface.dispose();
    expect(surface.isDisposed).toBe(true);
  });

  it('dispose() closes owned bitmaps', () => {
    const { canvas } = makeCanvas();
    const surface = new RasterSurface(canvas);
    const bitmap = { width: 80, height: 45, close: vi.fn() } as unknown as ImageBitmap;
    surface.own(bitmap);
    surface.dispose();
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('release() prevents bitmap close on dispose', () => {
    const { canvas } = makeCanvas();
    const surface = new RasterSurface(canvas);
    const bitmap = { width: 80, height: 45, close: vi.fn() } as unknown as ImageBitmap;
    surface.own(bitmap);
    surface.release(bitmap); // caller takes back ownership
    surface.dispose();
    expect(bitmap.close).not.toHaveBeenCalled();
  });

  it('imageSmoothingEnabled is false during drawTile', () => {
    const { canvas, ctx } = makeCanvas();
    const surface = new RasterSurface(canvas);
    surface.drawFilmstrip([makeArtifact(1000)], layout({ clipWidthPx: 60 }));
    // After drawTile, imageSmoothingEnabled should have been set to false
    expect(ctx.imageSmoothingEnabled).toBe(false);
    surface.dispose();
  });

  describe('cover-fit crop math', () => {
    it('crops horizontally when bitmap is wider than tile', () => {
      const { canvas, drawImage } = makeCanvas();
      const surface = new RasterSurface(canvas);
      // Bitmap 160×45 (aspect ~3.6), tile 60×40 (aspect 1.5) → wide bitmap → horizontal crop
      const artifact = makeArtifact(1000, 160, 45);
      surface.drawFilmstrip([artifact], layout({ clipWidthPx: 60, tileWidthPx: 60 }));
      const [, sx, , sw] = drawImage.mock.calls[0] as number[];
      // Source x should be > 0 (cropped from center)
      expect(sx).toBeGreaterThan(0);
      // Source width should be < bitmap width
      expect(sw).toBeLessThan(160);
      surface.dispose();
    });

    it('crops vertically when bitmap is taller than tile', () => {
      const { canvas, drawImage } = makeCanvas();
      const surface = new RasterSurface(canvas);
      // Bitmap 80×160 (aspect 0.5), tile 60×40 (aspect 1.5) → tall bitmap → vertical crop
      const artifact = makeArtifact(1000, 80, 160);
      surface.drawFilmstrip([artifact], layout({ clipWidthPx: 60, tileWidthPx: 60 }));
      const [, , sy, , sh] = drawImage.mock.calls[0] as number[];
      expect(sy).toBeGreaterThan(0);
      expect(sh).toBeLessThan(160);
      surface.dispose();
    });
  });
});
