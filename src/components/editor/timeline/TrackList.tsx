import React from "react";
import { Volume2, VolumeX, Lock, Unlock, Eye, EyeOff, Minimize2 } from "lucide-react";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { GapManager } from "@/lib/gapManager";
import type { Track } from "@/types";

interface TrackListProps {
  onEditTrack?: (trackId: string) => void;
}

export const TrackList: React.FC<TrackListProps> = ({ onEditTrack }) => {
  const { tracks, clips, gaps, toggleTrackLock, toggleTrackMute, toggleTrackVisibility } = useTimelineStore();
  const { selectedTrackId, selectTrack } = useUIStore();

  // Helper: Check if track has clips
  const trackHasClips = (trackId: string) => clips.some((c) => c.trackId === trackId);

  // Helper: Check if track has unprotected gaps
  const trackHasUnprotectedGaps = (trackId: string) => gaps.some((g) => g.trackId === trackId && !g.protected);

  const getTrackStyle = (track: Track) => {
    const isTextTrack = track.type === "text";
    const isAudioTrack = track.type === "audio";
    const isVideoTrack = track.type === "video";

    // Return styles based on track type
    if (isTextTrack) return "h-12"; // 48px for text
    if (isAudioTrack) return "h-13"; // 52px for audio
    return "h-17"; // 68px for video
  };

  return (
    <div className="w-40 border-r border-timeline-track-border flex flex-col bg-timeline-track-bg">
      <div className="h-6 px-3 border-b border-timeline-track-border flex items-center shrink-0 panel-head">
        <span className="text-[11px] font-semibold tracking-wide text-timeline-track-label uppercase">Track</span>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {tracks.length === 0 ? (
          // Edge case: No tracks exist at all (rare, but possible)
          <div className="flex-1 flex items-center justify-center px-3">
            <span className="text-[10px] text-text-muted/40 text-center">No tracks</span>
          </div>
        ) : (
          tracks.map((track) => {
            const isEmpty = !trackHasClips(track.id);
            const hasGaps = trackHasUnprotectedGaps(track.id);
            const isSelected = selectedTrackId === track.id;

            return (
              <div key={track.id} className={`group relative mb-1 bg-surface-raised/40 flex items-center gap-2 px-2 transition-colors ${isSelected ? "bg-timeline-track-selected ring-1 ring-inset ring-timeline-track-active" : "hover:bg-timeline-track-hover"} ${isEmpty ? "opacity-70" : ""} ${track.locked ? "bg-timeline-track-active/60" : ""}`} style={{ height: `${track.height}px` }} onClick={() => selectTrack(track.id)}>
                <div className={`absolute left-0 top-0 h-full w-[2px] ${isSelected ? "bg-timeline-track-label" : "bg-transparent"}`} />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTrackLock(track.id);
                  }}
                  className={`p-1 rounded transition-colors cursor-pointer hover:bg-timeline-button-hover ${track.locked ? "bg-timeline-button-hover text-timeline-track-name" : "text-timeline-button-icon"}`}
                  aria-label={track.locked ? "Unlock track" : "Lock track"}
                  title={track.locked ? "Unlock track" : "Lock track"}
                >
                  {track.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTrackVisibility(track.id);
                  }}
                  className={`p-1 rounded transition-colors cursor-pointer hover:bg-timeline-button-hover ${track.visible ? "text-timeline-button-icon" : "bg-timeline-button-hover text-timeline-track-name"}`}
                  aria-label={track.visible ? "Hide track" : "Show track"}
                  title={track.visible ? "Hide track" : "Show track"}
                >
                  {track.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTrackMute(track.id);
                  }}
                  className={`p-1 rounded transition-colors cursor-pointer hover:bg-timeline-button-hover ${track.muted ? "bg-timeline-button-hover text-timeline-track-name" : "text-timeline-button-icon"}`}
                  aria-label={track.muted ? "Unmute track" : "Mute track"}
                  title={track.muted ? "Unmute track" : "Mute track"}
                >
                  {track.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                </button>

                {/* Pack Track button - only show if track has unprotected gaps */}
                {hasGaps && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      GapManager.packTrack(track.id);
                    }}
                    className="p-1 rounded transition-colors cursor-pointer hover:bg-timeline-button-hover text-timeline-button-icon opacity-0 group-hover:opacity-100"
                    aria-label="Pack track (remove gaps)"
                    title="Pack track - remove all unprotected gaps"
                  >
                    <Minimize2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
