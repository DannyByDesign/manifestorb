import { create } from "zustand";

import {
  type Capabilities,
  detectCapabilities,
  logCapabilities,
  SCENE_VISUAL_CONFIG,
} from "@/lib/capabilities";

interface RenderState {
  capabilities: Capabilities;
  initialized: boolean;
  initialize: () => void;
}

const defaultCapabilities: Capabilities = {
  hasWebGL2: false,
  hasFloatRT: false,
  hasHalfFloatRT: false,
  hasFloatLinear: false,
  preferredSimTextureType: "float",
};

export const useRenderStore = create<RenderState>((set, get) => ({
  capabilities: defaultCapabilities,
  initialized: false,

  initialize: () => {
    if (get().initialized || typeof window === "undefined") return;

    const capabilities = detectCapabilities();

    if (process.env.NODE_ENV === "development") {
      logCapabilities();
    }

    set({ capabilities, initialized: true });
  },
}));

export function useRenderCapabilities(): Capabilities {
  return useRenderStore((state) => state.capabilities);
}

export function useRenderInitialized(): boolean {
  return useRenderStore((state) => state.initialized);
}

export { SCENE_VISUAL_CONFIG };
