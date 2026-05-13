import React, { useState, lazy, Suspense } from "react";
import { Film, Upload, Home, Settings, Camera } from "lucide-react";
import { Button } from "../ui/Button";
import { usePlayback } from "../../hooks/usePlayback";
import { useProjectStore } from "../../store/projectStore";
import { useUIStore } from "../../store/uiStore";
import { useTimelineStore } from "../../store/timelineStore";
import { useHistoryStore } from "../../store/historyStore";
import { exportFrameAndDownload } from "../../lib/exportFrame";

// Lazy load ExportDialog (code splitting)
const ExportDialog = lazy(() => import("../ui/ExportDialog").then((m) => ({ default: m.ExportDialog })));

export const TopBar: React.FC = () => {
  const { currentTime, duration, formatTime } = usePlayback();
  const { project, closeProject, mediaAssets } = useProjectStore();
  const { toggleSettingsModal } = useUIStore();
  const { clips, tracks, epoch } = useTimelineStore();
  const { state: historyState } = useHistoryStore();
  const [isExportingFrame, setIsExportingFrame] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const handleExportFrame = async () => {
    if (!project) return;

    setIsExportingFrame(true);
    try {
      await exportFrameAndDownload({
        time: currentTime,
        clips,
        tracks,
        assets: mediaAssets,
        project,
        epoch,
        format: "png",
      });
    } catch (error) {
      console.error("Failed to export frame:", error);
      alert("Failed to export frame. Check console for details.");
    } finally {
      setIsExportingFrame(false);
    }
  };

  return (
    <>
      {/* Native title bar area - content positioned in the title bar */}
      <div className="h-[37px] flex items-center justify-between px-3 md:px-4 gap-3 bg-transparent" data-tauri-drag-region style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        {/* Left side - starts after traffic lights */}
        <div className="flex items-center gap-3 pl-16" data-tauri-drag-region>
          <Button variant="ghost" size="icon-sm" onClick={closeProject} title="Back to Home" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <Home className="w-4 h-4" />
          </Button>
          <div className="w-px h-5 bg-border/50" />
          <Film className="w-4 h-4 text-accent-soft" />
          <span className="text-xs font-semibold text-text-primary">{project?.name}</span>
        </div>

        {/* Center - timecode */}
        <div className="flex items-center gap-2 text-xs text-text-primary bg-surface-raised/50 border border-border/50 px-2.5 py-0.5 rounded-md backdrop-blur-sm" data-tauri-drag-region>
          <span>{formatTime(currentTime)}</span>
          <span className="text-text-muted">/</span>
          <span>{formatTime(duration)}</span>
        </div>

        {/* Right side - actions */}
        <div className="flex items-center gap-1.5">
          {/* Undo/Redo indicator */}
          {(historyState.canUndo || historyState.canRedo) && (
            <div className="flex items-center gap-1 text-[10px] text-text-muted mr-1">
              <span title={`${historyState.position + 1} undo actions available`}>{historyState.position + 1} undo</span>
              {historyState.canRedo && (
                <>
                  <span>•</span>
                  <span title={`${historyState.size - historyState.position - 1} redo actions available`}>{historyState.size - historyState.position - 1} redo</span>
                </>
              )}
            </div>
          )}

          <Button variant="ghost" size="icon-sm" onClick={handleExportFrame} disabled={isExportingFrame} title="Export Current Frame (PNG)" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <Camera className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={toggleSettingsModal} title="Settings" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <Settings className="w-3.5 h-3.5" />
          </Button>
          <Button variant="default" size="sm" onClick={() => setShowExportDialog(true)} className="text-xs h-6 px-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <Upload className="w-3.5 h-3.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Export Dialog */}
      {showExportDialog && (
        <Suspense fallback={null}>
          <ExportDialog isOpen={showExportDialog} onClose={() => setShowExportDialog(false)} />
        </Suspense>
      )}
    </>
  );
};
