# BTAC Backstage

Create an independent workspace for your band. Each workspace can publish a branded presale signup page, send one-time email and text alerts when tickets open, and track signups and ticket clicks by partner.

## Use it

1. Sign in with ChatGPT and create a band with its name and brand color.
2. Create a presale with the event date, presale opening, time zone, and HTTPS ticket URL. Preview the fan page before publishing.
3. Add promo partners on the presale screen. Copy each partner’s link after publishing. Email addresses and numbers are deduplicated per presale. A signup with both channels counts once and retains its original source.
4. Fans can choose Email, Text, or Both. The form asks them to consent before enrolling a mobile number. Future updates are optional and recorded separately for each channel.
5. Once the presale opens, fans can continue to the ticket seller. The dashboard counts clicks through to the seller, including repeat clicks, separately from signups. It does not count sales.
6. If the ticket destination changes after opening, use **Edit ticket link** on the presale dashboard. Placeholder domains such as `tickets.example` show as unavailable on the fan page.

## Run locally

Requires Node 22.13 or newer. Run `npm ci` and `npm run build`, then apply each pending migration in filename order. For example, apply the first migration to a fresh local database with:

    node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_petite_mongu.sql

Repeat with `drizzle/0001_sour_firelord.sql` to add text signups. Run `npm run dev` and use the URL it prints. The starter uses a simulated ChatGPT identity on loopback in development. Local D1 data is independent from hosted data. Run `npm test` for request tests with SQLite and simulated delivery providers.

## Hosted access and delivery

The Sites preview is owner-only. The app uses Sites' authenticated identity for the band dashboard and checks ownership independently for each workspace. Before inviting outside bands or sharing campaign links with fans, make the deployed Site public. The fan routes can receive anonymous signups when the Site allows anonymous traffic.

Configure the runtime values for the channels you want to enable in Sites and redeploy the saved version:

| Key | Value |
| --- | --- |
| `RESEND_API_KEY` | A sending API key for the Resend account |
| `BACKSTAGE_FROM_EMAIL` | A sender on a verified domain |
| `BACKSTAGE_PUBLIC_URL` | The HTTPS origin fans will visit |
| `BACKSTAGE_DISPATCH_SECRET` | A random bearer secret of at least 32 characters |
| `TWILIO_ACCOUNT_SID` | Account for the SMS sender |
| `TWILIO_API_KEY_SID` | API key with permission to create Messages |
| `TWILIO_API_KEY_SECRET` | Secret for that API key |
| `TWILIO_MESSAGING_SERVICE_SID` | Messaging Service with a registered, reply-capable sender |

For SMS, configure a [Twilio Messaging Service](https://www.twilio.com/docs/messaging/services) with STOP handling. The text identifies the band and includes its tracked ticket link. The dashboard shows submissions accepted by the provider. Twilio handles subsequent delivery and opt-outs. Future update preferences are captured for each channel.

On an always-on host, run `npm run dispatch` with the public URL and dispatch secret set in its environment. For an owner-only Site, set `BACKSTAGE_SITES_SERVICE_TOKEN` to its service token. Use `npm run dispatch -- --once` to check an installation without leaving a process running. The script prints counts only.

You can also use your own scheduler. Send an authenticated `POST /api/dispatch` at least once a minute. Set `Authorization: Bearer <dispatch secret>`. For an owner-only Site the scheduler additionally needs supported Sites service access. Each successful call processes up to 20 due alerts. For larger presales, call again while `has_more` is true, honoring provider rate limits. The response contains counts only. Delivery starts at the opening time. Email retries use a stable idempotency key. Text sends retry on rate limits and report ambiguous submissions as failures to avoid duplicate texts.

The private preview can record email and text signups with delivery off. Before sharing a live presale link, verify each intended channel with its sender and scheduler.
