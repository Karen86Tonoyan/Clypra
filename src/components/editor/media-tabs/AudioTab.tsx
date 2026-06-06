import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Music2, Pause, Play, Plus, Search } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { AUDIO_LIBRARY_CATEGORIES, ClypraAudioApi, type AudioLibraryCategory, type AudioLibraryItem } from "@/features/audio-library/api/clypraAudioApi";
import type { TabProps } from "./types";

export const AudioTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<AudioLibraryCategory>("music");
  const [items, setItems] = useState<AudioLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    ClypraAudioApi.getAudioByCategory(activeCategory)
      .then((nextItems) => {
        if (!cancelled) setItems(nextItems);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load audio library");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeCategory]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.name.toLowerCase().includes(query) || item.author.toLowerCase().includes(query) || item.tags?.some((tag) => tag.toLowerCase().includes(query)));
  }, [items, searchQuery]);

  return (
    <>
      <div className="flex gap-1 overflow-x-auto scrollbar-none border-b border-border p-1">
        {AUDIO_LIBRARY_CATEGORIES.map((category) => (
          <button key={category} onClick={() => setActiveCategory(category)} className={`shrink-0 rounded px-2 py-1 text-[11px] font-semibold capitalize transition-colors ${activeCategory === category ? "bg-accent text-white" : "text-text-muted hover:bg-surface-raised hover:text-text-primary"}`}>
            {category === "sfx" ? "SFX" : category}
          </button>
        ))}
      </div>

      <div className="p-1 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input type="text" placeholder="Search public audio..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-surface-raised border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading audio library
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && filteredItems.length === 0 && (
          <div className="rounded-lg border border-border bg-surface-raised/40 p-4 text-center">
            <Music2 className="mx-auto mb-2 h-5 w-5 text-text-muted" />
            <p className="text-xs font-semibold text-text-primary">No approved audio yet</p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">Audio published from Clypra Studio will appear here after API cache refresh.</p>
          </div>
        )}

        {!loading && !error && filteredItems.map((item) => <AudioItem key={item.id} item={item} onAddToTimeline={() => onAddToTimeline?.(item, "audio")} />)}
      </div>
    </>
  );
};

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
};

const AudioItem: React.FC<{ item: AudioLibraryItem; onAddToTimeline: () => void }> = ({ item, onAddToTimeline }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePreview = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    audio.currentTime = 0;
    void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  };

  return (
    <div className="group flex items-center gap-3 p-2 bg-surface-raised hover:bg-surface-raised/80 rounded-lg transition-colors">
      <audio ref={audioRef} src={item.audioUrl} preload="none" onEnded={() => setIsPlaying(false)} onPause={() => setIsPlaying(false)} className="hidden" />
      <button onClick={handlePreview} className="w-10 h-10 flex items-center justify-center bg-accent/20 hover:bg-accent/30 rounded-lg transition-colors shrink-0">
        {isPlaying ? <Pause className="w-4 h-4 text-accent" /> : <Play className="w-4 h-4 text-accent" />}
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{item.name}</p>
        <p className="text-xs text-text-muted truncate">
          {item.author} - {formatDuration(item.duration)}
          {item.bpm ? ` - ${item.bpm} BPM` : ""}
        </p>
        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-text-muted/80">{item.license.type}</p>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={onAddToTimeline} className="w-7 h-7 flex items-center justify-center hover:bg-surface-raised rounded transition-colors">
              <Plus className="w-4 h-4 text-text-primary" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Add to Track</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
