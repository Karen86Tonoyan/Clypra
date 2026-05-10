use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use dashmap::DashMap;
use once_cell::sync::Lazy;
use tauri::Manager;
use tokio::sync::broadcast;

pub mod thumbnail_engine;
use std::sync::Arc;
use thumbnail_engine::decoder::{get_decoder, release_decoder};
use thumbnail_engine::pyramid::RawRgbaFrame;
use thumbnail_engine::{
    canonical_timestamp, clear_video_thumbnail_cache, downsample_pyramid, get_cache_stats,
    init_thumbnail_engine, tier_inflight_key, ArtifactSource, DensityLevel, FrameContentHash,
    RenderArtifact, SpatialTier, ThumbnailTile, TierCacheKey, FRAME_CACHE, IN_FLIGHT_TIER,
    TIER_CACHE,
};

/// Calculate fitted dimensions preserving aspect ratio within a max box.
fn fit_dimensions(src_w: u32, src_h: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    let src_ratio = src_w as f32 / src_h as f32;
    let box_ratio = max_w as f32 / max_h as f32;

    if src_ratio > box_ratio {
        let w = max_w;
        let h = ((max_w as f32) / src_ratio).round() as u32;
        (w, h.max(1))
    } else {
        let h = max_h;
        let w = ((max_h as f32) * src_ratio).round() as u32;
        (w.max(1), h)
    }
}

/// In-flight extraction deduplication for fast scrubbing.
/// Shares results across duplicate requests to reduce workload by 70%+.
type InFlightKey = String;
type InFlightResult = Result<Vec<u8>, String>;

struct InFlightMap {
    map: DashMap<InFlightKey, broadcast::Sender<InFlightResult>>,
}

impl InFlightMap {
    fn new() -> Self {
        Self {
            map: DashMap::new(),
        }
    }

    fn get_or_create(&self, key: String) -> (broadcast::Sender<InFlightResult>, bool) {
        if let Some(entry) = self.map.get(&key) {
            (entry.value().clone(), false)
        } else {
            let (tx, _rx) = broadcast::channel(1);
            self.map.insert(key.clone(), tx.clone());
            (tx, true)
        }
    }

    fn remove(&self, key: &str) {
        self.map.remove(key);
    }
}

static IN_FLIGHT_EXTRACTIONS: Lazy<InFlightMap> = Lazy::new(InFlightMap::new);

#[cfg(test)]
mod thumbnail_engine_tests;

#[cfg(test)]
mod thumbnail_engine_proptest;

pub mod commands;
pub mod models;

#[tauri::command]
async fn init_thumbnail_cache(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Initialize cache directory
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to get cache dir: {}", e))?;
    init_thumbnail_engine(cache_dir).await
}

#[tauri::command]
fn get_thumbnail_cache_stats() -> serde_json::Value {
    get_cache_stats()
}

#[tauri::command]
async fn clear_thumbnail_cache(video_path: String) {
    clear_video_thumbnail_cache(&video_path).await;
}

/// Extract poster frame at 10% mark using native decoder.
#[tauri::command]
async fn extract_poster_frame_command(
    video_path: String,
    duration: f64,
    dpr: f64,
) -> Result<String, String> {
    use image::codecs::webp::WebPEncoder;
    use thumbnail_engine::decoder::get_decoder;

    // Calculate poster frame time (10% of duration, or 0.5s for short clips)
    let poster_time = if duration < 1.0 { 0.5 } else { duration * 0.1 };

    // Target max dimension for longest edge
    let max_size: u32 = if dpr >= 1.5 { 320 } else { 160 };

    let decoder_arc = get_decoder(&video_path).await?;
    let (rgba_bytes, out_w, out_h) = {
        let mut decoder = decoder_arc.lock().await;

        // Get TRUE display dimensions (respects SAR + rotation)
        let (display_w, display_h) = decoder.display_dimensions();

        // Fit display dimensions to max_size (preserving aspect ratio)
        let (fit_w, fit_h) = fit_dimensions(display_w, display_h, max_size, max_size);

        eprintln!(
            "[extract_poster] pixels={}×{} SAR={}:{} rot={} display={}×{} target={}×{}",
            decoder.width(),
            decoder.height(),
            decoder.sar().0,
            decoder.sar().1,
            decoder.rotation(),
            display_w,
            display_h,
            fit_w,
            fit_h
        );

        // decode_frame will: decode → rotate → scale to target
        let bytes = decoder.decode_frame(poster_time, fit_w, fit_h)?;
        (bytes, fit_w, fit_h)
    };

    // Encode RGBA to WebP
    let mut webp_data = Vec::new();
    let encoder = WebPEncoder::new_lossless(&mut webp_data);
    encoder
        .encode(&rgba_bytes, out_w, out_h, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("WebP encode failed: {}", e))?;

    // Convert to base64 data URL
    let base64_data = BASE64.encode(&webp_data);
    Ok(format!("data:image/webp;base64,{}", base64_data))
}

