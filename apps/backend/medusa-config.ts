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
