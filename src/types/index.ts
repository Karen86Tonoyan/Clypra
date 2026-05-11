export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "21:9";

export enum DensityLevel {
  Low = "low",
  Medium = "medium",
  High = "high",
  Ultra = "ultra",
}

export interface DensityConfig {
  level: DensityLevel;
  interval: number;
  minZoom: number;
  maxZoom: number;
}

export interface ThumbnailRequest {
  videoPath: string;
  timestamps: number[];
  density: DensityLevel;
  width: number;
  height: number;
}

export interface ThumbnailTile {
  time: number;
  path: string;
  density: DensityLevel;
  atlas_coords?: {
    col: number;
    row: number;
    thumb_width: number;
    thumb_height: number;
  };
  actual_width?: number;
  actual_height?: number;
}

export interface FilmstripState {
  tiles: Map<number, ThumbnailTile>;
  loadingTimestamps: Set<number>;
  currentDensity: DensityLevel;
  posterFrame: string | null;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  fps: number;
  size: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  aspectRatio: AspectRatio;
  canvasWidth: number;
  canvasHeight: number;
  frameRate: 24 | 30 | 60;
  duration: number;
  mediaAssets?: MediaAsset[];
}

export type TrackType = "video" | "audio" | "text";

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  muted: boolean;
  locked: boolean;
  visible: boolean;
  height: number;
}

export interface MediaAsset {
  id: string;
  name: string;
  path: string;
  type: "video" | "audio" | "image";
  duration: number;
  width?: number;
  height?: number;
  posterFrame?: string;
  coverArt?: string; // Album artwork for audio files
  size: number;
}

export interface Clip {
  id: string;
  trackId: string;
  mediaId: string;
  startTime: number;
  duration: number;
  trimIn: number;
  trimOut: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
}

export interface TextClip extends Clip {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: string | number;
  fontStyle?: "normal" | "italic";
  color: string;
  backgroundColor?: string;
  align: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  lineHeight: number;
  letterSpacing?: number;
  maxWidth?: number;
  paddingX: number;
  paddingY: number;
  // Inherited from Clip: x, y, width, height, rotation, opacity
}

export type DragItem = { type: "MEDIA_ASSET"; asset: MediaAsset } | { type: "CLIP"; clip: Clip };
