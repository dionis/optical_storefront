import { loadEnv, defineConfig } from "@medusajs/framework/utils";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

// The S3 provider throws from its constructor when credentials are absent,
// which takes the whole server down at boot rather than degrading. Register it
// only when it can actually work, so a deployment without R2 still starts.
const hasR2Credentials = Boolean(
  process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
);

if (!hasR2Credentials) {
  console.warn(
    "[file] R2 credentials missing — falling back to local disk storage. " +
      "Uploads do not survive a redeploy, and prescription images would not " +
      "land in the private bucket they require. Set R2_ACCESS_KEY_ID and " +
      "R2_SECRET_ACCESS_KEY before enabling the prescription flow."
  );
}

// Same reasoning for email: the Resend provider validates its options at boot
// and throws when they are missing. Fall back to the logging provider so a
// deployment without mail credentials still starts — order confirmations then
// show up in the server log instead of an inbox.
const hasResendCredentials = Boolean(
  process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL
);

if (!hasResendCredentials) {
  console.warn(
    "[notification] Resend credentials missing — emails will be logged, not sent. " +
      "Set RESEND_API_KEY and RESEND_FROM_EMAIL to deliver order confirmations."
  );
}

const notificationProviders = hasResendCredentials
  ? [
      {
        resolve: "./src/modules/notification-resend",
        id: "resend",
        options: {
          channels: ["email"],
          api_key: process.env.RESEND_API_KEY,
          from: process.env.RESEND_FROM_EMAIL,
        },
      },
    ]
  : [
      {
        resolve: "@medusajs/medusa/notification-local",
        id: "local",
        options: {
          channels: ["email"],
        },
      },
    ];

const fileProviders = hasR2Credentials
  ? [
      {
        resolve: "@medusajs/medusa/file-s3",
        id: "s3",
        options: {
          file_url: process.env.R2_PUBLIC_URL,
          access_key_id: process.env.R2_ACCESS_KEY_ID,
          secret_access_key: process.env.R2_SECRET_ACCESS_KEY,
          region: process.env.R2_REGION ?? "auto",
          bucket: process.env.R2_BUCKET ?? "eyewear-assets",
          endpoint: process.env.R2_ENDPOINT,
          // Omit the ACL header entirely. Left unset, the provider defaults to
          // sending `public-read`/`private` on every upload, and none of the
          // backends we target implement S3 ACLs — R2 and Supabase Storage manage
          // visibility per bucket instead.
          acl: false,
          additional_client_config: {
            // See the comment in src/lib/s3.ts — bucket-as-subdomain has no
            // certificate on Supabase Storage, and path-style works everywhere.
            forcePathStyle: true,
          },
        },
      },
    ]
  : [
      {
        resolve: "@medusajs/medusa/file-local",
        id: "local",
      },
    ];

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS ?? "http://localhost:3000",
      adminCors: process.env.ADMIN_CORS ?? "http://localhost:9000",
      authCors: process.env.AUTH_CORS ?? "http://localhost:9000",
      jwtSecret: process.env.JWT_SECRET ?? "change-me-in-production",
      cookieSecret: process.env.COOKIE_SECRET ?? "change-me-in-production",
    },
  },
  admin: {
    backendUrl: process.env.BACKEND_URL ?? "http://localhost:9000",
  },
  modules: [
    // File storage: Cloudflare R2 via S3-compatible API, local disk otherwise
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: fileProviders,
      },
    },
    // Notifications: transactional email via Resend, logger otherwise
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: notificationProviders,
      },
    },
    // Payment: Stripe + PayPal + Square
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/payment-stripe",
            id: "stripe",
            options: {
              apiKey: process.env.STRIPE_SECRET_KEY,
              webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            },
          },
          {
            resolve: "./src/modules/payment-paypal",
            id: "paypal",
            options: {
              client_id: process.env.PAYPAL_CLIENT_ID,
              client_secret: process.env.PAYPAL_CLIENT_SECRET,
              environment: process.env.PAYPAL_ENVIRONMENT ?? "sandbox",
              webhook_id: process.env.PAYPAL_WEBHOOK_ID,
            },
          },
          {
            resolve: "./src/modules/payment-square",
            id: "square",
            options: {
              access_token: process.env.SQUARE_ACCESS_TOKEN,
              location_id: process.env.SQUARE_LOCATION_ID,
              environment: process.env.SQUARE_ENVIRONMENT ?? "sandbox",
              webhook_signature_key: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
            },
          },
        ],
      },
    },
    // Custom modules
    {
      resolve: "./src/modules/lens-config",
    },
    {
      resolve: "./src/modules/prescription",
    },
  ],
});
