# BTAC Backstage

Create an independent workspace for your band. Each workspace can publish a branded presale signup page, send a one-time email when tickets open, and track signups and ticket clicks by partner.

## Use it

1. Sign in with ChatGPT and create a band with its name and brand color.
2. Create a presale with the event date, presale opening, time zone, and HTTPS ticket URL. Preview the fan page before publishing.
3. Add promo partners on the presale screen. Copy each partner’s link after publishing. Signups are deduplicated by email for each presale and retain their original source.
4. The fan form has a separate, unchecked box for future band updates. That choice is recorded separately from the one-time presale alert.
5. Once the presale opens, fans can continue to the ticket seller. The dashboard counts clicks through to the seller, including repeat clicks, separately from signups. It does not count sales.

## Run locally

Requires Node 22.13 or newer. Run `npm ci` and `npm run build`, then apply the schema to the local D1 database once:

    node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_petite_mongu.sql

Run `npm run dev` and use the URL it prints. The starter uses a simulated ChatGPT identity on loopback in development. Local D1 data is independent from hosted data. Run `npm test` for the end-to-end request tests, which use SQLite and a simulated email provider.

## Hosted access and delivery

The Sites preview is owner-only. The app uses Sites' authenticated identity for the band dashboard and checks ownership independently for each workspace. Before inviting outside bands or sharing campaign links with fans, make the deployed Site public. The fan routes can receive anonymous signups when the Site allows anonymous traffic.

Configure the following runtime values in Sites and redeploy the saved version before enabling email:

| Key | Value |
| --- | --- |
| `RESEND_API_KEY` | A sending API key for the Resend account |
| `BACKSTAGE_FROM_EMAIL` | A sender on a verified domain |
| `BACKSTAGE_PUBLIC_URL` | The HTTPS origin fans will visit |
| `BACKSTAGE_DISPATCH_SECRET` | A random bearer secret of at least 32 characters |

On an always-on host, run `npm run dispatch` with the public URL and dispatch secret set in its environment. For an owner-only Site, set `BACKSTAGE_SITES_SERVICE_TOKEN` to its service token. Use `npm run dispatch -- --once` to check an installation without leaving a process running. The script prints counts only.

You can also use your own scheduler. Send an authenticated `POST /api/dispatch` at least once a minute. Set `Authorization: Bearer <dispatch secret>`. For an owner-only Site the scheduler additionally needs supported Sites service access. Each successful call processes up to 20 due alerts. Where a larger presale exceeds one batch, call again until `checked` is below 20, honoring provider rate limits. The response contains counts only. A presale never sends before its scheduled time. Retries use a stable idempotency key and are limited to the provider's idempotency window.

Email delivery is disabled without a configured sender and scheduler. The app will still record signups and partner activity. Do not share a live presale link until you have verified delivery end to end with your sender and scheduler.
