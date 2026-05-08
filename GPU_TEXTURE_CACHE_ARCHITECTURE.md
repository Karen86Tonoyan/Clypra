# GPU Texture Cache Architecture

## Problem: CPU-Centric vs GPU-Centric

### Current Architecture (Web-App Thinking)

```
decode → RGBA → base64 → IPC → frontend → canvas → GPU upload (every render)
         ↓
    WebP encode → disk
```

**Issues:**

- GPU upload happens on **every render** (wasteful)
- Base64 encoding overhead (~33% size increase)
- IPC transfer overhead (serialization/deserialization)
- Canvas intermediate step (CPU → GPU copy)
- No GPU texture reuse
- Disk I/O on critical path

### Target Architecture (NLE Thinking)

```
decode → GPU texture (upload once)
         ↓
    texture ID → frontend (reuse forever)
         ↓
    optional: persist to disk (secondary, background)
```

**Benefits:**

- GPU upload **once**, reuse forever
- Zero encoding overhead
- Minimal IPC (just texture ID)
- Direct GPU rendering
- Disk persistence is secondary (background)

---

## Architecture Design

### Option 1: WebGL Texture Cache (Recommended for Tauri)

#### Frontend: WebGL Texture Manager

```typescript
class GPUTextureCache {
  private gl: WebGLRenderingContext;
  private textures: Map<string, WebGLTexture>;
  private textureMetadata: Map<string, TextureMetadata>;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext("webgl2")!;
    this.textures = new Map();
    this.textureMetadata = new Map();
  }

  /**
   * Upload RGBA bytes to GPU texture (once)
   * Returns texture ID for reuse
   */
  uploadTexture(key: string, rgbaBytes: Uint8Array, width: number, height: number): string {
    // Check if texture already exists
    if (this.textures.has(key)) {
      return key;
    }

    // Create WebGL texture
    const texture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

    // Upload RGBA data directly to GPU
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0, // mip level
      this.gl.RGBA, // internal format
      width,
      height,
      0, // border
      this.gl.RGBA, // format
      this.gl.UNSIGNED_BYTE, // type
      rgbaBytes, // pixel data
    );

    // Set texture parameters
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    // Store texture and metadata
    this.textures.set(key, texture);
    this.textureMetadata.set(key, {
      width,
      height,
      uploadTime: Date.now(),
      lastUsed: Date.now(),
      useCount: 0,
    });

    return key;
  }

  /**
   * Render texture to canvas (reuse, no upload)
   */
  renderTexture(key: string, x: number, y: number, width: number, height: number) {
    const texture = this.textures.get(key);
    if (!texture) {
      console.warn(`Texture ${key} not found`);
      return;
    }

    // Update metadata
    const metadata = this.textureMetadata.get(key)!;
    metadata.lastUsed = Date.now();
    metadata.useCount++;

    // Bind texture and render quad
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

    // Use shader program to render textured quad
    // (shader setup omitted for brevity)
    this.renderQuad(x, y, width, height);
  }

  /**
   * Evict least recently used textures when GPU memory is full
   */
  evictLRU(targetMemoryMB: number) {
    const currentMemoryMB = this.getMemoryUsageMB();
    if (currentMemoryMB <= targetMemoryMB) {
      return;
    }

    // Sort by last used time
    const entries = Array.from(this.textureMetadata.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    // Evict oldest textures
    for (const [key, metadata] of entries) {
      const texture = this.textures.get(key)!;
      this.gl.deleteTexture(texture);
      this.textures.delete(key);
      this.textureMetadata.delete(key);

      if (this.getMemoryUsageMB() <= targetMemoryMB) {
        break;
      }
    }
  }

  private getMemoryUsageMB(): number {
    let totalBytes = 0;
    for (const metadata of this.textureMetadata.values()) {
      // RGBA = 4 bytes per pixel
      totalBytes += metadata.width * metadata.height * 4;
    }
    return totalBytes / (1024 * 1024);
  }

  private renderQuad(x: number, y: number, width: number, height: number) {
    // Render textured quad using vertex buffer and shader
    // (implementation omitted for brevity)
  }
}
```

