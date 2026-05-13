/**
 * Render Engine Store
 *
 * OWNERSHIP: Render runtime lifecycle (GPU resources, compositor)
 * PERSISTENCE: Non-persistent (ephemeral GPU resources)
 * MUTABILITY: Manages render runtime, consumes timeline as immutable input
 *
 * Responsibilities:
 * - Own RenderRuntime instance (GPU compositor, shader pipelines)
 * - Initialize/destroy render resources on project switch
 * - Provide render quality/mode configuration
 * - Expose render stats for debugging
 *
 * Does NOT:
 * - Own timeline data (consumes timelineStore as input)
 * - Mutate timeline state (read-only consumer)
 * - Persist render settings (future: move to workspace store)
 *
 * Architecture principle:
 * Render engine is a pure function: timeline state → pixels
 * It consumes timeline as immutable input and produces frames.
 * This enables deterministic rendering for export/background jobs.
 *
 * Why Zustand over React Context:
 * - Selector-based subscriptions prevent subtree re-renders
 * - Survives HMR without losing runtime state
 * - Deterministic teardown via destroyRuntime()
 * - Supports multiple concurrent projects without React tree coupling
 */

import { create } from "zustand";
import { RenderRuntime } from "@/lib/renderEngine/renderRuntime";
import { type QualityPreset, type RendererMode, type SrpConfig } from "@/lib/renderEngine/types";
import { resetFrameScheduler } from "../core/scheduler/FrameScheduler";
import { resetPlaybackClock } from "../core/playback/PlaybackClock";
import { resetEvaluationCache } from "../core/evaluation/cache";

interface RenderEngineStore {
  runtime: RenderRuntime | null;

  initRuntime: (
    projectId: string,
    options?: {
      srpConfig?: SrpConfig;
      qualityPreset?: QualityPreset;
      rendererMode?: RendererMode;
    },
  ) => void;

  destroyRuntime: () => void;
}

export const useRenderEngineStore = create<RenderEngineStore>((set, get) => ({
  runtime: null,

  initRuntime: (projectId, options = {}) => {
    get().destroyRuntime();
    const runtime = new RenderRuntime(projectId, options);
    set({ runtime });
  },

  destroyRuntime: () => {
    const { runtime } = get();
    if (runtime) {
      resetFrameScheduler();
      resetPlaybackClock();
      resetEvaluationCache();
      runtime.teardown();
      set({ runtime: null });
    }
  },
}));
