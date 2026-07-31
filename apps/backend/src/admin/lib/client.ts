import Medusa from "@medusajs/js-sdk";

/**
 * SDK instance for admin dashboard extensions. Session auth — the dashboard is
 * already logged in, and the SDK attaches the headers custom /admin routes need.
 */
export const sdk = new Medusa({
  baseUrl: import.meta.env.VITE_BACKEND_URL || "/",
  debug: import.meta.env.DEV,
  auth: {
    type: "session",
  },
});
