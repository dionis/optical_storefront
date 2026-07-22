"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useFaceLandmarker } from "@/hooks/use-face-landmarker";

// ── MediaPipe landmark indices ────────────────────────────────────────────
// Face mesh 468-point topology
const L_EYE_OUTER = 33;
const L_EYE_INNER = 133;
const R_EYE_OUTER = 263;
const R_EYE_INNER = 362;

interface Point {
  x: number;
  y: number;
}

// ── Props ─────────────────────────────────────────────────────────────────

interface TryonCanvasProps {
  frameImageUrl: string | null;
  /** Called with a base64 data-URL when the user hits "Capture" */
  onCapture?: (dataUrl: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────

export function TryonCanvas({ frameImageUrl, onCapture }: TryonCanvasProps) {
  const t = useTranslations("tryOn");
  const { landmarker, isReady, error: landmarkerError } = useFaceLandmarker();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameImgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimestamp = useRef<number>(-1);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);

  // Load frame image whenever URL changes
  useEffect(() => {
    if (!frameImageUrl) {
      frameImgRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = frameImageUrl;
    img.onload = () => {
      frameImgRef.current = img;
    };
    img.onerror = () => {
      frameImgRef.current = null;
    };
  }, [frameImageUrl]);

  // Open webcam
  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch {
        setCameraError(t("cameraAccessError"));
      }
    })();
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      setCameraReady(false);
    };
  }, []);

  // Render loop
  useEffect(() => {
    if (!cameraReady || !isReady) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = (timestamp: number) => {
      if (video.readyState < 2) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const W = canvas.width;
      const H = canvas.height;

      // Mirror video
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, W, H);
      ctx.restore();

      // Detect landmarks on the original (non-mirrored) video
      if (landmarker.current && timestamp !== lastTimestamp.current) {
        lastTimestamp.current = timestamp;
        const results = landmarker.current.detectForVideo(video, timestamp);
        const lm = results.faceLandmarks?.[0];

        if (lm && lm.length >= 468 && frameImgRef.current) {
          // Convert normalized coords to pixel — then mirror x
          const lmPx = (i: number): { x: number; y: number } => ({
            x: W - lm[i].x * W, // mirrored
            y: lm[i].y * H,
          });

          const leftEye: Point = {
            x: (lmPx(L_EYE_OUTER).x + lmPx(L_EYE_INNER).x) / 2,
            y: (lmPx(L_EYE_OUTER).y + lmPx(L_EYE_INNER).y) / 2,
          };
          const rightEye: Point = {
            x: (lmPx(R_EYE_OUTER).x + lmPx(R_EYE_INNER).x) / 2,
            y: (lmPx(R_EYE_OUTER).y + lmPx(R_EYE_INNER).y) / 2,
          };

          // Note: after mirroring, left/right are swapped on screen
          const ipd = Math.hypot(
            rightEye.x - leftEye.x,
            rightEye.y - leftEye.y
          );

          const angle = Math.atan2(
            rightEye.y - leftEye.y,
            rightEye.x - leftEye.x
          );

          const frameImg = frameImgRef.current;
          const aspectRatio = frameImg.naturalWidth / frameImg.naturalHeight;
          const frameW = ipd * 2.8;
          const frameH = frameW / aspectRatio;

          const centerX = (leftEye.x + rightEye.x) / 2;
          const centerY = (leftEye.y + rightEye.y) / 2 - frameH * 0.15;

          ctx.save();
          ctx.translate(centerX, centerY);
          ctx.rotate(angle);
          ctx.drawImage(frameImg, -frameW / 2, -frameH / 2, frameW, frameH);
          ctx.restore();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [cameraReady, isReady, landmarker]);

  const handleCapture = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCaptured(dataUrl);
    onCapture?.(dataUrl);
  }, [onCapture]);

  const handleRetake = () => setCaptured(null);

  // ── Error states ─────────────────────────────────────────────────────

  if (cameraError) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-red-200 bg-red-50 p-10 text-center">
        <span className="text-4xl">📵</span>
        <p className="text-sm font-semibold text-red-700">{cameraError}</p>
        <p className="text-xs text-red-500">{t("cameraAccessHint")}</p>
      </div>
    );
  }

  if (landmarkerError) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
        <span className="text-3xl">⚠️</span>
        <p className="text-sm text-amber-700">
          {t("faceDetectorError", { detail: landmarkerError.detail })}
        </p>
      </div>
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────

  if (!cameraReady || !isReady) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-gray-100 p-16 text-center">
        <svg
          className="h-8 w-8 animate-spin text-accent"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <p className="text-sm text-gray-500">
          {!cameraReady ? t("cameraStarting") : t("faceDetectorLoading")}
        </p>
      </div>
    );
  }

  // ── Captured photo ────────────────────────────────────────────────────

  if (captured) {
    return (
      <div className="flex flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={captured}
          alt={t("capturedPhotoAlt")}
          className="w-full max-w-xl rounded-2xl shadow-lg"
        />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleRetake}
            className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {t("backToCamera")}
          </button>
          <a
            href={captured}
            download={t("downloadFilename")}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-700 transition-colors"
          >
            {t("downloadPhoto")}
          </a>
        </div>
      </div>
    );
  }

  // ── Live preview ──────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Hidden video element */}
      <video ref={videoRef} className="sr-only" playsInline muted />

      {/* Canvas */}
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl shadow-lg bg-black">
        <canvas ref={canvasRef} className="w-full" />
        {!frameImageUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="rounded-lg bg-black/60 px-4 py-2 text-sm text-white">
              {t("selectFramePrompt")}
            </p>
          </div>
        )}
      </div>

      {/* Controls */}
      <button
        type="button"
        onClick={handleCapture}
        disabled={!frameImageUrl}
        aria-label={t("captureAria")}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-md hover:bg-accent-700 disabled:opacity-40 transition-all active:scale-95"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
          <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-1.61c.04-.32.07-.64.07-.97s-.03-.66-.07-1l2.16-1.63c.19-.15.24-.42.12-.64l-2.05-3.55c-.12-.22-.39-.3-.61-.22l-2.55 1.03c-.52-.4-1.08-.73-1.69-.98L14.17 3c-.04-.24-.24-.42-.5-.42h-4.1c-.26 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.55-1.03c-.22-.08-.49 0-.61.22L2.4 9.4c-.13.22-.07.49.12.64L4.68 11.67c-.04.34-.07.67-.07 1s.03.65.07.97l-2.16 1.66c-.19.15-.24.42-.12.64l2.05 3.55c.12.22.39.3.61.22l2.55-1.03c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.23.42.49.42h4.1c.26 0 .46-.18.5-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.55 1.03c.22.08.49 0 .61-.22l2.05-3.55c.12-.22.07-.49-.12-.64l-2.16-1.66z" />
        </svg>
      </button>
      <p className="text-xs text-gray-400">{t("captureHint")}</p>
    </div>
  );
}
