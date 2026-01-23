/**
 * Shape State Store (Zustand)
 *
 * Manages shape morphing state for the SDF orb.
 * Controls transitions between orb (sphere) and modal shapes.
 */

import { create } from "zustand";
import gsap from "gsap";

// ============================================
// Types
// ============================================

export type ShapeType = "orb" | "calendar" | "settings" | "chat";

export interface ShapeConfig {
  /** SDF type index: 0=sphere, 1=roundedBox, 2=capsule */
  type: number;
  /** Shape dimensions [width, height, depth] as half-extents */
  dimensions: [number, number, number];
  /** Corner radius for rounded shapes */
  cornerRadius: number;
  /** Sphere radius (used when morphing from/to sphere) */
  sphereRadius: number;
}

interface ShapeState {
  /** Current shape name */
  currentShape: ShapeType;
  /** Morph progress 0..1 (0 = sphere, 1 = target shape) */
  morphProgress: number;
  /** Current shape configuration */
  config: ShapeConfig;
  /** Whether a morph transition is in progress */
  transitioning: boolean;
  /** Previous shape (for reverse morphing) */
  previousShape: ShapeType;

  /** Trigger morph animation to a new shape */
  morphTo: (shape: ShapeType, duration?: number) => void;
  /** Reset to orb immediately (no animation) */
  resetToOrb: () => void;
  /** Set morph progress directly (for manual control) */
  setMorphProgress: (progress: number) => void;
}

// ============================================
// Shape Presets
// ============================================

export const SHAPE_PRESETS: Record<ShapeType, ShapeConfig> = {
  orb: {
    type: 0, // sphere
    dimensions: [1.0, 1.0, 1.0],
    cornerRadius: 0,
    sphereRadius: 1.0,
  },
  calendar: {
    type: 1, // roundedBox
    dimensions: [1.6, 1.2, 0.12], // wide modal
    cornerRadius: 0.15,
    sphereRadius: 1.0,
  },
  settings: {
    type: 1, // roundedBox
    dimensions: [1.2, 1.5, 0.12], // tall modal
    cornerRadius: 0.18,
    sphereRadius: 1.0,
  },
  chat: {
    type: 2, // capsule
    dimensions: [0.8, 1.0, 0.15], // chat bubble
    cornerRadius: 0.3,
    sphereRadius: 1.0,
  },
};

// ============================================
// Store
// ============================================

export const useShapeStore = create<ShapeState>((set, get) => ({
  currentShape: "orb",
  morphProgress: 0,
  config: { ...SHAPE_PRESETS.orb },
  transitioning: false,
  previousShape: "orb",

  morphTo: (shape: ShapeType, duration = 0.8) => {
    const state = get();

    // Don't morph to same shape
    if (shape === state.currentShape && !state.transitioning) return;

    // Don't interrupt ongoing transition
    if (state.transitioning) return;

    const targetConfig = SHAPE_PRESETS[shape];
    const isToOrb = shape === "orb";

    set({
      transitioning: true,
      previousShape: state.currentShape,
    });

    // Animate with GSAP
    const animState = { progress: isToOrb ? 1 : 0 };

    gsap.to(animState, {
      progress: isToOrb ? 0 : 1,
      duration,
      ease: "power2.inOut",
      onUpdate: () => {
        set({
          morphProgress: animState.progress,
          // Interpolate config during morph
          config: {
            type: isToOrb ? state.config.type : targetConfig.type,
            dimensions: [
              gsap.utils.interpolate(
                state.config.dimensions[0],
                targetConfig.dimensions[0],
                animState.progress
              ),
              gsap.utils.interpolate(
                state.config.dimensions[1],
                targetConfig.dimensions[1],
                animState.progress
              ),
              gsap.utils.interpolate(
                state.config.dimensions[2],
                targetConfig.dimensions[2],
                animState.progress
              ),
            ],
            cornerRadius: gsap.utils.interpolate(
              state.config.cornerRadius,
              targetConfig.cornerRadius,
              animState.progress
            ),
            sphereRadius: targetConfig.sphereRadius,
          },
        });
      },
      onComplete: () => {
        set({
          currentShape: shape,
          transitioning: false,
          config: { ...targetConfig },
          morphProgress: isToOrb ? 0 : 1,
        });
      },
    });
  },

  resetToOrb: () => {
    set({
      currentShape: "orb",
      morphProgress: 0,
      config: { ...SHAPE_PRESETS.orb },
      transitioning: false,
      previousShape: "orb",
    });
  },

  setMorphProgress: (progress: number) => {
    set({ morphProgress: Math.max(0, Math.min(1, progress)) });
  },
}));

// ============================================
// Selector Hooks
// ============================================

/** Get current shape type */
export function useCurrentShape(): ShapeType {
  return useShapeStore((state) => state.currentShape);
}

/** Get morph progress (0..1) */
export function useMorphProgress(): number {
  return useShapeStore((state) => state.morphProgress);
}

/** Get current shape configuration */
export function useShapeConfig(): ShapeConfig {
  return useShapeStore((state) => state.config);
}

/** Check if currently transitioning */
export function useIsTransitioning(): boolean {
  return useShapeStore((state) => state.transitioning);
}

/** Get morphTo action */
export function useMorphTo(): (shape: ShapeType, duration?: number) => void {
  return useShapeStore((state) => state.morphTo);
}

