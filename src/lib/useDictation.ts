"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export type DictationStatus =
  | "idle"
  | "permission"
  | "recording"
  | "uploading"
  | "error";

export type Dictation = {
  status: DictationStatus;
  error: string | null;
  seconds: number;
  isSupported: boolean;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
};

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

function isMediaRecorderSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

export function useDictation(onTranscript: (text: string) => void): Dictation {
  const generateUploadUrl = useMutation(api.transcribe.generateUploadUrl);
  const transcribeAudio = useAction(api.transcribe.transcribe);

  const [status, setStatus] = useState<DictationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [isSupported, setIsSupported] = useState<boolean>(() =>
    typeof window === "undefined" ? true : isMediaRecorderSupported(),
  );

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const teardown = useCallback(() => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        cancelledRef.current = true;
        try {
          recorder.stop();
        } catch {}
      }
      teardown();
    };
  }, [teardown]);

  const start = useCallback(async () => {
    if (status === "recording" || status === "permission" || status === "uploading") {
      return;
    }

    setError(null);

    if (!isMediaRecorderSupported()) {
      setIsSupported(false);
      setError("Voice recording isn't supported in this browser.");
      setStatus("error");
      return;
    }

    setStatus("permission");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error("getUserMedia failed", err);
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied. Enable it in your browser settings to dictate."
          : "Couldn't access the microphone.";
      setError(message);
      setStatus("error");
      return;
    }

    streamRef.current = stream;
    cancelledRef.current = false;

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (err) {
      console.error("MediaRecorder init failed", err);
      teardown();
      setError("Couldn't start recording on this device.");
      setStatus("error");
      return;
    }

    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = async () => {
      const localChunks = chunksRef.current;
      const localMime = recorder.mimeType || mimeType || "audio/webm";
      const wasCancelled = cancelledRef.current;

      teardown();

      if (wasCancelled || localChunks.length === 0) {
        setStatus("idle");
        setSeconds(0);
        return;
      }

      setStatus("uploading");
      try {
        const blob = new Blob(localChunks, { type: localMime });
        const uploadUrl = await generateUploadUrl();
        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": localMime },
          body: blob,
        });
        if (!uploadRes.ok) {
          throw new Error(`Upload failed (${uploadRes.status})`);
        }
        const { storageId } = (await uploadRes.json()) as { storageId: string };

        const text = await transcribeAudio({
          storageId: storageId as Id<"_storage">,
        });
        const trimmed = text.trim();
        if (trimmed) {
          onTranscriptRef.current(trimmed);
        }
        setStatus("idle");
        setSeconds(0);
      } catch (err) {
        console.error("transcription failed", err);
        setError("Transcription failed. Please try again.");
        setStatus("error");
      }
    };

    try {
      recorder.start(500);
    } catch (err) {
      console.error("recorder.start failed", err);
      teardown();
      setError("Couldn't start recording on this device.");
      setStatus("error");
      return;
    }

    setSeconds(0);
    setStatus("recording");
    tickerRef.current = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
  }, [generateUploadUrl, status, teardown, transcribeAudio]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state !== "inactive") {
      cancelledRef.current = false;
      try {
        recorder.stop();
      } catch (err) {
        console.error("recorder.stop failed", err);
      }
    }
  }, []);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      cancelledRef.current = true;
      try {
        recorder.stop();
      } catch {}
    } else {
      teardown();
    }
    setStatus("idle");
    setSeconds(0);
    setError(null);
  }, [teardown]);

  return { status, error, seconds, isSupported, start, stop, cancel };
}