// ─── Native FFmpeg Decoder Commands ─────────────────────────────────────────
// Fast path for thumbnail extraction using ffmpeg-next (no sidecar overhead)

use thumbnail_engine::{ResolutionTier, GLOBAL_CACHE};

async fn save_rgba_as_webp(
    rgba_bytes: &[u8],
    width: u32,
    height: u32,
    cache_path: &std::path::Path,
) -> Result<(), String> {
    use image::codecs::webp::WebPEncoder;
    let start = std::time::Instant::now();

    // Encode RGBA to WebP
    let mut webp_data = Vec::new();
    let encoder = WebPEncoder::new_lossless(&mut webp_data);
    encoder
        .encode(rgba_bytes, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("WebP encoding failed: {}", e))?;
    let encode_time = start.elapsed();

    // Ensure parent directory exists
    if let Some(parent) = cache_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create cache directory: {}", e))?;
    }

    // Write to file
    tokio::fs::write(cache_path, &webp_data)
        .await
        .map_err(|e| format!("Failed to write WebP file: {}", e))?;

    eprintln!(
        "[save_rgba_as_webp] Encoded {}x{} → {} bytes in {:?} (file: {:?})",
        width,
        height,
        webp_data.len(),
        encode_time,
        cache_path.file_name().unwrap_or_default()
    );

    Ok(())
}

fn encode_rgba_to_webp_data_url(
    rgba_bytes: &[u8],
    width: u32,
    height: u32,
) -> Result<String, String> {
    use image::codecs::webp::WebPEncoder;

    // Encode RGBA to WebP
    let mut webp_data = Vec::new();
    let encoder = WebPEncoder::new_lossless(&mut webp_data);
    encoder
        .encode(rgba_bytes, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("WebP encoding failed: {}", e))?;

    // Encode to base64 data URL
    let base64_data = BASE64.encode(&webp_data);
    Ok(format!("data:image/webp;base64,{}", base64_data))
}

/// Extract single frame with deduplication (reduces workload by 70%+ during scrubbing).
#[tauri::command]
async fn decode_frame(
    video_path: String,
    time_secs: f64,
    width: u32,
    height: u32,
) -> Result<String, String> {
    // Create deduplication key
    let video_id = format!("{:x}", md5::compute(&video_path));
    let timestamp_ms = (time_secs * 1000.0).round() as u64;
    let key = format!("{}:{}:{}x{}", video_id, timestamp_ms, width, height);

    // Check if extraction is already in-flight
    let (tx, is_new) = IN_FLIGHT_EXTRACTIONS.get_or_create(key.clone());

    if !is_new {
        // Extraction already in-flight, await existing result
        let mut rx = tx.subscribe();
        match rx.recv().await {
            Ok(result) => {
                return match result {
                    Ok(rgba_bytes) => {
                        let base64_data = BASE64.encode(&rgba_bytes);
                        Ok(format!("data:image/rgba;base64,{}", base64_data))
                    }
                    Err(e) => Err(e),
                };
            }
            Err(_) => {
                // Channel closed, fall through to extraction
            }
        }
    }

    // Perform extraction (first request or channel closed)
    let result = async {
        // Get or create decoder (reused across calls)
        let decoder = get_decoder(&video_path).await?;

        // Decode frame (3-15ms for subsequent frames with sequential optimization)
        let rgba_bytes = {
            let mut decoder_guard = decoder.lock().await;
            decoder_guard.decode_frame(time_secs, width, height)?
        };

        Ok(rgba_bytes)
    }
    .await;

    // Broadcast result to all waiting requests
    let _ = tx.send(result.clone());

    // Remove from in-flight map
    IN_FLIGHT_EXTRACTIONS.remove(&key);

    // Return result
    match result {
        Ok(rgba_bytes) => {
            let base64_data = BASE64.encode(&rgba_bytes);
            Ok(format!("data:image/rgba;base64,{}", base64_data))
        }
        Err(e) => Err(e),
    }
}

