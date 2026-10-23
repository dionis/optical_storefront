import { createRateLimit } from "../../../lib/rate-limit";

/**
 * Public seller routes (`/store/sellers/resolve`, `/store/seller-dashboard`)
 * are unauthenticated beyond the publishable key: the first answers "is this
 * code real" (an enumeration target) and the second takes a bearer-like token
 * (a brute-force target). 60 per IP per 15 minutes is plenty for a human.
 */
export const sellerPublicRateLimit = createRateLimit({
  name: "seller-public",
  windowMs: 15 * 60 * 1000,
  max: 60,
  maxEnv: "SELLER_PUBLIC_RATE_LIMIT",
});
