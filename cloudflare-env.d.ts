declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    RESEND_API_KEY?: string;
    BACKSTAGE_FROM_EMAIL?: string;
    BACKSTAGE_PUBLIC_URL?: string;
    BACKSTAGE_DISPATCH_SECRET?: string;
    TWILIO_ACCOUNT_SID?: string;
    TWILIO_API_KEY_SID?: string;
    TWILIO_API_KEY_SECRET?: string;
    TWILIO_MESSAGING_SERVICE_SID?: string;
  }
}