/// Extract single frame for GPU upload (returns raw RGBA, 5-10× faster than base64).
#[tauri::command]
async fn decode_frame_gpu(
    video_path: String,
    time_secs: f64,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    // Create deduplication key
    let video_id = format!("{:x}", md5::compute(&video_path));
    let timestamp_ms = (time_secs * 1000.0).round() as u64;
    let key = format!("{}:{}:{}x{}", video_id, timestamp_ms, width, height);

    // Check if extraction is already in-flight
    let (tx, is_new) = IN_FLIGHT_EXTRACTIONS.get_or_create(key.clone());

    if !is_new {
        // Extraction already in-flight, await existing result
        let mut rx = tx.subscribe();
        match rx.recv().await {
            Ok(result) => {
                IN_FLIGHT_EXTRACTIONS.remove(&key);
                return result;
            }
            Err(_) => {
                // Channel closed, fall through to extraction
            }
        }
    }

    // Perform extraction (first request or channel closed)
    let result = async {
        // Get or create decoder (reused across calls)
        let decoder = get_decoder(&video_path).await?;

        // Decode frame (3-15ms for subsequent frames with sequential optimization)
        let rgba_bytes = {
            let mut decoder_guard = decoder.lock().await;
            decoder_guard.decode_frame(time_secs, width, height)?
        };

        Ok(rgba_bytes)
    }
    .await;

    // Broadcast result to all waiting requests
    let _ = tx.send(result.clone());

    // Remove from in-flight map
    IN_FLIGHT_EXTRACTIONS.remove(&key);

    // Return raw RGBA bytes (no encoding!)
    result
}

