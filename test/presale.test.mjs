import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleRequest } from "../src/app.mjs";
import { dispatchDue } from "../src/alerts.mjs";
import { createStore } from "../src/store.mjs";

const origin = "https://backstage.example";
const initial = Date.parse("2026-12-01T12:00Z");
const opening = Date.parse("2026-12-05T15:00Z");
const owner = {userId:"btac-admin", displayName:"BTAC"};
const secondOwner = {userId:"another-band", displayName:"Another Band"};
const dest = "https://tickets.example/presale";
const details = {title:"Live in Brooklyn", venue:"Brooklyn, NY", timezone:"America/New_York",
  event:"2026-12-12T20:00", opens:"2026-12-05T10:00", ticket:dest};
const textSender = {BACKSTAGE_PUBLIC_URL:origin, TWILIO_ACCOUNT_SID:"AC" + "a".repeat(32),
  TWILIO_API_KEY_SID:"SK" + "b".repeat(32), TWILIO_API_KEY_SECRET:"test-secret",
  TWILIO_MESSAGING_SERVICE_SID:"MG" + "c".repeat(32)};
const acceptedText = () => Response.json({sid:"SM" + "d".repeat(32), status:"accepted"}, {status:201});

function fixture() {
  const sql = new DatabaseSync(":memory:");
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sql.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const db = {
    prepare(statement) {
      return {
        bind(...values) {
          const prepared = sql.prepare(statement);
          return {
            first: async () => prepared.get(...values) ?? null,
            all: async () => ({results:prepared.all(...values)}),
            run: async () => prepared.run(...values),
          };
        },
      };
    },
    batch: async (statements) => {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const env = {DB:db};
  return {
    sql,
    env,
    store:createStore(db),
    request(path, {user, form, now = initial, headers = {}, method = form ? "POST" : "GET"} = {}) {
      const body = form ? new URLSearchParams(form) : undefined;
      const req = new Request(new URL(path, origin), {method, headers, body});
      return handleRequest(req, {env, user, now});
    },
  };
}

async function setup(f, values = details) {
  const band = await f.request("/bands/new", {user:owner, form:{name:"BTAC", accent:"#5147bd"}});
  assert.equal(band.status, 303);
  assert.equal(band.headers.get("location"), "/bands/btac");
  const draft = await f.request("/bands/btac/new", {user:owner, form:values});
  assert.equal(draft.status, 303);
  return {
    admin:draft.headers.get("location"),
    fan:"/p/btac/live-in-brooklyn",
    id:f.sql.prepare("SELECT id FROM presales").get().id,
  };
}

test("an elapsed opening time can be saved as a draft, with a future opening required to publish", async () => {
  const f = fixture();
  const elapsed = {...details, opens:"2026-11-27T10:00"};
  const {admin, fan, id} = await setup(f, elapsed);

  const draftPage = await (await f.request(admin, {user:owner})).text();
  assert.match(draftPage, /Draft saved/);
  assert.match(draftPage, /<button[^>]* disabled>Publish<\/button>/);
  assert.equal((await f.request(admin+"/publish", {user:owner, form:{}})).status, 422);
  assert.equal((await f.request(fan)).status, 404);

  assert.equal((await f.request(admin+"/edit", {user:owner, form:details})).status, 303);
  assert.equal((await f.request(admin+"/publish", {user:owner, form:{}})).status, 303);
  assert.equal((await f.request(admin+"/edit", {user:owner, form:elapsed})).status, 422);
  assert.equal(f.sql.prepare("SELECT opens_at FROM presales WHERE id = ?").get(id).opens_at, opening);
  f.sql.close();
});

test("a band can publish its own branded page, while the draft and dashboard stay protected", async () => {
  const f = fixture();
  const {admin, fan} = await setup(f);
  assert.equal((await f.request(fan)).status, 404);
  assert.equal((await f.request(admin, {user:secondOwner})).status, 404);
  assert.equal((await f.request(admin+"/publish", {form:{}})).status, 401);
  assert.equal((await f.request(admin+"/publish", {user:owner, form:{}, headers:{origin:"https://other.example"}})).status, 400);

  const preview = await f.request(admin+"/preview", {user:owner});
  assert.match(await preview.text(), /Fan page preview/);
  assert.equal((await f.request(admin+"/publish", {user:owner, form:{}})).status, 303);
  const publicPage = await (await f.request(fan)).text();
  assert.match(publicPage, /Live in Brooklyn/);
  assert.match(publicPage, /Get first access/);
  assert.match(publicPage, new RegExp(`data-countdown="${opening}"`));
  assert.match(publicPage, /name="channel" value="both"/);
  assert.doesNotMatch(publicPage, /name="updates"[^>]+checked/);

  const newBand = await f.request("/bands/new", {user:secondOwner, form:{name:"Other Band", accent:"#315f72"}});
  const otherPath = newBand.headers.get("location");
  const otherDashboard = await (await f.request(otherPath, {user:secondOwner})).text();
  assert.match(otherDashboard, /No presales yet/);
  assert.doesNotMatch(otherDashboard, /Live in Brooklyn/);
  assert.equal((await f.request(otherPath, {user:owner})).status, 404);
  f.sql.close();
});

test("signups use the first source and record future updates only when explicitly checked", async () => {
  const f = fixture();
  const {admin, fan, id} = await setup(f);
  await f.request(admin+"/publish", {user:owner, form:{}});
  await f.request(admin+"/partners", {user:owner, form:{name:"Studio Radio"}});
  assert.equal((await f.request(fan, {form:{email:"wrong address"}})).status, 422);
  const result = await f.request(fan+"?via=studio-radio", {form:{email:"First@Example.com"}});
  assert.equal(result.status, 303);
  assert.match(await (await f.request(result.headers.get("location"))).text(), /You’re on the list/);
  await f.request(fan, {form:{email:"first@example.com", updates:"on"}});
  await f.request(fan+"?via=unknown", {form:{email:"second@example.com", updates:"on"}});
  const [first, second] = f.sql.prepare("SELECT * FROM signups ORDER BY email").all();
  assert.ok(first.partner_id);
  assert.equal(first.updates_opt_in_at, null);
  assert.equal(second.partner_id, null);
  assert.equal(second.updates_opt_in_at, initial);
  const stats = await f.store.stats(id);
  assert.equal(stats.signups, 2);
  assert.equal(stats.updates, 1);
  assert.equal(stats.direct_signups, 1);
  assert.equal(stats.partners[0].signups, 1);
  assert.equal((await f.request(fan, {form:{email:"late@example.com"}, now:opening})).status, 303);
  assert.equal((await f.store.stats(id)).signups, 2);
  f.sql.close();
});

test("email waits for opening, retries safely, and attributes the final ticket click", async () => {
  const f = fixture();
  const {admin, fan, id} = await setup(f);
  await f.request(admin+"/publish", {user:owner, form:{}});
  await f.request(admin+"/partners", {user:owner, form:{name:"Studio Radio"}});
  await f.request(fan+"?via=studio-radio", {form:{email:"fan@example.com"}});
  const {ticket_token:token} = f.sql.prepare("SELECT ticket_token FROM signups").get();

  const env = {...f.env, RESEND_API_KEY:"test-key", BACKSTAGE_FROM_EMAIL:"presale@example.com", BACKSTAGE_PUBLIC_URL:origin};
  const attempts = [];
  const send = async (url, options) => {
    const body = JSON.parse(options.body);
    attempts.push({url, key:options.headers["Idempotency-Key"], body});
    return new Response(null, {status:attempts.length === 1 ? 503 : 200});
  };
  assert.equal((await f.request("/api/dispatch", {method:"POST"})).status, 401);
  assert.equal((await f.request(`/t/${token}`)).status, 404);
  assert.equal((await dispatchDue(f.store, env, {now:opening-1, send})).checked, 0);
  assert.equal((await dispatchDue(f.store, env, {now:opening, send})).retrying, 1);

  const sendTime = opening + 60_000;
  const results = await Promise.all([
    dispatchDue(f.store, env, {now:sendTime, send}),
    dispatchDue(f.store, env, {now:sendTime, send}),
  ]);
  assert.equal(results.reduce((total, item) => total + item.sent, 0), 1);
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.deepEqual(attempts[1].body.to, ["fan@example.com"]);
  assert.ok(attempts[1].body.text.includes(`${origin}/t/${token}`));
  assert.equal((await dispatchDue(f.store, env, {now:sendTime+60_000, send})).checked, 0);

  assert.equal((await f.request(`/t/${token}`, {now:sendTime})).status, 200);
  assert.equal((await f.store.stats(id)).clicks, 0);
  const click = await f.request(`/t/${token}`, {now:sendTime, form:{}});
  assert.equal(click.status, 303);
  assert.equal(click.headers.get("location"), dest);
  await f.request(fan+"/tickets", {now:sendTime, form:{}});
  const stats = await f.store.stats(id);
  assert.equal(stats.delivery.email.sent, 1);
  assert.equal(stats.clicks, 2);
  assert.equal(stats.partners[0].clicks, 1);
  assert.equal(stats.direct_clicks, 1);
  f.sql.close();
});

test("text requires consent, and choosing both counts as one signup at the original source", async () => {
  const f = fixture();
  const {admin, fan, id} = await setup(f);
  await f.request(admin+"/publish", {user:owner, form:{}});
  await f.request(admin+"/partners", {user:owner, form:{name:"Studio Radio"}});
  const via = fan+"?via=studio-radio";
  const phone = "+1 (212) 555-0100";
  const refused = await f.request(via, {form:{channel:"both", email:"fan@example.com", phone}});
  assert.equal(refused.status, 422);
  assert.match(await refused.text(), /Confirm that you want the presale text/);
  assert.equal((await f.store.stats(id)).signups, 0);

  const textForm = {channel:"text", phone, text_consent:"on"};
  assert.equal((await f.request(via, {form:textForm})).status, 303);
  await f.request(fan, {form:{...textForm, phone:"+12125550100"}});
  const [row] = f.sql.prepare("SELECT phone, consented_at, updates_opt_in_at FROM text_signups").all();
  assert.equal(row.phone, "+12125550100");
  assert.equal(row.consented_at, initial);
  assert.equal(row.updates_opt_in_at, null);
  assert.equal((await f.store.stats(id)).delivery.email.recipients, 0);

  const both = {channel:"both", email:"fan@example.com", phone, text_consent:"on", updates:"on"};
  await f.request(fan, {form:both});
  await f.request(fan, {form:both});
  const stats = await f.store.stats(id);
  assert.equal(stats.signups, 1);
  assert.equal(stats.updates, 1);
  assert.equal(stats.partners[0].signups, 1);
  assert.equal(stats.direct_signups, 0);
  assert.equal(stats.delivery.email.recipients, 1);
  assert.equal(stats.delivery.text.recipients, 1);
  f.sql.close();
});

test("both channels send at opening with tracked links and recover from a text rate limit", async () => {
  const f = fixture();
  const {admin, fan, id} = await setup(f);
  await f.request(admin+"/publish", {user:owner, form:{}});
  await f.request(admin+"/partners", {user:owner, form:{name:"Studio Radio"}});
  await f.request(fan+"?via=studio-radio", {
    form:{channel:"both", email:"fan@example.com", phone:"+12125550100", text_consent:"on", text_updates:"on"},
  });
  const env = {...f.env, ...textSender, RESEND_API_KEY:"test-key", BACKSTAGE_FROM_EMAIL:"presale@example.com"};
  const texts = [];
  const emails = [];
  const send = async (url, options) => {
    if (url.startsWith("https://api.resend.com/")) {
      emails.push(JSON.parse(options.body));
      return new Response(null, {status:200});
    }
    assert.equal(url, `https://api.twilio.com/2010-04-01/Accounts/${textSender.TWILIO_ACCOUNT_SID}/Messages.json`);
    texts.push(options.body);
    return texts.length === 1 ? new Response(null, {status:429}) : acceptedText();
  };
  assert.equal((await dispatchDue(f.store, env, {now:opening-1, send})).checked, 0);
  assert.equal(emails.length + texts.length, 0);
  const first = await dispatchDue(f.store, env, {now:opening, send});
  assert.equal(first.sent, 1);
  assert.equal(first.retrying, 1);
  const retryTime = opening + 60_000;
  const results = await Promise.all([
    dispatchDue(f.store, env, {now:retryTime, send}),
    dispatchDue(f.store, env, {now:retryTime, send}),
  ]);
  assert.equal(results.reduce((count, result) => count + result.sent, 0), 1);
  assert.equal(emails.length, 1);
  assert.equal(texts.length, 2);
  assert.equal(texts[1].get("To"), "+12125550100");
  assert.equal(texts[1].get("MessagingServiceSid"), textSender.TWILIO_MESSAGING_SERVICE_SID);
  const sms = texts[1].get("Body");
  assert.match(sms, /BTAC via BTAC Backstage/);
  assert.match(sms, /Reply STOP to unsubscribe/);
  assert.ok(!sms.includes("+12125550100"));
  const tracked = new URL(sms.match(/https:\/\/\S+/)[0]).pathname;
  const click = await f.request(tracked, {now:retryTime, form:{}});
  assert.equal(click.headers.get("location"), dest);
  const stats = await f.store.stats(id);
  assert.equal(stats.delivery.email.sent, 1);
  assert.equal(stats.delivery.text.sent, 1);
  assert.equal(stats.partners[0].clicks, 1);
  assert.equal(stats.signups, 1);
  assert.equal(stats.updates, 1);
  f.sql.close();
});

test("an uncertain text send is recorded as failed without sending again", async () => {
  const f = fixture();
  const {admin, fan, id} = await setup(f);
  await f.request(admin+"/publish", {user:owner, form:{}});
  await f.request(fan, {form:{channel:"text", phone:"+12125550100", text_consent:"on"}});
  const env = {...f.env, ...textSender};
  let attempts = 0;
  const send = async () => { attempts++; throw new Error("Timed out"); };
  assert.equal((await dispatchDue(f.store, env, {now:opening, send})).failed, 1);
  assert.equal((await dispatchDue(f.store, env, {now:opening+600_000, send})).checked, 0);
  assert.equal(attempts, 1);
  assert.equal((await f.store.stats(id)).delivery.text.failed, 1);
  f.sql.close();
});
