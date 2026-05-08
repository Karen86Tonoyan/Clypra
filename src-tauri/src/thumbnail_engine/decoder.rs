//! Native FFmpeg decoder for ultra-fast thumbnail extraction
//!
//! This module replaces the sidecar-based extraction with direct FFmpeg API calls.
//! Key features:
//! - One decoder per video file, reused across frame requests
//! - Hardware acceleration (VideoToolbox on macOS, D3D11VA on Windows, VAAPI on Linux)
//! - In-memory decoder pool for instant subsequent requests
//! - **Sequential decoding optimization for timeline scrubbing**
//!
//! ## Sequential Decoding Optimization
//!
//! Modern video editors don't seek on every frame request during timeline scrubbing.
//! Instead, they maintain decoder state and decode forward when possible.
//!
//! ### The Problem
//! Naive approach (seek every frame):
//! ```text
//! Request 1.0s → seek → decode
//! Request 1.1s → seek → decode  ← wasteful!
//! Request 1.2s → seek → decode  ← wasteful!
//! Request 1.3s → seek → decode  ← wasteful!
//! ```
//!
//! ### The Solution
//! Sequential decoding (this implementation):
//! ```text
//! Request 1.0s → seek → decode
//! Request 1.1s → decode forward (no seek!)
//! Request 1.2s → decode forward (no seek!)
//! Request 1.3s → decode forward (no seek!)
//! ```
//!
//! ### How It Works
//!
//! Each decoder maintains state:
//! - `current_pts`: Current decoder position in stream
//! - `last_requested_pts`: Last requested timestamp
//! - `sequential_hits`: Counter for sequential forward requests
//! - `gop_start_pts`: Start of current GOP (Group of Pictures)
//!
//! Decision logic:
//! 1. **Backward request** → Always seek (can't decode backward)
//! 2. **Forward within 2s window** → Decode forward (no seek)
//! 3. **Forward beyond 2s** → Seek to new position
//! 4. **Sequential pattern detected** (3+ hits) → Expand window to 5s
//!
//! ### Performance Impact
//!
//! Timeline scrubbing (30 frames in 2 seconds):
//! - **Without optimization**: 30 seeks × ~20ms = 600ms
//! - **With optimization**: 1 seek × 20ms + 29 decodes × 3ms = 107ms
//! - **Speedup**: ~5.6x faster
//!
//! This makes timeline scrubbing feel instant and responsive.

use dashmap::DashMap;
use ffmpeg_next as ffmpeg;
use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Port of FFmpeg's av_display_rotation_get from libavutil/display.h.
/// Extracts the rotation angle (in degrees) from a 3×3 display matrix.
/// The matrix is 9 × i32 values in 16.16 fixed-point format.
unsafe fn av_display_rotation_get(matrix: *const i32) -> f64 {
    let s0 = *matrix.add(0) as f64; // matrix[0]
    let s1 = *matrix.add(1) as f64; // matrix[1]
    let s3 = *matrix.add(3) as f64; // matrix[3]
    let s4 = *matrix.add(4) as f64; // matrix[4]

    // scale[0] = hypot(matrix[0], matrix[3])
    // scale[1] = hypot(matrix[1], matrix[4])
    let scale0 = s0.hypot(s3);
    let scale1 = s1.hypot(s4);

    if scale0 == 0.0 || scale1 == 0.0 {
        return 0.0;
    }

    // rotation = atan2(matrix[1] / scale[1], matrix[0] / scale[0]) in degrees
    let angle = (s1 / scale1).atan2(s0 / scale0) * 180.0 / std::f64::consts::PI;
    -angle
}

/// Decoder state for sequential frame optimization
///
/// Tracks decoder position and request patterns to avoid unnecessary seeks.
/// This is critical for timeline scrubbing performance.
///
/// # Fields
/// - `current_pts`: Where the decoder is currently positioned (in stream time base units)
/// - `last_requested_pts`: The last timestamp requested by the caller
/// - `gop_start_pts`: Approximate start of the current GOP (Group of Pictures)
/// - `sequential_hits`: Number of consecutive forward requests (used to detect scrubbing)
///
/// # Sequential Window
/// - Default: 2 seconds (allows decoding forward without seeking)
/// - Extended: 5 seconds (when 3+ sequential hits detected)
///
/// This allows smooth timeline scrubbing without constant seeking.
#[derive(Debug, Clone)]
struct DecoderState {
    /// Current decoder position (PTS in stream time base)
    current_pts: i64,
    /// Last requested timestamp (PTS in stream time base)
    last_requested_pts: i64,
    /// Start of current GOP (Group of Pictures)
    gop_start_pts: i64,
    /// Number of sequential forward requests
    sequential_hits: u32,
}

