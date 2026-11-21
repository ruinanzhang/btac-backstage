import { escapeHtml } from "./view.mjs";

const minute = 60_000;
const retryWindow = 23 * 60 * minute;

export function emailReady(env) {
  if (!env.RESEND_API_KEY || !env.BACKSTAGE_FROM_EMAIL || !env.BACKSTAGE_PUBLIC_URL) return false;
  try {
    return new URL(env.BACKSTAGE_PUBLIC_URL).protocol === "https:";
  } catch {
    return false;
  }
}

export function dispatchReady(env) {
  return emailReady(env) && (env.BACKSTAGE_DISPATCH_SECRET?.length ?? 0) >= 32;
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

export async function dispatchDue(store, env, { now = Date.now(), send = fetch } = {}) {
  if (!emailReady(env)) return null;
  await store.expireLeases(now, now - retryWindow);
  const due = await store.due(now, 20);
  const counts = { checked: due.length, sent: 0, retrying: 0, failed: 0 };

  for (const item of due) {
    const lease = crypto.randomUUID();
    const job = await store.claim(item.id, lease, now, now + 5 * minute);
    if (!job) continue;

    let retryable = true;
    let delivered = false;
    try {
      const payload = presaleEmail(item, env.BACKSTAGE_PUBLIC_URL, env.BACKSTAGE_FROM_EMAIL);
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
      delivered = response.ok;
      retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    } catch {
      // A timeout can occur after the provider accepts a request. Reuse the same key.
    }
    if (delivered) {
      await store.complete(item.id, lease, now);
      counts.sent++;
      continue;
    }

    const retry = retryable && job.attempts < 8;
    const nextAt = now + Math.min(60, 4 ** (job.attempts - 1)) * minute;
    await store.retry(item.id, lease, retry ? "pending" : "failed", nextAt);
    counts[retry ? "retrying" : "failed"]++;
  }

  return counts;
}
