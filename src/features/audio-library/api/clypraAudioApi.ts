export type AudioLibraryCategory = "music" | "sfx" | "ambient" | "ui" | "transition" | "impact" | "voice";

export interface AudioLibraryItem {
  id: string;
  name: string;
  category: AudioLibraryCategory | string;
  description?: string;
  tags?: string[];
  author: string;
  duration: number;
  bpm?: number;
  loopable?: boolean;
  license: {
    type: "cc0" | "cc-by" | "royalty-free" | "public-domain";
    url?: string;
    attributionRequired: boolean;
  };
  source: {
    provider: string;
    url: string;
  };
  audioUrl: string;
  waveformUrl?: string;
  coverArtUrl?: string;
  isPremium?: boolean;
}

const BASE = "https://clypra-worker-api.abdulkabirmusa.com";
const API_KEY = import.meta.env.VITE_CLYPRA_API_KEY || "";

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

export const AUDIO_LIBRARY_CATEGORIES: AudioLibraryCategory[] = ["music", "sfx", "ambient", "ui", "transition", "impact", "voice"];

export const ClypraAudioApi = {
  async getAudioIndex(): Promise<AudioLibraryItem[]> {
    const res = await fetch(`${BASE}/audio`, {
      cache: "reload",
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load audio library");
    return res.json();
  },

  async getAudioByCategory(category: AudioLibraryCategory): Promise<AudioLibraryItem[]> {
    const res = await fetch(`${BASE}/audio/${category}`, {
      cache: "reload",
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load audio category: ${category}`);
    return res.json();
  },

  async getAudioAsset(category: string, id: string): Promise<AudioLibraryItem> {
    const res = await fetch(`${BASE}/audio/${category}/${id}`, {
      cache: "reload",
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load audio asset: ${id}`);
    return res.json();
  },
};
