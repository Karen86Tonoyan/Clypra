/**
 * RasterSurface
 *
 * Canvas2D renderer for RenderArtifacts.
 *
 * Core invariant: pixels drawn are ALWAYS from a pre-scaled ImageBitmap
 * produced by the backend pyramid. No browser-side resampling. Ever.
 *
 * The surface receives TransportArtifacts (ImageBitmap + exact pixel dims)
 * and draws them into a canvas that is sized to match the display layout.
 * `drawImage(bitmap, ...)` goes through the GPU compositor — not CSS scaling.
 *
 * Usage:
 *   const surface = new RasterSurface(canvasEl);
 *   surface.drawFilmstrip(artifacts, clipWidthPx, stripHeightPx);
 *   // On unmount:
 *   surface.dispose();
 */

import type { TransportArtifact } from './transport';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type FilmstripLayout = {
  /** Logical clip width in CSS pixels */
  clipWidthPx: number;
  /** Strip height in CSS pixels */
  stripHeightPx: number;
  /** Device pixel ratio — used to size the canvas backing store */
  dpr: number;
  /** Target tile width in CSS pixels (default 60) */
  tileWidthPx?: number;
};

// ─── RasterSurface ────────────────────────────────────────────────────────────

export class RasterSurface {
  private _canvas: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D | null;
  private _disposed = false;

