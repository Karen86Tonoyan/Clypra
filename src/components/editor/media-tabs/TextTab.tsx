import React, { useState, useEffect } from "react";
import { Search, Sparkles, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TEXT_EFFECTS } from "@/constants/textEffects";
import { TEXT_TEMPLATES } from "@/constants/textTemplates";
import type { TabProps } from "./types";
import { EffectCard } from "@/components/ui/EffectCard";
import { TemplateCard } from "@/components/ui/TemplateCard";
import { useUIStore } from "@/store/uiStore";
import { TextEffectPicker } from "../../../features/text-effects/TextEffectPicker";
import { allEffects } from "../../../features/text-effects/effects/definitions";

export const TextTab: React.FC<TabProps> = ({ onAddToTimeline }) => {
  const [activeTab, setActiveTab] = useState<"effects" | "templates" | "yours" | "captions">("effects");
  const [activeCategory, setActiveCategory] = useState<string>("Trending");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Local storage based favorites system for Yours / Favorites
  const [favorites, setFavorites] = useState<string[]>([]);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  const handlePreview = (item: any, type: "effect" | "template") => {
    const premiumDef = allEffects.find((e) => e.id === item.id);
    if (premiumDef && type === "effect") {
      handlePremiumPreview(premiumDef);
    } else {
      useUIStore.getState().previewTextPreset(item, type);
    }
  };

  const handlePremiumPreview = (effect: any) => {
    useUIStore.getState().previewTextPreset({
      id: effect.id,
      name: effect.name,
      presetType: "effect",
      fontFamily: effect.font.family,
      color: effect.fills[0]?.type === "solid" ? (effect.fills[0] as any).color : "#ffffff",
      fontWeight: effect.font.weight === 900 ? "bold" : "normal",
      fontStyle: effect.font.style,
      stroke: effect.strokes[0] ? { color: effect.strokes[0].color, width: strokeWidthToStandard(effect.strokes[0].width) } : undefined,
      shadow: effect.shadows[0] ? { color: effect.shadows[0].color, blur: effect.shadows[0].blur, offsetX: effect.shadows[0].offsetX, offsetY: effect.shadows[0].offsetY } : undefined,
      background: effect.background ? { color: effect.background.color, padding: effect.background.paddingX, borderRadius: effect.background.borderRadius } : undefined,
      styleId: effect.id,
    }, "effect");
  };

  const strokeWidthToStandard = (width: number) => {
    return width;
  };

  useEffect(() => {
    const saved = localStorage.getItem("clypra_text_favorites");
    if (saved) {
      try {
        setFavorites(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  // Sync category when tab changes to avoid blank grids
  const handleTabChange = (tab: "effects" | "templates" | "yours" | "captions") => {
    setActiveTab(tab);
    if (tab === "effects" || tab === "templates") {
      setActiveCategory("Trending");
    } else if (tab === "yours") {
      setActiveCategory("Favorites");
    } else {
      setActiveCategory("Auto");
    }
  };

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = favorites.includes(id) ? favorites.filter((favId) => favId !== id) : [...favorites, id];
    setFavorites(next);
    localStorage.setItem("clypra_text_favorites", JSON.stringify(next));
  };

  const handleDownloadAndApply = (item: any, type: "effect" | "template", e: React.MouseEvent) => {
    e.stopPropagation();
    const itemId = item.id;
    if (downloadingIds.has(itemId)) return;

    // Simulate standard CapCut download animation
    setDownloadingIds((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });

    setTimeout(() => {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });

      // Apply to timeline
      if (type === "effect") {
        const premiumDef = allEffects.find((e) => e.id === item.id);
        if (premiumDef) {
          onAddToTimeline?.(
            {
              name: item.name,
              presetType: "effect",
              styleId: item.id,
              fontFamily: premiumDef.font.family,
              color: premiumDef.fills[0]?.type === "solid" ? (premiumDef.fills[0] as any).color : "#ffffff",
              fontWeight: premiumDef.font.weight === 900 ? "bold" : "normal",
              fontStyle: premiumDef.font.style,
              stroke: premiumDef.strokes[0] ? { color: premiumDef.strokes[0].color, width: premiumDef.strokes[0].width } : undefined,
              shadow: premiumDef.shadows[0] ? { color: premiumDef.shadows[0].color, blur: premiumDef.shadows[0].blur, offsetX: premiumDef.shadows[0].offsetX, offsetY: premiumDef.shadows[0].offsetY } : undefined,
              background: premiumDef.background ? { color: premiumDef.background.color, padding: premiumDef.background.paddingX, borderRadius: premiumDef.background.borderRadius } : undefined,
            },
            "text",
          );
        } else {
          onAddToTimeline?.(
            {
              name: item.name,
              presetType: "effect",
              styleId: item.id,
              fontFamily: item.fontFamily,
              color: item.color,
              fontWeight: item.fontWeight,
              fontStyle: item.fontStyle,
              stroke: item.stroke,
              shadow: item.shadow,
              background: item.background,
            },
            "text",
          );
        }
      } else {
        onAddToTimeline?.(
          {
            name: item.defaultText,
            presetType: "template",
            templateId: item.id,
            fontFamily: item.fontFamily,
            color: item.color,
            fontSize: item.fontSize,
            fontWeight: item.fontWeight,
            fontStyle: item.fontStyle,
            stroke: item.stroke,
            shadow: item.shadow,
            background: item.background,
            overlayType: item.overlayType,
          },
          "text",
        );
      }
    }, 850);
  };

  // Categories list
  const effectCategories = ["Trending", "Classic", "NEW", "Hits", "Metal", "Neon", "3D", "Gradient", "Glitch", "Food", "Textile Art", "Manuscript"];
  const templateCategories = ["Trending", "Classic", "NEW", "Hits", "Free Fire", "Icons", "Title", "Retro"];

  // Filter items
  const filteredEffects = TEXT_EFFECTS.filter((effect) => effect.category === activeCategory && effect.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const filteredTemplates = TEXT_TEMPLATES.filter((template) => template.category === activeCategory && template.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const favoriteEffectsList = TEXT_EFFECTS.filter((e) => favorites.includes(e.id));
  const favoriteTemplatesList = TEXT_TEMPLATES.filter((t) => favorites.includes(t.id));

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface/5 select-none">
      {/* ── Top Header Control Navigation Row (Overflows X) ────────────── */}
      <div className="flex items-center gap-2.5 p-1 border-b border-border/50 shrink-0 bg-surface/10">
        {/* Sleek Plus Add Text Button */}
        <Button variant="ghost" size="sm" className="shrink-0 flex items-center justify-center gap-1 h-min px-2 py-0.5 cursor-pointer bg-accent/10 rounded-sm transition-all text-[12px] text-accent-soft hover:bg-accent/20 border border-accent/20" onClick={() => onAddToTimeline?.({ name: "Custom Text" }, "text")}>
          Add Text
        </Button>

        {/* Vertical Separator */}
        <div className="w-px h-5 bg-border/80 shrink-0" />

        {/* Main Tab Navigation Buttons (Overflowing X) */}
        <div className="grow overflow-x-auto flex items-center gap-2 pb-0.5 whitespace-nowrap" style={{ scrollbarWidth: "none" }}>
          <button onClick={() => handleTabChange("effects")} className={`px-2 py-0.5 rounded-sm text-xs font-semibold transition-all cursor-pointer ${activeTab === "effects" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-surface-raised/40"}`}>
            Text Effects
          </button>

          <button onClick={() => handleTabChange("templates")} className={`px-2 py-0.5 rounded-sm text-xs font-semibold transition-all cursor-pointer ${activeTab === "templates" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-surface-raised/40"}`}>
            Templates
          </button>

          <button onClick={() => handleTabChange("yours")} className={`px-2 py-0.5 rounded-sm text-xs font-semibold transition-all cursor-pointer ${activeTab === "yours" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-surface-raised/40"}`}>
            Favorites ({favorites.length})
          </button>

          <button onClick={() => handleTabChange("captions")} className={`px-2 py-0.5 rounded-sm text-xs font-semibold transition-all cursor-pointer ${activeTab === "captions" ? "bg-accent text-white" : "text-text-muted hover:text-text-primary hover:bg-surface-raised/40"}`}>
            Captions
          </button>
        </div>
      </div>

      {/* ── Sub-Categories Horizontal Navigation Row (Overflows X) ─────── */}
      {(activeTab === "effects" || activeTab === "templates") && (
        <div className="relative shrink-0 border-b border-border/40 bg-surface/5">
          {/* Subtle Left Fade indicator */}
          <div className="absolute left-0 top-0 bottom-0 w-3 bg-linear-to-l to-surface from-transparent pointer-events-none" />

          <div className="flex overflow-x-auto gap-2 p-1 whitespace-nowrap" style={{ scrollbarWidth: "none" }}>
            {(activeTab === "effects" ? effectCategories : templateCategories).map((cat) => (
              <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-2 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer ${activeCategory === cat ? "bg-accent/10 text-accent" : "text-text-muted hover:text-text-primary"}`}>
                {cat}
              </button>
            ))}
          </div>

          {/* Subtle Right Fade indicator */}
          <div className="absolute right-0 top-0 bottom-0 w-3 bg-linear-to-l from-surface to-transparent pointer-events-none" />
        </div>
      )}

      {/* ── Search bar header ────────────────────────────────────────── */}
      {activeTab !== "captions" && (
        <div className="p-1 border-b border-border/30 flex items-center justify-between gap-3 shrink-0">
          <div className="flex-1 relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input type="text" placeholder={`Search ${activeTab === "effects" ? "effects" : activeTab === "templates" ? "templates" : "text presets"}...`} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-surface-raised rounded-sm pl-8 pr-3 py-1.5 text-xs text-text-primary outline-none transition-colors" />
          </div>

          <div className="flex items-center gap-1 shrink-0 text-[10px] font-mono text-text-muted font-semibold bg-surface-raised border border-border/50 px-2 py-1.5 rounded-md">
            <span className="text-accent-soft">{activeCategory}</span>
          </div>
        </div>
      )}

      {/* ── Main content Scrollable Grid area ───────────────────────── */}
      <div className="grow overflow-y-auto scrollbar-thin p-3.5">
        {/* Yours/Favorites Display */}
        {activeTab === "yours" && (
          <div className="space-y-6">
            {/* Favorite Effects */}
            <div>
              <h4 className="text-xs font-semibold text-text-muted mb-2.5 uppercase tracking-wide">Favorite Effects ({favoriteEffectsList.length})</h4>
              {favoriteEffectsList.length === 0 ? (
                <p className="text-xs text-text-muted/60 italic py-2 pl-1">No favorite effects saved.</p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {favoriteEffectsList.map((effect) => (
                    <EffectCard key={effect.id} effect={effect} isFavorite={true} isDownloading={downloadingIds.has(effect.id)} onFavorite={(e) => toggleFavorite(effect.id, e)} onApply={(e) => handleDownloadAndApply(effect, "effect", e)} onPreview={() => handlePreview(effect, "effect")} />
                  ))}
                </div>
              )}
            </div>

            {/* Favorite Templates */}
            <div>
              <h4 className="text-xs font-semibold text-text-muted mb-2.5 uppercase tracking-wide">Favorite Templates ({favoriteTemplatesList.length})</h4>
              {favoriteTemplatesList.length === 0 ? (
                <p className="text-xs text-text-muted/60 italic py-2 pl-1">No favorite templates saved.</p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {favoriteTemplatesList.map((template) => (
                    <TemplateCard key={template.id} template={template} isFavorite={true} isDownloading={downloadingIds.has(template.id)} onFavorite={(e) => toggleFavorite(template.id, e)} onApply={(e) => handleDownloadAndApply(template, "template", e)} onPreview={() => handlePreview(template, "template")} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Effects Display Grid */}
        {activeTab === "effects" && (
          <>
            {filteredEffects.length === 0 ? (
              <div className="h-40 flex flex-col items-center justify-center text-text-muted gap-1 text-xs">
                <p>No matching effects found</p>
                <p className="opacity-60">Try searching for other styles</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {filteredEffects.map((effect) => (
                  <EffectCard key={effect.id} effect={effect} isFavorite={favorites.includes(effect.id)} isDownloading={downloadingIds.has(effect.id)} onFavorite={(e) => toggleFavorite(effect.id, e)} onApply={(e) => handleDownloadAndApply(effect, "effect", e)} onPreview={() => handlePreview(effect, "effect")} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Templates Display Grid */}
        {activeTab === "templates" && (
          <>
            {filteredTemplates.length === 0 ? (
              <div className="h-40 flex flex-col items-center justify-center text-text-muted gap-1 text-xs">
                <p>No matching templates found</p>
                <p className="opacity-60">Try searching other categories</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {filteredTemplates.map((template) => (
                  <TemplateCard key={template.id} template={template} isFavorite={favorites.includes(template.id)} isDownloading={downloadingIds.has(template.id)} onFavorite={(e) => toggleFavorite(template.id, e)} onApply={(e) => handleDownloadAndApply(template, "template", e)} onPreview={() => handlePreview(template, "template")} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Auto Captions Panel */}
        {activeTab === "captions" && (
          <div className="p-4 bg-surface-raised/40 border border-border/50 rounded-xl space-y-4 text-xs">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-accent animate-pulse" />
              <h4 className="font-bold text-text-primary">Auto Caption Generator</h4>
            </div>
            <p className="text-text-muted leading-relaxed">Generate highly accurate captions automatically from the audio tracks in your project timeline. Powered by local speech recognition models.</p>

            <div className="space-y-3 pt-2">
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase block mb-1">Language</label>
                <select className="w-full bg-surface-raised border border-border rounded-md px-2.5 py-1.5 text-text-primary text-xs outline-none">
                  <option value="en">English (US)</option>
                  <option value="es">Español</option>
                  <option value="fr">Français</option>
                  <option value="de">Deutsch</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase block mb-1">Filter gaps & silence</label>
                <div className="flex items-center gap-2 mt-1">
                  <input type="checkbox" id="filter-silence" defaultChecked className="rounded border-border accent-accent cursor-pointer" />
                  <label htmlFor="filter-silence" className="text-text-muted cursor-pointer">
                    Automatically skip silent audio blocks
                  </label>
                </div>
              </div>
            </div>

            <Button className="w-full py-2 bg-accent hover:bg-accent/80 text-white font-semibold flex items-center justify-center gap-1.5 shadow-[0_4px_12px_rgba(108,99,255,0.2)] rounded-lg active:scale-[0.98] transition-all cursor-pointer mt-4" onClick={() => onAddToTimeline?.({ name: "Generating captions...", styleId: "neon-red" }, "text")}>
              <Sparkles className="w-4 h-4" />
              Start Captioning
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
