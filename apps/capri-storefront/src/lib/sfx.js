// Subtle, non-invasive UI sound effects generated with the Web Audio API — no
// audio files are shipped. A single AudioContext is created lazily on the first
// user gesture (respecting browser autoplay rules). Every sound is very quiet
// and short so it never distracts. Muting is persisted in localStorage and
// exposed through a header toggle.

let ctx = null;
let muted = false;
try { muted = localStorage.getItem("oer_sfx_muted") === "1"; } catch { /* no storage */ }

function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// One short, softly-enveloped tone. gain stays tiny (≤0.05) to be unobtrusive.
function blip({ freq = 660, type = "sine", dur = 0.06, gain = 0.04, glideTo = null }) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  click:   () => blip({ freq: 520, type: "triangle", dur: 0.05, gain: 0.03 }),
  select:  () => blip({ freq: 660, type: "sine", dur: 0.07, gain: 0.038, glideTo: 990 }),
  toggle:  () => blip({ freq: 440, type: "triangle", dur: 0.05, gain: 0.03 }),
  success: () => {
    blip({ freq: 660, type: "sine", dur: 0.09, gain: 0.042, glideTo: 880 });
    setTimeout(() => blip({ freq: 990, type: "sine", dur: 0.12, gain: 0.038 }), 70);
  },
};

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem("oer_sfx_muted", muted ? "1" : "0"); } catch { /* no storage */ }
  if (!muted) sfx.toggle();
}
export function toggleMuted() { setMuted(!muted); return muted; }

// Global wiring: a capture-phase click listener plays a soft sound for EVERY
// interactive element, so all interactions are covered without touching each
// component. Elements can opt into a richer sound via data-sfx="success|select".
let inited = false;
export function initSfx() {
  if (inited || typeof document === "undefined") return;
  inited = true;
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target.closest(
        "button, a, [role=button], .choice, .zlx-float-color, .brand-circle, .flag-btn, .swatch, .pdp-thumb, .chip, .icon-btn"
      );
      if (!el || el.getAttribute("aria-disabled") === "true" || el.disabled) return;
      const kind = el.dataset ? el.dataset.sfx : null;
      if (kind === "success") sfx.success();
      else if (kind === "select") sfx.select();
      else sfx.click();
    },
    true
  );
}
