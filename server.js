// AFTERLIFE AI web server. Zero dependencies. Holds the API key; the browser never sees it.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnv } from "./src/env.js";
import { generate as realGenerate } from "./src/model/gemmaClient.js";
import { handleAssess, handleRefine, isConfigured, toHttpError, HttpError } from "./src/handlers.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export function readConfig(env = process.env) {
  return {
    apiKey: (env.GEMINI_API_KEY || "").trim(),
    model: (env.GEMMA_MODEL || "gemma-4-26b-a4b-it").trim(),
    port: Number(env.PORT) || 3000,
    host: env.HOST || "127.0.0.1",
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE) || 12,
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function sendError(res, err) {
  const e = toHttpError(err);
  if (e.status >= 500 && e.code === "internal") console.error("Unexpected error:", err?.message || err);
  sendJson(res, e.status, { error: { code: e.code, message: e.message } });
}

async function readJsonBody(req) {
  const type = String(req.headers["content-type"] || "");
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json.");
  }
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "too_large", "That upload is too large.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "too_large", "That upload is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_json", "The request body was not valid JSON.");
  }
}

function makeLimiter(perMinute) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < 60_000);
    if (recent.length >= perMinute) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

async function serveStatic(req, res, publicDir) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    return sendJson(res, 400, { error: { code: "bad_path", message: "Bad path." } });
  }
  if (rel.includes("\0")) return sendJson(res, 400, { error: { code: "bad_path", message: "Bad path." } });
  if (rel === "/") rel = "/index.html";
  const full = path.normalize(path.join(publicDir, rel));
  if (full !== publicDir && !full.startsWith(publicDir + path.sep)) {
    return sendJson(res, 403, { error: { code: "forbidden", message: "Forbidden." } });
  }
  const type = MIME[path.extname(full).toLowerCase()];
  if (!type) return sendJson(res, 404, { error: { code: "not_found", message: "Not found." } });
  try {
    const data = await readFile(full);
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    sendJson(res, 404, { error: { code: "not_found", message: "Not found." } });
  }
}

export function createServer({
  config = readConfig(),
  generate = realGenerate,
  publicDir = path.join(ROOT, "public"),
} = {}) {
  const allow = makeLimiter(config.rateLimitPerMinute);
  const deps = { config, generate };

  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, "http://localhost");

      if (req.method === "GET" && pathname === "/api/health") {
        return sendJson(res, 200, { ok: true, configured: isConfigured(config), model: config.model });
      }

      if (pathname === "/api/assess" || pathname === "/api/refine") {
        if (req.method !== "POST") {
          res.setHeader("Allow", "POST");
          return sendJson(res, 405, { error: { code: "method_not_allowed", message: "Use POST." } });
        }
        if (!allow(req.socket.remoteAddress || "unknown")) {
          return sendJson(res, 429, {
            error: { code: "rate_limited", message: "Too many requests. Wait a minute and try again." },
          });
        }
        const body = await readJsonBody(req);
        const handler = pathname === "/api/assess" ? handleAssess : handleRefine;
        return sendJson(res, 200, await handler(body, deps));
      }

      if (req.method === "GET" || req.method === "HEAD") return await serveStatic(req, res, publicDir);

      res.setHeader("Allow", "GET, HEAD, POST");
      return sendJson(res, 405, { error: { code: "method_not_allowed", message: "Method not allowed." } });
    } catch (err) {
      sendError(res, err);
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  loadEnv(path.join(ROOT, ".env"));
  const config = readConfig();
  const server = createServer({ config });
  server.listen(config.port, config.host, () => {
    console.log(`\n  AFTERLIFE AI is running at http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`);
    console.log(`  Model: ${config.model}`);
    console.log(
      isConfigured(config)
        ? "  API key: found (kept on the server)\n"
        : "  API key: NOT SET. Copy .env.example to .env and add GEMINI_API_KEY, then restart.\n",
    );
  });
}
