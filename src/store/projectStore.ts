/**
 * Project Store
 *
 * OWNERSHIP: Project persistence orchestration (facade, not domain owner)
 * PERSISTENCE: Persistent (saves to disk via Tauri)
 * MUTABILITY: Orchestrates mutations, doesn't own mutable state
 *
 * Responsibilities:
 * - Load project metadata + timeline state from disk
 * - Save project metadata + timeline state to disk
 * - Manage media assets list
 * - Trigger auto-save on changes
 * - Coordinate project lifecycle (create/open/close)
 *
 * Does NOT:
 * - Own live timeline state (timelineStore is source of truth)
 * - Mutate timeline directly (reads from timelineStore for save)
 * - Manage runtime resources (ProjectSession handles that)
 *
 * Architecture principle:
 * This is a persistence facade. It snapshots timelineStore for save,
 * and hydrates timelineStore on load. It does not compete with timelineStore
 * for ownership of live editing state.
 */

import { create } from "zustand";
import type { Project, MediaAsset } from "@/types";
import { useSettingsStore } from "./settingsStore";
import { TIMELINE_PPS_PER_ZOOM, TIMELINE_ZOOM_DEFAULT } from "@/lib/timelineZoom";

interface ProjectStore {
  project: Project | null;
  mediaAssets: MediaAsset[];
  recentProjects: Project[];
  toastMessage: string | null;
  setToastMessage: (message: string | null) => void;
  createProject: (name: string, aspectRatio: string, frameRate: 24 | 30 | 60) => void;
  loadProject: (project: Project, payload?: { tracks?: any[]; clips?: any[]; mediaAssets?: MediaAsset[] }) => Promise<void> | void;
  addMediaAsset: (asset: MediaAsset) => void;
  removeMediaAsset: (assetId: string) => void;
  updateProject: (updates: Partial<Project>) => void;
  setRecentProjects: (projects: Project[]) => void;
  deleteProject: (projectId: string) => Promise<void>;
  closeProject: () => Promise<void> | void;
  scheduleAutoSave: () => void;
}

