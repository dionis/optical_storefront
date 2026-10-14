import type { MedusaRequest } from "@medusajs/framework/http";

/**
 * Real client IP behind ONE trusted reverse proxy (Traefik/Coolify).
 *
 * `X-Forwarded-For` is client-writable: an attacker can send any chain he
 * likes, and the proxy APPENDS the address it actually saw. Trusting the FIRST
 * entry (what the three rate limiters used to do) let anyone rotate a header
 * value to dodge every limit. The only entry our single proxy vouches for is
 * the LAST one, so that is the one we meter.
 *
 * `TRUSTED_PROXY_HOPS` (default 1) exists for deployments that chain a CDN in
 * front of the proxy: with 2 hops the client is the second-from-last entry.
 */
export function clientIp(req: MedusaRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  if (raw) {
    const chain = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const hops = Math.max(1, parseInt(process.env.TRUSTED_PROXY_HOPS || "1", 10) || 1);
    const pick = chain[chain.length - hops];
    if (pick) return pick;
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}
