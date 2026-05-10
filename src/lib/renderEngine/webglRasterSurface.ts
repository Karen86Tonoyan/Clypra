/**
 * WebGL RasterSurface
 *
 * GPU-accelerated filmstrip renderer.
 * Uploads all artifact bitmaps into a single RGBA texture atlas per epoch,
 * then issues ONE drawArrays() call to render the entire strip.
 *
 * Invariants:
 *   - `NEAREST` sampling — zero browser resampling (matches Canvas2D imageSmoothingEnabled=false)
 *   - Straight alpha — no premul (matches Rust output)
 *   - Falls back to Canvas2D RasterSurface if WebGL2 is unavailable
 *
 * Factory:
 *   import { createRasterSurface } from './rasterSurface';
 *   const surface = createRasterSurface(canvasEl);
 */

import { RasterSurface, type FilmstripLayout } from "./rasterSurface";
import type { TransportArtifact } from "./transport";

// ─── Shaders ──────────────────────────────────────────────────────────────────

const VERT_SRC = /* glsl */ `#version 300 es
precision mediump float;

// Per-tile: position rect [x, y, w, h] in clip-space and UV rect [u, v, uw, uh] in atlas space
in vec4 a_posRect;   // x, y, w, h  (clip-space, -1..1)
in vec4 a_uvRect;    // u, v, uw, uh (0..1 in atlas)
in float a_tileIdx;  // which tile (for vertex expansion)

out vec2 v_uv;

void main() {
  // Expand rect into 2 triangles via vertex index (0-5 per tile)
  int vi = gl_VertexID % 6;
  // Quad corners: 0=TL, 1=TR, 2=BL, 3=TR, 4=BR, 5=BL
  float dx[6];  float dy[6];
  dx[0]=0.0; dy[0]=0.0;
  dx[1]=1.0; dy[1]=0.0;
  dx[2]=0.0; dy[2]=1.0;
  dx[3]=1.0; dy[3]=0.0;
  dx[4]=1.0; dy[4]=1.0;
  dx[5]=0.0; dy[5]=1.0;

  float cx = a_posRect.x + a_posRect.z * dx[vi];
  float cy = a_posRect.y - a_posRect.w * dy[vi]; // flip Y (clip-space +y = up)
  gl_Position = vec4(cx, cy, 0.0, 1.0);

  v_uv = vec2(
    a_uvRect.x + a_uvRect.z * dx[vi],
    a_uvRect.y + a_uvRect.w * dy[vi]
  );
}
`;