/// Extract multiple frames with streaming and atlas-based storage.
#[tauri::command]
async fn decode_frames_streaming(
    video_path: String,
    timestamps: Vec<f64>,
    density: DensityLevel,
    width: u32,
    height: u32,
    _duration: f64,
    on_tile: tauri::ipc::Channel<ThumbnailTile>,
) -> Result<(), String> {
    use thumbnail_engine::atlas::{get_atlas_manager, AtlasBuilder, THUMBNAILS_PER_ATLAS};

    let start = std::time::Instant::now();
    let video_id = format!("{:x}", md5::compute(&video_path));
    let resolution_tier = if width >= 160 {
        ResolutionTier::Tier2x
    } else {
        ResolutionTier::Tier1x
    };

    eprintln!("[decode_frames_streaming] START video_id={} timestamps={} density={:?} size={}x{} (ATLAS MODE + IMMEDIATE RGBA)", 
              video_id, timestamps.len(), density, width, height);

    // Get cache directory
    let cache_dir = match GLOBAL_CACHE.cache_dir().await {
        Some(dir) => dir,
        None => return Err("Cache not initialized".to_string()),
    };

    // Get atlas manager for this video
    let atlas_manager = get_atlas_manager(&video_id, density, resolution_tier, cache_dir).await;

    // Check which frames are already in atlases
    let mut missing_times = Vec::new();
    let mut sent_count = 0u32;

    {
        let manager = atlas_manager.read().await;
        for &time in &timestamps {
            if let Some(location) = manager.get_location(time) {
                let (display_w, display_h) = {
                    let decoder_guard =
                        get_decoder(&video_path).await.map_err(|e| e.to_string())?;
                    let guard = decoder_guard.lock().await;
                    guard.display_dimensions()
                };

                let display_aspect = display_w as f64 / display_h as f64;
                let target_aspect = width as f64 / height as f64;

                let (actual_width, actual_height) = if (display_aspect - target_aspect).abs() < 0.01
                {
                    (width, height)
                } else {
                    let scale =
                        (width as f64 / display_w as f64).min(height as f64 / display_h as f64);
                    let w = (display_w as f64 * scale).round() as u32;
                    let h = (display_h as f64 * scale).round() as u32;
                    (w.max(1), h.max(1))
                };

                let tile = ThumbnailTile::from_atlas(
                    time,
                    location.atlas_path.to_string_lossy().to_string(),
                    density,
                    location.col,
                    location.row,
                    width,
                    height,
                    actual_width,
                    actual_height,
                );

                match on_tile.send(tile) {
                    Ok(_) => {
                        sent_count += 1;
                        if sent_count <= 3 {
                            eprintln!("[STREAM] Sent cached atlas tile #{}: time={:.2}s atlas={} pos=({},{})", 
                                      sent_count, time, location.atlas_index, location.col, location.row);
                        }
                    }
                    Err(e) => {
                        eprintln!("[STREAM] ✗ Failed to send cached tile: {:?}", e);
                    }
                }
            } else {
                missing_times.push(time);
            }
        }
    }

    eprintln!(
        "[decode_frames_streaming] Atlas check: cached={} missing={}",
        sent_count,
        missing_times.len()
    );

    // If all cached, return early
    if missing_times.is_empty() {
        eprintln!(
            "[decode_frames_streaming] All cached in atlases, returning early ({:?})",
            start.elapsed()
        );
        return Ok(());
    }

    // Spawn extraction task - IMMEDIATE RGBA streaming + background atlas persistence
    let total_frames = timestamps.len();
    let handle = tokio::spawn(async move {
        let bg_start = std::time::Instant::now();
        eprintln!(
            "[decode_frames_streaming] BG task starting, missing={} frames",
            missing_times.len()
        );

        // Get decoder
        let decoder = match get_decoder(&video_path).await {
            Ok(d) => {
                eprintln!(
                    "[decode_frames_streaming] Decoder acquired ({:?})",
                    bg_start.elapsed()
                );
                d
            }
            Err(e) => {
                eprintln!("[decode_frames_streaming] Failed to get decoder: {}", e);
                return;
            }
        };

        // Process frames in batches of THUMBNAILS_PER_ATLAS (32)
        let mut frames_decoded = 0u32;
        let mut frames_failed = 0u32;
        let mut frames_sent = sent_count;
        let mut atlases_created = 0u32;

        for chunk in missing_times.chunks(THUMBNAILS_PER_ATLAS) {
            let chunk_start = std::time::Instant::now();

            // Create atlas builder for background persistence
            let mut atlas_builder = AtlasBuilder::new(width, height);
            let mut chunk_frames: Vec<(f64, Vec<u8>, u32, u32)> = Vec::new();

            // IMMEDIATE PATH: Decode and stream RGBA to frontend (no compression!)
            for &time in chunk {
                let decode_start = std::time::Instant::now();

                // Create deduplication key
                let timestamp_ms = (time * 1000.0).round() as u64;
                let key = format!("{}:{}:{}x{}", video_id, timestamp_ms, width, height);

                // Check if extraction is already in-flight
                let (tx, is_new) = IN_FLIGHT_EXTRACTIONS.get_or_create(key.clone());

                let rgba_bytes = if !is_new {
                    // Extraction already in-flight, await existing result
                    let mut rx = tx.subscribe();
                    match rx.recv().await {
                        Ok(Ok(bytes)) => bytes,
                        Ok(Err(e)) => {
                            frames_failed += 1;
                            if frames_failed <= 5 {
                                eprintln!("[decode_frames_streaming] Decode failed at {}s (deduplicated): {}", time, e);
                            }
                            continue;
                        }
                        Err(_) => {
                            // Channel closed, perform extraction
                            match decoder.lock().await.decode_frame(time, width, height) {
                                Ok(bytes) => bytes,
                                Err(e) => {
                                    frames_failed += 1;
                                    if frames_failed <= 5 {
                                        eprintln!(
                                            "[decode_frames_streaming] Decode failed at {}s: {}",
                                            time, e
                                        );
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                } else {
                    // New extraction, perform decode and broadcast result
                    let result = decoder.lock().await.decode_frame(time, width, height);

                    match result {
                        Ok(bytes) => {
                            // Broadcast success to waiting requests
                            let _ = tx.send(Ok(bytes.clone()));
                            IN_FLIGHT_EXTRACTIONS.remove(&key);
                            bytes
                        }
                        Err(e) => {
                            // Broadcast error to waiting requests
                            let _ = tx.send(Err(e.clone()));
                            IN_FLIGHT_EXTRACTIONS.remove(&key);
                            frames_failed += 1;
                            if frames_failed <= 5 {
                                eprintln!(
                                    "[decode_frames_streaming] Decode failed at {}s: {}",
                                    time, e
                                );
                            }
                            continue;
                        }
                    }
                };

                let decode_time = decode_start.elapsed();

                let actual_width = (rgba_bytes.len() / 4 / height as usize) as u32;
                let actual_height = height;

                let webp_data_url =
                    match encode_rgba_to_webp_data_url(&rgba_bytes, actual_width, actual_height) {
                        Ok(url) => url,
                        Err(e) => {
                            eprintln!(
                                "[decode_frames_streaming] WebP encoding failed at {}s: {}",
                                time, e
                            );
                            frames_failed += 1;
                            continue;
                        }
                    };

                let tile = ThumbnailTile::from_path(time, webp_data_url, density);

                match on_tile.send(tile) {
                    Ok(_) => {
                        frames_sent += 1;
                        if frames_sent <= 3 || frames_sent % 20 == 0 {
                            eprintln!(
                                "[STREAM] Sent WebP tile #{}/{}: time={:.2}s decode={:?}",
                                frames_sent, total_frames, time, decode_time
                            );
                        }
                    }
                    Err(e) => {
                        eprintln!(
                            "[STREAM] ✗ Failed to send tile #{}: {:?}",
                            frames_sent + 1,
                            e
                        );
                    }
                }

                chunk_frames.push((time, rgba_bytes, actual_width, actual_height));
                frames_decoded += 1;
            }

            if chunk_frames.is_empty() {
                continue;
            }

            // BACKGROUND PATH: Persist to WebP atlas (non-blocking for frontend)
            let persist_start = std::time::Instant::now();

            // Allocate atlas locations
            let mut locations = Vec::new();
            {
                let mut manager = atlas_manager.write().await;
                for (time, rgba_bytes, actual_width, actual_height) in &chunk_frames {
                    let location = manager.allocate(*time);

                    if let Err(e) =
                        atlas_builder.add_thumbnail(rgba_bytes, *actual_width, *actual_height)
                    {
                        eprintln!(
                            "[decode_frames_streaming] Failed to add thumbnail to atlas: {}",
                            e
                        );
                        continue;
                    }

                    locations.push((*time, location, *actual_width, *actual_height));
                }
            }

            // Save atlas to disk (background persistence)
            if let Some((_, first_location, _, _)) = locations.first() {
                if let Err(e) = atlas_builder.save(&first_location.atlas_path).await {
                    eprintln!("[decode_frames_streaming] Failed to save atlas: {}", e);
                } else {
                    atlases_created += 1;
                    let persist_time = persist_start.elapsed();
                    eprintln!("[PERSIST] Created atlas #{} with {} thumbnails in {:?} (background, non-blocking)", 
                              atlases_created, chunk_frames.len(), persist_time);
                }
            }

            let chunk_time = chunk_start.elapsed();
            eprintln!(
                "[decode_frames_streaming] Chunk complete: {} frames in {:?}",
                chunk_frames.len(),
                chunk_time
            );

            // Yield between atlas batches
            tokio::task::yield_now().await;
        }

        eprintln!("[decode_frames_streaming] BG task complete: decoded={} failed={} sent={}/{} atlases={} total_time={:?}",
                  frames_decoded, frames_failed, frames_sent, total_frames, atlases_created, bg_start.elapsed());
    });

    // Await the task — invoke resolves only after all frames are streamed
    handle
        .await
        .map_err(|e| format!("Extraction task failed: {}", e))?;

    Ok(())
}

#[tauri::command]
fn release_video_decoder(video_path: String) {
    release_decoder(&video_path);
}

// ─── Pyramid Render Artifact Command (Phase 2) ───────────────────────────────

/// Decode a frame and produce all requested spatial tiers via the decode-once
/// pyramid pipeline. Results are streamed via `on_artifact` channel.
///
/// Cache check order (R11):
///   1. BackendTierCache hit → stream immediately (zero decode cost)
///   2. BackendFrameCache hit → downsample only (no decode cost)
///   3. Fresh decode → store in FRAME_CACHE → downsample → store per tier
///
/// In-flight dedup (R12): concurrent calls for the same (content_hash, tier)
/// share a single decode path.
#[tauri::command]
async fn get_render_artifact(
    video_path: String,
    // Millisecond timestamp — canonical (pre-rounded by caller)
    timestamp_ms: u64,
    // Spatial tiers to produce, e.g. ["l0", "l1"]
    spatial_tiers: Vec<String>,
    // Effect graph version for cache keying (0 = no effects)
    effect_graph_version: u32,
    on_artifact: tauri::ipc::Channel<RenderArtifact>,
) -> Result<(), String> {
    let timestamp_secs = timestamp_ms as f64 / 1000.0;
    let video_id = format!("{:x}", md5::compute(&video_path));

    // Parse requested tiers
    let tiers: Vec<SpatialTier> = spatial_tiers
        .iter()
        .filter_map(|s| SpatialTier::from_label(s).ok())
        .collect();
    if tiers.is_empty() {
        return Err("No valid spatial tiers requested".to_string());
    }

    // Compute content hash (speed=1.0, no trim, no fps-norm for now — Phase 3 will pass these)
    let content_hash = FrameContentHash::compute(
        &video_id,
        timestamp_ms,
        effect_graph_version,
        1.0,
        0,
        u64::MAX,
        false,
    );

    let frame_id = format!("{}-{}", content_hash.0, timestamp_ms);

    // ── Pass 1: tier cache hits ─────────────────────────────────────────────
    let mut missing_tiers: Vec<SpatialTier> = Vec::new();
    for tier in &tiers {
        let key = TierCacheKey {
            content_hash: content_hash.clone(),
            tier: *tier,
        };
        if let Some(frame) = TIER_CACHE.get(&key) {
            let artifact = RenderArtifact {
                frame_id: frame_id.clone(),
                content_hash: content_hash.0.clone(),
                spatial_tier: *tier,
                rgba_data: frame.data.clone(),
                width: frame.width,
                height: frame.height,
                timestamp_ms,
                source: ArtifactSource::BackendTierCache,
            };
            let _ = on_artifact.send(artifact);
        } else {
            missing_tiers.push(*tier);
        }
    }
    if missing_tiers.is_empty() {
        return Ok(());
    }

    // ── Pass 2: frame cache or fresh decode ─────────────────────────────────
    // In-flight dedup: only one decode path per content_hash.
    // Other callers poll TIER_CACHE after the first decode completes.
    let inflight_key = tier_inflight_key(&content_hash, SpatialTier::L0); // use L0 as decode lock
    let is_new = IN_FLIGHT_TIER.insert(inflight_key.clone(), ()).is_none();
    let raw_arc = if is_new {
        let raw = if let Some(existing) = FRAME_CACHE.get(&content_hash) {
            existing
        } else {
            // Fresh decode
            let decoder_arc = get_decoder(&video_path).await?;
            let (rgba, w, h) = {
                let mut dec = decoder_arc.lock().await;
                dec.decode_frame_full_res(timestamp_secs)?
            };
            let frame = Arc::new(RawRgbaFrame::new(rgba, w, h));
            FRAME_CACHE.insert(content_hash.clone(), frame.clone());
            frame
        };
        IN_FLIGHT_TIER.remove(&inflight_key);
        raw
    } else {
        // Another task is decoding — poll briefly then fall through
        let mut waited = 0u32;
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
            waited += 1;
            if let Some(f) = FRAME_CACHE.get(&content_hash) {
                IN_FLIGHT_TIER.remove(&inflight_key);
                break f;
            }
            if waited > 400 {
                // 2s timeout
                return Err(format!("Decode timeout for {}", content_hash.0));
            }
        }
    };

    // ── Pass 3: parallel downsample ─────────────────────────────────────────
    let tier_frames = {
        let raw = raw_arc.clone();
        // rayon parallel downsample (blocking, offloaded to thread pool)
        tokio::task::spawn_blocking(move || downsample_pyramid(&raw, &missing_tiers))
            .await
            .map_err(|e| format!("Downsample task failed: {:?}", e))?
    };

    // Store results in TIER_CACHE and stream artifacts
    for (tier, result) in tier_frames {
        match result {
            Ok(tier_frame) => {
                let key = TierCacheKey {
                    content_hash: content_hash.clone(),
                    tier,
                };
                let artifact = RenderArtifact {
                    frame_id: frame_id.clone(),
                    content_hash: content_hash.0.clone(),
                    spatial_tier: tier,
                    rgba_data: tier_frame.data.clone(),
                    width: tier_frame.width,
                    height: tier_frame.height,
                    timestamp_ms,
                    source: ArtifactSource::FreshDecode,
                };
                TIER_CACHE.insert(key, tier_frame);
                let _ = on_artifact.send(artifact);
            }
            Err(e) => {
                eprintln!(
                    "[get_render_artifact] Downsample failed for {:?}: {}",
                    tier, e
                );
            }
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(dir) = handle.path().app_cache_dir() {
                    let _ = init_thumbnail_engine(dir).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_thumbnail_cache,
            get_thumbnail_cache_stats,
            clear_thumbnail_cache,
            extract_poster_frame_command,
            commands::media::get_video_metadata,
            commands::media::extract_poster_frame,
            commands::media::extract_audio_artwork,
            commands::project::save_project,
            commands::project::load_project,
            commands::project::get_recent_projects,
            commands::project::delete_project,
            // Native FFmpeg decoder commands (fast path for thumbnails)
            decode_frame,
            decode_frame_gpu,
            decode_frames_streaming,
            release_video_decoder,
            // Pyramid render engine
            get_render_artifact,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

