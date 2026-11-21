import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleRequest } from "../src/app.mjs";
import { dispatchDue } from "../src/mail.mjs";
import { createStore } from "../src/store.mjs";

const origin = "https://backstage.example";
const initial = Date.parse("2026-12-01T12:00Z");
const opening = Date.parse("2026-12-05T15:00Z");
const owner = {userId:"btac-admin", displayName:"BTAC"};
const secondOwner = {userId:"another-band", displayName:"Another Band"};
const dest = "https://tickets.example/presale";
const details = {title:"Live in Brooklyn", venue:"Brooklyn, NY", timezone:"America/New_York",
  event:"2026-12-12T20:00", opens:"2026-12-05T10:00", ticket:dest};

function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync(new URL("../drizzle/0000_petite_mongu.sql", import.meta.url), "utf8"));
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
    batch: async (statements) => Promise.all(statements.map((statement) => statement.all())),
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
  assert.match(publicPage, /name="updates" >/);

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
  assert.equal(stats.sent, 1);
  assert.equal(stats.clicks, 2);
  assert.equal(stats.partners[0].clicks, 1);
  assert.equal(stats.direct_clicks, 1);
  f.sql.close();
});
