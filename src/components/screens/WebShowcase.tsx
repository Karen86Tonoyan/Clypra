import React from "react";
import { Download, Play, Sparkles, Shield, Monitor, Layers, Sliders, ArrowRight, Laptop, HelpCircle, Terminal } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface WebShowcaseProps {
  onLaunchDemo: () => void;
}

export const WebShowcase: React.FC<WebShowcaseProps> = ({ onLaunchDemo }) => {
  return (
    <div className="w-full min-h-screen bg-[#09090b] text-[#fafafa] flex flex-col font-sans selection:bg-accent/30 selection:text-white overflow-x-hidden">
      {/* ── Background Gradients & Glows ─────────────────────────── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        {/* Top central mesh glow */}
        <div
          className="absolute -top-[40%] left-1/2 -translate-x-1/2 w-[80%] h-[70%] rounded-full blur-[120px]"
          style={{
            background: "radial-gradient(circle, rgba(108, 99, 255, 0.12) 0%, rgba(139, 92, 246, 0.04) 50%, transparent 100%)",
          }}
        />
        {/* Right side glowing orb */}
        <div
          className="absolute top-[30%] right-[-10%] w-[40%] h-[50%] rounded-full blur-[150px]"
          style={{
            background: "radial-gradient(circle, rgba(6, 182, 212, 0.06) 0%, transparent 80%)",
          }}
        />
      </div>

      {/* ── Navigation / Header ────────────────────────────────── */}
      <header className="relative z-10 w-full max-w-7xl mx-auto px-6 h-20 flex items-center justify-between border-b border-white/[0.04] backdrop-blur-md bg-[#09090b]/40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center relative">
            <div className="absolute inset-0 bg-accent/20 blur-md rounded-full animate-pulse"></div>
            <img src="/clypra.svg" alt="Clypra Logo" className="w-9 h-9 object-contain relative z-10" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-white to-neutral-400 bg-clip-text text-transparent">Clypra</h1>
            <p className="text-[9px] text-text-muted font-mono tracking-widest uppercase">Desktop Video Editor</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="https://github.com/AIEraDev/clypra"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-text-muted hover:text-white transition-colors flex items-center gap-1.5 font-medium"
          >
            GitHub Repository
            <ArrowRight className="w-3 h-3" />
          </a>
        </div>
      </header>

      {/* ── Hero Section ────────────────────────────────────────── */}
      <main className="relative z-10 flex-1 w-full max-w-7xl mx-auto px-6 py-12 md:py-20 flex flex-col gap-16">
        <section className="text-center max-w-3xl mx-auto flex flex-col gap-6">
          <div className="inline-flex self-center items-center gap-2 px-3 py-1 rounded-full border border-accent/30 bg-accent/10 backdrop-blur-md shadow-[0_0_20px_rgba(108,99,255,0.1)]">
            <Sparkles className="w-3.5 h-3.5 text-accent animate-bounce" />
            <span className="text-[10px] font-semibold tracking-wider text-accent uppercase font-mono">Web Sandbox Released</span>
          </div>

          <h2 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.1] bg-gradient-to-b from-white via-white to-neutral-400 bg-clip-text text-transparent font-outfit">
            A Premium Desktop Video Editor.
            <br />
            <span className="bg-gradient-to-r from-accent to-purple-400 bg-clip-text text-transparent">Directly in Your Browser.</span>
          </h2>

          <p className="text-sm md:text-base text-text-muted leading-relaxed font-sans max-w-2xl mx-auto">
            Clypra is a modern, high-performance video editor engineered using Tauri, React, and Rust. Experience the desktop-class NLE timeline, visual asset pools, and instant video exports directly in this web showcase.
          </p>
        </section>

        {/* ── Interactive Web Sandbox Callout (PRIMARY ACTION) ── */}
        <section className="w-full">
          <div
            className="relative rounded-3xl overflow-hidden border border-white/[0.06] p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8 backdrop-blur-xl bg-surface/50 shadow-[0_20px_50px_rgba(0,0,0,0.4)] group"
            style={{
              background: "linear-gradient(135deg, rgba(20, 20, 25, 0.7) 0%, rgba(10, 10, 12, 0.9) 100%)",
            }}
          >
            {/* Hover card border glow */}
            <div className="absolute inset-0 border border-accent/0 group-hover:border-accent/10 rounded-3xl transition-colors duration-500 pointer-events-none" />
            
            <div className="flex-1 flex flex-col gap-4 text-left">
              <div className="inline-flex self-start items-center gap-1.5 text-accent font-semibold text-xs tracking-wider uppercase font-mono">
                <Laptop className="w-4 h-4" />
                Browser Sandbox
              </div>
              <h3 className="text-2xl md:text-3xl font-bold tracking-tight text-white font-outfit">
                Try the Clypra Interactive Web Demo
              </h3>
              <p className="text-xs md:text-sm text-text-muted leading-relaxed max-w-xl">
                Experience the timeline tracks, clip drag-and-drop mechanics, preset configurations, and the real-time frame renderer. No download required. Runs securely in sandbox mode.
              </p>
            </div>

            <div className="shrink-0">
              <Button
                onClick={onLaunchDemo}
                className="relative h-14 px-8 text-base font-semibold bg-accent text-white hover:bg-accent/90 hover:scale-[1.02] active:scale-[0.98] transition-all rounded-2xl flex items-center gap-3 shadow-[0_0_30px_rgba(108,99,255,0.4)] hover:shadow-[0_0_40px_rgba(108,99,255,0.6)] cursor-pointer group-hover:animate-pulse"
              >
                <Play className="w-5 h-5 fill-white text-white" />
                Launch Web Demo
                <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
              </Button>
            </div>
          </div>
        </section>

        {/* ── Native Downloads Section ── */}
        <section className="flex flex-col gap-8">
          <div className="text-center md:text-left flex flex-col gap-2">
            <h3 className="text-2xl font-bold tracking-tight text-white font-outfit">Download Desktop Builds</h3>
            <p className="text-xs text-text-muted max-w-lg leading-relaxed">
              Clypra compiles to optimized native executables for hardware acceleration, native file explorer integration, and robust multithreading.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* macOS DMG */}
            <div className="flex flex-col gap-5 p-6 rounded-2xl border border-white/[0.04] bg-surface/30 backdrop-blur-md flex-1">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-bold text-white text-lg">macOS Build</h4>
                  <p className="text-[10px] text-text-muted font-mono">Universal DMG (.dmg)</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white font-mono text-sm">
                  
                </div>
              </div>
              
              <ul className="text-[11px] text-text-muted flex flex-col gap-2 list-none p-0 my-2">
                <li className="flex gap-2">
                  <span className="text-accent font-bold">✓</span> Supports both Apple Silicon & Intel processors.
                </li>
                <li className="flex gap-2">
                  <span className="text-accent font-bold">✓</span> Direct DMG installer with Application drag-and-drop.
                </li>
              </ul>

              <div className="mt-auto pt-4 border-t border-white/[0.04]">
                <a
                  href="https://github.com/AIEraDev/clypra/releases/latest"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.1] text-xs font-semibold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.01]"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download for macOS
                </a>
              </div>
            </div>

            {/* Windows MSI */}
            <div className="flex flex-col gap-5 p-6 rounded-2xl border border-white/[0.04] bg-surface/30 backdrop-blur-md flex-1">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-bold text-white text-lg">Windows Build</h4>
                  <p className="text-[10px] text-text-muted font-mono">x64 MSI Installer (.msi)</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white text-sm">
                  <Monitor className="w-4 h-4" />
                </div>
              </div>

              <ul className="text-[11px] text-text-muted flex flex-col gap-2 list-none p-0 my-2">
                <li className="flex gap-2">
                  <span className="text-accent font-bold">✓</span> Hardware-accelerated video scaling.
                </li>
                <li className="flex gap-2">
                  <span className="text-accent font-bold">✓</span> Packaged with pre-compiled Windows static libraries.
                </li>
              </ul>

              <div className="mt-auto pt-4 border-t border-white/[0.04]">
                <a
                  href="https://github.com/AIEraDev/clypra/releases/latest"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.1] text-xs font-semibold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.01]"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download for Windows
                </a>
              </div>
            </div>

            {/* Linux AppImage */}
            <div className="flex flex-col gap-5 p-6 rounded-2xl border border-white/[0.04] bg-surface/30 backdrop-blur-md flex-1">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-bold text-white text-lg">Linux Build</h4>
                  <p className="text-[10px] text-text-muted font-mono">x64 AppImage (.AppImage)</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-white text-sm">
                  <Terminal className="w-4 h-4" />
                </div>
              </div>

              <ul className="text-[11px] text-text-muted flex flex-col gap-2 list-none p-0 my-2">
                <li className="flex gap-2">
                  <span className="text-accent font-bold">✓</span> Sandbox-compatible executable with no installation needed.
                </li>
                <li className="flex gap-2">
                  <span className="text-accent font-bold">✓</span> Lightweight distribution compatible with major distros.
                </li>
              </ul>

              <div className="mt-auto pt-4 border-t border-white/[0.04]">
                <a
                  href="https://github.com/AIEraDev/clypra/releases/latest"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.1] text-xs font-semibold text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.01]"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download for Linux
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ── Detailed Installation Bypass Guidelines ── */}
        <section className="p-8 rounded-2xl border border-white/[0.04] bg-surface/20 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-6">
            <Shield className="w-5 h-5 text-accent" />
            <h4 className="text-lg font-bold text-white font-outfit">Bypassing Smart-Screen & Gatekeeper Controls</h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="flex flex-col gap-2 text-left">
              <span className="text-[10px] font-semibold text-accent font-mono">01 / MACOS USER INSTALLATION</span>
              <h5 className="font-bold text-white text-sm">Open with Control-Click</h5>
              <p className="text-xs text-text-muted leading-relaxed">
                If macOS reports that the app is from an unidentified developer, simply drag Clypra to your **Applications** folder. Right-click (or Control-click) the Clypra icon, and select **Open** from the context menu. Click **Open** again in the warning dialog to authorize execution.
              </p>
            </div>

            <div className="flex flex-col gap-2 text-left">
              <span className="text-[10px] font-semibold text-accent font-mono">02 / WINDOWS USER INSTALLATION</span>
              <h5 className="font-bold text-white text-sm">Windows SmartScreen Bypass</h5>
              <p className="text-xs text-text-muted leading-relaxed">
                Because this is a freshly compiled open-source release, Windows Defender may display a SmartScreen dialog stating the app is unrecognized. Click **More Info** at the top of the dialog, which exposes a **Run Anyway** button. Click it to begin installation.
              </p>
            </div>

            <div className="flex flex-col gap-2 text-left">
              <span className="text-[10px] font-semibold text-accent font-mono">03 / LINUX USER INSTALLATION</span>
              <h5 className="font-bold text-white text-sm">Make File Executable</h5>
              <p className="text-xs text-text-muted leading-relaxed">
                After downloading the `.AppImage` executable, navigate to the download folder in terminal and execute:
                <code className="block mt-2 p-2 bg-[#121214] border border-white/[0.04] rounded-lg text-accent text-[11px] font-mono select-all">
                  chmod +x Clypra*.AppImage
                </code>
                Then double-click the file or run <code className="text-accent font-mono bg-white/5 px-1 py-0.5 rounded">./Clypra*.AppImage</code> to launch.
              </p>
            </div>
          </div>
        </section>

        {/* ── Key Editor Features ── */}
        <section className="flex flex-col gap-8">
          <div className="text-center flex flex-col gap-2">
            <h3 className="text-2xl font-bold tracking-tight text-white font-outfit">Core NLE Platform Architecture</h3>
            <p className="text-xs text-text-muted max-w-md mx-auto">
              Clypra features premium architectural layers that rival industry-standard desktop non-linear editors.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl border border-white/[0.04] bg-surface/10 hover:border-white/[0.08] transition-colors flex flex-col gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
                <Layers className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-white text-sm">Infinite Multi-Track Sequencing</h4>
              <p className="text-xs text-text-muted leading-relaxed">
                Arrange and sequence video, audio, text, and visual overlays on layers with clean, responsive drag-and-drop clips and snap-to-edge alignment precision.
              </p>
            </div>

            <div className="p-6 rounded-2xl border border-white/[0.04] bg-surface/10 hover:border-white/[0.08] transition-colors flex flex-col gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
                <Play className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-white text-sm">High-Performance Frame Renderer</h4>
              <p className="text-xs text-text-muted leading-relaxed">
                A canvas-based, real-time render surface that accurately updates, scales, and scales visual clip layers using custom DPR scaling configurations.
              </p>
            </div>

            <div className="p-6 rounded-2xl border border-white/[0.04] bg-surface/10 hover:border-white/[0.08] transition-colors flex flex-col gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
                <Sparkles className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-white text-sm">Preset-Driven FFmpeg Exporters</h4>
              <p className="text-xs text-text-muted leading-relaxed">
                Redesigned premium video export flow featuring custom aspect presets (YouTube, TikTok, Instagram, Custom), project renaming, and animated SVG export progress circles.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="relative z-10 w-full max-w-7xl mx-auto px-6 py-8 mt-12 border-t border-white/[0.04] flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-text-muted">
        <div>
          © {new Date().getFullYear()} Clypra Contributors. Released under the MIT License.
        </div>
        <div className="flex items-center gap-6">
          <span>Built with Tauri, React & Rust</span>
          <a href="https://github.com/AIEraDev/clypra" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
};
