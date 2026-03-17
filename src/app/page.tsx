"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { Scene } from "@/components/experience/Scene";

const INTRO_OFFSET = "68svh";
const STAGE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const BUTTON_EASE: [number, number, number, number] = [0.65, 0, 0.35, 1];

export default function Page() {
  const [viewState, setViewState] = useState<"intro" | "revealed">("intro");
  const prefersReducedMotion = useReducedMotion();
  const isRevealed = viewState === "revealed";

  const stageTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { duration: 1.35, ease: STAGE_EASE };

  const buttonTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { duration: 1.1, ease: BUTTON_EASE };

  return (
    <main className="relative isolate h-[100svh] w-full overflow-hidden bg-[var(--base-lilac)]">
      <motion.div
        className="absolute inset-x-0 top-0 z-0"
        style={{ height: `calc(100svh + ${INTRO_OFFSET})` }}
        animate={{ y: isRevealed ? `-${INTRO_OFFSET}` : "0svh" }}
        transition={stageTransition}
      >
        <div className="stage-backdrop absolute inset-0" />
      </motion.div>

      <section aria-label="Orb scene" className="absolute inset-0 z-10 overflow-hidden">
        <Scene
          viewState={viewState}
          reducedMotion={Boolean(prefersReducedMotion)}
        />
      </section>

      <div className="pointer-events-none absolute inset-0 z-30">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2">
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{
              opacity: 1,
              y: isRevealed
                ? "calc(50svh - env(safe-area-inset-bottom, 0px) - 5.5rem)"
                : "-50%",
            }}
            transition={buttonTransition}
          >
            <motion.button
              type="button"
              onClick={() => setViewState(isRevealed ? "intro" : "revealed")}
              transition={buttonTransition}
              className="pointer-events-auto inline-flex h-12 w-56 items-center justify-center whitespace-nowrap rounded-full bg-[color:var(--button-lavender)] px-8 py-3 text-sm font-semibold uppercase tracking-[0.22em] text-white shadow-[0_22px_54px_rgba(123,76,255,0.35)] outline-none transition-colors duration-300 hover:bg-[color:var(--button-lavender-strong)] focus-visible:ring-4 focus-visible:ring-white/45"
            >
              <AnimatePresence initial={false} mode="wait">
                <motion.span
                  key={isRevealed ? "go-back" : "enter-scene"}
                  initial={prefersReducedMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={prefersReducedMotion ? undefined : { opacity: 0 }}
                  transition={buttonTransition}
                >
                  {isRevealed ? "Go back" : "Enter scene"}
                </motion.span>
              </AnimatePresence>
            </motion.button>
          </motion.div>
        </div>
      </div>
    </main>
  );
}
