// Live generated media: the manifest `media stream` republishes to the bucket at
// every checkpoint, merged over the fixture bundled with the build.
//
// Why: the fixture (frameMediaSample.js) is a snapshot frozen at build time, so a
// generation run that goes on for days would otherwise need a commit and a deploy
// per batch before a customer sees anything. The manifest is the same data as the
// fixture, in the same bucket as the images themselves, so it needs neither.
//
// Failure is silent on purpose: without the manifest the page shows exactly what
// the bundled fixture has, which is what it showed before this file existed.

import { useSyncExternalStore } from "react";
import { mergeGeneratedMedia } from "./frameMediaSample.js";
import { resolveMedia } from "./imageUrl.js";

// Same key as MANIFEST_KEY in apps/scraper/scraper/media/fixture.py.
const MANIFEST_KEY = "media/frame-media.json";

let version = 0;
let started = false;
const listeners = new Set();

function notify() {
  version += 1;
  for (const fn of listeners) fn();
}

/** Fetches the manifest once per page load. Safe to call from anywhere. */
export function loadLiveFrameMedia() {
  if (started) return;
  started = true;
  const url = resolveMedia(MANIFEST_KEY);
  // A bare key means no public bucket is configured (local dev): nothing to fetch.
  if (!/^https?:\/\//i.test(url)) return;
  // The query defeats any CDN copy: the key is rewritten in place every checkpoint.
  fetch(`${url}?t=${Date.now()}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((manifest) => {
      if (mergeGeneratedMedia(manifest)) notify();
    })
    .catch(() => {});
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Re-renders the caller when the live manifest lands. The return value only
 * changes identity; read the media itself through frameMediaSample.js as usual.
 */
export function useFrameMediaVersion() {
  loadLiveFrameMedia();
  return useSyncExternalStore(subscribe, () => version, () => version);
}
