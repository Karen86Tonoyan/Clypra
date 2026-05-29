import lottie from "lottie-web";
import { TemplateDefinition, RenderedFrameSequence } from "./types";

/**
 * Renders a complete Lottie animation frame-by-frame to a sequence of PNG Blobs.
 * Designed to execute synchronously per frame in the browser WebView context.
 */
export async function renderToFrameSequence(
  lottieData: object,
  definition: TemplateDefinition,
  onProgress?: (progress: number) => void
): Promise<RenderedFrameSequence> {
  const container = document.createElement("div");
  container.style.width = `${definition.width}px`;
  container.style.height = `${definition.height}px`;
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "-9999px";
  document.body.appendChild(container);

  // Load Lottie with canvas renderer, autoplay & loop disabled
  const anim = lottie.loadAnimation({
    container,
    renderer: "canvas",
    autoplay: false,
    loop: false,
    animationData: JSON.parse(JSON.stringify(lottieData)),
  });

  // Force Lottie to draw its first frame to initialize the inner canvas
  anim.goToAndStop(0, true);
  await Promise.resolve();

  const canvas = container.querySelector("canvas") as HTMLCanvasElement;
  if (!canvas) {
    anim.destroy();
    document.body.removeChild(container);
    throw new Error("Lottie canvas renderer failed to initialize");
  }

  const frames: Blob[] = [];
  const totalFrames = definition.durationFrames;

  for (let f = 0; f < totalFrames; f++) {
    anim.goToAndStop(f, true);
    // Wait a microtask for draw sequence to settle
    await Promise.resolve();

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error(`Failed to rasterize frame ${f} to PNG Blob`));
      }, "image/png");
    });

    frames.push(blob);

    if (onProgress) {
      onProgress(Math.round(((f + 1) / totalFrames) * 100));
    }
  }

  anim.destroy();
  document.body.removeChild(container);

  return {
    frames,
    fps: definition.fps,
    width: definition.width,
    height: definition.height,
    durationFrames: totalFrames,
  };
}

/**
 * Transfers the rendered PNG blobs to the Tauri Rust native backend.
 */
export async function renderFrameSequenceToTauri(
  sequence: RenderedFrameSequence,
  outputDir: string
): Promise<string[]> {
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  const paths: string[] = [];

  for (let i = 0; i < sequence.frames.length; i++) {
    const blob = sequence.frames[i];
    const buffer = await blob.arrayBuffer();
    const data = new Uint8Array(buffer);

    // Standard 4-digit zero-padded filename: e.g. /output/0000.png, /output/0001.png
    const fileName = `${String(i).padStart(4, "0")}.png`;
    // Clean directory path handling
    const cleanDir = outputDir.endsWith("/") || outputDir.endsWith("\\")
      ? outputDir
      : `${outputDir}/`;
    const framePath = `${cleanDir}${fileName}`;

    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        // Cast data to standard number array for Tauri JSON serialization compatibility
        const bytes = Array.from(data);
        await invoke("write_frame", { path: framePath, data: bytes });
      } catch (err) {
        console.error(`Tauri failed to write frame ${i}:`, err);
        throw err;
      }
    }

    paths.push(framePath);
  }

  return paths;
}
