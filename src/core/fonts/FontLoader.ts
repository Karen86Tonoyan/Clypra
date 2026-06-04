/**
 * Font Loading System — Delegated to `@clypra/engine`
 *
 * Ensures deterministic font availability before rendering.
 * Re-exports the unified font loader from `@clypra/engine`.
 */

export type { FontDescriptor, FontLoadResult } from "@clypra/engine";

export { FontLoader, getFontLoader, resetFontLoader, ensureFontsLoaded } from "@clypra/engine";
