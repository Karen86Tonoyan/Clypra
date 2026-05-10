/**
 * renderEngineStore — Zustand store owning RenderRuntime lifecycle.
 *
 * Why Zustand over React Context:
 *   - Selector-based subscriptions prevent subtree re-renders
 *   - Survives HMR without losing runtime state
 *   - Deterministic teardown via destroyRuntime()
 *   - Supports multiple concurrent projects without React tree coupling
 */

import { create } from "zustand";
import { RenderRuntime } from "../lib/renderEngine/renderRuntime";
import { type QualityPreset, type RendererMode, type SrpConfig } from "../lib/renderEngine/types";

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
      runtime.teardown();
      set({ runtime: null });
    }
  },
}));
