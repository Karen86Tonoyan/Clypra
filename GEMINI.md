# Clypra: AI Developer Guidelines & Project Rules

Welcome to the Clypra repository. This `GEMINI.md` file serves as the strict source of truth for the architecture, technology stack, conventions, and operational rules for this codebase. Any AI assistant contributing to this repository must strictly adhere to these instructions.

---

## 1. Core Technology Stack
- **Framework**: Tauri v2
- **Frontend**: React 19, TypeScript, Vite
- **Styling**: TailwindCSS v4, Lucide React, Shadcn/Radix UI
- **State Management**: Zustand
- **Drag and Drop**: React DnD
- **Backend (Desktop Core)**: Rust (Strict compilation)
- **Media Processing Engine**: FFmpeg (via `ffmpeg-sys-next` crate)

---

## 2. Native Desktop Runtime (CRITICAL)
Clypra is a native desktop app that runs inside Tauri's WebView, granting filesystem and command-line access through Tauri APIs.

**The Golden Rule of Tauri Imports**:
- **Always** wrap Tauri-specific functionality in environment checks where code can execute before the Tauri bridge is ready. Verify the presence of `window.__TAURI_INTERNALS__` before executing Tauri APIs.

---

## 3. Frontend & UI Design Rules
- **Aesthetic standard**: The UI must be highly modern, premium, and "dynamic". Utilize glassmorphic effects (backdrop-blur), rich gradients, smooth hover micro-animations, and modern typography (Inter, Outfit).
- **Styling constraints**: Strictly use Tailwind CSS v4. Do not clutter files with arbitrary global CSS unless modifying core token variables in `index.css`.
- **Testing**: All frontend logic and utility functions must maintain 100% test coverage using Vitest and React Testing Library.

---

## 4. Backend Rust Rules
- **Strict Clippy**: The Rust backend is configured with strict compiler rules. You must run `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` before committing any backend changes.
- **Zero Warnings**: Code must compile with 0 errors and 0 warnings. Fix all linting macros (e.g., use `matches!` over explicit match expressions where suggested).
- **Concurrency**: Do not block the main thread. Use `async fn` and Tauri's async `invoke` command macros for heavy native operations (like FFmpeg encoding).

---

## 5. Automated CI/CD & Cross-Compilation Rules
The `master` branch is protected. Code must be developed on `feature/*` branches and merged via Pull Requests. The CI/CD pipelines run complex cross-platform builds.

**NEVER MODIFY THESE PIPELINE BEHAVIORS WITHOUT APPROVAL:**
- **macOS (`macos-latest`)**: GitHub Actions macOS runners use Apple Silicon (ARM64). **Do not** attempt to build a `universal-apple-darwin` target for FFmpeg. Native Homebrew only installs the `aarch64` libraries.
- **Linux (`ubuntu-22.04`)**: Compiling `ffmpeg-sys-next` requires specific `apt-get` packages. Always ensure `libavfilter-dev`, `libavdevice-dev`, and `libpostproc-dev` are present in the dependency installation step.
- **Windows (`windows-latest`)**: The Windows FFmpeg bundle is built statically using `vcpkg`. To ensure Rust successfully discovers and links essential Windows libraries (like `strmiids.lib`, `ole32.lib`), you must set the `VCPKG_ROOT` environment variable and **NOT** use `FFMPEG_DIR`. Setting `FFMPEG_DIR` bypasses the `vcpkg` dependency prober and causes catastrophic linker errors.

---

## 6. Dependency Management Rules
- **Package Lock Corruptions**: Always run `npm install` locally and review `package-lock.json` modifications before committing.
- If upstream lockfile corruptions arise (e.g., packages accidentally prefixed with `@/` instead of `@`), you must fix the typos in `package-lock.json` using `sed` or file replacements, and re-run `npm install` to clean the tree before pushing to CI.
