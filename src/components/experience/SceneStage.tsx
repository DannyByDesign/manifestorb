"use client";

import { useEffect, useRef, useState } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useReducedMotion,
} from "framer-motion";

import { Scene } from "@/components/experience/Scene";

const INTRO_OFFSET = 68;
const STAGE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const CTA_EASE: [number, number, number, number] = [0.65, 0, 0.35, 1];
const SWIPE_COMPLETE_THRESHOLD = 0.88;
const SCENE_TRANSITION_START = 0.58;
const TRACK_HANDLE_SIZE = 46;
const TRACK_PADDING = 5;

type CtaMode = "swipe" | "button";

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function SceneStage() {
  const prefersReducedMotion = useReducedMotion();
  const [swipeProgress, setSwipeProgress] = useState(0);
  const [ctaMode, setCtaMode] = useState<CtaMode>("swipe");
  const [isDragging, setIsDragging] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const swipeProgressRef = useRef(0);
  const animationRef = useRef<{ stop: () => void } | null>(null);
  const dragRef = useRef<{ pointerId: number; rect: DOMRect } | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = trackRef.current;
    if (!node) return;

    const syncWidth = () => setTrackWidth(node.clientWidth);
    syncWidth();

    const observer = new ResizeObserver(syncWidth);
    observer.observe(node);

    return () => observer.disconnect();
  }, [ctaMode]);

  useEffect(() => {
    return () => {
      animationRef.current?.stop();
    };
  }, []);

  const setProgress = (value: number) => {
    const next = clamp(value);
    swipeProgressRef.current = next;
    setSwipeProgress(next);
  };

  const animateProgress = (target: number) => {
    animationRef.current?.stop();

    if (prefersReducedMotion) {
      setProgress(target);
      return;
    }

    animationRef.current = animate(swipeProgressRef.current, target, {
      duration: target > swipeProgressRef.current ? 1.18 : 1.02,
      ease: STAGE_EASE,
      onUpdate: setProgress,
      onComplete: () => {
        animationRef.current = null;
        setProgress(target);
      },
    });
  };

  const resolveProgressFromClientX = (clientX: number, rect: DOMRect) => {
    const travel = Math.max(rect.width - TRACK_HANDLE_SIZE - TRACK_PADDING * 2, 1);
    const next = (clientX - rect.left - TRACK_PADDING - TRACK_HANDLE_SIZE / 2) / travel;
    return clamp(next);
  };

  const settleSwipe = () => {
    const shouldReveal = swipeProgressRef.current >= SWIPE_COMPLETE_THRESHOLD;
    setIsDragging(false);
    dragRef.current = null;

    if (shouldReveal) {
      setCtaMode("button");
      animateProgress(1);
      return;
    }

    animateProgress(0);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
      setProgress(resolveProgressFromClientX(event.clientX, dragRef.current.rect));
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
      settleSwipe();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [isDragging]);

  const handleSwipePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (ctaMode !== "swipe") return;

    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;

    event.preventDefault();
    animationRef.current?.stop();
    dragRef.current = { pointerId: event.pointerId, rect };
    setIsDragging(true);
    setProgress(resolveProgressFromClientX(event.clientX, rect));
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleSwipeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    setCtaMode("button");
    animateProgress(1);
  };

  const handleGoBack = () => {
    setCtaMode("swipe");
    animateProgress(0);
  };

  const sceneProgress =
    swipeProgress <= SCENE_TRANSITION_START
      ? 0
      : 1 -
        Math.pow(
          1 -
            clamp(
              (swipeProgress - SCENE_TRANSITION_START) /
                (1 - SCENE_TRANSITION_START)
            ),
          2
        );
  const introOpacity = clamp(1 - sceneProgress * 1.3);
  const introShiftX = sceneProgress * 18;
  const introShiftY = sceneProgress * 10;
  const trackFillOpacity = 0.14 + swipeProgress * 0.86;
  const handleTravel = Math.max(trackWidth - TRACK_HANDLE_SIZE - TRACK_PADDING * 2, 0);
  const handleOffset = TRACK_PADDING + handleTravel * swipeProgress;
  const fillWidth = clamp(handleOffset + TRACK_HANDLE_SIZE - 1, 0, Math.max(trackWidth - 2, 0));
  const backdropTransform = `translate3d(0, ${-INTRO_OFFSET * sceneProgress}svh, 0)`;
  const ctaFadeTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { duration: 0.42, ease: CTA_EASE };
  const ctaHoverTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { type: "spring", stiffness: 420, damping: 28, mass: 0.55 };

  return (
    <main className="relative isolate h-[100svh] w-full overflow-hidden bg-[var(--base-lilac)]">
      <div
        className="absolute inset-x-0 top-0 z-0 will-change-transform"
        style={{
          height: `calc(100svh + ${INTRO_OFFSET}svh)`,
          transform: backdropTransform,
        }}
      >
        <div className="stage-backdrop absolute inset-0" />
      </div>

      <section aria-label="Orb scene" className="absolute inset-0 z-10 overflow-hidden">
        <Scene
          sceneProgress={sceneProgress}
          reducedMotion={Boolean(prefersReducedMotion)}
        />
      </section>

      <div className="pointer-events-none absolute inset-0 z-30">
        <div className="absolute inset-0 px-6 pb-10 pt-[max(4.75rem,env(safe-area-inset-top,0px)+3rem)] sm:px-10 sm:pb-12 lg:px-16">
          <div className="flex h-full items-start sm:items-center">
            <div
              className="w-full max-w-[21.5rem] sm:max-w-[24rem]"
              style={{
                opacity: introOpacity,
                transform: `translate3d(${introShiftX}px, ${introShiftY}px, 0)`,
              }}
            >
                <div className="space-y-5">
                  <h1 className="text-[clamp(1.85rem,6vw,5.4rem)] font-semibold leading-[0.9] tracking-[-0.06em] text-[#20133b]">
                    <span className="block whitespace-nowrap">What Is the Final</span>
                    <span className="block whitespace-nowrap">Form of Voice AI?</span>
                  </h1>

                  <p className="max-w-[25rem] pl-[0.22rem] text-[1.04rem] leading-[1.38] tracking-[0.002em] text-[#4c3d69]/86 sm:max-w-[26rem] sm:pl-[0.28rem] sm:text-[1.18rem]">
                    <span className="block whitespace-nowrap">
                      What if we embrace the purple gradient and explore
                    </span>
                    <span className="block whitespace-nowrap">
                      beyond what we thought was possible?
                    </span>
                  </p>
                </div>

              <div className="mt-14 min-h-14 max-w-[21.5rem] -translate-x-[0.22rem] sm:-translate-x-[0.28rem]">
                <AnimatePresence initial={false}>
                  {ctaMode === "swipe" ? (
                    <motion.div
                      key="swipe-control"
                      ref={trackRef}
                      initial={prefersReducedMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={prefersReducedMotion ? undefined : { opacity: 0 }}
                      transition={ctaFadeTransition}
                      role="button"
                      tabIndex={0}
                      aria-label="Swipe to enter scene"
                      onPointerDown={handleSwipePointerDown}
                      onKeyDown={handleSwipeKeyDown}
                      className="pointer-events-auto relative flex h-14 w-full touch-none select-none items-center overflow-hidden rounded-full border border-white/70 bg-white/16 shadow-[0_20px_48px_rgba(79,45,156,0.18)] outline-none backdrop-blur-[10px] focus-visible:ring-4 focus-visible:ring-white/45"
                    >
                      <span className="pointer-events-none absolute inset-0 z-[1] flex translate-x-[0.65rem] items-center justify-center px-16 text-center text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-white sm:translate-x-[0.78rem] sm:text-[0.72rem]">
                        SLIDE TO ENTER SCENE
                      </span>

                      <motion.div
                        aria-hidden="true"
                        className="absolute bottom-[1px] left-[1px] top-[1px] rounded-full bg-[var(--button-lavender)] shadow-[0_20px_48px_rgba(123,76,255,0.32)]"
                        style={{
                          opacity: trackFillOpacity,
                          width: Math.max(fillWidth, TRACK_HANDLE_SIZE),
                        }}
                      />

                      <motion.span
                        aria-hidden="true"
                        className="absolute left-0 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--button-lavender)] bg-[color:var(--button-lavender)] shadow-[0_14px_28px_rgba(102,76,176,0.34)]"
                        style={{
                          x: handleOffset,
                          width: TRACK_HANDLE_SIZE,
                          height: TRACK_HANDLE_SIZE,
                        }}
                      >
                        <span className="h-2.5 w-2.5 rounded-full bg-white/92" />
                      </motion.span>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-[max(2.25rem,env(safe-area-inset-bottom,0px)+2rem)] flex justify-center px-6">
          <AnimatePresence initial={false}>
            {ctaMode === "button" ? (
              <motion.button
                key="revealed-button"
                type="button"
                initial={prefersReducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0 }}
                whileHover={prefersReducedMotion ? undefined : { scale: 1.04 }}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
                transition={{
                  opacity: ctaFadeTransition,
                  scale: ctaHoverTransition,
                }}
                onClick={handleGoBack}
                aria-label="Go back to intro scene"
                className="pointer-events-auto inline-flex h-14 min-w-56 items-center justify-center whitespace-nowrap rounded-full border border-white/70 bg-white/16 px-8 py-3 text-sm font-semibold uppercase tracking-[0.22em] text-white shadow-[0_20px_48px_rgba(79,45,156,0.18)] outline-none backdrop-blur-[10px] transition-colors duration-300 hover:bg-white/22 focus-visible:ring-4 focus-visible:ring-white/45"
              >
                Go back
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
