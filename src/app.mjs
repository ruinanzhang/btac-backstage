import { alertAvailability, authorizeDispatch, dispatchDue } from "./alerts.mjs";
import { alertChannel, Invalid, slugify, validateFanSignup, validatePresale, value } from "./model.mjs";
import { createStore } from "./store.mjs";
import {
  createBandPage, dashboard, detail, editor, emailTicketPage, errorPage, fanPage, fanPath,
  managePath, signInPage,
} from "./view.mjs";

const safeRef = /^[a-z0-9-]{1,56}$/;
const tokenPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const notFound = () => errorPage(404, "Page not found", "Check the link and try again.");
const redirect = (location) => new Response(null, {
  status: 303, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
});
const json = (body, status = 200) => Response.json(body, {status, headers: {"Cache-Control": "no-store"}});
const notices = {
  published: "Your signup page is published. Share its link with fans.",
  saved: "Presale updated.",
  partner: "Partner link added.",
};
const futureOpening = "Set “Presale opens” to a future time in the selected time zone.";

async function readForm(request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return null;
  }
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return null;
  const body = request.body?.getReader();
  if (!body) return null;
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { value, done } = await body.read();
    if (done) break;
    size += value.byteLength;
    if (size > 12_000) {
      await body.cancel();
      return null;
    }
    text += decoder.decode(value, {stream:true});
  }
  return new URLSearchParams(text + decoder.decode());
}

function inputNotice(error) {
  if (error instanceof Invalid) return error.message;
  throw error;
}

async function addWithSlug(base, insert) {
  const id = crypto.randomUUID();
  const slug = slugify(base) || "presale";
  if (await insert(id, slug)) return slug;
  const fallback = `${slug}-${id.slice(0, 8)}`;
  if (await insert(id, fallback)) return fallback;
  throw new Invalid("Choose a different name and try again.");
}

function checkedRef(url) {
  const ref = url.searchParams.get("via") ?? "";
  return safeRef.test(ref) ? ref : "";
}

async function fanRoute(ctx, [band, slug, action, ...rest]) {
  const { store, now, url, post, form } = ctx;
  if (!band || !slug || rest.length || (action && action !== "tickets")) return notFound();
  const sale = await store.publicPresale(band, slug);
  if (!sale) return notFound();

  const ref = checkedRef(url);
  const partner = ref ? await store.partner(sale.id, ref) : null;
  const partnerCode = partner?.code ?? "";
  const options = {now, ref:partnerCode, availability:alertAvailability(ctx.env)};
  if (!post && !action) return fanPage(sale, {...options, joined:url.searchParams.get("joined") === "1",
    channel:alertChannel(url.searchParams.get("channel"))});
  if (!post) return notFound();

  if (action === "tickets") {
    if (now < sale.opens_at || now >= sale.event_at) return redirect(fanPath(band, slug));
    await store.recordClick(sale.id, partner?.id ?? null, now);
    return redirect(sale.ticket_url);
  }

  if (now >= sale.opens_at) return redirect(fanPath(band, slug));
  const channel = alertChannel(form.get("channel"));
  const after = new URLSearchParams({joined:"1", channel});
  if (partnerCode) after.set("via", partnerCode);
  try {
    if (!form.get("website")) {
      await store.signup(sale.id, partner?.id ?? null, validateFanSignup(form, channel), now);
    }
    return redirect(`${fanPath(band, slug)}?${after}`);
  } catch (error) {
    return fanPage(sale, {...options, channel, values:Object.fromEntries(form), error:inputNotice(error)});
  }
}

async function ticketRoute(ctx, [token, ...rest]) {
  const { store, now, post } = ctx;
  if (!tokenPattern.test(token ?? "") || rest.length) return notFound();
  const sale = await store.ticketForSignup(token);
  if (!sale || now < sale.opens_at || now >= sale.event_at) return notFound();
  if (!post) return emailTicketPage({token});
  await store.recordClick(sale.id, sale.partner_id, now);
  return redirect(sale.ticket_url);
}