const FRAG_SRC = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D u_atlas;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  fragColor = texture(u_atlas, v_uv);
}
`;

// ─── Atlas layout ─────────────────────────────────────────────────────────────

/** Packs bitmaps into a square-ish power-of-two atlas texture. */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

interface AtlasCell {
  u: number;
  v: number;
  uw: number;
  vh: number;
}

function packAtlas(artifacts: readonly TransportArtifact[], cols: number): { atlasW: number; atlasH: number; cells: AtlasCell[] } {
  if (artifacts.length === 0) return { atlasW: 1, atlasH: 1, cells: [] };

  const cellW = artifacts[0].width;
  const cellH = artifacts[0].height;
  const rows = Math.ceil(artifacts.length / cols);
  const atlasW = nextPow2(cols * cellW);
  const atlasH = nextPow2(rows * cellH);

  const cells: AtlasCell[] = artifacts.map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      u: (col * cellW) / atlasW,
      v: (row * cellH) / atlasH,
      uw: cellW / atlasW,
      vh: cellH / atlasH,
    };
  });

  return { atlasW, atlasH, cells };
}

// ─── WebGLRasterSurface ───────────────────────────────────────────────────────

export class WebGLRasterSurface {
  private _canvas: HTMLCanvasElement;
  private _gl: WebGL2RenderingContext;
  private _program: WebGLProgram;
  private _vao: WebGLVertexArrayObject;
  private _vbo: WebGLBuffer;
  private _atlasTexture: WebGLTexture;
  private _disposed = false;

  // Attribute locations
  private _aPosRect: number;
  private _aUvRect: number;
  private _aTileIdx: number;

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this._canvas = canvas;
    this._gl = gl;

    this._program = this._compileProgram();
    this._aPosRect = gl.getAttribLocation(this._program, "a_posRect");
    this._aUvRect = gl.getAttribLocation(this._program, "a_uvRect");
    this._aTileIdx = gl.getAttribLocation(this._program, "a_tileIdx");

    this._vao = gl.createVertexArray()!;
    this._vbo = gl.createBuffer()!;
    this._atlasTexture = gl.createTexture()!;

    gl.bindTexture(gl.TEXTURE_2D, this._atlasTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ── Shader compilation ──────────────────────────────────────────────────────

  private _compileProgram(): WebGLProgram {
    const gl = this._gl;
    const vert = this._compileShader(gl.VERTEX_SHADER, VERT_SRC);
    const frag = this._compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`[WebGLRasterSurface] Link error: ${gl.getProgramInfoLog(prog)}`);
    }
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    return prog;
  }

  private _compileShader(type: number, src: string): WebGLShader {
    const gl = this._gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`[WebGLRasterSurface] Shader error: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }

  // ── Filmstrip render ────────────────────────────────────────────────────────

  drawFilmstrip(artifacts: readonly TransportArtifact[], layout: FilmstripLayout): void {
    if (this._disposed || artifacts.length === 0) {
      this._clear(layout);
      return;
    }

    const gl = this._gl;
    const { clipWidthPx, stripHeightPx, dpr, tileWidthPx: targetTileW = 60 } = layout;

    const tileCount = Math.max(1, Math.ceil(clipWidthPx / targetTileW));
    const backingW = Math.round(clipWidthPx * dpr);
    const backingH = Math.round(stripHeightPx * dpr);

    if (this._canvas.width !== backingW || this._canvas.height !== backingH) {
      this._canvas.width = backingW;
      this._canvas.height = backingH;
    }

    gl.viewport(0, 0, backingW, backingH);
    gl.clearColor(0.047, 0.153, 0.188, 1.0); // #0c2730
    gl.clear(gl.COLOR_BUFFER_BIT);

    // ── Upload atlas ────────────────────────────────────────────────────────
    const cols = Math.min(artifacts.length, 16); // max 16 per row
    const { atlasW, atlasH, cells } = packAtlas(artifacts, cols);

    gl.bindTexture(gl.TEXTURE_2D, this._atlasTexture);
    // Allocate atlas
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlasW, atlasH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    // Upload each bitmap into its atlas cell
    for (let i = 0; i < artifacts.length; i++) {
      const art = artifacts[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, col * art.width, row * art.height, gl.RGBA, gl.UNSIGNED_BYTE, art.bitmap);
    }

    // ── Build per-tile geometry ─────────────────────────────────────────────
    // 6 vertices per tile, each vertex: [posRect(4), uvRect(4), tileIdx(1)] = 9 floats
    const FLOATS_PER_VERTEX = 9;
    const VERTS_PER_TILE = 6;
    const buf = new Float32Array(tileCount * VERTS_PER_TILE * FLOATS_PER_VERTEX);

    const step = artifacts.length > 1 ? (artifacts.length - 1) / (tileCount - 1) : 0;
    const tileW_cs = 2.0 / tileCount; // clip-space tile width

    for (let i = 0; i < tileCount; i++) {
      const artIdx = Math.min(Math.round(i * step), artifacts.length - 1);
      const cell = cells[artIdx];
      const x_cs = -1.0 + i * tileW_cs; // clip-space left edge

      // Cover-fit UV crop (match RasterSurface cover-fit behaviour)
      const art = artifacts[artIdx];
      const bmpAspect = art.width / art.height;
      const tileAspect = clipWidthPx / tileCount / stripHeightPx;
      let u0 = cell.u,
        v0 = cell.v,
        uw = cell.uw,
        vh = cell.vh;
      if (bmpAspect > tileAspect) {
        const cropFraction = tileAspect / bmpAspect;
        const uOffset = (cell.uw * (1 - cropFraction)) / 2;
        u0 += uOffset;
        uw = cell.uw * cropFraction;
      } else if (bmpAspect < tileAspect) {
        const cropFraction = bmpAspect / tileAspect;
        const vOffset = (cell.vh * (1 - cropFraction)) / 2;
        v0 += vOffset;
        vh = cell.vh * cropFraction;
      }

      for (let v = 0; v < VERTS_PER_TILE; v++) {
        const off = (i * VERTS_PER_TILE + v) * FLOATS_PER_VERTEX;
        buf[off + 0] = x_cs; // posRect.x
        buf[off + 1] = 1.0; // posRect.y (top of clip-space)
        buf[off + 2] = tileW_cs; // posRect.w
        buf[off + 3] = 2.0; // posRect.h (full clip-space height)
        buf[off + 4] = u0;
        buf[off + 5] = v0;
        buf[off + 6] = uw;
        buf[off + 7] = vh;
        buf[off + 8] = i;
      }
    }

    // ── Upload VBO and draw ─────────────────────────────────────────────────
    gl.useProgram(this._program);
    gl.bindVertexArray(this._vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.DYNAMIC_DRAW);

    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(this._aPosRect);
    gl.vertexAttribPointer(this._aPosRect, 4, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this._aUvRect);
    gl.vertexAttribPointer(this._aUvRect, 4, gl.FLOAT, false, stride, 4 * 4);
    gl.enableVertexAttribArray(this._aTileIdx);
    gl.vertexAttribPointer(this._aTileIdx, 1, gl.FLOAT, false, stride, 8 * 4);

    gl.uniform1i(gl.getUniformLocation(this._program, "u_atlas"), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._atlasTexture);

    // Single draw call for ALL tiles
    gl.drawArrays(gl.TRIANGLES, 0, tileCount * VERTS_PER_TILE);

    gl.bindVertexArray(null);
  }

  drawPlaceholder(layout: FilmstripLayout): void {
    this._clear(layout);
  }

  private _clear(layout: FilmstripLayout): void {
    const gl = this._gl;
    const { clipWidthPx, stripHeightPx, dpr } = layout;
    const w = Math.round(clipWidthPx * dpr);
    const h = Math.round(stripHeightPx * dpr);
    if (this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas.width = w;
      this._canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.047, 0.153, 0.188, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    const gl = this._gl;
    gl.deleteTexture(this._atlasTexture);
    gl.deleteBuffer(this._vbo);
    gl.deleteVertexArray(this._vao);
    gl.deleteProgram(this._program);
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export type AnyRasterSurface = RasterSurface | WebGLRasterSurface;

/**
 * Create the best available raster surface for a canvas element.
 *
 * - Tries WebGL2 first (single draw call, GPU atlas upload)
 * - Falls back to Canvas2D `RasterSurface` if WebGL2 is unavailable
 *
 * ClipFilmstrip usage:
 *   surfaceRef.current = createRasterSurface(canvasRef.current);
 */
export function createRasterSurface(canvas: HTMLCanvasElement): AnyRasterSurface {
  try {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      desynchronized: true,
      antialias: false,
      powerPreference: "default",
    });
    if (gl) {
      return new WebGLRasterSurface(canvas, gl);
    }
  } catch {
    // WebGL context creation can throw in some sandboxed environments
  }
  return new RasterSurface(canvas);
}
