import { PlatformInterface, getPlatformType } from "./platform";
import { TauriPlatformAdapter } from "./adapters/tauriAdapter";
import { CapacitorPlatformAdapter } from "./adapters/capacitorAdapter";
import { WebPlatformAdapter } from "./adapters/webAdapter";

let activePlatform: PlatformInterface;

const platformType = getPlatformType();

if (platformType === "tauri") {
  activePlatform = new TauriPlatformAdapter();
} else if (platformType === "capacitor") {
  activePlatform = new CapacitorPlatformAdapter();
} else {
  activePlatform = new WebPlatformAdapter();
}

export { activePlatform as platform };
export * from "./platform";
