import test from "node:test";
import assert from "node:assert/strict";
import {
  parseModelJson,
  normalizeAssessment,
  normalizeRefined,
  validateImage,
  validateEvidence,
  validateNote,
  InputError,
  ModelOutputError,
} from "../src/model/validate.js";
import { assessmentJson, refinedJson, goodImage, JPEG_B64, PNG_B64 } from "./fixtures.js";

test("parseModelJson accepts fenced and padded JSON", () => {
  const text = "Here you go:\n```json\n" + JSON.stringify({ a: 1 }) + "\n```\nThanks";
  assert.deepEqual(parseModelJson(text), { a: 1 });
});

test("parseModelJson rejects text with no JSON and broken JSON", () => {
  assert.throws(() => parseModelJson("no braces here"), ModelOutputError);
  assert.throws(() => parseModelJson("{ not: json }"), ModelOutputError);
});

test("normalizeAssessment keeps valid data and clamps unknown enums", () => {
  const out = normalizeAssessment({
    ...assessmentJson,
    object: { name: "Mug", confidence: "certain" },
    provisional_leaning: { pathway: "burn", reason: "x" },
  });
  assert.equal(out.object.confidence, "low");
  assert.equal(out.provisional_leaning.pathway, "unclear");
  assert.equal(out.missing_evidence.request.length > 0, true);
});

test("normalizeAssessment requires a name, visible items and an evidence request", () => {
  assert.throws(() => normalizeAssessment({ ...assessmentJson, object: {} }), ModelOutputError);
  assert.throws(() => normalizeAssessment({ ...assessmentJson, visible: [] }), ModelOutputError);
  assert.throws(() => normalizeAssessment({ ...assessmentJson, missing_evidence: {} }), ModelOutputError);
  assert.throws(() => normalizeAssessment(null), ModelOutputError);
});

test("normalizeAssessment drops non-string list items and caps list length", () => {
  const out = normalizeAssessment({ ...assessmentJson, visible: ["ok", 5, null, ...Array(20).fill("x")] });
  assert.ok(out.visible.length <= 8);
  assert.ok(out.visible.every((v) => typeof v === "string"));
});

test("normalizeRefined returns exactly three pathways in fixed order", () => {
  const shuffled = { ...refinedJson, pathways: [...refinedJson.pathways].reverse() };
  const out = normalizeRefined(shuffled);
  assert.deepEqual(out.pathways.map((p) => p.type), ["repair", "repurpose", "recycle"]);
});

test("normalizeRefined fails when a pathway is missing or has no steps", () => {
  assert.throws(() => normalizeRefined({ ...refinedJson, pathways: refinedJson.pathways.slice(0, 2) }), ModelOutputError);
  const noSteps = structuredClone(refinedJson);
  noSteps.pathways[0].steps = [];
  assert.throws(() => normalizeRefined(noSteps), ModelOutputError);
});

test("normalizeRefined allows empty steps only for not_advised", () => {
  const r = structuredClone(refinedJson);
  r.pathways[0].fit = "not_advised";
  r.pathways[0].steps = [];
  assert.equal(normalizeRefined(r).pathways[0].steps.length, 0);
});

test("normalizeRefined picks a sensible top recommendation when the model's is invalid", () => {
  const r = { ...refinedJson, top_recommendation: { pathway: "explode", reason: "" } };
  assert.equal(normalizeRefined(r).top_recommendation.pathway, "repurpose");
});

test("validateImage accepts real signatures and rejects mismatches", () => {
  assert.deepEqual(validateImage(goodImage), goodImage);
  assert.ok(validateImage({ mime: "image/png", data: PNG_B64 }));
  assert.throws(() => validateImage({ mime: "image/png", data: JPEG_B64 }), InputError);
  assert.throws(() => validateImage({ mime: "image/gif", data: JPEG_B64 }), InputError);
  assert.throws(() => validateImage({ mime: "image/jpeg", data: "###" }), InputError);
  assert.throws(() => validateImage(null), InputError);
});

test("validateImage rejects images over 5 MB", () => {
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024 + 10)]).toString("base64");
  assert.throws(() => validateImage({ mime: "image/jpeg", data: big }), /larger than 5 MB/);
});

test("validateEvidence needs content unless the user skips", () => {
  assert.throws(() => validateEvidence({ skipped: false, text: "  " }), InputError);
  assert.equal(validateEvidence({ skipped: true }).skipped, true);
  assert.equal(validateEvidence({ text: "checked the hinge" }).text, "checked the hinge");
  assert.ok(validateEvidence({ image: goodImage }).image);
  assert.throws(() => validateEvidence({ image: { mime: "image/jpeg", data: "bad" } }), InputError);
});

test("validateNote trims and caps length", () => {
  assert.equal(validateNote("  hi  "), "hi");
  assert.equal(validateNote("x".repeat(900)).length, 500);
  assert.equal(validateNote(undefined), "");
  assert.throws(() => validateNote(42), InputError);
});