#### Backend: Send Raw RGBA Bytes (No Encoding)

```rust
#[tauri::command]
async fn decode_frame_gpu(
    video_path: String,
    time_secs: f64,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    // Deduplication (already implemented)
    let key = format!("{}:{}:{}x{}", video_id, timestamp_ms, width, height);
    let (tx, is_new) = IN_FLIGHT_EXTRACTIONS.get_or_create(key.clone());

    if !is_new {
        let mut rx = tx.subscribe();
        return rx.recv().await.unwrap_or_else(|_| {
            // Fall through to extraction
        });
    }

    // Decode frame
    let decoder = get_decoder(&video_path).await?;
    let rgba_bytes = {
        let mut decoder_guard = decoder.lock().await;
        decoder_guard.decode_frame(time_secs, width, height)?
    };

    // Broadcast result
    let _ = tx.send(Ok(rgba_bytes.clone()));
    IN_FLIGHT_EXTRACTIONS.remove(&key);

    // Return raw RGBA bytes (no base64, no encoding!)
    Ok(rgba_bytes)
}
```

#### Frontend: Receive and Upload to GPU

```typescript
// Receive raw RGBA bytes from backend
const rgbaBytes = await invoke<number[]>("decode_frame_gpu", {
  videoPath,
  timeSecs,
  width,
  height,
});

// Convert to Uint8Array
const rgbaArray = new Uint8Array(rgbaBytes);

// Upload to GPU texture cache (once)
const textureKey = `${videoPath}:${timeSecs}:${width}x${height}`;
gpuTextureCache.uploadTexture(textureKey, rgbaArray, width, height);

// Render texture (reuse forever, no upload)
gpuTextureCache.renderTexture(textureKey, x, y, width, height);
```

---

### Option 2: Shared GPU Memory (Advanced, Native Only)

For native desktop apps, use shared GPU memory between Rust and frontend:

#### Backend: Upload to GPU Texture

```rust
use wgpu::{Device, Queue, Texture, TextureDescriptor, TextureUsages};

struct GPUTextureCache {
    device: Arc<Device>,
    queue: Arc<Queue>,
    textures: DashMap<String, Texture>,
}

impl GPUTextureCache {
    async fn upload_texture(
        &self,
        key: String,
        rgba_bytes: &[u8],
        width: u32,
        height: u32,
    ) -> Result<u64, String> {
        // Create GPU texture
        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some(&key),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST,
            view_formats: &[],
        });

        // Upload RGBA data to GPU
        self.queue.write_texture(
            texture.as_image_copy(),
            rgba_bytes,
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(4 * width),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );

        // Store texture
        self.textures.insert(key.clone(), texture);

        // Return texture handle (can be shared with frontend)
        Ok(texture_handle)
    }
}
```

#### Frontend: Reference GPU Texture

```typescript
// Receive texture handle from backend
const textureHandle = await invoke<number>("decode_frame_gpu", {
  videoPath,
  timeSecs,
  width,
  height,
});

// Use texture handle to render (no data transfer!)
webgpuRenderer.renderTexture(textureHandle, x, y, width, height);
```

---

## Implementation Roadmap

### Phase 1: WebGL Texture Cache (Immediate)

**Effort:** 2-3 days **Impact:** 5-10× faster rendering

1. Create `GPUTextureCache` class in frontend
2. Update `decode_frame` to return raw RGBA bytes (remove base64)
3. Update `ClipFilmstrip.tsx` to use GPU texture cache
4. Implement WebGL shader for textured quad rendering
5. Add GPU memory management (LRU eviction)

**Benefits:**

- GPU upload once, reuse forever
- No base64 encoding overhead
- No canvas intermediate step
- Direct GPU rendering

### Phase 2: Shared GPU Memory (Advanced)

**Effort:** 1-2 weeks **Impact:** 10-20× faster (zero-copy)

1. Integrate `wgpu` in Rust backend
2. Create shared GPU texture pool
3. Implement texture handle sharing between Rust and frontend
4. Update frontend to use WebGPU API
5. Implement zero-copy texture rendering