  /** Open bitmaps owned by this surface — closed on dispose() */
  private _ownedBitmaps: Set<ImageBitmap> = new Set();

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d', {
      alpha: false,             // opaque — no premul alpha overhead
      desynchronized: true,    // hint: don't wait for vsync for offscreen paint
    });
  }

  // ── Layout ──────────────────────────────────────────────────────────────────

  private _applyLayout(layout: FilmstripLayout): void {
    const { clipWidthPx, stripHeightPx, dpr } = layout;
    const backingW = Math.round(clipWidthPx * dpr);
    const backingH = Math.round(stripHeightPx * dpr);

    if (this._canvas.width !== backingW || this._canvas.height !== backingH) {
      this._canvas.width = backingW;
      this._canvas.height = backingH;
      // Reset CSS size to logical pixels (canvas sizing clears it)
      this._canvas.style.width  = `${clipWidthPx}px`;
      this._canvas.style.height = `${stripHeightPx}px`;
    }
  }

  // ── Filmstrip Render ─────────────────────────────────────────────────────────

  /**
   * Draw a filmstrip from an ordered array of TransportArtifacts.
   *
   * Artifacts should be sorted by timestamp (ascending).
   * Tile count is driven by clipWidthPx / tileWidthPx — never by artifact count.
   * Artifacts are sampled (nearest-neighbour in time) to fill tile slots.
   *
   * Zero browser resampling: drawImage() maps bitmap pixels to canvas pixels
   * via the GPU compositor. Canvas backing store is DPR-scaled so 1 canvas
   * pixel = 1 physical pixel.
   */
  drawFilmstrip(
    artifacts: readonly TransportArtifact[],
    layout: FilmstripLayout,
  ): void {
    if (this._disposed || !this._ctx) return;
    if (artifacts.length === 0) {
      this._clear(layout);
      return;
    }

    this._applyLayout(layout);

    const ctx = this._ctx;
    const { clipWidthPx, stripHeightPx, dpr, tileWidthPx: targetTileW = 60 } = layout;

    const backingW = this._canvas.width;
    const backingH = this._canvas.height;

    // Scale context so all coordinates are in CSS pixels (DPR handled by backing store)
    ctx.save();
    ctx.scale(dpr, dpr);

    // Clear with background
    ctx.fillStyle = '#0c2730';
    ctx.fillRect(0, 0, clipWidthPx, stripHeightPx);

    // Tile layout
    const tileCount = Math.max(1, Math.ceil(clipWidthPx / targetTileW));
    const tileW = clipWidthPx / tileCount;

    // Sample artifacts for each tile slot (nearest-neighbour in time index)
    const step = artifacts.length > 1 ? (artifacts.length - 1) / (tileCount - 1) : 0;

    for (let i = 0; i < tileCount; i++) {
      const idx = Math.min(Math.round(i * step), artifacts.length - 1);
      const art = artifacts[idx];
      const x = i * tileW;

      this._drawTile(ctx, art.bitmap, art.width, art.height, x, 0, tileW, stripHeightPx);
    }

    ctx.restore();

    // Overlay: subtle gradient at left/right edges to soften tile boundaries
    this._drawEdgeFade(ctx, backingW, backingH);
  }

  /**
   * Draw a single tile — cover-fit the bitmap into the tile rect.
   * No CSS scaling involved; all math is done in canvas coordinates.
   */
  private _drawTile(
    ctx: CanvasRenderingContext2D,
    bitmap: ImageBitmap,
    bmpW: number,
    bmpH: number,
    x: number,
    y: number,
    tileW: number,
    tileH: number,
  ): void {
    if (bmpW === 0 || bmpH === 0 || tileW === 0 || tileH === 0) return;

    // Cover-fit: scale the bitmap so it fills the tile, centred
    const bmpAspect = bmpW / bmpH;
    const tileAspect = tileW / tileH;

    let sx = 0, sy = 0, sw = bmpW, sh = bmpH;

    if (bmpAspect > tileAspect) {
      // Bitmap wider than tile — crop horizontally
      sw = Math.round(bmpH * tileAspect);
      sx = Math.round((bmpW - sw) / 2);
    } else {
      // Bitmap taller than tile — crop vertically
      sh = Math.round(bmpW / tileAspect);
      sy = Math.round((bmpH - sh) / 2);
    }

    ctx.imageSmoothingEnabled = false; // pixel-exact — no browser resampling
    ctx.drawImage(bitmap, sx, sy, sw, sh, x, y, tileW, tileH);
  }

  /** Draw a single poster frame filling the entire strip. */
  drawPoster(bitmap: ImageBitmap, layout: FilmstripLayout): void {
    if (this._disposed || !this._ctx) return;
    this._applyLayout(layout);

    const ctx = this._ctx;
    const { clipWidthPx, stripHeightPx, dpr } = layout;

    ctx.save();
    ctx.scale(dpr, dpr);
    this._drawTile(ctx, bitmap, bitmap.width, bitmap.height, 0, 0, clipWidthPx, stripHeightPx);
    ctx.restore();
  }

  /** Draw a placeholder (waiting for decode). */
  drawPlaceholder(layout: FilmstripLayout): void {
    if (this._disposed || !this._ctx) return;
    this._applyLayout(layout);
    this._clear(layout);
  }

  // ── Edge Fade ────────────────────────────────────────────────────────────────

  private _drawEdgeFade(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): void {
    const fadeW = Math.min(6, w * 0.05);

    const left = ctx.createLinearGradient(0, 0, fadeW, 0);
    left.addColorStop(0, 'rgba(0,0,0,0.35)');
    left.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, fadeW, h);

    const right = ctx.createLinearGradient(w - fadeW, 0, w, 0);
    right.addColorStop(0, 'rgba(0,0,0,0)');
    right.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = right;
    ctx.fillRect(w - fadeW, 0, fadeW, h);
  }

  private _clear(layout: FilmstripLayout): void {
    if (!this._ctx) return;
    this._applyLayout(layout);
    this._ctx.fillStyle = '#0c2730';
    this._ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);
  }

  // ── Bitmap Ownership ─────────────────────────────────────────────────────────

  /**
   * Take ownership of a bitmap — it will be closed when `dispose()` is called.
   * Only call this for bitmaps the caller doesn't intend to reuse.
   */
  own(bitmap: ImageBitmap): void {
    this._ownedBitmaps.add(bitmap);
  }

  /** Release ownership of a bitmap (caller takes back responsibility). */
  release(bitmap: ImageBitmap): void {
    this._ownedBitmaps.delete(bitmap);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const bmp of this._ownedBitmaps) bmp.close();
    this._ownedBitmaps.clear();
    this._ctx = null;
  }

  get isDisposed(): boolean { return this._disposed; }
}
