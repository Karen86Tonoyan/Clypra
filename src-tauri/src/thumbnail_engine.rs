//! Thumbnail engine with multi-resolution cache and atlas-based storage.

pub mod decoder;
pub mod atlas;
pub mod pyramid;

// Re-export pyramid types at crate level for convenience
pub use pyramid::{
    SpatialTier, FrameContentHash, TierCacheKey, RenderArtifact, ArtifactSource,
    ExtractionProgressEvent, canonical_timestamp, downsample_pyramid, scale_rgba_lanczos,
    FRAME_CACHE, TIER_CACHE, IN_FLIGHT_TIER, tier_inflight_key,
};

use dashmap::DashMap;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{BinaryHeap, HashSet};
use std::cmp::Reverse;
use std::fmt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, RwLock, Semaphore};
use web_time::Instant;

#[derive(Debug, Clone)]
pub enum ExtractionError {
    ProcessSpawn(String),
    CodecError(String),
    Timeout,
    CacheError(String),
    Other(String),
}

impl fmt::Display for ExtractionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExtractionError::ProcessSpawn(msg) => write!(f, "Process spawn error: {}", msg),
            ExtractionError::CodecError(msg) => write!(f, "Codec error: {}", msg),
            ExtractionError::Timeout => write!(f, "Extraction timed out"),
            ExtractionError::CacheError(msg) => write!(f, "Cache error: {}", msg),
            ExtractionError::Other(msg) => write!(f, "Extraction error: {}", msg),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailTile {
    pub time: f64,
    pub path: String,
    pub density: DensityLevel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub atlas_coords: Option<AtlasCoords>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtlasCoords {
    pub col: u32,
    pub row: u32,
    pub thumb_width: u32,
    pub thumb_height: u32,
}

impl ThumbnailTile {
    pub fn from_path(time: f64, path: String, density: DensityLevel) -> Self {
        Self {
            time,
            path,
            density,
            atlas_coords: None,
            actual_width: None,
            actual_height: None,
        }
    }

    pub fn from_atlas(
        time: f64,
        atlas_path: String,
        density: DensityLevel,
        col: u32,
        row: u32,
        thumb_width: u32,
        thumb_height: u32,
        actual_width: u32,
        actual_height: u32,
    ) -> Self {
        Self {
            time,
            path: atlas_path,
            density,
            atlas_coords: Some(AtlasCoords {
                col,
                row,
                thumb_width,
                thumb_height,
            }),
            actual_width: Some(actual_width),
            actual_height: Some(actual_height),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ResolutionTier {
    Tier1x,
    Tier2x,
}

impl ResolutionTier {
    pub fn from_dpr(dpr: f64) -> Self {
        if dpr >= 1.5 {
            ResolutionTier::Tier2x
        } else {
            ResolutionTier::Tier1x
        }
    }

    pub fn dimensions(&self) -> (u32, u32) {
        match self {
            ResolutionTier::Tier1x => (80, 60),
            ResolutionTier::Tier2x => (160, 120),
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            ResolutionTier::Tier1x => "1x",
            ResolutionTier::Tier2x => "2x",
        }
    }

    pub fn from_label(label: &str) -> Result<Self, String> {
        match label {
            "1x" => Ok(ResolutionTier::Tier1x),
            "2x" => Ok(ResolutionTier::Tier2x),
            _ => Err(format!("Invalid resolution tier: {}", label)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CacheKey {
    pub video_id: String,
    pub timestamp_ms: u64,
    pub density: DensityLevel,
    pub resolution_tier: ResolutionTier,
}

impl CacheKey {
    pub fn new(video_path: &str, time: f64, density: DensityLevel, dpr: f64) -> Self {
        let video_id = format!("{:x}", md5::compute(video_path));
        let timestamp_ms = (time * 1000.0).round() as u64;
        let resolution_tier = ResolutionTier::from_dpr(dpr);

        Self {
            video_id,
            timestamp_ms,
            density,
            resolution_tier,
        }
    }

    pub fn to_string(&self) -> String {
        format!(
            "{}:{}:{}:{}",
            self.video_id,
            self.timestamp_ms,
            self.density.label(),
            self.resolution_tier.label()
        )
    }

    pub fn from_string(s: &str) -> Result<Self, String> {
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() != 4 {
            return Err(format!("Invalid cache key format: expected 4 parts, got {}", parts.len()));
        }

        Ok(Self {
            video_id: parts[0].to_string(),
            timestamp_ms: parts[1]
                .parse()
                .map_err(|_| format!("Invalid timestamp: {}", parts[1]))?,
            density: DensityLevel::from_label(parts[2])?,
            resolution_tier: ResolutionTier::from_label(parts[3])?,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DensityLevel {
    Low = 0,
    Medium = 1,
    High = 2,
    Ultra = 3,
}

impl DensityLevel {
    pub fn time_interval(&self) -> f64 {
        match self {
            DensityLevel::Low => 5.0,
            DensityLevel::Medium => 1.0,
            DensityLevel::High => 0.2,
            DensityLevel::Ultra => 0.02,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            DensityLevel::Low => "low",
            DensityLevel::Medium => "medium",
            DensityLevel::High => "high",
            DensityLevel::Ultra => "ultra",
        }
    }

    /// Parse density level from label string
    pub fn from_label(label: &str) -> Result<Self, String> {
        match label {
            "low" => Ok(DensityLevel::Low),
            "medium" => Ok(DensityLevel::Medium),
            "high" => Ok(DensityLevel::High),
            "ultra" => Ok(DensityLevel::Ultra),
            _ => Err(format!("Invalid density level: {}", label)),
        }
    }

    pub fn from_zoom(px_per_sec: f64) -> Self {
        let time_per_thumb = 80.0 / px_per_sec;

        if time_per_thumb > 3.0 {
            DensityLevel::Low
        } else if time_per_thumb > 0.5 {
            DensityLevel::Medium
        } else if time_per_thumb > 0.05 {
            DensityLevel::High
        } else {
            DensityLevel::Ultra
        }
    }

    pub fn higher(&self) -> Option<Self> {
        match self {
            DensityLevel::Low => Some(DensityLevel::Medium),
            DensityLevel::Medium => Some(DensityLevel::High),
            DensityLevel::High => Some(DensityLevel::Ultra),
            DensityLevel::Ultra => None,
        }
    }

    pub fn lower(&self) -> Option<Self> {
        match self {
            DensityLevel::Ultra => Some(DensityLevel::High),
            DensityLevel::High => Some(DensityLevel::Medium),
            DensityLevel::Medium => Some(DensityLevel::Low),
            DensityLevel::Low => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    Critical = 0,
    High = 1,
    Normal = 2,
}

#[derive(Debug)]
pub struct CachedFrame {
    pub time: f64,
    pub path: PathBuf,
    pub timestamp: Instant,
    pub access_count: AtomicU64,
    pub last_access: RwLock<Instant>,
    pub in_viewport: RwLock<bool>,
}

impl CachedFrame {
    pub fn new(time: f64, path: PathBuf) -> Self {
        Self {
            time,
            path,
            timestamp: Instant::now(),
            access_count: AtomicU64::new(1),
            last_access: RwLock::new(Instant::now()),
            in_viewport: RwLock::new(false),
        }
    }

    pub fn touch(&self) {
        self.access_count.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut last) = self.last_access.try_write() {
            *last = Instant::now();
        }
    }

    pub async fn set_in_viewport(&self, visible: bool) {
        let mut in_vp = self.in_viewport.write().await;
        *in_vp = visible;
    }

    pub async fn eviction_score(&self, density: DensityLevel) -> u64 {
        let viewport_priority = if *self.in_viewport.read().await { 10 } else { 0 };
        let last_access_time = *self.last_access.read().await;
        let seconds_since_access = Instant::now().duration_since(last_access_time).as_secs();
        let recency_weight = if seconds_since_access < 5 {
            10 // Very recent (< 5s)
        } else if seconds_since_access < 30 {
            7 // Recent (< 30s)
        } else if seconds_since_access < 120 {
            4 // Somewhat recent (< 2min)
        } else if seconds_since_access < 600 {
            2 // Old (< 10min)
        } else {
            0
        };

        let access_count = self.access_count.load(Ordering::Relaxed);
        let access_frequency = if access_count >= 50 {
            10 // Very frequently accessed (looping playback)
        } else if access_count >= 20 {
            7 // Frequently accessed
        } else if access_count >= 10 {
            5 // Moderately accessed
        } else if access_count >= 5 {
            3 // Occasionally accessed
        } else {
            0
        };

        let density_weight = match density {
            DensityLevel::Low => 10,
            DensityLevel::Medium => 7,
            DensityLevel::High => 4,
            DensityLevel::Ultra => 0,
        };

        let score = viewport_priority * 10 + recency_weight * 5 + access_frequency * 3 + density_weight * 2;
        
        score
    }
}

#[derive(Debug)]
pub struct DensityCache {
    pub video_id: String,
    pub density: DensityLevel,
    pub frames: DashMap<u64, CachedFrame>,
    pub max_size: usize,
    pub total_size: AtomicU64,
}

impl DensityCache {
    pub fn new(video_id: String, density: DensityLevel) -> Self {
        Self {
            video_id,
            density,
            frames: DashMap::new(),
            max_size: 500,
            total_size: AtomicU64::new(0),
        }
    }

    fn time_key(time: f64) -> u64 {
        (time * 1000.0).round() as u64
    }

    pub fn get_path(&self, time: f64) -> Option<PathBuf> {
        let key = Self::time_key(time);
        self.frames.get(&key).map(|entry| {
            entry.value().touch();
            entry.value().path.clone()
        })
    }

    pub async fn insert(&self, time: f64, frame: CachedFrame) {
        let key = Self::time_key(time);
        self.frames.insert(key, frame);
        self.evict_if_needed().await;
    }

    async fn evict_if_needed(&self) {
        if self.frames.len() > self.max_size {
            let mut scored_entries: Vec<(u64, u64)> = Vec::new();
            
            for entry in self.frames.iter() {
                let time_key = *entry.key();
                let frame = entry.value();
                let score = frame.eviction_score(self.density).await;
                scored_entries.push((time_key, score));
            }

            scored_entries.sort_by_key(|(_, score)| *score);
            let to_remove = (self.max_size / 5).max(1);
            let mut removed = 0;
            let mut viewport_protected = 0;

            for (key, score) in scored_entries.into_iter().take(to_remove) {
                if score >= 100 {
                    viewport_protected += 1;
                    continue;
                }

                if let Some((_, frame)) = self.frames.remove(&key) {
                    if let Ok(metadata) = std::fs::metadata(&frame.path) {
                        GLOBAL_CACHE.total_size.fetch_sub(metadata.len(), Ordering::Relaxed);
                    }
                    removed += 1;
                }
            }

            if removed > 0 || viewport_protected > 0 {
                eprintln!(
                    "[DensityCache] Evicted {} frames (protected {} viewport frames) from {} density cache",
                    removed, viewport_protected, self.density.label()
                );
            }
        }
    }
}

/// Multi-density cache for a single video
#[derive(Debug)]
pub struct VideoCache {
    pub video_id: String,
    pub video_path: String,
    pub duration: f64,
    pub levels: DashMap<DensityLevel, DensityCache>,
    pub last_accessed: RwLock<Instant>,
}

impl VideoCache {
    pub fn new(video_id: String, video_path: String, duration: f64) -> Self {
        let levels = DashMap::new();
        levels.insert(DensityLevel::Low, DensityCache::new(video_id.clone(), DensityLevel::Low));
        levels.insert(DensityLevel::Medium, DensityCache::new(video_id.clone(), DensityLevel::Medium));
        levels.insert(DensityLevel::High, DensityCache::new(video_id.clone(), DensityLevel::High));
        levels.insert(DensityLevel::Ultra, DensityCache::new(video_id.clone(), DensityLevel::Ultra));

        Self {
            video_id,
            video_path,
            duration,
            levels,
            last_accessed: RwLock::new(Instant::now()),
        }
    }

    pub async fn touch(&self) {
        let mut last = self.last_accessed.write().await;
        *last = Instant::now();
    }

    pub fn get_frame_path(&self, time: f64, target_density: DensityLevel) -> Option<(PathBuf, DensityLevel)> {
        self.get_frame_with_fallback(time, target_density)
    }

    pub fn get_frame_with_fallback(
        &self,
        time: f64,
        target_density: DensityLevel,
    ) -> Option<(PathBuf, DensityLevel)> {
        if let Some(path) = self.get_frame_at_density(time, target_density) {
            return Some((path, target_density));
        }

        // Try higher densities (more detail)
        let mut current = target_density;
        while let Some(higher) = current.higher() {
            if let Some(path) = self.get_frame_at_density(time, higher) {
                return Some((path, higher));
            }
            current = higher;
        }

        let fallback_order = [
            DensityLevel::High,
            DensityLevel::Medium,
            DensityLevel::Low,
        ];

        for density in fallback_order {
            if density >= target_density {
                continue;
            }
            if let Some(path) = self.get_frame_at_density(time, density) {
                return Some((path, density));
            }
        }

        None
    }

    /// Get frame at specific density level (no fallback)
    fn get_frame_at_density(&self, time: f64, density: DensityLevel) -> Option<PathBuf> {
        let cache = self.levels.get(&density)?;
        cache.get_path(time)
    }
}

/// Global cache for all videos
#[derive(Debug)]
pub struct ThumbnailCache {
    /// Video ID -> Video cache
    videos: DashMap<String, Arc<VideoCache>>,
    /// Max videos to keep in memory
    max_videos: usize,
    /// Base cache directory
    cache_dir: RwLock<Option<PathBuf>>,
    /// Total size in bytes across all videos and all density levels
    pub total_size: AtomicU64,
}

impl ThumbnailCache {
    pub fn new() -> Self {
        Self {
            videos: DashMap::new(),
            max_videos: 50, // Keep 50 videos in memory
            cache_dir: RwLock::new(None),
            total_size: AtomicU64::new(0),
        }
    }

    pub async fn init_cache_dir(&self, app_cache_dir: PathBuf) -> Result<(), String> {
        let thumb_dir = app_cache_dir.join("thumbnails");
        tokio::fs::create_dir_all(&thumb_dir)
            .await
            .map_err(|e| format!("Failed to create thumbnail cache dir: {}", e))?;

        let mut dir = self.cache_dir.write().await;
        *dir = Some(thumb_dir);
        Ok(())
    }

    pub async fn get_or_create_video(&self, video_path: &str, duration: f64) -> Arc<VideoCache> {
        let video_id = format!("{:x}", md5::compute(video_path));

        if let Some(cached) = self.videos.get(&video_id) {
            cached.touch().await;
            return cached.clone();
        }

        let cache = Arc::new(VideoCache::new(video_id.clone(), video_path.to_string(), duration));
        self.videos.insert(video_id, cache.clone());
        self.evict_if_needed().await;
        cache
    }

    pub fn get_video(&self, video_path: &str) -> Option<Arc<VideoCache>> {
        let video_id = format!("{:x}", md5::compute(video_path));
        self.videos.get(&video_id).map(|e| e.clone())
    }

    pub async fn evict_if_needed(&self) {
        const CACHE_SIZE_LIMIT: u64 = 200 * 1024 * 1024;

        let current_size = self.total_size.load(Ordering::Relaxed);
        if current_size <= CACHE_SIZE_LIMIT {
            return;
        }

        eprintln!(
            "[ThumbnailCache] Cache size {}MB exceeds 200MB limit, evicting with weighted scoring...",
            current_size / (1024 * 1024)
        );

        let mut scored_frames: Vec<(String, DensityLevel, u64, u64, PathBuf)> = Vec::new();

        for video_entry in self.videos.iter() {
            let video_cache = video_entry.value();
            for level_entry in video_cache.levels.iter() {
                let density = *level_entry.key();
                let density_cache = level_entry.value();
                for frame_entry in density_cache.frames.iter() {
                    let time_key = *frame_entry.key();
                    let frame = frame_entry.value();
                    let path = frame.path.clone();
                    let vid_id = video_cache.video_id.clone();

                    let score = frame.eviction_score(density).await;

                    scored_frames.push((vid_id, density, time_key, score, path));
                }
            }
        }

        scored_frames.sort_by_key(|(_, _, _, score, _)| *score);
        let total_frames = scored_frames.len();
        let to_remove = ((total_frames / 5).max(1)).min(total_frames);

        eprintln!(
            "[ThumbnailCache] Evicting {} of {} frames using weighted scoring",
            to_remove,
            total_frames
        );

        if !scored_frames.is_empty() {
            let lowest_score = scored_frames.first().map(|(_, _, _, s, _)| *s).unwrap_or(0);
            let highest_score = scored_frames.last().map(|(_, _, _, s, _)| *s).unwrap_or(0);
            let median_score = scored_frames.get(total_frames / 2).map(|(_, _, _, s, _)| *s).unwrap_or(0);
            eprintln!(
                "[ThumbnailCache] Score distribution: lowest={}, median={}, highest={}",
                lowest_score, median_score, highest_score
            );
        }

        let mut removed = 0;
        let mut viewport_protected = 0;

        for (vid_id, density, time_key, score, file_path) in scored_frames.into_iter().take(to_remove) {
            if score >= 100 {
                viewport_protected += 1;
                continue;
            }

            if let Some(video_entry) = self.videos.get(&vid_id) {
                if let Some(level_cache) = video_entry.levels.get(&density) {
                    if level_cache.frames.remove(&time_key).is_some() {
                        if let Ok(metadata) = std::fs::metadata(&file_path) {
                            self.total_size.fetch_sub(metadata.len(), Ordering::Relaxed);
                        }
                        removed += 1;
                    }
                }
            }
        }

        eprintln!(
            "[ThumbnailCache] Eviction complete: removed {} frames, protected {} viewport frames, new size ~{}MB",
            removed,
            viewport_protected,
            self.total_size.load(Ordering::Relaxed) / (1024 * 1024)
        );
    }

    pub async fn cache_dir(&self) -> Option<PathBuf> {
        self.cache_dir.read().await.clone()
    }

    pub async fn frame_path(
        &self,
        video_id: &str,
        density: DensityLevel,
        time: f64,
        resolution_tier: ResolutionTier,
    ) -> Option<PathBuf> {
        let cache_dir = self.cache_dir.read().await;
        cache_dir.as_ref().map(|dir| {
            let density_name = density.label();
            let tier_name = resolution_tier.label();
            let time_key = (time * 1000.0).round() as u64;
            dir.join(format!("{}_{}_{}_{}.webp", video_id, density_name, time_key, tier_name))
        })
    }

    pub async fn clear(&self) {
        self.videos.clear();
    }
}

/// Global singleton cache
pub static GLOBAL_CACHE: Lazy<ThumbnailCache> = Lazy::new(ThumbnailCache::new);

/// Extraction job for the async queue
#[derive(Debug)]
pub struct ExtractionJob {
    pub video_path: String,
    pub video_id: String,
    pub time: f64,
    pub density: DensityLevel,
    pub priority: Priority,
    pub width: u32,
    pub height: u32,
    pub resolution_tier: ResolutionTier,
    pub result_tx: oneshot::Sender<Result<PathBuf, String>>,
}

impl ExtractionJob {
    fn is_cancelled(&self) -> bool {
        let timestamp_key = (self.time * 1000.0).round() as u64;
        
        if let Some(entry) = ACTIVE_TRACKER.active_requests.get(&self.video_id) {
            !entry.value().contains(&timestamp_key)
        } else {
            true
        }
    }
}

/// Batch extraction request
#[derive(Debug)]
pub struct BatchExtractionRequest {
    pub video_path: String,
    pub video_id: String,
    pub times: Vec<f64>,
    pub density: DensityLevel,
    pub priority: Priority,
    pub width: u32,
    pub height: u32,
    pub resolution_tier: ResolutionTier,
    pub result_tx: oneshot::Sender<Vec<Result<PathBuf, String>>>,
}

#[derive(Debug)]
pub struct ExtractionQueue {
    job_tx: mpsc::Sender<ExtractionJob>,
    batch_tx: mpsc::Sender<BatchExtractionRequest>,
    semaphore: Arc<Semaphore>,
}
pub(crate) struct PrioritizedJob(pub ExtractionJob);

impl PartialEq for PrioritizedJob {
    fn eq(&self, other: &Self) -> bool {
        self.0.priority == other.0.priority
    }
}

impl Eq for PrioritizedJob {}

impl PartialOrd for PrioritizedJob {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PrioritizedJob {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Lower Priority value = higher urgency (Critical=0 > Normal=2)
        // Use Reverse so that Critical (0) sorts highest in the max-heap
        Reverse(self.0.priority).cmp(&Reverse(other.0.priority))
    }
}

impl ExtractionQueue {
    pub fn new() -> Self {
        let (job_tx, mut job_rx) = mpsc::channel::<ExtractionJob>(1000);
        let (batch_tx, mut batch_rx) = mpsc::channel::<BatchExtractionRequest>(100);
        let semaphore = Arc::new(Semaphore::new(4)); // 4 concurrent extractions

        let semaphore_clone = semaphore.clone();

        // Spawn job processor
        tokio::spawn(async move {
            // Priority queue: Critical jobs are processed before High, which before Normal.
            // BinaryHeap is a max-heap; PrioritizedJob's Ord maps Critical (0) to the
            // highest value so it is popped first.
            let mut priority_queue: BinaryHeap<PrioritizedJob> = BinaryHeap::new();

            loop {
                // If the priority queue is empty, block until at least one job arrives.
                // If it already has jobs, drain any additional pending jobs without blocking
                // so we can re-sort before picking the next one to run.
                if priority_queue.is_empty() {
                    tokio::select! {
                        Some(job) = job_rx.recv() => {
                            priority_queue.push(PrioritizedJob(job));
                        }
                        Some(batch) = batch_rx.recv() => {
                            // Batch requests bypass the priority heap and run immediately
                            // (they are always submitted with an explicit priority by the caller).
                            let permit = semaphore_clone.clone().acquire_owned().await;
                            if let Ok(permit) = permit {
                                tokio::spawn(async move {
                                    // Hold the permit for the duration of extraction;
                                    // it is dropped (released) when this closure returns.
                                    let _permit = permit;
                                    let results = Self::extract_batch(
                                        &batch.video_path,
                                        &batch.times,
                                        batch.width,
                                        batch.height,
                                        &batch.video_id,
                                        batch.density,
                                        batch.resolution_tier,
                                    ).await;
                                    let _ = batch.result_tx.send(results);
                                });
                            }
                            continue;
                        }
                        else => break,
                    }
                }

                // Drain all currently-available jobs into the priority queue without blocking.
                // This ensures that if a Critical job arrives while we are about to process a
                // Normal job, the Critical job gets picked up first.
                loop {
                    match job_rx.try_recv() {
                        Ok(job) => priority_queue.push(PrioritizedJob(job)),
                        Err(_) => break,
                    }
                }

                // Also drain any pending batch requests
                loop {
                    match batch_rx.try_recv() {
                        Ok(batch) => {
                            let sem = semaphore_clone.clone();
                            tokio::spawn(async move {
                                let permit = sem.acquire_owned().await;
                                if let Ok(permit) = permit {
                                    // Hold the permit for the duration of extraction;
                                    // it is dropped (released) when this closure returns.
                                    let _permit = permit;
                                    let results = Self::extract_batch(
                                        &batch.video_path,
                                        &batch.times,
                                        batch.width,
                                        batch.height,
                                        &batch.video_id,
                                        batch.density,
                                        batch.resolution_tier,
                                    ).await;
                                    let _ = batch.result_tx.send(results);
                                }
                            });
                        }
                        Err(_) => break,
                    }
                }

                // Pop the highest-priority job from the heap
                if let Some(PrioritizedJob(job)) = priority_queue.pop() {
                    // Check if job has been cancelled before acquiring semaphore
                    if job.is_cancelled() {
                        // Send cancellation error and skip execution
                        let _ = job.result_tx.send(Err("Job cancelled".to_string()));
                        continue;
                    }

                    // Try to acquire a semaphore permit without blocking first.
                    // If all 4 permits are taken, we wait using tokio::select! so that
                    // new incoming jobs can still be queued while we wait for a free slot.
                    // This ensures additional requests are queued (not dropped) when the
                    // semaphore is full, and that higher-priority jobs arriving during the
                    // wait are re-sorted before the next dispatch.
                    let permit = match semaphore_clone.clone().try_acquire_owned() {
                        Ok(permit) => permit,
                        Err(_) => {
                            // All 4 permits are taken — wait for one to become available,
                            // but also keep draining new jobs into the priority queue so
                            // that Critical jobs arriving now can jump ahead of Normal jobs.
                            let sem = semaphore_clone.clone();
                            let permit = tokio::select! {
                                // A permit became available
                                Ok(permit) = sem.acquire_owned() => {
                                    // Drain any new jobs that arrived while we were waiting
                                    loop {
                                        match job_rx.try_recv() {
                                            Ok(new_job) => priority_queue.push(PrioritizedJob(new_job)),
                                            Err(_) => break,
                                        }
                                    }
                                    // Also drain any pending batch requests
                                    loop {
                                        match batch_rx.try_recv() {
                                            Ok(batch) => {
                                                let batch_sem = semaphore_clone.clone();
                                                tokio::spawn(async move {
                                                    if let Ok(p) = batch_sem.acquire_owned().await {
                                                        let _p = p;
                                                        let results = Self::extract_batch(
                                                            &batch.video_path,
                                                            &batch.times,
                                                            batch.width,
                                                            batch.height,
                                                            &batch.video_id,
                                                            batch.density,
                                                            batch.resolution_tier,
                                                        ).await;
                                                        let _ = batch.result_tx.send(results);
                                                    }
                                                });
                                            }
                                            Err(_) => break,
                                        }
                                    }
                                    // Check if a higher-priority job arrived while waiting.
                                    // If so, push the current job back and re-sort.
                                    if let Some(top) = priority_queue.peek() {
                                        if top.0.priority < job.priority {
                                            // A higher-priority job is now at the top.
                                            // Push current job back and release the permit
                                            // so the loop re-sorts and picks the best job.
                                            priority_queue.push(PrioritizedJob(job));
                                            // Spawn a no-op to release the permit immediately
                                            drop(permit);
                                            continue;
                                        }
                                    }
                                    permit
                                }
                                // A new job arrived — push current job back, re-sort, retry
                                Some(new_job) = job_rx.recv() => {
                                    priority_queue.push(PrioritizedJob(new_job));
                                    priority_queue.push(PrioritizedJob(job));
                                    continue;
                                }
                            };
                            permit
                        }
                    };

                    tokio::spawn(async move {
                        // Double-check cancellation right before extraction
                        if job.is_cancelled() {
                            let _ = job.result_tx.send(Err("Job cancelled".to_string()));
                            return;
                        }

                        // Hold the permit for the duration of extraction;
                        // it is dropped (released) when this closure returns,
                        // whether extraction succeeds or fails.
                        let _permit = permit;
                        let result = Self::extract_single_frame(
                            &job.video_path,
                            job.time,
                            job.width,
                            job.height,
                            &job.video_id,
                            job.density,
                            job.resolution_tier,
                        ).await;
                        let _ = job.result_tx.send(result);
                    });
                }
            }
        });

        Self {
            job_tx,
            batch_tx,
            semaphore,
        }
    }

    pub async fn submit(&self, job: ExtractionJob) -> Result<(), String> {
        self.job_tx
            .send(job)
            .await
            .map_err(|_| "Failed to submit extraction job".to_string())
    }

    pub async fn submit_batch(&self, request: BatchExtractionRequest) -> Result<(), String> {
        self.batch_tx
            .send(request)
            .await
            .map_err(|_| "Failed to submit batch extraction request".to_string())
    }

    async fn extract_single_frame(
        _video_path: &str,
        _time: f64,
        _width: u32,
        _height: u32,
        _video_id: &str,
        _density: DensityLevel,
        _resolution_tier: ResolutionTier,
    ) -> Result<PathBuf, String> {
        Err("extract_single_frame is deprecated - use decode_frames_streaming instead".to_string())
    }

    async fn extract_batch(
        _video_path: &str,
        _times: &[f64],
        _width: u32,
        _height: u32,
        _video_id: &str,
        _density: DensityLevel,
        _resolution_tier: ResolutionTier,
    ) -> Vec<Result<PathBuf, String>> {
        vec![Err("extract_batch is deprecated - use decode_frames_streaming instead".to_string()); _times.len()]
    }
}

pub static GLOBAL_QUEUE: Lazy<ExtractionQueue> = Lazy::new(ExtractionQueue::new);
#[derive(Debug)]
pub struct ActiveExtractionTracker {
    pub(crate) active_requests: DashMap<String, HashSet<u64>>,
}

impl ActiveExtractionTracker {
    pub fn new() -> Self {
        Self {
            active_requests: DashMap::new(),
        }
    }

    pub fn register_request(&self, video_id: &str, timestamps: &[f64]) {
        let timestamp_keys: HashSet<u64> = timestamps
            .iter()
            .map(|&t| (t * 1000.0).round() as u64)
            .collect();

        self.active_requests
            .insert(video_id.to_string(), timestamp_keys);
    }

    pub fn cancel_stale_timestamps(&self, video_id: &str, new_timestamps: &[f64]) -> Vec<u64> {
        let new_keys: HashSet<u64> = new_timestamps
            .iter()
            .map(|&t| (t * 1000.0).round() as u64)
            .collect();

        let mut cancelled = Vec::new();

        if let Some(mut entry) = self.active_requests.get_mut(video_id) {
            let old_keys = entry.value().clone();

            for old_key in old_keys.iter() {
                if !new_keys.contains(old_key) {
                    cancelled.push(*old_key);
                }
            }

            *entry.value_mut() = new_keys;
        } else {
            self.active_requests
                .insert(video_id.to_string(), new_keys);
        }

        cancelled
    }

    pub fn clear_video(&self, video_id: &str) {
        self.active_requests.remove(video_id);
    }
}

pub static ACTIVE_TRACKER: Lazy<ActiveExtractionTracker> = Lazy::new(ActiveExtractionTracker::new);
pub async fn get_video_cache(video_path: &str, duration: f64) -> Arc<VideoCache> {
    GLOBAL_CACHE.get_or_create_video(video_path, duration).await
}

pub async fn request_thumbnail(
    video_path: &str,
    time: f64,
    density: DensityLevel,
    priority: Priority,
    width: u32,
    height: u32,
    dpr: f64,
) -> Result<PathBuf, String> {
    let video_id = format!("{:x}", md5::compute(video_path));
    let resolution_tier = ResolutionTier::from_dpr(dpr);

    if let Some(video_cache) = GLOBAL_CACHE.get_video(video_path) {
        if let Some((path, _)) = video_cache.get_frame_path(time, density) {
            return Ok(path);
        }
    }

    let (tx, rx) = oneshot::channel();
    let job = ExtractionJob {
        video_path: video_path.to_string(),
        video_id,
        time,
        density,
        priority,
        width,
        height,
        resolution_tier,
        result_tx: tx,
    };

    GLOBAL_QUEUE.submit(job).await?;

    rx.await
        .map_err(|_| "Extraction channel closed".to_string())?
}

pub async fn request_batch_thumbnails(
    video_path: &str,
    times: Vec<f64>,
    density: DensityLevel,
    priority: Priority,
    width: u32,
    height: u32,
    dpr: f64,
) -> Vec<Result<PathBuf, String>> {
    let video_id = format!("{:x}", md5::compute(video_path));
    let resolution_tier = ResolutionTier::from_dpr(dpr);

    let mut missing_times = Vec::new();
    let mut cached_results: Vec<Option<Result<PathBuf, String>>> = vec![None; times.len()];

    if let Some(video_cache) = GLOBAL_CACHE.get_video(video_path) {
        for (i, time) in times.iter().enumerate() {
            if let Some((path, _)) = video_cache.get_frame_path(*time, density) {
                cached_results[i] = Some(Ok(path));
            } else {
                missing_times.push((i, *time));
            }
        }
    } else {
        missing_times = times.iter().enumerate().map(|(i, t)| (i, *t)).collect();
    }

    if missing_times.is_empty() {
        return cached_results.into_iter().flatten().collect();
    }

    let (tx, rx) = oneshot::channel();
    let request = BatchExtractionRequest {
        video_path: video_path.to_string(),
        video_id,
        times: missing_times.iter().map(|(_, t)| *t).collect(),
        density,
        priority,
        width,
        height,
        resolution_tier,
        result_tx: tx,
    };

    if let Err(e) = GLOBAL_QUEUE.submit_batch(request).await {
        return vec![Err(e); times.len()];
    }

    match rx.await {
        Ok(batch_results) => {
            for ((orig_idx, _), result) in missing_times.iter().zip(batch_results.iter()) {
                cached_results[*orig_idx] = Some(result.clone());
            }
            cached_results.into_iter().flatten().collect()
        }
        Err(_) => {
            for (i, _) in missing_times {
                cached_results[i] = Some(Err("Extraction cancelled".to_string()));
            }
            cached_results.into_iter().flatten().collect()
        }
    }
}

/// Initialize the thumbnail system
pub async fn init_thumbnail_engine(app_cache_dir: PathBuf) -> Result<(), String> {
    GLOBAL_CACHE.init_cache_dir(app_cache_dir).await
}

/// Preload a density level for a video (background task)
pub async fn preload_density_level(
    video_path: &str,
    density: DensityLevel,
    duration: f64,
    dpr: f64,
) -> Result<(), String> {
    // Generate all timestamps for this density
    let interval = density.time_interval();
    let times: Vec<f64> = (0..)
        .map(|i| i as f64 * interval)
        .take_while(|&t| t < duration)
        .collect();

    // Determine dimensions based on DPR
    let resolution_tier = ResolutionTier::from_dpr(dpr);
    let (width, height) = resolution_tier.dimensions();

    // Request batch extraction with low priority
    let _results = request_batch_thumbnails(
        video_path,
        times,
        density,
        Priority::Normal,
        width,
        height,
        dpr,
    ).await;

    Ok(())
}

/// Generate timestamp grid for visible range (same logic as frontend)
pub fn generate_timestamp_grid(
    visible_start: f64,
    visible_end: f64,
    time_per_thumb: f64,
) -> Vec<f64> {
    // Align to global grid
    let first_thumb = (visible_start / time_per_thumb).floor() * time_per_thumb;

    // Buffer of one thumbnail
    let buffer = time_per_thumb;
    let grid_start = first_thumb - buffer;
    let grid_end = visible_end + buffer;

    let mut timestamps = Vec::new();
    let mut t = grid_start;

    while t <= grid_end {
        let time = (t * 1000.0).round() / 1000.0;
        timestamps.push(time);
        t += time_per_thumb;
    }

    timestamps
}

/// Clear thumbnail cache for a video
pub async fn clear_video_thumbnail_cache(video_path: &str) {
    let video_id = format!("{:x}", md5::compute(video_path));
    GLOBAL_CACHE.videos.remove(&video_id);
}

/// Get cache statistics
pub fn get_cache_stats() -> serde_json::Value {
    let video_count = GLOBAL_CACHE.videos.len();
    let mut total_frames = 0usize;

    for video in GLOBAL_CACHE.videos.iter() {
        for level in video.levels.iter() {
            total_frames += level.frames.len();
        }
    }

    serde_json::json!({
        "video_count": video_count,
        "total_frames": total_frames,
    })
}

/// Extract a single frame, returning a typed ExtractionError on failure.
///
/// This is a thin wrapper around `request_thumbnail` that maps the
/// string-based errors into the structured `ExtractionError` variants used
/// by `extract_with_retry`.
pub async fn extract_frame(
    video_path: &str,
    time: f64,
    density: DensityLevel,
    width: u32,
    height: u32,
) -> Result<PathBuf, ExtractionError> {
    request_thumbnail(
        video_path,
        time,
        density,
        Priority::Critical,
        width,
        height,
        1.0, // default DPR; callers needing 2x should use request_thumbnail directly
    )
    .await
    .map_err(|e| {
        // Classify the string error into a typed ExtractionError.
        let lower = e.to_lowercase();
        if lower.contains("no such file")
            || lower.contains("permission denied")
            || lower.contains("spawn")
            || lower.contains("os error")
        {
            ExtractionError::ProcessSpawn(e)
        } else if lower.contains("codec")
            || lower.contains("decoder")
            || lower.contains("invalid data")
            || lower.contains("moov atom")
        {
            ExtractionError::CodecError(e)
        } else if lower.contains("timeout") || lower.contains("timed out") {
            ExtractionError::Timeout
        } else if lower.contains("cache") {
            ExtractionError::CacheError(e)
        } else {
            ExtractionError::Other(e)
        }
    })
}

/// Extract a frame with automatic retry and exponential backoff.
///
/// Retry policy (Property 15 — Validates: Requirements 16.1, 16.4):
/// - `ProcessSpawn` errors: retry up to 3 times with delays of 100 ms, 400 ms,
///   1600 ms (base-4 exponential backoff).
/// - `CodecError`: no retry — return immediately and let the caller use the
///   fallback chain.
/// - `Timeout`: retry once with the next lower density level; if already at
///   the lowest density, return the error.
/// - All other errors: return immediately without retry.
pub async fn extract_with_retry(
    video_path: &str,
    time: f64,
    density: DensityLevel,
    width: u32,
    height: u32,
) -> Result<PathBuf, ExtractionError> {
    let mut attempts = 0;
    let max_attempts = 3;
    let mut backoff_ms: u64 = 100;

    loop {
        attempts += 1;

        match extract_frame(video_path, time, density, width, height).await {
            Ok(path) => return Ok(path),
            Err(e) => {
                match e {
                    ExtractionError::CodecError(_) => {
                        // No retry for codec errors — use fallback chain immediately
                        eprintln!("[Extract] Codec error (no retry): {}", e);
                        return Err(e);
                    }
                    ExtractionError::Timeout => {
                        // Retry with lower density if available
                        if let Some(lower) = density.lower() {
                            eprintln!(
                                "[Extract] Timeout at density {:?}, retrying with lower density {:?}",
                                density, lower
                            );
                            return Box::pin(extract_with_retry(
                                video_path, time, lower, width, height,
                            ))
                            .await;
                        }
                        eprintln!("[Extract] Timeout at lowest density, giving up");
                        return Err(e);
                    }
                    ExtractionError::ProcessSpawn(_) => {
                        if attempts >= max_attempts {
                            eprintln!(
                                "[Extract] Max retries ({}) exceeded for process spawn error: {}",
                                max_attempts, e
                            );
                            return Err(e);
                        }

                        // Exponential backoff: sleep first, then log
                        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                        eprintln!(
                            "[Extract] Retry {} after {}ms (process spawn error)",
                            attempts, backoff_ms
                        );
                        backoff_ms *= 4;
                    }
                    _ => {
                        eprintln!("[Extract] Non-retriable error: {}", e);
                        return Err(e);
                    }
                }
            }
        }
    }
}

// ============================================================================
