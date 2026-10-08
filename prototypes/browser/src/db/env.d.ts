declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    APP_ORIGIN?: string;
    DEMO_MODE?: string;
    DEMO_RESET_SECRET?: string;
    DEMO_DRIVER_PASSWORD?: string;
    DEMO_PASSENGER_PASSWORD?: string;
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
  }
}
