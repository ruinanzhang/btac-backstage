export class Invalid extends Error {}

export const slugify = (value) =>
  value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/, "");

export function value(form, field, maximum, { required = true, label = field } = {}) {
  const raw = form.get(field);
  const text = typeof raw === "string" ? raw.trim() : "";
  if (required && !text) throw new Invalid(`Enter ${label}.`);
  if (text.length > maximum) throw new Invalid(`Keep ${label} to ${maximum} characters or fewer.`);
  return text;
}

function formatter(zone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", hourCycle: "h23",
  });
}

function parts(format, time) {
  return Object.fromEntries(format.formatToParts(time).map(({ type, value }) => [type, value]));
}

export function localInput(time, zone) {
  if (!time) return "";
  const {year, month, day, hour, minute} = parts(formatter(zone), time);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function timeInZone(input, zone) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(input)) throw new Invalid("Enter a date and time.");
  const wallTime = Date.parse(input + ":00Z");
  if (!Number.isFinite(wallTime) || new Date(wallTime).toISOString().slice(0, 16) !== input) {
    throw new Invalid("Enter a valid date and time.");
  }

  const format = formatter(zone);
  const matches = new Set();
  for (const probe of [wallTime - 86400000, wallTime, wallTime + 86400000]) {
    const {year, month, day, hour, minute} = parts(format, probe);
    const offset = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00Z`) - probe;
    const candidate = wallTime - offset;
    if (localInput(candidate, zone) === input) matches.add(candidate);
  }
  if (matches.size !== 1) {
    throw new Invalid("Choose a different time. That time is skipped or repeated when the clocks change.");
  }
  return matches.values().next().value;
}

export function validatePresale(form, now) {
  const title = value(form, "title", 100, {label: "an event name"});
  const venue = value(form, "venue", 120, {required: false, label: "the venue"});
  const description = value(form, "description", 650, {required: false, label: "the description"});
  let timezone;
  try {
    const zone = value(form, "timezone", 60, {label: "a time zone"});
    timezone = formatter(zone).resolvedOptions().timeZone;
  } catch {
    throw new Invalid("Choose an IANA time zone such as America/New_York.");
  }
  const eventAt = timeInZone(value(form, "event", 16, {label: "an event date and time"}), timezone);
  const opensAt = timeInZone(value(form, "opens", 16, {label: "a presale opening time"}), timezone);
  if (opensAt <= now) throw new Invalid("Set the presale opening time in the future.");
  if (opensAt >= eventAt) throw new Invalid("The presale must open before the event.");
  let ticket;
  try {
    ticket = new URL(value(form, "ticket", 2048, {label: "the ticket URL"}));
  } catch {
    throw new Invalid("Enter a valid ticket URL beginning with https://.");
  }
  if (ticket.protocol !== "https:" || ticket.username || ticket.password) {
    throw new Invalid("Enter a valid ticket URL beginning with https://.");
  }
  return {title, venue, description, timezone, eventAt, opensAt, ticketUrl: ticket.href};
}

export function validateEmail(form) {
  const email = value(form, "email", 254, {label: "your email address"}).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Invalid("Enter a valid email address.");
  return email;
}

export function dateLabel(time, zone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(time);
}

export function presaleStatus(presale, now) {
  if (!presale.published_at) return ["Draft", "draft"];
  if (presale.opens_at > now) return ["Scheduled", "scheduled"];
  if (presale.event_at > now) return ["Presale open", "open"];
  return ["Ended", "ended"];
}
