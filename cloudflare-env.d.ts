declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    APP_ORIGIN?: string;
    BETTER_AUTH_SECRET?: string;
    RESEND_API_KEY?: string;
    AUTH_EMAIL_FROM?: string;
    HARDCOVER_CLIENT_ID?: string;
  }
}
