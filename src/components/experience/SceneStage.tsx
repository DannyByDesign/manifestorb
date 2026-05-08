"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  type Variants,
  useReducedMotion,
} from "framer-motion";
import { useAction, useMutation } from "convex/react";

import { Scene } from "@/components/experience/Scene";
import { api } from "../../../convex/_generated/api";

const STAGE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const CTA_EASE: [number, number, number, number] = [0.65, 0, 0.35, 1];
const LOAD_IN_DURATION = 1.08;
const LOAD_IN_SCENE_DURATION = 0.82;

const ASKING_PROGRESS = 0.5;
const LANDING_PROGRESS = 0;

const SCENE_BIG_TRANSITION = 1.4;

const MOBILE_MEDIA_QUERY = "(max-width: 639px)";

type Question = {
  title: string;
  helper: string;
  inputType: "text" | "email" | "number" | "textarea";
  placeholder?: string;
  autoComplete?: string;
};

const QUESTIONS: Question[] = [
  {
    title: "Send a letter to your future self first.",
    helper: "What's your name?",
    inputType: "text",
    placeholder: "First and last name",
    autoComplete: "name",
  },
  {
    title: "Where should the letters arrive?",
    helper:
      "An email address — that's where they'll send everything.",
    inputType: "email",
    placeholder: "your@email.com",
    autoComplete: "email",
  },
  {
    title: "How old are you today?",
    helper: "So they know who they're writing to.",
    inputType: "number",
    placeholder: "Age",
  },
  {
    title: "Who are you right now?",
    helper:
      "A founder in year two. A musician chasing the dream. A new parent figuring it out. The version of you today.",
    inputType: "textarea",
  },
  {
    title:
      "Five years from now, what are you doing that you aren't doing today?",
    helper:
      "Get specific. A role you're in. A project you finished. How you spend your time.",
    inputType: "textarea",
  },
  {
    title: "What matters most to you, five years from now?",
    helper:
      "If you could tell yourself one thing today about what actually matters, what would it be?",
    inputType: "textarea",
  },
  {
    title: "What's the hardest part of getting there?",
    helper: "What are you afraid of? What's keeping you stuck right now?",
    inputType: "textarea",
  },
  {
    title: "What does a normal Tuesday look like, five years from now?",
    helper: "Walk through it — morning to night.",
    inputType: "textarea",
  },
  {
    title: "What do you most need to hear on the hard days?",
    helper: "From the version of you who already made it through.",
    inputType: "textarea",
  },
];

type Cadence = "monthly" | "biweekly" | "weekly";

type PricingOption = {
  id: Cadence;
  cadence: string;
  price: string;
  description: string;
};

const PRICING_OPTIONS: PricingOption[] = [
  {
    id: "monthly",
    cadence: "Monthly",
    price: "$3",
    description: "One email every month",
  },
  {
    id: "biweekly",
    cadence: "Every 2 weeks",
    price: "$8",
    description: "One email every 2 weeks",
  },
  {
    id: "weekly",
    cadence: "Weekly",
    price: "$12",
    description: "One email every week",
  },
];

const introContentVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const introHeadlineVariants: Variants = {
  hidden: { opacity: 0, y: 28, filter: "blur(8px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.9, ease: STAGE_EASE },
  },
};

const introCopyVariants: Variants = {
  hidden: { opacity: 0, y: 28, filter: "blur(8px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.9, ease: STAGE_EASE },
  },
};

const introCtaVariants: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.985, filter: "blur(8px)" },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: 0.9, ease: STAGE_EASE },
  },
};

const sceneShellVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: LOAD_IN_SCENE_DURATION, ease: STAGE_EASE },
  },
};

const logoVariants: Variants = {
  hidden: { opacity: 0, y: 18, filter: "blur(8px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.88, ease: STAGE_EASE },
  },
};

const phaseSwapVariants: Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.6, ease: STAGE_EASE },
  },
  exit: {
    opacity: 0,
    y: -10,
    filter: "blur(6px)",
    transition: { duration: 0.34, ease: STAGE_EASE },
  },
};

