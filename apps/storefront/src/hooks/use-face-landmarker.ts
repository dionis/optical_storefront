"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceLandmarker as FaceLandmarkerType } from "@mediapipe/tasks-vision";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export function useFaceLandmarker() {
  const landmarkerRef = useRef<FaceLandmarkerType | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { FaceLandmarker, FilesetResolver } = await import(
          "@mediapipe/tasks-vision"
        );
        const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "GPU",
          },
          outputFaceBlendshapes: false,
          runningMode: "VIDEO",
          numFaces: 1,
        });
        if (!cancelled) {
          landmarkerRef.current = landmarker;
          setIsReady(true);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            "No se pudo cargar el detector facial. " +
              (err instanceof Error ? err.message : String(err))
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  return { landmarker: landmarkerRef, isReady, error };
}
