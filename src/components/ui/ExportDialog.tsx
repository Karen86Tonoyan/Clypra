/**
 * Export Dialog
 *
 * UI for configuring and starting video exports.
 * Lazy-loaded to reduce initial bundle size.
 * Uses theme-aware styling (respects user's color theme).
 */

import React, { useState, useEffect } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { useProjectStore } from "../../store/projectStore";
import { useTimelineStore } from "../../store/timelineStore";

// Lazy load video export functionality (code splitting)
const exportVideoModule = () => import("../../lib/videoExport");

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExportPreset = "1080p-fast" | "1080p-quality" | "720p-fast" | "4k-quality" | "prores-422hq";

interface VideoExportProgress {
  currentFrame: number;
  totalFrames: number;
  progress: number;
  etaSeconds: number;
  fps: number;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({ isOpen, onClose }) => {
  const { project, mediaAssets } = useProjectStore();
  const { clips, tracks, epoch } = useTimelineStore();

  const [preset, setPreset] = useState<ExportPreset>("1080p-fast");
  const [outputPath, setOutputPath] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<VideoExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);
  const [ffmpegVersion, setFfmpegVersion] = useState<string>("");

  // Check FFmpeg availability on mount
  useEffect(() => {
    if (!isOpen) return;

    const checkFFmpeg = async () => {
      try {
        const module = await exportVideoModule();
        const available = await module.checkFFmpegAvailable();
        setFfmpegAvailable(available);
        if (available) {
          try {
            const version = await module.getFFmpegVersion();
            setFfmpegVersion(version);
          } catch {
            // Version detection is non-critical
          }
        }
      } catch (err) {
        console.error("[ExportDialog] FFmpeg check failed:", err);
        setFfmpegAvailable(false);
      }
    };

    checkFFmpeg();
  }, [isOpen]);

  const presetConfigs = {
    "1080p-fast": { label: "1080p Fast (H.264)", width: 1920, height: 1080, codec: "h264" as const, preset: "fast" as const, crf: 23, pixelFormat: "yuv420p" as const },
    "1080p-quality": { label: "1080p High Quality (H.264)", width: 1920, height: 1080, codec: "h264" as const, preset: "slow" as const, crf: 18, pixelFormat: "yuv420p" as const },
    "720p-fast": { label: "720p Fast (H.264)", width: 1280, height: 720, codec: "h264" as const, preset: "fast" as const, crf: 23, pixelFormat: "yuv420p" as const },
    "4k-quality": { label: "4K Quality (H.265)", width: 3840, height: 2160, codec: "h265" as const, preset: "medium" as const, crf: 20, pixelFormat: "yuv420p" as const },
    "prores-422hq": { label: "ProRes 422 HQ", width: 1920, height: 1080, codec: "prores" as const, preset: "medium" as const, crf: 0, pixelFormat: "yuv422p10le" as const },
  };

  const selectedPreset = presetConfigs[preset];

  const handleSelectOutputPath = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: `${project?.name || "video"}.mp4`,
      filters: [{ name: "Video", extensions: ["mp4", "mov"] }],
    });

    if (path) {
      setOutputPath(path);
    }
  };

  const handleExport = async () => {
    if (!outputPath) {
      setError("Please select an output path");
      return;
    }

    if (!project) {
      setError("No project loaded");
      return;
    }

    setIsExporting(true);
    setError(null);
    setSuccess(false);
    setProgress(null);

    try {
      const { exportVideo } = await exportVideoModule();

      const result = await exportVideo({
        clips,
        tracks,
        assets: mediaAssets,
        project,
        epoch,
        startTime: 0,
        endTime: project.duration,
        outputPath,
        width: selectedPreset.width,
        height: selectedPreset.height,
        codec: selectedPreset.codec,
        preset: selectedPreset.preset,
        crf: selectedPreset.crf,
        pixelFormat: selectedPreset.pixelFormat,
        onProgress: (p) => {
          setProgress(p);
        },
      });

      if (!result.cancelled) {
        setSuccess(true);
        setProgress(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export Video"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isExporting}>
            {isExporting ? "Exporting..." : success ? "Close" : "Cancel"}
          </Button>
          <Button variant="default" onClick={handleExport} disabled={isExporting || !outputPath || !ffmpegAvailable}>
            {isExporting ? "Exporting..." : "Export"}
          </Button>
        </>
      }
    >
      <div className="px-5 py-4 space-y-4">
        {/* FFmpeg Status */}
        {ffmpegAvailable === false && (
          <div className="flex items-start gap-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-destructive">FFmpeg Not Found</p>
              <p className="text-xs text-text-muted mt-1">FFmpeg is required for video export. Please install FFmpeg and make sure it's in your PATH.</p>
            </div>
          </div>
        )}

        {ffmpegAvailable && ffmpegVersion && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            <span>{ffmpegVersion}</span>
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="flex items-start gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-green-500">Export Complete</p>
              <p className="text-xs text-text-muted mt-1 truncate">Video exported to {outputPath}</p>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="flex items-start gap-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-destructive">Export Failed</p>
              <p className="text-xs text-text-muted mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Preset Selection */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Export Preset</label>
          <select value={preset} onChange={(e) => setPreset(e.target.value as ExportPreset)} disabled={isExporting} className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50">
            {Object.entries(presetConfigs).map(([key, config]) => (
              <option key={key} value={key}>
                {config.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-text-muted mt-1.5">
            {selectedPreset.width}×{selectedPreset.height} • {selectedPreset.codec.toUpperCase()} • {selectedPreset.preset}
          </p>
        </div>

        {/* Output Path */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Output File</label>
          <div className="flex gap-2">
            <input type="text" value={outputPath} readOnly placeholder="Select output path..." className="flex-1 px-3 py-2 bg-bg border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            <Button variant="ghost" onClick={handleSelectOutputPath} disabled={isExporting}>
              Browse
            </Button>
          </div>
        </div>

        {/* Progress */}
        {isExporting && progress && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">
                Frame {progress.currentFrame} / {progress.totalFrames}
              </span>
              <span className="text-text-muted">{(progress.progress * 100).toFixed(1)}%</span>
            </div>
            <div className="w-full h-2 bg-surface-raised rounded-full overflow-hidden">
              <div className="h-full bg-accent transition-all duration-300" style={{ width: `${progress.progress * 100}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>{progress.fps.toFixed(1)} fps</span>
              <span>ETA: {formatTime(progress.etaSeconds)}</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
