import { loadEnv, defineConfig } from "@medusajs/framework/utils";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

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
    disable: process.env.MEDUSA_DISABLE_ADMIN === "true",
  },
  modules: [
    // File storage: Cloudflare R2 via S3-compatible API
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
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
        ],
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
