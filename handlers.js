// Application logic. Pure functions with injected dependencies so they are easy to test.
import { assessParts, refineParts, RETRY_NUDGE } from "./model/prompts.js";
import {
  parseModelJson,
  normalizeAssessment,
  normalizeRefined,
  validateImage,
  validateNote,
  validateEvidence,
  InputError,
  ModelOutputError,
} from "./model/validate.js";
import { ModelError } from "./model/gemmaClient.js";

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function isConfigured(config) {
  return Boolean(config.apiKey) && config.apiKey !== "your_key_here";
}

function requireConfigured(config) {
  if (!isConfigured(config)) {
    throw new HttpError(
      503,
      "not_configured",
      "The server has no GEMINI_API_KEY yet. Add one to the .env file and restart (see the README).",
    );
  }
}

/** Calls the model, parses and normalises its JSON, and retries once on a bad reply. */
async function runJson({ generate, config, parts, normalize }) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await generate({
      apiKey: config.apiKey,
      model: config.model,
      parts: attempt === 0 ? parts : [...parts, { text: RETRY_NUDGE }],
    });
    try {
      return normalize(parseModelJson(text));
    } catch (err) {
      if (!(err instanceof ModelOutputError)) throw err;
      last = err;
    }
  }
  throw new HttpError(
    502,
    "model_bad_output",
    `The model replied, but not in a usable format. Please try again. (${last.message})`,
  );
}

export async function handleAssess(body, { config, generate }) {
  requireConfigured(config);
  const image = validateImage(body?.image);
  const note = validateNote(body?.note);
  const assessment = await runJson({
    generate,
    config,
    parts: assessParts({ image, note }),
    normalize: normalizeAssessment,
  });
  return { assessment };
}

export async function handleRefine(body, { config, generate }) {
  requireConfigured(config);
  const image = validateImage(body?.image);
  const evidence = validateEvidence(body?.evidence);
  let previous;
  try {
    previous = normalizeAssessment(body?.initial);
  } catch {
    throw new InputError("The initial assessment is missing or invalid. Start again from the first photo.");
  }
  const updated = await runJson({
    generate,
    config,
    parts: refineParts({ image, previous, evidence }),
    normalize: normalizeRefined,
  });
  return { updated };
}

/** Maps any thrown error to a safe HTTP status and message. Never leaks secrets or stack traces. */
export function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof InputError) return new HttpError(400, "bad_request", err.message);
  if (err instanceof ModelError) {
    switch (err.kind) {
      case "not_configured":
        return new HttpError(503, "not_configured", "The server is not configured with a valid model setup.");
      case "auth":
        return new HttpError(502, "model_auth", "The model service rejected the server's API key. Check GEMINI_API_KEY.");
      case "rate_limit":
        return new HttpError(429, "model_quota", "The free model quota is used up for the moment. Wait a minute and try again.");
      case "timeout":
        return new HttpError(504, "model_timeout", "The model took too long to respond. Try again.");
      case "network":
        return new HttpError(502, "model_unreachable", "Could not reach the model service. Check the server's internet connection.");
      case "blocked":
        return new HttpError(422, "model_declined", "The model declined to analyse this image. Try a different photo.");
      case "empty":
        return new HttpError(502, "model_empty", "The model returned nothing. Try again.");
      default:
        return new HttpError(502, "model_error", err.message || "The model service returned an error.");
    }
  }
  return new HttpError(500, "internal", "Unexpected server error.");
}
