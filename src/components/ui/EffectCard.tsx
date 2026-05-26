import { useRef, useEffect } from "react";
import { Download, Star } from "lucide-react";
import { type TextEffectPreset } from "@/constants/textEffects";
import { renderTextEffect } from "@/features/renderer/renderer";
import { allEffects } from "@/features/renderer/definitions";

interface EffectCardProps {
  effect: TextEffectPreset;
  isFavorite: boolean;
  isDownloading: boolean;
  onFavorite: (e: React.MouseEvent) => void;
  onApply: (e: React.MouseEvent) => void;
  onPreview: () => void;
}

export const EffectCard: React.FC<EffectCardProps> = ({ effect, isFavorite, isDownloading, onFavorite, onApply, onPreview }) => {
  const premiumEffect = allEffects.find((e) => e.id === effect.id);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (premiumEffect && canvasRef.current) {
      const canvas = canvasRef.current;
      canvas.width = 250;
      canvas.height = 100;
      renderTextEffect(canvas, "Default text", premiumEffect, 22);

      if (typeof document !== "undefined" && document.fonts) {
        document.fonts.ready.then(() => {
          renderTextEffect(canvas, "Default text", premiumEffect, 22);
        });
      }
    }
  }, [effect, premiumEffect]);

  return (
    <div onClick={onPreview} className="w-full aspect-square bg-surface-raised/40 hover:bg-surface-raised/80 border border-border/40 hover:border-accent/40 rounded-xl relative overflow-hidden flex flex-col justify-between p-2.5 transition-all duration-300 group cursor-pointer">
      {/* Favorite Star (hover show or active) */}
      <button onClick={onFavorite} className={`absolute top-2 right-2 p-1 cursor-pointer rounded-full bg-black/40 hover:bg-black/60 border border-white/5 text-white/70 hover:text-white transition-all duration-200 z-10 ${isFavorite ? "opacity-100 text-yellow-400!" : "opacity-0 group-hover:opacity-100 group-hover:translate-y-0 translate-y-2"}`}>
        <Star className={`w-3 h-3 ${isFavorite ? "fill-yellow-400 text-yellow-400!" : ""}`} />
      </button>

      {/* Real-time HTML Styled Visual Canvas Preview */}
      <div className="flex-1 flex items-center justify-center w-full px-1 py-3 select-none relative overflow-hidden">
        <canvas ref={canvasRef} className="max-w-full max-h-full block select-none pointer-events-none" />
      </div>

      {/* Footer Info / Apply Download Button */}
      <div className="flex items-center justify-between w-full mt-0.5">
        <span className="text-[9px] text-text-muted font-medium group-hover:text-text-primary transition-colors truncate max-w-[65px]">{effect.name}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onApply(e);
          }}
          className="w-5.5 h-5.5 rounded-full bg-black/40 hover:bg-black/60 border border-white/5 flex items-center justify-center text-text-muted hover:text-text-primary transition-all relative cursor-pointer"
        >
          {isDownloading ? <div className="w-3 h-3 rounded-full border border-accent border-t-transparent animate-spin" /> : <Download className="w-2.5 h-2.5 group-hover:scale-115 transition-transform" />}
        </button>
      </div>
    </div>
  );
};
