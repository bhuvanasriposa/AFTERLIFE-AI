import test from "node:test";
import assert from "node:assert/strict";
import { generate, ModelError } from "../src/model/gemmaClient.js";

const okResponse = (parts) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts } }] }),
});
const errResponse = (status, message = "x") => ({ ok: false, status, json: async () => ({ error: { message } }) });
const parts = [{ text: "hello" }];

test("sends the key in a header, never in the URL, and uses the configured model", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return okResponse([{ text: "hi" }]);
  };
  const out = await generate({ apiKey: "SECRET", model: "gemma-4-26b-a4b-it", parts, fetchImpl });
  assert.equal(out, "hi");
  assert.match(seen.url, /models\/gemma-4-26b-a4b-it:generateContent$/);
  assert.ok(!seen.url.includes("SECRET"));
  assert.equal(seen.init.headers["x-goog-api-key"], "SECRET");
  assert.deepEqual(JSON.parse(seen.init.body).contents[0].parts, parts);
});

test("ignores hidden thought parts", async () => {
  const fetchImpl = async () => okResponse([{ text: "private reasoning", thought: true }, { text: "answer" }]);
  assert.equal(await generate({ apiKey: "k", model: "m", parts, fetchImpl }), "answer");
});

test("refuses to run without a key or with a suspicious model name", async () => {
  await assert.rejects(generate({ apiKey: "", model: "m", parts }), (e) => e.kind === "not_configured");
  await assert.rejects(generate({ apiKey: "k", model: "../evil", parts }), (e) => e.kind === "not_configured");
});

test("maps HTTP failures to typed errors", async () => {
  const kind = async (status) => {
    try {
      await generate({ apiKey: "k", model: "m", parts, fetchImpl: async () => errResponse(status) });
    } catch (e) {
      return e.kind;
    }
  };
  assert.equal(await kind(401), "auth");
  assert.equal(await kind(403), "auth");
  assert.equal(await kind(429), "rate_limit");
  assert.equal(await kind(500), "upstream");
});

test("maps network failure and timeout", async () => {
  await assert.rejects(
    generate({ apiKey: "k", model: "m", parts, fetchImpl: async () => { throw new TypeError("fetch failed"); } }),
    (e) => e.kind === "network",
  );
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("a"), { name: "AbortError" }))));
  await assert.rejects(generate({ apiKey: "k", model: "m", parts, fetchImpl: hang, timeoutMs: 20 }), (e) => e.kind === "timeout");
});

test("reports blocked or empty replies", async () => {
  const blocked = async () => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }) });
  await assert.rejects(generate({ apiKey: "k", model: "m", parts, fetchImpl: blocked }), (e) => e.kind === "blocked");
  const empty = async () => okResponse([{ text: "   " }]);
  await assert.rejects(generate({ apiKey: "k", model: "m", parts, fetchImpl: empty }), (e) => e instanceof ModelError && e.kind === "empty");
});
