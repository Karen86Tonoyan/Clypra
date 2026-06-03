/**
 * Font Loading System
 *
 * Ensures deterministic font availability before rendering.
 * Without this, text layout will drift between preview and export.
 *
 * Key principles:
 * - Load fonts before preview/export rasterization
 * - Wait for document.fonts.ready
 * - Preload required fonts per project
 * - Fall back cleanly if a font is missing
 *
 * Architecture:
 *   Font Request → FontLoader → document.fonts → Ready Signal
 */

/**
 * Font descriptor for loading.
 */
export interface FontDescriptor {
  /** Font family name */
  family: string;

  /** Font weight (normal, bold, or numeric 100-900) */
  weight?: string | number;

  /** Font style */
  style?: "normal" | "italic";
}

/**
 * Font loading result.
 */
export interface FontLoadResult {
  /** Font descriptor */
  font: FontDescriptor;

  /** Whether font loaded successfully */
  loaded: boolean;

  /** Error message if failed */
  error?: string;

  /** Load time in ms */
  loadTimeMs: number;
}

/**
 * Font loader state.
 */
interface FontLoaderState {
  /** Fonts currently loading */
  loading: Set<string>;

  /** Successfully loaded fonts */
  loaded: Set<string>;

  /** Failed fonts */
  failed: Map<string, string>;

  /** Load promises (for deduplication) */
  promises: Map<string, Promise<FontLoadResult>>;
}

/**
 * Font Loader
 *
 * Manages font loading with deduplication and caching.
 */
export class FontLoader {
  private state: FontLoaderState = {
    loading: new Set(),
    loaded: new Set(),
    failed: new Map(),
    promises: new Map(),
  };

  /**
   * Ensure a single font is loaded.
   *
   * @param descriptor - Font descriptor
   * @returns Load result
   */
  async ensureFont(descriptor: FontDescriptor): Promise<FontLoadResult> {
    const key = this.getFontKey(descriptor);

    // Already loaded
    if (this.state.loaded.has(key)) {
      return {
        font: descriptor,
        loaded: true,
        loadTimeMs: 0,
      };
    }

    // Already failed
    if (this.state.failed.has(key)) {
      return {
        font: descriptor,
        loaded: false,
        error: this.state.failed.get(key),
        loadTimeMs: 0,
      };
    }

    // Currently loading - return existing promise
    if (this.state.promises.has(key)) {
      return this.state.promises.get(key)!;
    }

    // Start loading
    const promise = this.loadFont(descriptor);
    this.state.promises.set(key, promise);

    return promise;
  }

  /**
   * Ensure multiple fonts are loaded.
   *
   * @param descriptors - Font descriptors
   * @returns Load results
   */
  async ensureFonts(descriptors: FontDescriptor[]): Promise<FontLoadResult[]> {
    return Promise.all(descriptors.map((desc) => this.ensureFont(desc)));
  }

  /**
   * Wait for all fonts to be ready.
   * Uses document.fonts.ready for deterministic loading.
   */
  async waitForFontsReady(): Promise<void> {
    if (typeof document === "undefined" || !document.fonts) {
      return;
    }

    await document.fonts.ready;
  }

  /**
   * Check if a font is loaded.
   *
   * @param descriptor - Font descriptor
   * @returns True if loaded
   */
  isLoaded(descriptor: FontDescriptor): boolean {
    const key = this.getFontKey(descriptor);
    return this.state.loaded.has(key);
  }

  /**
   * Get loading statistics.
   */
  getStats() {
    return {
      loaded: this.state.loaded.size,
      loading: this.state.loading.size,
      failed: this.state.failed.size,
    };
  }

  /**
   * Clear cache (for testing).
   */
  clear(): void {
    this.state.loading.clear();
    this.state.loaded.clear();
    this.state.failed.clear();
    this.state.promises.clear();
  }

  /**
   * Load a single font.
   */
  private async loadFont(descriptor: FontDescriptor): Promise<FontLoadResult> {
    const key = this.getFontKey(descriptor);
    const startTime = performance.now();

    this.state.loading.add(key);

    try {
      // Check if font is available in document.fonts
      if (typeof document === "undefined" || !document.fonts) {
        throw new Error("Font API not available");
      }

      // Build font face string
      const weight = this.normalizeFontWeight(descriptor.weight);
      const style = descriptor.style || "normal";
      const fontFace = `${style} ${weight} 16px "${descriptor.family}"`;

      // Check if font is already loaded
      if (document.fonts.check(fontFace)) {
        this.state.loaded.add(key);
        this.state.loading.delete(key);
        this.state.promises.delete(key);

        return {
          font: descriptor,
          loaded: true,
          loadTimeMs: performance.now() - startTime,
        };
      }

      // Load font
      await document.fonts.load(fontFace);

      // Verify font loaded
      if (!document.fonts.check(fontFace)) {
        throw new Error(`Font "${descriptor.family}" failed to load`);
      }

      this.state.loaded.add(key);
      this.state.loading.delete(key);
      this.state.promises.delete(key);

      return {
        font: descriptor,
        loaded: true,
        loadTimeMs: performance.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      this.state.failed.set(key, errorMessage);
      this.state.loading.delete(key);
      this.state.promises.delete(key);

      return {
        font: descriptor,
        loaded: false,
        error: errorMessage,
        loadTimeMs: performance.now() - startTime,
      };
    }
  }

  /**
   * Get cache key for a font.
   */
  private getFontKey(descriptor: FontDescriptor): string {
    const weight = this.normalizeFontWeight(descriptor.weight);
    const style = descriptor.style || "normal";
    return `${descriptor.family}|${weight}|${style}`;
  }

  /**
   * Normalize font weight to numeric value.
   * Handles numeric types, numeric strings (e.g. "600"), and CSS keyword strings.
   */
  private normalizeFontWeight(weight?: string | number): number {
    if (typeof weight === "number") {
      return weight;
    }

    if (!weight) return 400;

    // Parse numeric strings like "600", "800" directly
    const asNum = parseInt(weight, 10);
    if (!isNaN(asNum) && asNum >= 100 && asNum <= 900) {
      return asNum;
    }

    const weightMap: Record<string, number> = {
      normal: 400,
      bold: 700,
      lighter: 300,
      // "bolder" is a relative CSS keyword — map to 700 as a reasonable fixed fallback
      bolder: 700,
    };

    return weightMap[weight] ?? 400;
  }
}

/**
 * Global font loader instance.
 */
let globalFontLoader: FontLoader | null = null;

/**
 * Get or create global font loader.
 */
export function getFontLoader(): FontLoader {
  if (!globalFontLoader) {
    globalFontLoader = new FontLoader();
  }
  return globalFontLoader;
}

/**
 * Reset global font loader (for testing).
 */
export function resetFontLoader(): void {
  globalFontLoader = null;
}

/**
 * Convenience function to ensure fonts are loaded.
 *
 * @param descriptors - Font descriptors
 * @returns Load results
 */
export async function ensureFontsLoaded(descriptors: FontDescriptor[]): Promise<FontLoadResult[]> {
  const loader = getFontLoader();
  return loader.ensureFonts(descriptors);
}