**Benefits:**

- Zero-copy texture sharing
- Native GPU performance
- Unified GPU memory management
- Lower memory footprint

### Phase 3: GPU Texture Persistence (Optional)

**Effort:** 3-5 days **Impact:** Faster cold starts

1. Serialize GPU textures to disk (compressed)
2. Implement fast texture deserialization
3. Background texture persistence (non-blocking)
4. Texture cache warming on app start

**Benefits:**

- Faster cold starts (load from disk)
- Persistent GPU texture cache
- Reduced extraction on app restart

---

## Performance Comparison

### Current Architecture (CPU-Centric)

```
Timeline scrubbing (100 frames):
  decode: 100 × 10ms = 1000ms
  base64: 100 × 2ms = 200ms
  IPC: 100 × 1ms = 100ms
  canvas: 100 × 3ms = 300ms
  GPU upload: 100 × 5ms = 500ms
  Total: 2100ms
```

### Phase 1: WebGL Texture Cache

```
Timeline scrubbing (100 frames):
  First pass:
    decode: 30 × 10ms = 300ms (deduplicated)
    IPC: 30 × 1ms = 30ms
    GPU upload: 30 × 5ms = 150ms
    Total: 480ms (4.4× faster)

  Subsequent passes (texture reuse):
    GPU render: 100 × 0.1ms = 10ms
    Total: 10ms (210× faster!)
```

### Phase 2: Shared GPU Memory

```
Timeline scrubbing (100 frames):
  First pass:
    decode: 30 × 10ms = 300ms (deduplicated)
    GPU upload: 30 × 2ms = 60ms (zero-copy)
    Total: 360ms (5.8× faster)

  Subsequent passes (texture reuse):
    GPU render: 100 × 0.05ms = 5ms
    Total: 5ms (420× faster!)
```

---

## Code Changes Required

### Backend Changes

#### 1. Remove Base64 Encoding

```rust
// Before
let base64_data = BASE64.encode(&rgba_bytes);
Ok(format!("data:image/rgba;base64,{}", base64_data))

// After
Ok(rgba_bytes) // Return raw bytes
```

#### 2. Update Tauri Command Return Type

```rust
#[tauri::command]
async fn decode_frame_gpu(
    video_path: String,
    time_secs: f64,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    // ... (existing decode logic)
    Ok(rgba_bytes) // Return Vec<u8> instead of String
}
```

### Frontend Changes

#### 1. Create GPU Texture Cache

```typescript
// src/lib/gpuTextureCache.ts
export class GPUTextureCache {
  private gl: WebGL2RenderingContext;
  private textures: Map<string, WebGLTexture>;
  private program: WebGLProgram;
  private vertexBuffer: WebGLBuffer;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
    })!;

    this.textures = new Map();
    this.program = this.createShaderProgram();
    this.vertexBuffer = this.createVertexBuffer();
  }

  uploadTexture(key: string, rgbaBytes: Uint8Array, width: number, height: number): string {
    if (this.textures.has(key)) {
      return key; // Already uploaded
    }

    const texture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

    // Upload RGBA data to GPU
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, width, height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, rgbaBytes);

    // Set texture parameters
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    this.textures.set(key, texture);
    return key;
  }

  renderTexture(key: string, x: number, y: number, width: number, height: number) {
    const texture = this.textures.get(key);
    if (!texture) return;

    this.gl.useProgram(this.program);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

    // Set uniforms for position and size
    // Render textured quad
    // (shader implementation omitted)
  }

  private createShaderProgram(): WebGLProgram {
    const vertexShader = `#version 300 es
      in vec2 a_position;
      in vec2 a_texCoord;
      out vec2 v_texCoord;
      uniform mat4 u_matrix;
      
      void main() {
        gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;

    const fragmentShader = `#version 300 es
      precision highp float;
      in vec2 v_texCoord;
      out vec4 outColor;
      uniform sampler2D u_texture;
      
      void main() {
        outColor = texture(u_texture, v_texCoord);
      }
    `;

    // Compile and link shaders
    // (implementation omitted)
    return program;
  }

  private createVertexBuffer(): WebGLBuffer {
    const vertices = new Float32Array([
      // position (x, y), texCoord (u, v)
      0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1,
    ]);

    const buffer = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
    return buffer;
  }
}
```

#### 2. Update ClipFilmstrip to Use GPU Cache

```typescript
// src/components/editor/timeline/ClipFilmstrip.tsx
import { GPUTextureCache } from '@/lib/gpuTextureCache';

