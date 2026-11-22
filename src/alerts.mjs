import { escapeHtml } from "./view.mjs";

const minute = 60_000;
const retryWindow = 23 * 60 * minute;

function publicOrigin(env) {
  try {
    const url = new URL(env.BACKSTAGE_PUBLIC_URL);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

function configuredChannels(env) {
  const origin = publicOrigin(env);
  return {
    email: Boolean(origin && env.RESEND_API_KEY && env.BACKSTAGE_FROM_EMAIL),
    text: Boolean(origin && /^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID)
      && /^SK[0-9a-f]{32}$/i.test(env.TWILIO_API_KEY_SID) && env.TWILIO_API_KEY_SECRET
      && /^MG[0-9a-f]{32}$/i.test(env.TWILIO_MESSAGING_SERVICE_SID)),
  };
}

export function alertAvailability(env) {
  return (env.BACKSTAGE_DISPATCH_SECRET?.length ?? 0) >= 32
    ? configuredChannels(env) : {email:false, text:false};
}

export async function authorizeDispatch(request, secret) {
  const header = request.headers.get("authorization");
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ") || header.length <= 7) return false;
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", bytes.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign", "verify"]);
  const challenge = bytes.encode("backstage-dispatch");
  const suppliedKey = await crypto.subtle.importKey("raw", bytes.encode(header.slice(7)), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", suppliedKey, challenge);
  return crypto.subtle.verify("HMAC", key, signature, challenge);
}

export function presaleEmail(item, publicUrl, from) {
  const url = new URL(`/t/${item.ticket_token}`, publicUrl).href;
  const title = item.title.replace(/[\r\n]+/g, " ");
  return {
    from,
    to: [item.email],
    subject: `Presale is open: ${title}`,
    text: `Tickets for ${title} from ${item.band_name} are now available.\n\nGet tickets: ${url}\n\nYou signed up for a one-time presale alert.`,
    html: `<div style="font:16px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;color:#1a1a1a;max-width:580px;margin:32px auto">
      <p>${escapeHtml(item.band_name)}</p><h1>Presale is open.</h1>
      <p>Tickets for <strong>${escapeHtml(title)}</strong> are now available.</p>
      <p><a style="display:inline-block;padding:12px 20px;border-radius:9px;background:#262433;color:white;text-decoration:none" href="${escapeHtml(url)}">Get tickets</a></p>
      <p style="color:#64616c;font-size:14px">You signed up for a one-time presale alert.</p>
    </div>`,
  };
}

async function submitEmail(item, env, send) {
  try {
    const payload = presaleEmail(item, publicOrigin(env), env.BACKSTAGE_FROM_EMAIL);
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `presale/${item.id}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) return "sent";
    return response.status === 408 || response.status === 429 || response.status >= 500 ? "retry" : "failed";
  } catch {
    // Resend deduplicates a retry even when the original request timed out after acceptance.
    return "retry";
  }
}

async function submitText(item, env, send) {
  const url = new URL(`/t/${item.ticket_token}`, publicOrigin(env)).href;
  const band = item.band_name.replace(/[\r\n]+/g, " ");
  const body = new URLSearchParams({
    To: item.phone,
    MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
    Body: `${band} via BTAC Backstage: Presale is open. ${url} Reply STOP to unsubscribe.`,
  });
  try {
    const credentials = btoa(`${env.TWILIO_API_KEY_SID}:${env.TWILIO_API_KEY_SECRET}`);
    const response = await send(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: {Authorization: `Basic ${credentials}`},
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 429) return "retry";
    if (!response.ok) return "failed";
    const result = await response.json();
    return /^(SM|MM)[0-9a-f]{32}$/i.test(result.sid)
      && ["accepted", "queued", "sending", "sent", "delivered"].includes(result.status) ? "sent" : "failed";
  } catch {
    // A timed-out send may have been accepted. Do not risk another text to the same fan.
    return "failed";
  }
}

async function processQueue(queue, submit, now, limit) {
  await queue.expireLeases(now, now - retryWindow);
  const due = await queue.due(now, limit);
  const counts = { checked: due.length, sent: 0, retrying: 0, failed: 0 };

  for (const item of due) {
    const lease = crypto.randomUUID();
    const job = await queue.claim(item.id, lease, now, now + 5 * minute);
    if (!job) continue;

    const result = await submit(item);
    if (result === "sent") {
      await queue.complete(item.id, lease, now);
      counts.sent++;
      continue;
    }

    const retry = result === "retry" && job.attempts < 8;
    const nextAt = now + Math.min(60, 4 ** (job.attempts - 1)) * minute;
    await queue.retry(item.id, lease, retry ? "pending" : "failed", nextAt);
    counts[retry ? "retrying" : "failed"]++;
  }

  return counts;
}

export async function dispatchDue(store, env, {now = Date.now(), send = fetch} = {}) {
  const channels = configuredChannels(env);
  const active = Object.entries(channels).filter(([, ready]) => ready);
  if (!active.length) return null;
  const batchSize = 20 / active.length;
  const providers = {email:submitEmail, text:submitText};
  const results = await Promise.all(active.map(([channel]) =>
    processQueue(store.queues[channel], (item) => providers[channel](item, env, send), now, batchSize),
  ));
  return {
    checked: results.reduce((sum, item) => sum + item.checked, 0),
    sent: results.reduce((sum, item) => sum + item.sent, 0),
    retrying: results.reduce((sum, item) => sum + item.retrying, 0),
    failed: results.reduce((sum, item) => sum + item.failed, 0),
    has_more: results.some((item) => item.checked === batchSize),
  };
}
