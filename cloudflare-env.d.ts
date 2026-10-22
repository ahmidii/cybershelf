declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    APP_ORIGIN?: string;
    BETTER_AUTH_SECRET?: string;
    HARDCOVER_CLIENT_ID?: string;
  }
}
