import { setTimeout as sleep } from "node:timers/promises";

const { BACKSTAGE_PUBLIC_URL: origin, BACKSTAGE_DISPATCH_SECRET: secret, BACKSTAGE_SITES_SERVICE_TOKEN: sitesToken } = process.env;
let endpoint;
try {
  endpoint = new URL("/api/dispatch", origin);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error();
} catch {
  console.error("Set BACKSTAGE_PUBLIC_URL to the HTTPS address of the deployed app.");
  process.exit(1);
}
if (!secret || secret.length < 32) {
  console.error("Set BACKSTAGE_DISPATCH_SECRET to the secret configured on the deployed app.");
  process.exit(1);
}

const headers = { Authorization: "Bearer " + secret };
if (sitesToken) headers["OAI-Sites-Authorization"] = "Bearer " + sitesToken;

const once = process.argv.includes("--once");
do {
  const started = Date.now();
  try {
    for (let batch = 0; batch < 10; batch++) {
      const response = await fetch(endpoint, {
        method: "POST", headers, signal: AbortSignal.timeout(30_000), redirect: "error",
      });
      if (!response.ok) throw new Error("Dispatch returned HTTP " + response.status);
      const { checked, sent, retrying, failed } = await response.json();
      if (!Number.isInteger(checked)) throw new Error("Unexpected dispatch response.");
      if (checked > 0) console.log({ checked, sent, retrying, failed });
      if (checked < 20) break;
      await sleep(1000);
    }
  } catch (error) {
    console.error("Could not process due alerts:", error.message);
    if (once) process.exitCode = 1;
  }
  if (!once) await sleep(Math.max(1000, 60_000 - (Date.now() - started)));
} while (!once);
