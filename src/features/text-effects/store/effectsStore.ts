// src/features/text-effects/store/effectsStore.ts
import { create } from "zustand";
import type { EffectIndexItem, EffectFullDefinition } from "../types/types";
import { ClypraApi } from "../api/clypraApi";

const API_BASE = "https://clypra-worker-api.abdulkabirmusa.com";
const API_KEY = import.meta.env.VITE_CLYPRA_API_KEY || "";

// Helper function to create headers with API key
const getHeaders = (): HeadersInit => {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "X-Clypra-Client": "clypra-desktop-v1",
    "User-Agent": "Clypra-Desktop/1.0.0",
  };

  if (API_KEY) {
    headers["X-API-Key"] = API_KEY;
  }

  return headers;
};

interface EffectsState {
  // ── Phase 1: Grid index ─────────────────────────────────────────
  index: Record<string, EffectIndexItem[]>; // category → items
  indexLoading: boolean;
  indexError: string | null;

  // ── Phase 2: Full definitions ───────────────────────────────────
  definitions: Record<string, EffectFullDefinition>; // id → definition
  loadingId: string | null; // which card shows a spinner
  prefetchingIds: Set<string>; // silent background fetches

  // ── Selected effect ─────────────────────────────────────────────
  selectedEffect: EffectFullDefinition | null;
  selectedCategory: string | null;

  // ── Actions ─────────────────────────────────────────────────────
  loadCategory: (category: string) => Promise<void>;
  getDefinitionById: (id: string, category: string) => Promise<EffectFullDefinition>;
  selectEffect: (id: string, category: string) => Promise<void>;
  prefetchEffect: (id: string, category: string) => void; // fire and forget
  clearSelected: () => void;
  fetchDefinitionOnlyById: (id: string) => Promise<EffectFullDefinition>;
}

export const useEffectsStore = create<EffectsState>((set, get) => ({
  index: {},
  indexLoading: false,
  indexError: null,
  definitions: {},
  loadingId: null,
  prefetchingIds: new Set(),
  selectedEffect: null,
  selectedCategory: null,

  // ── loadCategory ──────────────────────────────────────────────
  // Called on panel open or tab switch
  // No-ops if category already in memory
  loadCategory: async (category) => {
    // Standardize category lookup (e.g. lowercase)
    const catKey = category.toLowerCase();
    if (get().index[catKey]) return;

    set({ indexLoading: true, indexError: null });

    try {
      const res = await fetch(`${API_BASE}/effects/${catKey}`, {
        cache: "reload",
        headers: getHeaders(),
      });

      // Handle 404 as empty category (category doesn't exist yet on API)
      if (res.status === 404) {
        set((state) => ({
          index: { ...state.index, [catKey]: [] },
          indexLoading: false,
        }));
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as EffectIndexItem[];

      set((state) => ({
        index: { ...state.index, [catKey]: data },
        indexLoading: false,
      }));
    } catch (err) {
      set({
        indexLoading: false,
        indexError: "Failed to load effects. Tap to retry.",
      });
    }
  },

  getDefinitionById: async (id, category) => {
    const cached = get().definitions[id];
    if (cached) return cached;

    const catKey = category.toLowerCase();
    const res = await fetch(`${API_BASE}/effects/${catKey}/${id}`, {
      cache: "reload",
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as EffectFullDefinition;

    set((state) => ({
      definitions: { ...state.definitions, [id]: data },
    }));

    return data;
  },

  // ── selectEffect ─────────────────────────────────────────────
  // Called on card click
  // Shows spinner on card if definition not yet cached
  selectEffect: async (id, category) => {
    const catKey = category.toLowerCase();

    // Show loading state on the clicked card
    set({ loadingId: id });

    try {
      const data = await get().getDefinitionById(id, catKey);

      set({
        selectedEffect: data,
        selectedCategory: catKey,
        loadingId: null,
      });
    } catch (err) {
      set({ loadingId: null });
    }
  },

  // ── prefetchEffect ────────────────────────────────────────────
  // Called on 300ms hover hold — fire and forget, no loading state
  // Primes the cache so that selectEffect() is instant on click
  prefetchEffect: (id, category) => {
    const catKey = category.toLowerCase();
    const state = get();
    if (state.definitions[id]) return; // already cached
    if (state.prefetchingIds.has(id)) return; // already in flight

    set((s) => {
      const nextPrefetching = new Set(s.prefetchingIds);
      nextPrefetching.add(id);
      return { prefetchingIds: nextPrefetching };
    });

    fetch(`${API_BASE}/effects/${catKey}/${id}`, {
      cache: "reload",
      headers: getHeaders(),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: EffectFullDefinition) => {
        set((s) => {
          const nextPrefetching = new Set(s.prefetchingIds);
          nextPrefetching.delete(id);
          return {
            definitions: { ...s.definitions, [id]: data },
            prefetchingIds: nextPrefetching,
          };
        });
      })
      .catch(() => {
        set((s) => {
          const nextPrefetching = new Set(s.prefetchingIds);
          nextPrefetching.delete(id);
          return { prefetchingIds: nextPrefetching };
        });
      });
  },

  clearSelected: () => set({ selectedEffect: null, selectedCategory: null }),
  fetchDefinitionOnlyById: async (id) => {
    const cached = get().definitions[id];
    if (cached) return cached;

    const index = await ClypraApi.getEffectsIndex();
    const item = index.find((x) => x.id === id);
    if (!item) throw new Error(`Effect with ID ${id} not found in index`);

    const def = await get().getDefinitionById(id, item.category);
    return def;
  },
}));