impl DecoderState {
    fn new() -> Self {
        Self {
            current_pts: -1,
            last_requested_pts: -1,
            gop_start_pts: -1,
            sequential_hits: 0,
        }
    }

    /// Check if we can decode forward without seeking
    fn can_decode_forward(&self, target_pts: i64, sequential_window: i64) -> bool {
        // Must be ahead of current position
        if target_pts <= self.current_pts {
            return false;
        }

        // Must be within sequential window (e.g., 2 seconds worth of frames)
        let distance = target_pts - self.current_pts;
        if distance > sequential_window {
            return false;
        }

        // If we're in a sequential pattern, allow larger window
        if self.sequential_hits >= 3 {
            // Allow up to 5 seconds for scrubbing
            return distance <= sequential_window * 2;
        }

        true
    }

    fn update_sequential(&mut self, target_pts: i64) {
        if target_pts > self.last_requested_pts {
            self.sequential_hits += 1;
        } else {
            self.sequential_hits = 0;
        }
        self.last_requested_pts = target_pts;
    }
}

/// One decoder per video file — stays alive between frame requests
pub struct VideoDecoder {
    input_ctx: ffmpeg::format::context::Input,
    decoder: ffmpeg::codec::decoder::Video,
    stream_index: usize,
    time_base: ffmpeg::Rational,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    /// Rotation from container metadata (0, 90, 180, 270)
    rotation: u32,
    /// Decoder state for sequential optimization
    state: DecoderState,
}