async function bandRoute(ctx, [bandSlug, section, presaleSlug, action, ...rest]) {
  const { store, now, post, form, url, user } = ctx;
  if (rest.length) return notFound();
  if (bandSlug === "new" && !section) {
    if (!post) return createBandPage(ctx);
    try {
      const name = value(form, "name", 70, {label:"a band name"});
      const accent = value(form, "accent", 7, {label:"a brand color"});
      if (!/^#[a-f0-9]{6}$/i.test(accent)) throw new Invalid("Choose a valid brand color.");
      const slug = await addWithSlug(slugify(name) === "new" ? "new-band" : name, (id, slug) =>
        store.createBand(id, user.userId, slug, name, accent, now));
      return redirect(`/bands/${slug}`);
    } catch (error) {
      return createBandPage(ctx, {error:inputNotice(error), values:Object.fromEntries(form)});
    }
  }

  const band = await store.band(user.userId, bandSlug);
  if (!band) return notFound();
  const scoped = {...ctx, band};
  if (!section && !post) return dashboard(scoped, await store.presales(band.id), now);

  if (section === "new" && !presaleSlug) {
    if (!post) return editor(scoped, null, {});
    try {
      const data = validatePresale(form);
      const slug = await addWithSlug(data.title, (id, slug) => store.createPresale(id, band.id, slug, data, now));
      return redirect(managePath(band, {slug}));
    } catch (error) {
      return editor(scoped, null, {error:inputNotice(error), values:Object.fromEntries(form)});
    }
  }

  if (section !== "presales" || !presaleSlug) return notFound();
  const sale = await store.presale(band.id, presaleSlug);
  if (!sale) return notFound();
  const path = managePath(band, sale);
  const renderDetails = async (error) => detail(scoped, sale, await store.stats(sale.id), {
    now, origin:url.origin, availability:alertAvailability(ctx.env), error,
    notice: Object.hasOwn(notices, url.searchParams.get("notice")) ? notices[url.searchParams.get("notice")] : "",
  });

  if (!post) {
    if (!action) return renderDetails();
    if (action === "edit" && (!sale.published_at || sale.opens_at > now)) return editor(scoped, sale, {});
    if (action === "preview") {
      return fanPage({...sale, band_name:band.name, band_slug:band.slug, accent:band.accent}, {now, preview:true});
    }
    return notFound();
  }

  if (action === "edit") {
    if (sale.published_at && sale.opens_at <= now) return renderDetails("This presale has already opened and can no longer be edited.");
    try {
      const data = validatePresale(form);
      if (sale.published_at && data.opensAt <= now) throw new Invalid(futureOpening);
      if (!await store.editPresale(sale.id, data, now)) throw new Invalid("The presale status changed. Reload the page before editing.");
      return redirect(path + "?notice=saved");
    } catch (error) {
      return editor(scoped, sale, {error:inputNotice(error), values:Object.fromEntries(form)});
    }
  }

  if (action === "publish") {
    if (sale.published_at) return redirect(path);
    if (!await store.publish(sale.id, now)) return renderDetails(futureOpening);
    return redirect(path + "?notice=published");
  }

  if (action === "partners") {
    try {
      const name = value(form, "name", 70, {label:"a partner name"});
      const code = slugify(name) || crypto.randomUUID().slice(0, 8);
      if (code === "direct") throw new Invalid("Choose a name other than Direct.");
      if (!await store.addPartner(crypto.randomUUID(), sale.id, code, name, now)) {
        throw new Invalid("A partner already uses that link name.");
      }
      return redirect(path + "?notice=partner");
    } catch (error) {
      return renderDetails(inputNotice(error));
    }
  }

  return notFound();
}

/**
 * @param {Request} request
 * @param {{env: Cloudflare.Env, user?: {userId: string, displayName?: string, email?: string} | null, signIn?: string, signOut?: string, now?: number}} options
 */
export async function handleRequest(request, {env, user = null, signIn = "/signin-with-chatgpt", signOut = "/signout-with-chatgpt", now = Date.now()}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const [area, ...segments] = path.slice(1).split("/");
  const post = request.method === "POST";
  if (request.method !== "GET" && !post) return new Response(null, {status:405, headers:{Allow:"GET, POST"}});

  if (!env.DB) return errorPage(503, "Backstage is unavailable", "Try again in a moment.");
  const store = createStore(env.DB);
  if (path === "/api/dispatch" && post) {
    if (!await authorizeDispatch(request, env.BACKSTAGE_DISPATCH_SECRET)) return json({error:"Unauthorized"}, 401);
    const counts = await dispatchDue(store, env, {now});
    return counts ? json(counts) : json({error:"Alert delivery is off"}, 503);
  }

  if ((!area || area === "bands") && !user) {
    return post ? json({error:"Sign in required"}, 401) : signInPage(signIn);
  }

  let form;
  if (post) {
    form = await readForm(request);
    if (!form) return errorPage(400, "Form could not be submitted", "Reload the page and try again.");
  }
  const ctx = {store, now, env, url, post, form, user, signOut};

  if (area === "p") return fanRoute(ctx, segments);
  if (area === "t") return ticketRoute(ctx, segments);

  if (!area && !post) {
    const bands = await store.bands(user.userId);
    return redirect(bands.length ? `/bands/${bands[0].slug}` : "/bands/new");
  }
  if (area === "bands" && segments.length) {
    const bands = await store.bands(user.userId);
    return bandRoute({...ctx, bands}, segments);
  }
  return notFound();
}
