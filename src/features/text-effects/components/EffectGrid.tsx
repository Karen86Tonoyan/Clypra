import { useState, useEffect } from "react";
import { useEffectsStore } from "../store/effectsStore";
import { EffectCard } from "@/components/ui/EffectCard";
import { ClypraApi } from "../api/clypraApi";
import type { TextEffectDefinition } from "../types/types";
import { useFavoritesStore } from "@/store/favoritesStore";
import { useUIStore } from "@/store/uiStore";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";

const CATEGORIES = ["3d", "neon", "metallic", "glitch", "retro", "gradient", "grunge", "outline", "shadow", "elements", "luxury"];

interface EffectGridProps {
  searchQuery?: string;
  onAddToTimeline?: (payload: any, type: any) => void;
}

export function EffectGrid({ searchQuery = "", onAddToTimeline }: EffectGridProps) {
  const [activeCategory, setActiveCategory] = useState("3d");
  const { index, indexLoading, indexError, loadCategory } = useEffectsStore();

  // Consume global favorites and downloads store
  const { favorites, downloadedEffects, downloadingIds, toggleFavorite, startDownload, completeDownload, cancelDownload } = useFavoritesStore();

  // Load index when category changes
  useEffect(() => {
    loadCategory(activeCategory);
  }, [activeCategory, loadCategory]);

  const items = index[activeCategory] ?? [];
  const filteredItems = items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleToggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(id);
  };

  const handleDownloadAndApply = async (item: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const itemId = item.id;
    if (downloadingIds.includes(itemId)) return;

    startDownload(itemId);

    // Lazy load the full effect definition
    try {
      const fullEffect = await ClypraApi.getFullEffect(item.category, item.id);

      setTimeout(() => {
        completeDownload(itemId, "effect");

        const targetEffect = fullEffect || item;
        onAddToTimeline?.(
          {
            name: targetEffect.name,
            text: targetEffect.text || "CLYPRA", // Use default text from full definition
            presetType: "effect",
            styleId: targetEffect.id,
            fontFamily: targetEffect.font?.family,
            color: targetEffect.fills?.[0]?.color,
            fontWeight: targetEffect.font?.weight,
            fontStyle: targetEffect.font?.style,
            stroke: targetEffect.strokes?.[0] ? { color: targetEffect.strokes[0].color, width: targetEffect.strokes[0].width } : undefined,
            shadow: targetEffect.shadows?.[0] ? { color: targetEffect.shadows[0].color, blur: targetEffect.shadows[0].blur, offsetX: targetEffect.shadows[0].offsetX ?? 0, offsetY: targetEffect.shadows[0].offsetY ?? 0 } : undefined,
          },
          "text",
        );
      }, 850);
    } catch (err) {
      console.error("[EffectGrid] Failed to load effect:", err);
      cancelDownload(itemId);
    }
  };

  const handlePreview = async (item: any) => {
    const itemId = item.id;
    const isDownloaded = downloadedEffects.includes(itemId);

    if (downloadingIds.includes(itemId)) return;

    // Set the latest targeted preview ID immediately to track user intent and resolve race conditions
    useUIStore.getState().setPreviewMedia(itemId);

    if (!isDownloaded) {
      startDownload(itemId);
    }

    try {
      // Resolve the full effect configuration
      const fullEffect = useEffectsStore.getState().definitions[itemId] || (await ClypraApi.getFullEffect(item.category, itemId));

      // Mark as downloaded
      completeDownload(itemId, "effect");

      // Only project to the preview player if this item is still the active preview target
      if (useUIStore.getState().previewMediaId === itemId) {
        // Send directly to the main preview player — same as template preview flow
        useUIStore.getState().previewTextPreset(fullEffect, "effect");

        // Activate transport source context
        const session = getActiveSessionOrNull();
        session?.transportAuthority?.setActiveContext("source");
      }
    } catch (e) {
      console.error("[EffectGrid] Failed to push to main player:", e);
      cancelDownload(itemId);

      // Fallback: still preview with partial data if this item is still the active target
      if (useUIStore.getState().previewMediaId === itemId) {
        useUIStore.getState().previewTextPreset(item, "effect");
        const session = getActiveSessionOrNull();
        session?.transportAuthority?.setActiveContext("source");
      }
    }
  };

  // Convert EffectIndexItem to TextEffectDefinition for the UI component
  const convertToEffectDefinition = (item: any): TextEffectDefinition => {
    return {
      ...item,
      text: "CLYPRA",
      description: item.description || "",
      tags: item.tags || [],
      font: {
        family: "Inter",
        weight: 700,
        style: "normal",
        letterSpacing: 0,
        lineHeight: 1.2,
      },
      fills: [],
      strokes: [],
      shadows: [],
    };
  };

  return (
    <div className="flex flex-col h-full bg-surface/5">
      {/* ── Category tabs ───────────────────────────────────── */}
      <div className="relative shrink-0 border-b border-border/40 bg-surface/5">
        <div className="absolute left-0 top-0 bottom-0 w-3 bg-linear-to-l to-surface from-transparent pointer-events-none" />
        <div className="flex overflow-x-auto gap-2 p-1 whitespace-nowrap" style={{ scrollbarWidth: "none" }}>
          {CATEGORIES.map((cat) => (
            <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-2 py-1 capitalize text-xs font-medium rounded-sm transition-colors cursor-pointer hover:bg-accent/10 hover:text-accent ${activeCategory === cat ? "bg-accent/10 text-accent" : "text-text-muted"}`}>
              {cat}
            </button>
          ))}
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-3 bg-linear-to-l from-surface to-transparent pointer-events-none" />
      </div>

      {/* ── Grid body ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-1 scrollbar-thin">
        {indexLoading && <GridSkeleton />}

        {indexError && (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <p className="text-sm text-text-muted">{indexError}</p>
            <button onClick={() => loadCategory(activeCategory)} className="text-xs text-accent underline cursor-pointer hover:text-accent-soft">
              Retry
            </button>
          </div>
        )}

        {!indexLoading && !indexError && filteredItems.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-1 text-xs text-text-muted">
            <p>No matching effects found</p>
            <p className="opacity-60">Try searching for other styles</p>
          </div>
        )}

        {!indexLoading && !indexError && filteredItems.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {filteredItems.map((effect) => (
              <EffectCard key={effect.id} effect={convertToEffectDefinition(effect)} isFavorite={favorites.includes(effect.id)} isDownloading={downloadingIds.includes(effect.id)} isDownloaded={downloadedEffects.includes(effect.id)} onFavorite={(e) => handleToggleFavorite(effect.id, e)} onApply={(e) => handleDownloadAndApply(effect, e)} onPreview={() => handlePreview(effect)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-white/5 animate-pulse aspect-square" style={{ animationDelay: `${i * 45}ms` }} />
      ))}
    </div>
  );
}