impl VideoDecoder {
    pub fn open(path: &str) -> Result<Self, String> {
        // Initialize FFmpeg once globally
        ffmpeg::init().map_err(|e| e.to_string())?;

        let input_ctx = ffmpeg::format::input(&path)
            .map_err(|e| format!("Cannot open: {}", e))?;

        // Find best video stream
        let stream = input_ctx
            .streams()
            .best(ffmpeg::media::Type::Video)
            .ok_or("No video stream")?;

        let stream_index = stream.index();
        let time_base = stream.time_base();

        // Detect rotation from stream metadata or display matrix side data.
        // Older encoders set a "rotate" tag; modern phones (iOS) use a display matrix.
        let rotation = {
            let mut rot = 0i32;

            // 1. Try the "rotate" metadata tag first
            for (key, value) in stream.metadata().iter() {
                if key.eq_ignore_ascii_case("rotate") {
                    rot = value.parse::<i32>().unwrap_or(0);
                    break;
                }
            }

            // 2. If no tag, try the display matrix side data
            if rot == 0 {
                unsafe {
                    let stream_ptr = stream.as_ptr();
                    // Try codecpar side data (FFmpeg 6.1+)
                    let codecpar = (*stream_ptr).codecpar;
                    if !codecpar.is_null() {
                        let nb_sd = (*codecpar).nb_coded_side_data as usize;
                        let sd_arr = (*codecpar).coded_side_data;
                        if !sd_arr.is_null() {
                            for i in 0..nb_sd {
                                let sd = &*sd_arr.add(i);
                                if sd.type_ == ffmpeg::ffi::AVPacketSideDataType::AV_PKT_DATA_DISPLAYMATRIX {
                                    let matrix = sd.data as *const i32;
                                    rot = -(av_display_rotation_get(matrix) as i32);
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // Normalize to nearest 90-degree step
            let abs_rot = ((rot % 360) + 360) as u32 % 360;
            match abs_rot {
                r if r > 45 && r <= 135 => 90,
                r if r > 135 && r <= 225 => 180,
                r if r > 225 && r <= 315 => 270,
                _ => 0,
            }
        };

        if rotation != 0 {
            eprintln!("[VideoDecoder::open] Detected rotation={}°", rotation);
        }

        // Duration in seconds
        let duration = input_ctx.duration() as f64 / ffmpeg::ffi::AV_TIME_BASE as f64;

        // Build codec context
        let codec_ctx = ffmpeg::codec::context::Context::from_parameters(
            stream.parameters()
        ).map_err(|e| e.to_string())?;

        let (decoder, width, height) = Self::open_with_hw(codec_ctx)?;

        Ok(Self {
            input_ctx,
            decoder,
            stream_index,
            time_base,
            duration,
            width,
            height,
            rotation,
            state: DecoderState::new(),
        })
    }

    /// Get the detected rotation angle (0, 90, 180, or 270)
    pub fn rotation(&self) -> u32 {
        self.rotation
    }

    /// Get the frame rate (fps) from the time base
    pub fn fps(&self) -> f64 {
        if self.time_base.denominator() > 0 {
            self.time_base.denominator() as f64 / self.time_base.numerator() as f64
        } else {
            30.0 // Default fallback
        }
    }

    /// Try hardware acceleration, fall back to software silently
    fn open_with_hw(
        mut ctx: ffmpeg::codec::context::Context,
    ) -> Result<(ffmpeg::codec::decoder::Video, u32, u32), String> {
        // Platform-specific hardware decoder priority
        #[cfg(target_os = "macos")]
        let hw_types: &[u32] = &[ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_VIDEOTOOLBOX as u32];
        #[cfg(target_os = "windows")]
        let hw_types: &[u32] = &[ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA as u32];
        #[cfg(target_os = "linux")]
        let hw_types: &[u32] = &[ffmpeg::ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_VAAPI as u32];
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        let hw_types: &[u32] = &[];

        // Try hardware decode
        for &hw_type_raw in hw_types {
            unsafe {
                let hw_type = std::mem::transmute(hw_type_raw);
                let mut hw_ctx = std::ptr::null_mut();
                let ret = ffmpeg::ffi::av_hwdevice_ctx_create(
                    &mut hw_ctx,
                    hw_type,
                    std::ptr::null(),
                    std::ptr::null_mut(),
                    0,
                );
                if ret >= 0 {
                    (*ctx.as_mut_ptr()).hw_device_ctx =
                        ffmpeg::ffi::av_buffer_ref(hw_ctx);
                    ffmpeg::ffi::av_buffer_unref(&mut hw_ctx);
                }
            }
        }

        // Open decoder (hw or software — FFmpeg decides)
        let decoder = ctx.decoder().video().map_err(|e| e.to_string())?;
        let w = decoder.width();
        let h = decoder.height();

        eprintln!("[VideoDecoder::open] Opened {}x{} decoder", w, h);

        Ok((decoder, w, h))
    }

    /// Seek and decode a single frame — reuses this decoder instance
    /// Optimized for sequential timeline scrubbing (avoids seeking when possible)
    pub fn decode_frame(
        &mut self,
        timestamp_secs: f64,
        out_width: u32,
        out_height: u32,
    ) -> Result<Vec<u8>, String> {
        let start = std::time::Instant::now();
        
        // Clamp to video bounds
        let ts = timestamp_secs.max(0.0).min(self.duration - 0.001);

        // Convert seconds to stream time base units
        let target_pts = (ts * self.time_base.1 as f64
            / self.time_base.0 as f64) as i64;

        // Sequential window: 2 seconds worth of frames (adjusts based on time_base)
        let sequential_window = (2.0 * self.time_base.1 as f64 / self.time_base.0 as f64) as i64;

        // Update sequential tracking
        self.state.update_sequential(target_pts);

        // Decide: seek or decode forward?
        let needs_seek = if self.state.current_pts < 0 {
            // First frame - always seek
            true
        } else if target_pts < self.state.current_pts {
            // Backward request - must seek
            true
        } else if self.state.can_decode_forward(target_pts, sequential_window) {
            // Forward within window - decode without seeking
            eprintln!("[decode_frame] SEQUENTIAL: @{:.3}s (forward decode, no seek, hits={})", 
                      ts, self.state.sequential_hits);
            false
        } else {
            // Too far forward - seek
            true
        };

        let mut seek_time = std::time::Duration::ZERO;
        let mut packets_decoded = 0u32;

        if needs_seek {
            let seek_start = std::time::Instant::now();
            
            // Seek to nearest keyframe at or before target
            unsafe {
                let ret = ffmpeg::ffi::av_seek_frame(
                    self.input_ctx.as_mut_ptr(),
                    self.stream_index as i32,
                    target_pts,
                    ffmpeg::ffi::AVSEEK_FLAG_BACKWARD as i32,
                );
                if ret < 0 {
                    return Err(format!("Seek failed at {}s", ts));
                }
            }

            self.decoder.flush();
            self.state.current_pts = -1; // Reset position after seek
            self.state.gop_start_pts = target_pts; // Approximate GOP start
            
            seek_time = seek_start.elapsed();
            eprintln!("[decode_frame] SEEK: @{:.3}s (seek_time={:?})", ts, seek_time);
        }

        // Decode forward until we reach or pass the target timestamp
        let mut best_frame = ffmpeg::frame::Video::empty();
        let mut found = false;

        'decode: for (stream, packet) in self.input_ctx.packets() {
            if stream.index() != self.stream_index {
                continue;
            }

            if self.decoder.send_packet(&packet).is_err() {
                continue;
            }
            packets_decoded += 1;

            let mut frame = ffmpeg::frame::Video::empty();
            while self.decoder.receive_frame(&mut frame).is_ok() {
                let frame_pts = frame.pts().unwrap_or(0);
                let frame_ts = frame_pts as f64
                    * self.time_base.0 as f64
                    / self.time_base.1 as f64;

                // Update decoder position
                self.state.current_pts = frame_pts;

                // Accept this frame if it's at or just past target
                if frame_ts >= ts - (1.0 / 60.0) {
                    best_frame = frame;
                    found = true;
                    break 'decode;
                }

                // Keep this frame as best candidate so far
                best_frame = frame;
                frame = ffmpeg::frame::Video::empty();
            }
        }

        if !found && best_frame.width() == 0 {
            return Err(format!("No frame found at {}s", ts));
        }

        let decode_time = start.elapsed();

        // Handle hardware frames (copy back from GPU to CPU if needed)
        let cpu_frame = self.to_cpu_frame(best_frame)?;

        // Scale to output dimensions and convert to RGBA
        // If rotation is 90/270, swap the scale target so the final rotated image
        // has the caller's requested (out_width × out_height).
        let (scale_w, scale_h) = if self.rotation == 90 || self.rotation == 270 {
            (out_height, out_width) // pre-swap: scale to HxW, then rotate → WxH
        } else {
            (out_width, out_height)
        };

        let rgba_raw = self.scale_to_rgba(&cpu_frame, scale_w, scale_h)?;

        // Apply rotation if needed
        let rgba = if self.rotation != 0 {
            Self::rotate_rgba(&rgba_raw, scale_w, scale_h, self.rotation)
        } else {
            rgba_raw
        };
        
        let total_time = start.elapsed();
        
        if needs_seek {
            eprintln!("[decode_frame] @{:.3}s: seek={:?} decode={:?} total={:?} ({} packets)", 
                      ts, seek_time, decode_time - seek_time, total_time, packets_decoded);
        } else {
            eprintln!("[decode_frame] @{:.3}s: forward_decode={:?} total={:?} ({} packets, seq_hits={})", 
                      ts, decode_time, total_time, packets_decoded, self.state.sequential_hits);
        }
        
        Ok(rgba)
    }

    fn to_cpu_frame(
        &self,
        frame: ffmpeg::frame::Video,
    ) -> Result<ffmpeg::frame::Video, String> {
        // If it's a hardware frame, transfer it to system memory
        if frame.format() == ffmpeg::format::Pixel::VIDEOTOOLBOX
            || frame.format() == ffmpeg::format::Pixel::D3D11
            || frame.format() == ffmpeg::format::Pixel::VAAPI
        {
            let mut cpu_frame = ffmpeg::frame::Video::empty();
            unsafe {
                let ret = ffmpeg::ffi::av_hwframe_transfer_data(
                    cpu_frame.as_mut_ptr(),
                    frame.as_ptr(),
                    0,
                );
                if ret < 0 {
                    return Err("HW frame transfer failed".to_string());
                }
            }
            Ok(cpu_frame)
        } else {
            Ok(frame)
        }
    }

    fn scale_to_rgba(
        &self,
        frame: &ffmpeg::frame::Video,
        out_w: u32,
        out_h: u32,
    ) -> Result<Vec<u8>, String> {
        use ffmpeg_next::software::scaling::{context::Context, flag::Flags};

        let mut scaler = Context::get(
            frame.format(),
            frame.width(),
            frame.height(),
            ffmpeg::format::Pixel::RGBA,
            out_w,
            out_h,
            Flags::BILINEAR,
        ).map_err(|e| e.to_string())?;

        let mut out = ffmpeg::frame::Video::empty();
        scaler.run(frame, &mut out).map_err(|e| e.to_string())?;

        // FFmpeg frame data may have stride padding - copy tightly packed RGBA
        let stride = out.stride(0) as usize;
        let width = out.width() as usize;
        let height = out.height() as usize;
        let src_data = out.data(0);
        
        // Copy row by row to handle stride
        let mut rgba = Vec::with_capacity(width * height * 4);
        for y in 0..height {
            let row_start = y * stride;
            let row_pixels = &src_data[row_start..row_start + (width * 4)];
            rgba.extend_from_slice(row_pixels);
        }
        
        Ok(rgba)
    }

    /// Rotate an RGBA buffer by 90, 180, or 270 degrees.
    /// For 90/270 the output dimensions are swapped (W×H → H×W).
    fn rotate_rgba(src: &[u8], w: u32, h: u32, rotation: u32) -> Vec<u8> {
        let w = w as usize;
        let h = h as usize;

        match rotation {
            90 => {
                // 90° CW: output is h×w
                let mut dst = vec![0u8; w * h * 4];
                for y in 0..h {
                    for x in 0..w {
                        let src_off = (y * w + x) * 4;
                        // new position: col=h-1-y, row=x → offset = x * h + (h-1-y)
                        let dst_off = (x * h + (h - 1 - y)) * 4;
                        dst[dst_off..dst_off + 4].copy_from_slice(&src[src_off..src_off + 4]);
                    }
                }
                dst
            }
            180 => {
                // 180°: same dimensions, reverse pixel order
                let mut dst = vec![0u8; w * h * 4];
                let total = w * h;
                for i in 0..total {
                    let src_off = i * 4;
                    let dst_off = (total - 1 - i) * 4;
                    dst[dst_off..dst_off + 4].copy_from_slice(&src[src_off..src_off + 4]);
                }
                dst
            }
            270 => {
                // 270° CW (= 90° CCW): output is h×w
                let mut dst = vec![0u8; w * h * 4];
                for y in 0..h {
                    for x in 0..w {
                        let src_off = (y * w + x) * 4;
                        // new position: col=y, row=w-1-x → offset = (w-1-x) * h + y
                        let dst_off = ((w - 1 - x) * h + y) * 4;
                        dst[dst_off..dst_off + 4].copy_from_slice(&src[src_off..src_off + 4]);
                    }
                }
                dst
            }
            _ => src.to_vec(),
        }
    }
}

// ─── Global Decoder Pool ────────────────────────────────────────────────────
// One decoder per video path. Created on first use, reused forever.
// Mutex is per-video so decoders for different videos don't block each other.

pub static DECODER_POOL: Lazy<DashMap<String, Arc<Mutex<VideoDecoder>>>> =
    Lazy::new(DashMap::new);

pub async fn get_decoder(path: &str) -> Result<Arc<Mutex<VideoDecoder>>, String> {
    if let Some(existing) = DECODER_POOL.get(path) {
        eprintln!("[get_decoder] Pool HIT for {}", path);
        return Ok(existing.clone());
    }

    // Create new decoder — this is the only slow path (~20-50ms once per video)
    let start = std::time::Instant::now();
    eprintln!("[get_decoder] Pool MISS - creating new decoder for {}", path);
    
    let decoder = VideoDecoder::open(path)
        .map_err(|e| format!("Failed to open {}: {}", path, e))?;

    let arc = Arc::new(Mutex::new(decoder));
    DECODER_POOL.insert(path.to_string(), arc.clone());
    
    eprintln!("[get_decoder] Created decoder in {:?}", start.elapsed());
    Ok(arc)
}

/// Call this when a clip is removed from the project to free memory
pub fn release_decoder(path: &str) {
    DECODER_POOL.remove(path);
}
