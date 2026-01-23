/**
 * WebGL Capability Detection + Quality Tier System
 * 
 * Detects device capabilities and returns appropriate quality presets.
 * Mobile-first: defaults to conservative settings, upgrades if capable.
 */

export interface QualityTier {
    /** Fluid simulation resolution (square) */
    simRes: number;
    /** Number of particles in halo system */
    particleCount: number;
    /** Device pixel ratio clamp */
    dprClamp: number;
    /** Whether to use GPU fluid simulation (vs curl noise fallback) */
    useFluidSim: boolean;
    /** Tier name for debugging */
    tierName: 'mobile' | 'desktop';
}

export interface Capabilities {
    /** WebGL2 context available */
    hasWebGL2: boolean;
    /** Float render targets supported (EXT_color_buffer_float) */
    hasFloatRT: boolean;
    /** Linear filtering on float textures (OES_texture_float_linear) */
    hasFloatLinear: boolean;
    /** Detected as mobile device */
    isMobile: boolean;
    /** Fluid simulation is viable (requires WebGL2 + float RT + linear filtering) */
    canUseFluidSim: boolean;
}

// ============================================
// Detection Functions
// ============================================

function detectWebGL2(): boolean {
    if (typeof document === 'undefined') return false;

    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    return gl !== null;
}

function detectFloatRenderTarget(gl: WebGL2RenderingContext): boolean {
    // EXT_color_buffer_float enables rendering to float textures
    const ext = gl.getExtension('EXT_color_buffer_float');
    return ext !== null;
}

function detectFloatLinearFiltering(gl: WebGL2RenderingContext): boolean {
    // OES_texture_float_linear enables linear filtering on float textures
    const ext = gl.getExtension('OES_texture_float_linear');
    return ext !== null;
}

function detectMobile(): boolean {
    if (typeof navigator === 'undefined') return true; // Default to mobile (conservative)

    // Touch points heuristic
    const hasTouch = navigator.maxTouchPoints > 0;

    // User agent heuristics for iOS/Android
    const ua = navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);
    const isAndroid = /android/.test(ua);

    // Fallback: screen width heuristic
    const isSmallScreen = typeof window !== 'undefined' && window.innerWidth < 768;

    return hasTouch && (isIOS || isAndroid || isSmallScreen);
}

// ============================================
// Main Detection Function
// ============================================

let cachedCapabilities: Capabilities | null = null;

export function detectCapabilities(): Capabilities {
    // Return cached result if available
    if (cachedCapabilities) return cachedCapabilities;

    // Default conservative capabilities (SSR-safe)
    const defaults: Capabilities = {
        hasWebGL2: false,
        hasFloatRT: false,
        hasFloatLinear: false,
        isMobile: true,
        canUseFluidSim: false,
    };

    if (typeof document === 'undefined') {
        return defaults;
    }

    // Create temporary canvas for detection
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');

    if (!gl) {
        cachedCapabilities = defaults;
        return defaults;
    }

    const hasWebGL2 = true;
    const hasFloatRT = detectFloatRenderTarget(gl);
    const hasFloatLinear = detectFloatLinearFiltering(gl);
    const isMobile = detectMobile();

    // Fluid sim requires ALL of: WebGL2, float render targets, and linear filtering
    const canUseFluidSim = hasWebGL2 && hasFloatRT && hasFloatLinear;

    cachedCapabilities = {
        hasWebGL2,
        hasFloatRT,
        hasFloatLinear,
        isMobile,
        canUseFluidSim,
    };

    return cachedCapabilities;
}

// ============================================
// Quality Tier Presets
// ============================================

const MOBILE_TIER: QualityTier = {
    simRes: 256,
    particleCount: 50_000,
    dprClamp: 1.5,
    useFluidSim: false, // Will be overridden based on capabilities
    tierName: 'mobile',
};

const DESKTOP_TIER: QualityTier = {
    simRes: 512,
    particleCount: 150_000,
    dprClamp: 2.0,
    useFluidSim: true, // Will be overridden based on capabilities
    tierName: 'desktop',
};

export function getQualityTier(): QualityTier {
    const caps = detectCapabilities();

    // Select base tier
    const baseTier = caps.isMobile ? { ...MOBILE_TIER } : { ...DESKTOP_TIER };

    // Override fluid sim based on actual capability
    baseTier.useFluidSim = caps.canUseFluidSim;

    return baseTier;
}

// ============================================
// Debug Logging
// ============================================

export function logCapabilities(): void {
    const caps = detectCapabilities();
    const tier = getQualityTier();

    console.group('🎮 WebGL Capabilities');
    console.log('WebGL2:', caps.hasWebGL2 ? '✅' : '❌');
    console.log('Float RT:', caps.hasFloatRT ? '✅' : '❌');
    console.log('Float Linear:', caps.hasFloatLinear ? '✅' : '❌');
    console.log('Mobile:', caps.isMobile ? '📱' : '🖥️');
    console.log('Fluid Sim:', caps.canUseFluidSim ? '✅ enabled' : '❌ using curl noise');
    console.groupEnd();

    console.group('📊 Quality Tier');
    console.log('Tier:', tier.tierName);
    console.log('Sim Res:', tier.simRes);
    console.log('Particles:', tier.particleCount.toLocaleString());
    console.log('DPR Clamp:', tier.dprClamp);
    console.groupEnd();
}