type Phase = "landing" | "asking" | "pricing" | "sealed";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const COMMON_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "live.com",
  "protonmail.com",
  "proton.me",
  "me.com",
  "msn.com",
];

function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix: number[][] = Array.from({ length: b.length + 1 }, () => []);
  for (let i = 0; i <= b.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

function suggestEmailCorrection(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain || COMMON_EMAIL_DOMAINS.includes(domain)) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const candidate of COMMON_EMAIL_DOMAINS) {
    const d = levenshtein(domain, candidate);
    if (d > 0 && d <= 2 && d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best ? `${local}@${best}` : null;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function subscribeToMobileBreakpoint(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);

  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getMobileBreakpointSnapshot() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function getMobileBreakpointServerSnapshot() {
  return false;
}

const STAGE_PADDING_CLASSES =
  "absolute inset-0 px-6 pb-10 pt-[max(4.75rem,env(safe-area-inset-top,0px)+3rem)] sm:px-10 sm:pb-12 lg:px-16";

export function SceneStage() {
  const prefersReducedMotion = useReducedMotion();
  const pathname = usePathname();
  const router = useRouter();
  const isMobile = useSyncExternalStore(
    subscribeToMobileBreakpoint,
    getMobileBreakpointSnapshot,
    getMobileBreakpointServerSnapshot
  );

  const createSignup = useMutation(api.signup.createSignup);
  const createCheckoutSession = useAction(api.checkout.createCheckoutSession);

  const [phase, setPhase] = useState<Phase>("landing");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() => QUESTIONS.map(() => ""));
  const [submitting, setSubmitting] = useState<Cadence | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ageError, setAgeError] = useState(false);
  const ageErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);

  const [loadInProgress, setLoadInProgress] = useState(prefersReducedMotion ? 1 : 0);
  const [sceneProgress, setSceneProgress] = useState(0);
  const [isSceneReady, setIsSceneReady] = useState(false);
  const [hasLoadedIn, setHasLoadedIn] = useState(prefersReducedMotion);

  const loadInProgressRef = useRef(prefersReducedMotion ? 1 : 0);
  const sceneProgressRef = useRef(0);
  const sceneTargetRef = useRef(0);
  const loadInAnimationRef = useRef<{ stop: () => void } | null>(null);
  const sceneAnimationRef = useRef<{ stop: () => void } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      loadInAnimationRef.current?.stop();
      sceneAnimationRef.current?.stop();
      if (ageErrorTimeoutRef.current) {
        clearTimeout(ageErrorTimeoutRef.current);
      }
    };
  }, []);


  const setLoadProgress = (value: number) => {
    const next = clamp(value);
    loadInProgressRef.current = next;
    setLoadInProgress(next);
  };

  const setSceneProg = (value: number) => {
    const next = clamp(value);
    sceneProgressRef.current = next;
    setSceneProgress(next);
  };

  useEffect(() => {
    if (prefersReducedMotion || !isSceneReady || hasLoadedIn) return;

    loadInAnimationRef.current?.stop();
    loadInAnimationRef.current = animate(loadInProgressRef.current, 1, {
      duration: LOAD_IN_DURATION,
      ease: STAGE_EASE,
      onUpdate: setLoadProgress,
      onComplete: () => {
        loadInAnimationRef.current = null;
        setLoadProgress(1);
        setHasLoadedIn(true);
      },
    });
  }, [hasLoadedIn, isSceneReady, prefersReducedMotion]);

  useEffect(() => {
    if (phase !== "asking") return;
    const id = setTimeout(() => inputRef.current?.focus(), 380);
    return () => clearTimeout(id);
  }, [phase, questionIndex]);

  const animateSceneTo = (target: number, duration: number) => {
    sceneTargetRef.current = target;

    if (prefersReducedMotion) {
      setSceneProg(target);
      return;
    }

    sceneAnimationRef.current?.stop();
    sceneAnimationRef.current = animate(sceneProgressRef.current, target, {
      duration,
      ease: STAGE_EASE,
      onUpdate: setSceneProg,
      onComplete: () => {
        sceneAnimationRef.current = null;
        setSceneProg(target);
      },
    });
  };

  const clearFieldErrors = () => {
    setAgeError(false);
    if (ageErrorTimeoutRef.current) {
      clearTimeout(ageErrorTimeoutRef.current);
      ageErrorTimeoutRef.current = null;
    }
    setEmailError(null);
    setEmailSuggestion(null);
  };

  const handleLightOrb = () => {
    animateSceneTo(ASKING_PROGRESS, SCENE_BIG_TRANSITION);
    setQuestionIndex(0);
    setPhase("asking");
  };

  const handleNext = () => {
    if (currentQuestion.inputType === "email") {
      const raw = answers[questionIndex];
      const normalized = normalizeEmail(raw);
      if (!EMAIL_REGEX.test(normalized)) {
        setEmailError("Please enter a valid email address.");
        inputRef.current?.focus();
        return;
      }
      if (normalized !== raw) {
        setAnswers((prev) => {
          const next = [...prev];
          next[questionIndex] = normalized;
          return next;
        });
      }
    }

    clearFieldErrors();
    if (questionIndex < QUESTIONS.length - 1) {
      setQuestionIndex(questionIndex + 1);
    } else {
      setPhase("pricing");
    }
  };

  const handleBack = () => {
    clearFieldErrors();
    if (questionIndex === 0) {
      animateSceneTo(LANDING_PROGRESS, SCENE_BIG_TRANSITION);
      setPhase("landing");
    } else {
      setQuestionIndex(questionIndex - 1);
    }
  };

  const handleSelectPlan = async (cadence: Cadence) => {
    if (submitting) return;

    const ageNum = Number.parseInt(answers[2] ?? "", 10);
    if (!Number.isFinite(ageNum) || ageNum <= 0) {
      setSubmitError("Age looks off. Please go back and re-enter it.");
      return;
    }

    setSubmitError(null);
    setSubmitting(cadence);
    try {
      const { subscriptionId } = await createSignup({
        name: answers[0].trim(),
        email: normalizeEmail(answers[1]),
        ageAtSignup: ageNum,
        currentSelf: answers[3].trim(),
        futureSelf: answers[4].trim(),
        whatMatters: answers[5].trim(),
        hardestPart: answers[6].trim(),
        normalTuesday: answers[7].trim(),
        hardDayMessage: answers[8].trim(),
        cadence,
      });

      const { url } = await createCheckoutSession({ subscriptionId });
      window.location.assign(url);
    } catch (err) {
      console.error(err);
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setSubmitting(null);
    }
  };

  const handlePricingBack = () => {
    setPhase("asking");
  };

  const handleStartOver = () => {
    clearFieldErrors();
    animateSceneTo(LANDING_PROGRESS, SCENE_BIG_TRANSITION);
    setAnswers(QUESTIONS.map(() => ""));
    setQuestionIndex(0);
    setPhase("landing");
  };

  const handleEmailBlur = () => {
    const raw = answers[questionIndex];
    if (!raw.trim()) return;

    const normalized = normalizeEmail(raw);
    if (normalized !== raw) {
      setAnswers((prev) => {
        const next = [...prev];
        next[questionIndex] = normalized;
        return next;
      });
    }

    if (!EMAIL_REGEX.test(normalized)) {
      setEmailError("That doesn't look like a valid email.");
      setEmailSuggestion(null);
      return;
    }

    setEmailError(null);
    const suggestion = suggestEmailCorrection(normalized);
    setEmailSuggestion(suggestion && suggestion !== normalized ? suggestion : null);
  };

  const acceptEmailSuggestion = () => {
    if (!emailSuggestion) return;
    const corrected = emailSuggestion;
    setAnswers((prev) => {
      const next = [...prev];
      next[questionIndex] = corrected;
      return next;
    });
    setEmailSuggestion(null);
    setEmailError(null);
  };

  const handleAnswerChange = (value: string) => {
    let processed = value;

    if (currentQuestion.inputType === "number") {
      processed = value.replace(/\D/g, "").slice(0, 2);
      const rejectedChars = processed !== value;

      if (rejectedChars) {
        setAgeError(true);
        if (ageErrorTimeoutRef.current) {
          clearTimeout(ageErrorTimeoutRef.current);
        }
        ageErrorTimeoutRef.current = setTimeout(() => setAgeError(false), 2200);
      } else {
        setAgeError(false);
      }
    } else if (currentQuestion.inputType === "email") {
      processed = value.replace(/^\s+/, "");
      if (emailError) setEmailError(null);
      if (emailSuggestion) setEmailSuggestion(null);
    }

    setAnswers((prev) => {
      const next = [...prev];
      next[questionIndex] = processed;
      return next;
    });
  };

  const handleLogoClick = () => {
    if (pathname !== "/") {
      router.push("/");
      return;
    }

    if (phase !== "landing") {
      handleStartOver();
    }
  };

  const loadInMotionState = prefersReducedMotion || isSceneReady ? "visible" : "hidden";
  const buttonHoverTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { type: "spring" as const, stiffness: 420, damping: 28, mass: 0.55 };

  const currentQuestion = QUESTIONS[questionIndex];

  return (
    <main className="relative isolate h-[100svh] w-full overflow-hidden bg-[var(--base-lilac)]">
      <motion.button
        type="button"
        aria-label="Go to home page"
        onClick={handleLogoClick}
        initial={prefersReducedMotion ? false : "hidden"}
        animate={loadInMotionState}
        variants={logoVariants}
        className="pointer-events-auto absolute left-6 top-[max(1.5rem,env(safe-area-inset-top,0px)+1rem)] z-40 rounded-full outline-none focus-visible:ring-4 focus-visible:ring-white/35 sm:left-10 lg:left-16"
      >
        <div
          aria-hidden="true"
          className="logo-mark h-11 w-11 sm:h-[3.15rem] sm:w-[3.15rem]"
          style={{ backgroundColor: "rgb(62 46 103)" }}
        />
      </motion.button>

      <div className="absolute inset-0 z-0">
        <div className="stage-backdrop absolute inset-0" />
      </div>

      <motion.section
        aria-label="Orb scene"
        className="absolute inset-0 z-10 overflow-hidden"
        initial={prefersReducedMotion ? false : "hidden"}
        animate={loadInMotionState}
        variants={sceneShellVariants}
      >
        <Scene
          isMobile={isMobile}
          loadInProgress={loadInProgress}
          sceneProgress={sceneProgress}
          reducedMotion={Boolean(prefersReducedMotion)}
          onReady={() => setIsSceneReady(true)}
        />
      </motion.section>

      <div className="pointer-events-none absolute inset-0 z-30">
        <AnimatePresence mode="wait" initial={false}>
          {phase === "landing" ? (
            <motion.div
              key="landing"
              variants={phaseSwapVariants}
              initial={prefersReducedMotion ? false : "hidden"}
              animate={loadInMotionState}
              exit={prefersReducedMotion ? undefined : "exit"}
              className={STAGE_PADDING_CLASSES}
            >
              <div className="flex h-full items-start justify-center sm:items-center sm:justify-start">
                <div className="w-full max-w-[26rem] text-center sm:max-w-[36rem] sm:text-left">
                  <motion.div
                    variants={introContentVariants}
                    className="stage-intro-flow"
                  >
                    <div className="space-y-5">
                      <motion.h1
                        variants={introHeadlineVariants}
                        className="mx-auto flex w-fit max-w-full flex-col items-center text-center font-serif text-[clamp(2.2rem,9vw,2.95rem)] font-normal leading-[1.02] tracking-[-0.012em] text-[#37285d] sm:mx-0 sm:block sm:w-auto sm:max-w-none sm:text-left sm:text-[clamp(2.85rem,2.1rem+1.6vw,4.4rem)]"
                      >
                        <span className="block w-fit">Letters from</span>
                        <span className="block w-fit">your future self.</span>
                      </motion.h1>

                      <motion.p
                        variants={introCopyVariants}
                        className="mx-auto max-w-[20rem] text-center text-[1.05rem] leading-[1.42] tracking-[0.002em] text-[#64567f]/88 sm:mx-0 sm:max-w-[26rem] sm:text-left sm:pl-[0.28rem] sm:text-[1.18rem]"
                      >
                        Your future self 5 years from now wants to write to
                        you. To remind you who you&apos;re becoming, and what
                        you&apos;re fighting for.
                      </motion.p>
                    </div>

                    <motion.div
                      variants={introCtaVariants}
                      className="mx-auto mt-12 flex justify-center sm:mx-0 sm:mt-14 sm:justify-start sm:-translate-x-[0.06rem]"
                    >
                      <motion.button
                        type="button"
                        onClick={handleLightOrb}
                        whileHover={prefersReducedMotion ? undefined : { scale: 1.04 }}
                        whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
                        transition={buttonHoverTransition}
                        className="orb-cta pointer-events-auto inline-flex h-14 min-w-56 items-center justify-center whitespace-nowrap rounded-full px-9 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-white outline-none"
                      >
                        Read my letters
                      </motion.button>
                    </motion.div>
                  </motion.div>
                </div>
              </div>
            </motion.div>
          ) : phase === "asking" ? (
            <motion.div
              key={`asking-${questionIndex}`}
              variants={phaseSwapVariants}
              initial={prefersReducedMotion ? false : "hidden"}
              animate="visible"
              exit={prefersReducedMotion ? undefined : "exit"}
              className={STAGE_PADDING_CLASSES}
            >
              <div className="flex h-full items-center justify-center">
                <div className="w-full max-w-[26rem] text-center sm:max-w-[34rem]">
                  <div className="space-y-6">
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-[0.62rem] font-semibold uppercase tracking-[0.32em] text-[#64567f]/82">
                        {questionIndex + 1} of {QUESTIONS.length}
                      </span>
                      <span aria-hidden="true" className="flex items-center gap-1.5">
                        {QUESTIONS.map((_, idx) => (
                          <span
                            key={idx}
                            className={`block h-[5px] w-[5px] rounded-full transition-colors duration-300 ${
                              idx <= questionIndex ? "bg-[#37285d]" : "bg-[#37285d]/22"
                            }`}
                          />
                        ))}
                      </span>
                    </div>

                    <h2
                      id={`q-${questionIndex}`}
                      className="font-serif text-[clamp(1.55rem,5.8vw,2.15rem)] font-normal leading-[1.12] tracking-[-0.005em] text-[#37285d] sm:text-[clamp(1.75rem,1.45rem+0.85vw,2.5rem)]"
                    >
                      {currentQuestion.title}
                    </h2>

                    <p className="text-[0.97rem] leading-[1.46] text-[#64567f]/82 sm:text-[1.04rem]">
                      {currentQuestion.helper}
                    </p>

                    {currentQuestion.inputType === "textarea" ? (
                      <textarea
                        ref={(el) => {
                          inputRef.current = el;
                        }}
                        value={answers[questionIndex]}
                        onChange={(event) => handleAnswerChange(event.target.value)}
                        aria-labelledby={`q-${questionIndex}`}
                        rows={isMobile ? 4 : 5}
                        className="pointer-events-auto block w-full resize-none rounded-2xl border border-white/70 bg-white/55 px-5 py-4 text-left text-[1rem] leading-[1.5] tracking-[0.002em] text-[#37285d] shadow-[0_18px_44px_rgba(79,45,156,0.14)] outline-none backdrop-blur-[10px] placeholder:text-[#64567f]/40 focus:border-white focus:ring-4 focus:ring-white/45"
                      />
                    ) : (
                      <div>
                        <input
                          ref={(el) => {
                            inputRef.current = el;
                          }}
                          type={
                            currentQuestion.inputType === "number"
                              ? "text"
                              : currentQuestion.inputType
                          }
                          value={answers[questionIndex]}
                          onChange={(event) =>
                            handleAnswerChange(event.target.value)
                          }
                          onBlur={
                            currentQuestion.inputType === "email"
                              ? handleEmailBlur
                              : undefined
                          }
                          aria-labelledby={`q-${questionIndex}`}
                          placeholder={currentQuestion.placeholder}
                          autoComplete={currentQuestion.autoComplete}
                          maxLength={
                            currentQuestion.inputType === "number" ? 2 : undefined
                          }
                          pattern={
                            currentQuestion.inputType === "number"
                              ? "[0-9]*"
                              : undefined
                          }
                          inputMode={
                            currentQuestion.inputType === "number"
                              ? "numeric"
                              : currentQuestion.inputType === "email"
                                ? "email"
                                : "text"
                          }
                          className="pointer-events-auto block w-full rounded-2xl border border-white/70 bg-white/55 px-5 py-4 text-left text-[1rem] leading-[1.5] tracking-[0.002em] text-[#37285d] shadow-[0_18px_44px_rgba(79,45,156,0.14)] outline-none backdrop-blur-[10px] placeholder:text-[#64567f]/40 focus:border-white focus:ring-4 focus:ring-white/45"
                        />
                        {currentQuestion.inputType === "number" && ageError ? (
                          <p
                            role="alert"
                            className="mt-2 text-left text-[0.8rem] leading-[1.3] text-[#b8395a]"
                          >
                            Numbers only — up to 2 digits.
                          </p>
                        ) : null}
                        {currentQuestion.inputType === "email" && emailError ? (
                          <p
                            role="alert"
                            className="mt-2 text-left text-[0.8rem] leading-[1.3] text-[#b8395a]"
                          >
                            {emailError}
                          </p>
                        ) : null}
                        {currentQuestion.inputType === "email" &&
                        !emailError &&
                        emailSuggestion ? (
                          <p className="mt-2 text-left text-[0.84rem] leading-[1.4] text-[#64567f]">
                            Did you mean{" "}
                            <button
                              type="button"
                              onClick={acceptEmailSuggestion}
                              className="cursor-pointer font-semibold text-[#37285d] underline decoration-[#37285d]/35 underline-offset-2 transition-colors hover:decoration-[#37285d]"
                            >
                              {emailSuggestion}
                            </button>
                            ?
                          </p>
                        ) : null}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <motion.button
                        type="button"
                        onClick={handleBack}
                        whileHover={prefersReducedMotion ? undefined : { scale: 1.03 }}
                        whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
                        transition={buttonHoverTransition}
                        className="pointer-events-auto inline-flex h-12 items-center justify-center rounded-full border border-white/70 bg-white/24 px-6 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-[#37285d] outline-none backdrop-blur-[10px] transition-colors duration-300 hover:bg-white/36 focus-visible:ring-4 focus-visible:ring-white/45"
                      >
                        Back
                      </motion.button>
                      <motion.button
                        type="button"
                        onClick={handleNext}
                        whileHover={prefersReducedMotion ? undefined : { scale: 1.04 }}
                        whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
                        transition={buttonHoverTransition}
                        className="orb-cta pointer-events-auto inline-flex h-12 min-w-32 items-center justify-center rounded-full px-7 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-white outline-none"
                      >
                        {questionIndex === QUESTIONS.length - 1 ? "Continue" : "Next"}
                      </motion.button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : phase === "pricing" ? (
            <motion.div
              key="pricing"
              variants={phaseSwapVariants}
              initial={prefersReducedMotion ? false : "hidden"}
              animate="visible"
              exit={prefersReducedMotion ? undefined : "exit"}
              className={STAGE_PADDING_CLASSES}
            >
              <div className="flex h-full items-center justify-center">
                <div className="w-full max-w-[26rem] text-center sm:max-w-[34rem]">
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <h2 className="font-serif text-[clamp(1.55rem,5.8vw,2.15rem)] font-normal leading-[1.12] tracking-[-0.005em] text-[#37285d] sm:text-[clamp(1.75rem,1.45rem+0.85vw,2.5rem)]">
                        Choose your email cadence
                      </h2>
                      <p className="text-[0.97rem] leading-[1.46] text-[#64567f]/82 sm:text-[1.04rem]">
                        How often would you like to hear from them?
                      </p>
                    </div>

                    <div className="flex flex-col gap-3">
                      {PRICING_OPTIONS.map((option) => (
                        <div
                          key={option.id}
                          className="flex items-center gap-4 rounded-2xl border border-white/70 bg-white/55 px-4 py-3.5 shadow-[0_18px_44px_rgba(79,45,156,0.14)] backdrop-blur-[10px] sm:px-5 sm:py-4"
                        >
                          <div className="flex-1 text-left">
                            <div className="font-serif text-[1.15rem] font-normal leading-[1.05] text-[#37285d] sm:text-[1.3rem]">
                              {option.cadence}
                            </div>
                            <p className="mt-1 text-[0.74rem] leading-[1.3] text-[#64567f]/68 sm:text-[0.8rem]">
                              {option.description}
                            </p>
                          </div>
                          <div className="flex flex-col items-end leading-none">
                            <div className="font-serif text-[1.55rem] font-normal text-[#37285d] sm:text-[1.75rem]">
                              {option.price}
                            </div>
                            <div className="mt-1 text-[0.6rem] tracking-[0.04em] text-[#64567f]/60 sm:text-[0.64rem]">
                              one-time
                            </div>
                          </div>
                          <motion.button
                            type="button"
                            onClick={() => handleSelectPlan(option.id)}
                            disabled={submitting !== null}
                            whileHover={
                              prefersReducedMotion || submitting !== null
                                ? undefined
                                : { scale: 1.04 }
                            }
                            whileTap={
                              prefersReducedMotion || submitting !== null
                                ? undefined
                                : { scale: 0.985 }
                            }
                            transition={buttonHoverTransition}
                            className="orb-cta pointer-events-auto inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-5 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-white outline-none disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {submitting === option.id ? "Sealing…" : "Seal it"}
                          </motion.button>
                        </div>
                      ))}
                    </div>

                    {submitError ? (
                      <p
                        role="alert"
                        className="text-center text-[0.84rem] leading-[1.4] text-[#b8395a]"
                      >
                        {submitError}
                      </p>
                    ) : null}

                    <div className="flex justify-center pt-1">
                      <motion.button
                        type="button"
                        onClick={handlePricingBack}
                        whileHover={prefersReducedMotion ? undefined : { scale: 1.03 }}
                        whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
                        transition={buttonHoverTransition}
                        className="pointer-events-auto inline-flex h-12 items-center justify-center rounded-full border border-white/70 bg-white/24 px-6 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-[#37285d] outline-none backdrop-blur-[10px] transition-colors duration-300 hover:bg-white/36 focus-visible:ring-4 focus-visible:ring-white/45"
                      >
                        Back
                      </motion.button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="sealed"
              variants={phaseSwapVariants}
              initial={prefersReducedMotion ? false : "hidden"}
              animate="visible"
              exit={prefersReducedMotion ? undefined : "exit"}
              className={STAGE_PADDING_CLASSES}
            >
              <div className="flex h-full items-center justify-center">
                <div className="w-full max-w-[26rem] text-center sm:max-w-[34rem]">
                  <div className="space-y-6">
                    <h1
                      className="font-serif text-[clamp(2.8rem,11.5vw,4.7rem)] font-normal leading-[0.97] tracking-[-0.012em] text-white sm:text-[clamp(3.1rem,2.4rem+1.7vw,5rem)]"
                      style={{
                        textShadow:
                          "0 2px 28px rgba(54,40,93,0.55), 0 1px 3px rgba(54,40,93,0.4)",
                      }}
                    >
                      Sealed.
                    </h1>
                    <p
                      className="mx-auto max-w-[22rem] text-[1.05rem] leading-[1.42] tracking-[0.002em] text-white/92 sm:max-w-[26rem] sm:text-[1.18rem]"
                      style={{
                        textShadow: "0 1px 18px rgba(54,40,93,0.55)",
                      }}
                    >
                      A letter from five-years-you is on the way.
                    </p>
                    <div className="flex justify-center pt-2">
                      <motion.button
                        type="button"
                        onClick={handleStartOver}
                        whileHover={prefersReducedMotion ? undefined : { scale: 1.04 }}
                        whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
                        transition={buttonHoverTransition}
                        className="pointer-events-auto inline-flex h-12 items-center justify-center rounded-full border border-white/80 bg-white/18 px-7 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-white shadow-[0_18px_42px_rgba(54,40,93,0.35)] outline-none backdrop-blur-[10px] transition-colors duration-300 hover:bg-white/28 focus-visible:ring-4 focus-visible:ring-white/55"
                      >
                        Start Over
                      </motion.button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
