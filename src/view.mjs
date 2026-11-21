import { dateLabel, localInput, presaleStatus } from "./model.mjs";

export function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const h = escapeHtml;
const ink = "#5147bd";
const number = (value) => Number(value ?? 0).toLocaleString("en-US");
const mark = '<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>';
const brand = `<a class="brand" href="/">${mark}<span>BTAC Backstage</span></a>`;
const bandPath = (band) => `/bands/${band.slug}`;
export const managePath = (band, presale) => `${bandPath(band)}/presales/${presale.slug}`;
export const fanPath = (bandSlug, presaleSlug) => `/p/${bandSlug}/${presaleSlug}`;

function html(title, content, status = 200) {
  return new Response(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${h(title)} · BTAC Backstage</title>
    <link rel="stylesheet" href="/backstage.css"><script defer src="/backstage.js"></script>
    </head><body>${content}</body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function message(text, error = false) {
  if (!text) return "";
  return `<p class="notice ${error ? "error" : ""}" role="${error ? "alert" : "status"}">${h(text)}</p>`;
}

function pill(presale, now) {
  const [label, kind] = presaleStatus(presale, now);
  return `<span class="pill ${kind}">${label}</span>`;
}

export function signInPage(signIn) {
  return html("Presales for bands", `<div class="welcome">
    <header class="welcome-header">${brand}</header>
    <main class="welcome-main">
      <h1>Presales for bands.</h1>
      <p>Publish a signup page, email fans when tickets open, and see which partners drove interest.</p>
      <a class="button primary" href="${h(signIn)}" target="_top">Sign in with ChatGPT</a>
    </main>
  </div>`);
}

export function errorPage(status, title, description) {
  return html(title, `<div class="welcome"><header class="welcome-header">${brand}</header>
    <main class="welcome-main"><h1>${h(title)}</h1><p>${h(description)}</p>
    <a class="button" href="/">Back to Backstage</a></main></div>`, status);
}

function workspace({ title, bands, band, user, signOut, crumb, content, status = 200 }) {
  const links = bands.map((item) => `<a href="${bandPath(item)}" class="workspace-link"
    ${band?.id === item.id ? 'aria-current="page"' : ""}><span class="band-icon" style="--accent:${h(item.accent)}">${h(item.name[0].toUpperCase())}</span>
    <span>${h(item.name)}</span></a>`).join("");
  return html(title, `<div class="shell">
    <aside class="sidebar" aria-label="Band workspaces">
      ${brand}
      <div class="workspace-list"><p class="section-label">Workspaces</p>${links}
        <a class="workspace-link add-workspace" href="/bands/new"><span aria-hidden="true">+</span> New band</a>
      </div>
      <a class="account" href="${h(signOut)}" target="_top">
        <span class="account-icon" aria-hidden="true">${h((user.displayName || user.email || "U")[0].toUpperCase())}</span>
        <span><strong>${h(user.displayName || user.email)}</strong><small>Sign out</small></span>
      </a>
    </aside>
    <div class="work-area">
      <header class="topbar">${band ? `<a href="${bandPath(band)}">${h(band.name)}</a><span aria-hidden="true">/</span>` : ""}
        <span>${h(crumb || title)}</span></header>
      <main class="page">${content}</main>
    </div>
  </div>`, status);
}

export function createBandPage(ctx, {error, values = {}} = {}) {
  const first = !ctx.bands.length;
  return workspace({...ctx, title: "New band", status: error ? 422 : 200, content: `
    <div class="page-heading"><div><h1>${first ? "Create your band workspace" : "New band"}</h1>
      <p>Give your band its own presales and fan signups.</p></div></div>
    ${message(error, true)}
    <form class="panel editor" action="/bands/new" method="post">
      <label>Band name<input name="name" maxlength="70" required placeholder="e.g. BTAC" value="${h(values.name)}" autofocus></label>
      <label class="color-field">Brand color<input aria-label="Brand color" type="color" name="accent" value="${h(values.accent || ink)}"></label>
      <div class="form-actions"><button class="button primary" type="submit">Create workspace</button></div>
    </form>`});
}

export function dashboard(ctx, presales, now) {
  const { band } = ctx;
  const rows = presales.map((sale) => `<li>
    <a class="presale-row" href="${managePath(band, sale)}">
      <span class="event-icon" style="--accent:${h(band.accent)}" aria-hidden="true">${h(new Intl.DateTimeFormat("en-US", {timeZone:sale.timezone, day:"numeric"}).format(sale.event_at))}</span>
      <span class="row-title"><strong>${h(sale.title)}</strong><small>${h(dateLabel(sale.event_at, sale.timezone))}</small></span>
      <span class="row-data"><strong>${number(sale.signups)}</strong><small>Signups</small></span>
      <span class="row-data"><strong>${number(sale.clicks)}</strong><small>Ticket clicks</small></span>
      ${pill(sale, now)}
    </a></li>`).join("");
  return workspace({...ctx, title: "Presales", content: `
    <div class="page-heading"><div><h1>Presales</h1><p>Manage your upcoming ticket releases.</p></div>
      <a class="button primary" href="${bandPath(band)}/new">New presale</a></div>
    ${rows ? `<ul class="panel presale-list" aria-label="Your presales">${rows}</ul>` : `
      <section class="panel empty"><span class="empty-icon" aria-hidden="true">${mark}</span>
        <h2>No presales yet</h2><p>Create an event to start collecting fan signups.</p>
      </section>`}`});
}

const timezones = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "Europe/London",
  "Europe/Paris", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney", "UTC"];
export function editor(ctx, presale, {error, values}) {
  const {band} = ctx;
  const title = presale ? "Edit presale" : "New presale";
  const path = presale ? managePath(band, presale) : bandPath(band);
  const zone = values?.timezone ?? presale?.timezone ?? "America/New_York";
  const defaults = {
    title: presale?.title, venue: presale?.venue, description: presale?.description, ticket: presale?.ticket_url,
    event: presale ? localInput(presale.event_at, presale.timezone) : "",
    opens: presale ? localInput(presale.opens_at, presale.timezone) : "",
  };
  const v = (key) => h(values?.[key] ?? defaults[key]);
  return workspace({...ctx, title, status: error ? 422 : 200, content: `
    <div class="page-heading"><div><h1>${title}</h1><p>Set the event details and when fans can get tickets.</p></div></div>
    ${message(error, true)}
    <form class="panel editor" action="${path}/${presale ? "edit" : "new"}" method="post">
      <label>Event name<input name="title" maxlength="100" required placeholder="e.g. Live in Brooklyn" value="${v("title")}" autofocus></label>
      <label>Venue <span class="optional">Optional</span><input name="venue" maxlength="120" value="${v("venue")}" placeholder="e.g. Music Hall of Williamsburg"></label>
      <label>Description <span class="optional">Optional</span><textarea name="description" rows="3" maxlength="650" placeholder="Add a short note for fans.">${v("description")}</textarea></label>
      <div class="field-grid">
        <label>Event date and time<input name="event" type="datetime-local" required value="${v("event")}"></label>
        <label>Presale opens<input name="opens" type="datetime-local" required value="${v("opens")}"></label>
      </div>
      <label>Time zone<input name="timezone" list="timezones" maxlength="60" required value="${h(zone)}" ${presale || values ? "" : "data-auto-zone"}></label>
      <datalist id="timezones">${timezones.map((z) => `<option value="${z}"></option>`).join("")}</datalist>
      <label>Ticket URL<input name="ticket" type="url" maxlength="2048" required placeholder="https://" value="${v("ticket")}"></label>
      <div class="form-actions"><a class="button" href="${path}">Cancel</a>
        <button class="button primary" type="submit">${presale ? "Save changes" : "Create draft"}</button></div>
    </form>`});
}

export function detail(ctx, sale, stats, {now, origin, emailReady, notice, error}) {
  const { band } = ctx;
  const path = managePath(band, sale);
  const page = fanPath(band.slug, sale.slug);
  const url = new URL(page, origin).href;
  const published = !!sale.published_at;
  const editable = !published || sale.opens_at > now;
  const action = published
    ? `<a class="button primary" href="${page}" target="_blank" rel="noopener">View fan page</a>`
    : `<a class="button" href="${path}/preview" target="_blank" rel="noopener">Preview fan page</a>
      <form method="post" action="${path}/publish"><button class="button primary" type="submit">Publish</button></form>`;
  const source = (name, signups, clicks, code) => {
    const link = code ? `${url}?via=${encodeURIComponent(code)}` : url;
    return `<tr><th scope="row">${h(name)}</th><td>${number(signups)}</td><td>${number(clicks)}</td>
      <td>${published ? `<button type="button" class="button compact" data-copy="${h(link)}">Copy link</button>`
        : '<span class="muted">Available after publishing</span>'}</td></tr>`;
  };
  return workspace({...ctx, title: sale.title, crumb: "Presales", status: error ? 422 : 200, content: `
    <div class="page-heading detail-heading"><div><div class="title-line"><h1>${h(sale.title)}</h1>${pill(sale, now)}</div>
      <p>${h(dateLabel(sale.event_at, sale.timezone))}${sale.venue ? ` <span class="dot-separator">·</span> ${h(sale.venue)}` : ""}</p></div>
      <div class="header-actions">${editable ? `<a class="button" href="${path}/edit">Edit</a>` : ""}${action}</div></div>
    ${message(error || notice, Boolean(error))}
    <div class="stats" aria-label="Presale totals">
      <div class="panel stat"><span>Signups</span><strong>${number(stats.signups)}</strong></div>
      <div class="panel stat"><span>Ticket-link clicks</span><strong>${number(stats.clicks)}</strong></div>
      <div class="panel stat"><span>Updates opt-ins</span><strong>${number(stats.updates)}</strong></div>
    </div>
    <section class="panel block launch"><div><h2>Presale email</h2><p>${h(dateLabel(sale.opens_at, sale.timezone))}</p></div>
      <div class="launch-status">${emailReady ? `<strong>${number(stats.sent)} sent</strong>${stats.failed ? `<span>${number(stats.failed)} failed</span>` : ""}`
        : "<strong>Email delivery is off</strong><span>Signups are still recorded.</span>"}</div>
    </section>
    <section class="panel block source-panel">
      <div class="source-heading"><div><h2>Traffic sources</h2><p>Use a separate link for each promo partner.</p></div>
        <form action="${path}/partners" method="post" class="inline-form">
          <label class="sr-only" for="source-name">Partner name</label><input id="source-name" name="name" maxlength="70" required placeholder="Partner name">
          <button class="button" type="submit">Add partner</button>
        </form></div>
      <div class="table-scroll"><table><thead><tr><th scope="col">Source</th><th scope="col">Signups</th><th scope="col">Ticket clicks</th><th scope="col">Share link</th></tr></thead>
      <tbody>${source("Direct", stats.direct_signups, stats.direct_clicks, "")}${stats.partners.map((p) => source(p.name, p.signups, p.clicks, p.code)).join("")}</tbody></table></div>
    </section>
    <p class="sr-only" role="status" data-copy-status></p>`});
}

export function fanPage(sale, {now, ref = "", preview = false, joined = false, error = "", deliveryEnabled = false}) {
  const page = fanPath(sale.band_slug, sale.slug);
  const via = ref ? `?via=${encodeURIComponent(ref)}` : "";
  const opening = sale.opens_at > now;
  const ended = sale.event_at <= now;
  const closed = ended && !preview;
  const countdown = opening ? `<div class="countdown" role="timer" aria-label="Time until the presale opens" data-countdown="${sale.opens_at}" data-now="${now}">
    ${["Days", "Hours", "Mins", "Secs"].map((unit, index) => `<div><strong data-segment="${index}">–</strong><span>${unit}</span></div>`).join("")}
    </div>` : "";
  const signup = `<form class="fan-form" method="post" action="${page}${via}">
    <label>Email address<input name="email" type="email" maxlength="254" required placeholder="you@example.com" autocomplete="email" ${preview ? "disabled" : ""}></label>
    <input class="trap" tabindex="-1" name="website" autocomplete="off" aria-hidden="true">
    <label class="check-label"><input type="checkbox" name="updates" ${preview ? "disabled" : ""}> I'd also like future updates from ${h(sale.band_name)}.</label>
    <button class="button primary" type="submit" ${preview ? "disabled" : ""}>Get first access</button>
    <p class="supporting">${preview || deliveryEnabled ? "We’ll email you the ticket link when the presale opens."
      : "Email alerts are unavailable. Return here when the presale opens."}</p>
  </form>`;
  const ready = `<form method="post" action="${page}/tickets${via}"><button class="button primary full" ${preview ? "disabled" : ""}>Get tickets</button></form>`;
  return html(sale.title, `<main class="fan-wrap" style="--accent:${h(sale.accent)}">
    ${preview ? '<p class="preview-bar">Fan page preview</p>' : ""}
    <div class="fan-card">
      <header class="fan-cover"><p class="fan-band"><span aria-hidden="true"></span>${h(sale.band_name)}</p>
        <h1>${h(sale.title)}</h1>
        <p class="event-date">${h(dateLabel(sale.event_at, sale.timezone))}${sale.venue ? `<span>${h(sale.venue)}</span>` : ""}</p>
      </header>
      <section class="fan-body">
        ${sale.description ? `<p class="event-description">${h(sale.description)}</p>` : ""}
        ${closed ? '<h2>This event has ended</h2>'
          : opening ? `<h2>Presale opens in</h2>${countdown}<p class="open-date">${h(dateLabel(sale.opens_at, sale.timezone))}</p>`
          : '<h2>Presale is open</h2>'}
        ${message(error, true)}
        ${closed ? "" : !opening ? ready : joined ? `<p class="joined" role="status"><strong>You’re on the list.</strong><br>
          ${deliveryEnabled ? "Look for the ticket link in your inbox when the presale opens." : "Return here when the presale opens to get tickets."}</p>` : signup}
      </section>
    </div>
    <footer>Powered by <a href="/">BTAC Backstage</a></footer>
  </main>`, error ? 422 : 200);
}

export function emailTicketPage(sale) {
  const action = `/t/${encodeURIComponent(sale.token)}`;
  return html("Get tickets", `<main class="fan-wrap"><div class="fan-card ticket-card">
    <div class="fan-body"><h1>Presale is open</h1><p>Continue to the ticket seller to get your tickets.</p>
      <form method="post" action="${action}"><button class="button primary full">Get tickets</button></form></div>
    </div><footer>Powered by BTAC Backstage</footer></main>`);
}