export function ClipFilmstrip({ clip, mediaAsset, ... }: ClipFilmstripProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuCacheRef = useRef<GPUTextureCache | null>(null);

  useEffect(() => {
    if (canvasRef.current && !gpuCacheRef.current) {
      gpuCacheRef.current = new GPUTextureCache(canvasRef.current);
    }
  }, []);

  const channel = new Channel<ThumbnailTile>();
  channel.onmessage = async (tile) => {
    if (tile.path.startsWith('data:image/rgba;base64,')) {
      // OLD: Decode RGBA data URL to canvas
      // NEW: Upload to GPU texture cache
      const rgbaBytes = await invoke<number[]>('decode_frame_gpu', {
        videoPath: mediaAsset.path,
        timeSecs: tile.time,
        width: thumbW,
        height: thumbH,
      });

      const textureKey = `${mediaAsset.path}:${tile.time}:${thumbW}x${thumbH}`;
      gpuCacheRef.current?.uploadTexture(
        textureKey,
        new Uint8Array(rgbaBytes),
        thumbW,
        thumbH
      );

      // Store texture key instead of data URL
      setFrameCache(prev => new Map(prev).set(roundMs(tile.time), textureKey));
    }
  };

  // Render using GPU texture cache
  return (
    <canvas
      ref={canvasRef}
      width={clipWidthPx}
      height={stripHeightPx}
      style={{ width: '100%', height: stripHeightPx }}
    />
  );
}
```

---

## Migration Strategy

### Step 1: Add GPU Texture Cache (Non-Breaking)

- Create `GPUTextureCache` class
- Add alongside existing canvas rendering
- Feature flag to toggle between canvas and GPU rendering

### Step 2: Update Backend (Non-Breaking)

- Add `decode_frame_gpu` command (returns `Vec<u8>`)
- Keep existing `decode_frame` command (returns base64 string)
- Frontend can choose which to use

### Step 3: Migrate Frontend (Gradual)

- Update `ClipFilmstrip` to use GPU cache
- Update `PreviewPanel` to use GPU cache
- Remove old canvas-based rendering

### Step 4: Remove Legacy Code

- Remove `decode_frame` command (base64 version)
- Remove canvas-based rendering
- Remove base64 encoding/decoding

---

## Benefits Summary

### Performance

- **5-10× faster** first render (no base64, no canvas)
- **210× faster** subsequent renders (texture reuse)
- **70% less memory** (no duplicate RGBA buffers)
- **Zero encoding overhead** (raw bytes)

### Architecture

- **GPU-centric** (matches CapCut/Premiere Pro)
- **Upload once, reuse forever** (proper NLE architecture)
- **Disk persistence secondary** (background, non-blocking)
- **Zero-copy** (Phase 2: shared GPU memory)

### User Experience

- **Instant timeline scrubbing** (texture reuse)
- **Smooth playback** (GPU rendering)
- **Lower battery usage** (less CPU work)
- **Faster app startup** (GPU texture persistence)

---

## Conclusion

The current architecture is CPU-centric (web-app thinking). To match CapCut-level performance, we need to shift to GPU-centric architecture:

**Current:** decode → encode → filesystem → frontend reload  
**Target:** decode → GPU texture (upload once, reuse forever)

Phase 1 (WebGL Texture Cache) provides immediate 5-10× performance improvement with minimal changes. Phase 2 (Shared GPU Memory) provides 10-20× improvement with zero-copy architecture.

This is the final piece to achieve professional NLE performance.
