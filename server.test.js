import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, readConfig } from "../server.js";
import { parseEnv } from "../src/env.js";
import { assessmentJson, goodImage, config } from "./fixtures.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

async function withServer(opts, fn) {
  const server = createServer({ publicDir, ...opts });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}
const post = (base, p, body, headers = { "Content-Type": "application/json" }) =>
  fetch(base + p, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

test("health reports configuration without revealing the key", async () => {
  await withServer({ config }, async (base) => {
    const j = await (await fetch(base + "/api/health")).json();
    assert.equal(j.configured, true);
    assert.equal(j.model, config.model);
    assert.ok(!JSON.stringify(j).includes(config.apiKey));
  });
  await withServer({ config: { ...config, apiKey: "" } }, async (base) => {
    assert.equal((await (await fetch(base + "/api/health")).json()).configured, false);
  });
});

test("serves the app with security headers, and no key appears in any public file", async () => {
  await withServer({ config }, async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
    assert.match(await res.text(), /AFTERLIFE/);
    for (const f of ["/app.js", "/styles.css", "/index.html"]) {
      const body = await (await fetch(base + f)).text();
      assert.ok(!/x-goog-api-key|AIza[0-9A-Za-z_-]{20,}|generativelanguage\.googleapis\.com/.test(body), `${f} must not contain credentials or call the model directly`);
    }
  });
});

test("blocks path traversal and unknown file types", async () => {
  await withServer({ config }, async (base) => {
    for (const p of ["/../server.js", "/%2e%2e/server.js", "/..%2f..%2fpackage.json", "/.env", "/nothing.txt"]) {
      const res = await fetch(base + p);
      assert.ok([400, 403, 404].includes(res.status), `${p} gave ${res.status}`);
      assert.ok(!(await res.text()).includes('"afterlife-ai"'));
    }
  });
});

test("assess works end to end with an injected model", async () => {
  const generate = async () => JSON.stringify(assessmentJson);
  await withServer({ config, generate }, async (base) => {
    const res = await post(base, "/api/assess", { image: goodImage });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).assessment.object.name, "Ceramic mug");
  });
});

test("returns 503 with setup guidance when no key is set", async () => {
  await withServer({ config: { ...config, apiKey: "" } }, async (base) => {
    const res = await post(base, "/api/assess", { image: goodImage });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error.message, /GEMINI_API_KEY/);
  });
});

test("rejects wrong content type, bad JSON, wrong method and oversized bodies", async () => {
  await withServer({ config }, async (base) => {
    assert.equal((await post(base, "/api/assess", "x", { "Content-Type": "text/plain" })).status, 415);
    assert.equal((await post(base, "/api/assess", "{oops")).status, 400);
    assert.equal((await fetch(base + "/api/assess")).status, 405);
    const huge = JSON.stringify({ image: { mime: "image/jpeg", data: "A".repeat(9 * 1024 * 1024) } });
    assert.equal((await post(base, "/api/assess", huge)).status, 413);
  });
});

test("rate limits repeated analysis requests", async () => {
  await withServer({ config: { ...config, rateLimitPerMinute: 2 } }, async (base) => {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await post(base, "/api/assess", { image: { mime: "image/jpeg", data: "bad" } })).status);
    assert.deepEqual(codes, [400, 400, 429, 429]);
  });
});

test("surfaces model failures as clear JSON errors", async () => {
  const { ModelError } = await import("../src/model/gemmaClient.js");
  const generate = async () => { throw new ModelError("rate_limit", "quota"); };
  await withServer({ config, generate }, async (base) => {
    const res = await post(base, "/api/assess", { image: goodImage });
    assert.equal(res.status, 429);
    assert.equal((await res.json()).error.code, "model_quota");
  });
});

test("config and .env parsing", () => {
  assert.deepEqual(parseEnv('# c\nA=1\nB="two"\n\nC=\'3\'\nbad line'), { A: "1", B: "two", C: "3" });
  const c = readConfig({ GEMINI_API_KEY: " k ", GEMMA_MODEL: "gemma-4-31b-it", PORT: "8080" });
  assert.equal(c.apiKey, "k");
  assert.equal(c.model, "gemma-4-31b-it");
  assert.equal(c.port, 8080);
  assert.equal(readConfig({}).model, "gemma-4-26b-a4b-it");
  assert.equal(readConfig({}).host, "127.0.0.1");
});