const getAspectRatioDimensions = (ratio: string): { width: number; height: number } => {
  const map: Record<string, { width: number; height: number }> = {
    "16:9": { width: 1920, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
    "1:1": { width: 1080, height: 1080 },
    "4:3": { width: 1440, height: 1080 },
    "21:9": { width: 2520, height: 1080 },
  };
  return map[ratio] || map["16:9"];
};

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DELAY = 500; // ms

const DEFAULT_TIMELINE_VIEW = {
  tracks: [],
  clips: [],
  scrollLeft: 0,
  zoomLevel: TIMELINE_ZOOM_DEFAULT,
  pixelsPerSecond: TIMELINE_ZOOM_DEFAULT * TIMELINE_PPS_PER_ZOOM,
};

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  mediaAssets: [],
  recentProjects: [],
  toastMessage: null,

  setToastMessage: (message) => set({ toastMessage: message }),

  createProject: (name, aspectRatio, frameRate) => {
    const dims = getAspectRatioDimensions(aspectRatio);
    const project: Project = {
      id: `project-${Date.now()}`,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      aspectRatio: aspectRatio as any,
      canvasWidth: dims.width,
      canvasHeight: dims.height,
      frameRate,
      duration: 0,
    };
    set({ project, mediaAssets: [] });

    // Clear timeline state for new project
    import("./timelineStore").then(({ useTimelineStore }) => {
      useTimelineStore.setState(DEFAULT_TIMELINE_VIEW);
    });

    get().scheduleAutoSave();
  },

  loadProject: async (project, payload) => {
    // 1. Dispose previous runtime first
    try {
      const { disposeProjectRuntime } = await import("../core/runtime/ProjectRuntimeManager");
      await disposeProjectRuntime();
    } catch (err) {
      console.error("[LoadProject] Runtime disposal failed:", err);
    }

    // 2. Apply project and provided mediaAssets so normalization has access
    set({ project, mediaAssets: payload?.mediaAssets ?? [] });

    // 3. Hydrate timeline with normalized clips
    try {
      const { useTimelineStore } = await import("./timelineStore");

      const finalTracks = payload?.tracks ?? [];
      const finalClipsRaw = payload?.clips ?? [];

      const { normalizeClipTiming } = await import("../lib/timelineClip");
      const mediaAssets = get().mediaAssets;

      const normalizedClips = finalClipsRaw.map((clip) => {
        const asset = mediaAssets.find((a) => a.id === clip.mediaId);
        return normalizeClipTiming(clip, asset);
      });

      useTimelineStore.setState({
        ...DEFAULT_TIMELINE_VIEW,
        tracks: finalTracks,
        clips: normalizedClips,
      });
    } catch (err) {
      console.error("[LoadProject] Failed to restore timeline state:", err);
      import("./timelineStore").then(({ useTimelineStore }) => useTimelineStore.setState(DEFAULT_TIMELINE_VIEW));
    }

    // 4. Initialize runtime LAST — stores are now fully populated
    try {
      const { initializeProjectRuntime } = await import("../core/runtime/ProjectRuntimeManager");
      await initializeProjectRuntime(project.id);
    } catch (err) {
      console.error("[LoadProject] Runtime initialization failed:", err);
    }
  },

  addMediaAsset: (asset) => {
    set((state) => {
      // Check if asset with same path already exists
      const existingAsset = state.mediaAssets.find((a) => a.path === asset.path);

      if (existingAsset) {
        return state; // No change
      }

      return {
        mediaAssets: [...state.mediaAssets, asset],
      };
    });
    get().scheduleAutoSave();

    // Trigger background thumbnail pre-extraction for video assets.
    // The Low → Medium → High density cascade is handled entirely in Rust
    // Native decoder handles on-demand extraction via decode_frames_streaming
    // No preloading needed - decoder is fast enough (3-15ms per frame)
  },

  removeMediaAsset: (assetId) => {
    set((state) => ({
      mediaAssets: state.mediaAssets.filter((a) => a.id !== assetId),
    }));
    get().scheduleAutoSave();
  },

  updateProject: (updates) => {
    set((state) => ({
      project: state.project ? { ...state.project, ...updates, updatedAt: Date.now() } : null,
    }));
    get().scheduleAutoSave();
  },

  setRecentProjects: (projects) => {
    set({ recentProjects: projects });
  },

  deleteProject: async (projectId) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("delete_project", { projectId });

      // Remove from recent projects list
      set((state) => ({
        recentProjects: state.recentProjects.filter((p) => p.id !== projectId),
      }));

      // If the deleted project is currently open, close it
      const currentProject = get().project;
      if (currentProject && currentProject.id === projectId) {
        set({ project: null, mediaAssets: [] });
      }
    } catch (error) {
      console.error("[DeleteProject] Failed to delete project:", error);
      throw error;
    }
  },

  closeProject: async () => {
    // Ensure any pending auto-save completes before closing
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      const state = get();
      const { project, mediaAssets } = state;

      if (project) {
        try {
          const { useTimelineStore } = await import("./timelineStore");
          const { tracks, clips } = useTimelineStore.getState();

          // Convert camelCase to snake_case for Rust backend
          const projectData = {
            id: project.id,
            name: project.name,
            created_at: project.createdAt,
            modified_at: Date.now(),
            aspect_ratio: project.aspectRatio,
            canvas_width: project.canvasWidth,
            canvas_height: project.canvasHeight,
            frame_rate: project.frameRate,
            duration: project.duration,
            tracks,
            clips,
            media_assets: mediaAssets,
          };

          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("save_project", {
            projectData: JSON.stringify(projectData),
          });

          get().setToastMessage("Project saved");
          setTimeout(() => get().setToastMessage(null), 2000);
        } catch (error) {
          console.error("[CloseProject] Failed to save project:", error);
        }
      }
    }
    // Dispose runtime after we've saved timeline state to avoid save-read race
    try {
      const { disposeProjectRuntime } = await import("../core/runtime/ProjectRuntimeManager");
      await disposeProjectRuntime();
    } catch (err) {
      console.error("[CloseProject] Error disposing runtime:", err);
    }

    // Now clear project and media assets
    set({ project: null, mediaAssets: [] });

    // Ensure timeline is cleared (dispose may already have done this)
    import("./timelineStore").then(({ useTimelineStore }) => {
      useTimelineStore.setState(DEFAULT_TIMELINE_VIEW);
    });
  },

  scheduleAutoSave: () => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }

    // Respect the auto-save toggle from settings
    if (!useSettingsStore.getState().autoSave) return;

    autoSaveTimer = setTimeout(async () => {
      const state = get();
      const { project, mediaAssets } = state;

      if (!project) return;

      try {
        // Import timeline store to get tracks and clips
        const { useTimelineStore } = await import("./timelineStore");
        const { tracks, clips } = useTimelineStore.getState();

        // Convert camelCase to snake_case for Rust backend
        const projectData = {
          id: project.id,
          name: project.name,
          created_at: project.createdAt,
          modified_at: Date.now(),
          aspect_ratio: project.aspectRatio,
          canvas_width: project.canvasWidth,
          canvas_height: project.canvasHeight,
          frame_rate: project.frameRate,
          duration: project.duration,
          tracks,
          clips,
          media_assets: mediaAssets,
        };

        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_project", {
          projectData: JSON.stringify(projectData),
        });
        get().setToastMessage("Project saved");
        setTimeout(() => get().setToastMessage(null), 2000);
      } catch (error) {
        console.error("[AutoSave] Failed to save project:", error);
      }
    }, AUTO_SAVE_DELAY);
  },
}));
