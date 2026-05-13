import React, { useEffect, useState } from "react";
import { Film, Image as ImageIcon, Plus, Trash2, Clock, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useProjectStore } from "@/store/projectStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { AspectRatio, MediaAsset, Project } from "@/types";

interface LaunchScreenProps {
  onProjectCreate: (name: string, aspectRatio: AspectRatio, frameRate: 24 | 30 | 60) => void;
  onProjectOpen: (project: Project) => void;
}

const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http") || value.startsWith("asset://");

const toPreviewSrc = (value?: string) => {
  if (!value) return undefined;
  return value;
};

const getProjectThumbnail = (project: Project) => {
  const mediaAssets = project.mediaAssets ?? [];
  const firstVisualAsset = mediaAssets.find((asset) => asset.type === "video" || asset.type === "image") ?? mediaAssets[0];
  if (!firstVisualAsset) return undefined;
  if (firstVisualAsset.posterFrame) return toPreviewSrc(firstVisualAsset.posterFrame);
  if (firstVisualAsset.coverArt) return toPreviewSrc(firstVisualAsset.coverArt);
  if (firstVisualAsset.type === "image") return toPreviewSrc(firstVisualAsset.path);
  return undefined;
};

export const LaunchScreen: React.FC<LaunchScreenProps> = ({ onProjectCreate, onProjectOpen }) => {
  const { recentProjects, setRecentProjects, deleteProject } = useProjectStore();
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const loadRecentProjects = async () => {
      try {
        const { convertFileSrc, invoke } = await import("@tauri-apps/api/core");
        const projectsJson: string[] = await invoke("get_recent_projects");

        // Convert snake_case from Rust to camelCase for frontend
        const projects = projectsJson.map((json) => {
          const rustProject = JSON.parse(json);
          const mediaAssets: MediaAsset[] = Array.isArray(rustProject.media_assets)
            ? rustProject.media_assets.map((asset: MediaAsset) => ({
                ...asset,
                posterFrame: asset.posterFrame && !isExternalOrDataUrl(asset.posterFrame) ? convertFileSrc(asset.posterFrame) : asset.posterFrame,
                coverArt: asset.coverArt && !isExternalOrDataUrl(asset.coverArt) ? convertFileSrc(asset.coverArt) : asset.coverArt,
                path: asset.path && asset.type === "image" && !isExternalOrDataUrl(asset.path) ? convertFileSrc(asset.path) : asset.path,
              }))
            : [];
          return {
            id: rustProject.id,
            name: rustProject.name,
            createdAt: rustProject.created_at,
            updatedAt: rustProject.modified_at || rustProject.created_at,
            aspectRatio: rustProject.aspect_ratio,
            canvasWidth: rustProject.canvas_width,
            canvasHeight: rustProject.canvas_height,
            frameRate: rustProject.frame_rate,
            duration: rustProject.duration || 0,
            mediaAssets,
          };
        });

        setRecentProjects(projects);
      } catch (error) {
        console.error("Failed to load recent projects:", error);
      }
    };
    loadRecentProjects();
  }, [setRecentProjects]);

  const handleStartNewProject = () => {
    const { defaultFrameRate } = useSettingsStore.getState();
    onProjectCreate("Untitled Project", "9:16", defaultFrameRate);
  };

  const handleDeleteClick = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setProjectToDelete(project);
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      await deleteProject(projectToDelete.id);
      setProjectToDelete(null);
    } catch (error) {
      console.error("Failed to delete project:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (dateStr: string | number) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="w-full h-full bg-bg flex flex-col overflow-hidden">
      {/* Native title bar area */}
      <div className="h-[37px] select-none flex items-center justify-center bg-transparent" data-tauri-drag-region style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
        <span className="text-xs font-semibold text-text-muted/60">Clypra</span>
      </div>

      {/* ── Background gradient ─────────────────────────────────── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 80% 50% at 50% -10%, var(--color-accent, #6c63ff) 0%, transparent 60%)",
          opacity: 0.06,
        }}
      />

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 flex flex-col w-full px-6 md:px-10 py-8 overflow-y-auto scrollbar-thin">
        {/* Header / Brand */}
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <Film className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-text-primary tracking-tight leading-tight">Clypra</h1>
              <p className="text-[11px] text-text-muted font-medium tracking-wide">VIDEO EDITOR</p>
            </div>
          </div>
          <span className="text-[10px] text-text-muted/50 font-mono">v0.1.0-dev</span>
        </header>

        {/* ── Hero / New Project ────────────────────────────────── */}
        <section className="mb-12">
          <div
            className="relative rounded-2xl overflow-hidden border border-white/4 p-8 md:p-10 flex flex-col items-center text-center"
            style={{
              background: "linear-gradient(135deg, var(--color-surface, #1a1a1a) 0%, var(--color-bg, #0f0f0f) 100%)",
            }}
          >
            {/* Subtle glow */}
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[120px] rounded-full pointer-events-none"
              style={{
                background: "var(--color-accent, #6c63ff)",
                opacity: 0.07,
                filter: "blur(60px)",
              }}
            />

            <div className="relative z-10">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 text-accent text-[11px] font-semibold mb-4">
                <Sparkles className="w-3 h-3" />
                Create something amazing
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-text-primary mb-2 tracking-tight">Start a new project</h2>
              <p className="text-sm text-text-muted mb-6 max-w-md">Begin with a 9:16 portrait canvas optimized for social media, or open a recent project below.</p>
              <Button variant="default" size="lg" onClick={handleStartNewProject} className="px-8 py-3 text-base font-semibold rounded-xl shadow-lg shadow-accent/20 hover:shadow-accent/30 transition-shadow">
                <Plus className="w-5 h-5 mr-2" />
                New Project
              </Button>
            </div>
          </div>
        </section>

        {/* ── Recent Projects ──────────────────────────────────── */}
        <section className="flex-1">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-text-muted" />
            <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">Recent Projects</h3>
          </div>

          {recentProjects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.06] p-10 flex flex-col items-center justify-center text-center">
              <Film className="w-10 h-10 text-text-muted/30 mb-3" />
              <p className="text-sm text-text-muted">No recent projects</p>
              <p className="text-xs text-text-muted/60 mt-1">Create a new project to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentProjects.map((project) => {
                const thumbnail = getProjectThumbnail(project);
                return (
                  <button key={project.id} onClick={() => onProjectOpen(project)} className="group relative text-left rounded-xl border border-white/[0.04] bg-surface hover:bg-surface-raised transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.08] hover:shadow-lg hover:shadow-black/20 overflow-hidden">
                    {/* Thumbnail area */}
                    <div className="h-[170px] bg-bg flex items-center justify-center relative overflow-hidden">
                      {thumbnail ? (
                        <>
                          <img src={thumbnail} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-xl transition-transform duration-300 group-hover:scale-[1.14]" draggable={false} />
                          <div className="absolute inset-3 flex items-center justify-center overflow-hidden rounded-lg">
                            <img src={thumbnail} alt="" className="max-h-full max-w-full object-contain opacity-95 shadow-[0_12px_28px_rgba(0,0,0,0.28)] transition-transform duration-300 group-hover:scale-[1.02]" draggable={false} />
                          </div>
                        </>
                      ) : (
                        <ImageIcon className="w-7 h-7 text-text-muted/25 group-hover:text-accent/40 transition-colors" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-bg/55 via-transparent to-bg/10" />
                      {/* Accent glow on hover */}
                      <div className="absolute inset-0 bg-accent/[0.03] opacity-0 group-hover:opacity-100 transition-opacity" />
                      {/* Aspect ratio badge */}
                      <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-bg/75 backdrop-blur-sm text-text-muted border border-white/[0.06]">{project.aspectRatio}</span>
                    </div>

                    {/* Info */}
                    <div className="px-3.5 py-4">
                      <h4 className="text-sm font-semibold text-text-primary truncate group-hover:text-accent-soft transition-colors">{project.name}</h4>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-text-muted">{formatDate(project.createdAt)}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-text-muted/30 group-hover:text-accent/60 transition-colors" />
                      </div>
                    </div>

                    {/* Delete button */}
                    <div onClick={(e) => handleDeleteClick(e, project)} className="absolute top-2 left-2 p-1.5 rounded-lg bg-bg/80 backdrop-blur-sm border border-white/[0.04] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-danger/20 hover:border-danger/30 cursor-pointer" title="Delete project">
                      <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-danger transition-colors" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!projectToDelete} onClose={() => setProjectToDelete(null)} title="Delete Project">
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-primary">
            Are you sure you want to delete <strong>{projectToDelete?.name}</strong>?
          </p>
          <p className="text-xs text-text-muted">This action cannot be undone. All project data will be permanently deleted.</p>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => setProjectToDelete(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="default" onClick={handleConfirmDelete} disabled={isDeleting} className="bg-danger hover:bg-danger/80">
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
