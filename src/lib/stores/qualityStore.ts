/**
 * Quality State Store (Zustand)
 * 
 * Global state for quality tier settings.
 * Initialize once on app mount, then read from any component.
 */

import { create } from 'zustand';
import {
    type QualityTier,
    type Capabilities,
    getQualityTier,
    detectCapabilities,
    logCapabilities
} from '../capabilities';

interface QualityState {
    /** Current quality tier settings */
    tier: QualityTier;
    /** Raw capability detection results */
    capabilities: Capabilities;
    /** Whether initialization has completed */
    initialized: boolean;
    /** Initialize quality detection (call once on mount) */
    initialize: () => void;
}

// Default tier (conservative, SSR-safe)
const defaultTier: QualityTier = {
    simRes: 256,
    particleCount: 50_000,
    dprClamp: 1.5,
    useFluidSim: false,
    tierName: 'mobile',
};

const defaultCapabilities: Capabilities = {
    hasWebGL2: false,
    hasFloatRT: false,
    hasFloatLinear: false,
    isMobile: true,
    canUseFluidSim: false,
};

export const useQualityStore = create<QualityState>((set, get) => ({
    tier: defaultTier,
    capabilities: defaultCapabilities,
    initialized: false,

    initialize: () => {
        // Only initialize once
        if (get().initialized) return;

        // Guard for SSR
        if (typeof window === 'undefined') return;

        const capabilities = detectCapabilities();
        const tier = getQualityTier();

        // Log capabilities in development
        if (process.env.NODE_ENV === 'development') {
            logCapabilities();
        }

        set({ tier, capabilities, initialized: true });
    },
}));

// ============================================
// Selector Hooks
// ============================================

/** Get full quality tier object */
export function useQuality(): QualityTier {
    return useQualityStore((state) => state.tier);
}

/** Get specific quality value */
export function useQualityValue<K extends keyof QualityTier>(key: K): QualityTier[K] {
    return useQualityStore((state) => state.tier[key]);
}

/** Get raw capabilities */
export function useCapabilities(): Capabilities {
    return useQualityStore((state) => state.capabilities);
}

/** Check if fluid sim is enabled */
export function useFluidSimEnabled(): boolean {
    return useQualityStore((state) => state.tier.useFluidSim);
}

/** Get particle count for current tier */
export function useParticleCount(): number {
    return useQualityStore((state) => state.tier.particleCount);
}

/** Get simulation resolution for current tier */
export function useSimResolution(): number {
    return useQualityStore((state) => state.tier.simRes);
}

/** Get clamped DPR for current tier */
export function useDPRClamp(): number {
    return useQualityStore((state) => state.tier.dprClamp);
}
