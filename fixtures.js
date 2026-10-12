// Test fixtures only. These canned replies exist to test parsing, validation and plumbing.
// They are NOT used by the running application, which always calls the real model.

export const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]).toString("base64");
export const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(200, 1)]).toString("base64");

export const goodImage = { mime: "image/jpeg", data: JPEG_B64 };

export const assessmentJson = {
  object: { name: "Ceramic mug", confidence: "medium" },
  visible: ["A white mug with a chipped rim", "A hairline mark near the handle"],
  inferred: ["The mug is probably glazed stoneware"],
  uncertain: ["Whether the hairline mark is a crack", "Whether the glaze is food safe"],
  missing_evidence: {
    request: "Photograph the handle joint from the side in bright light.",
    reason: "A crack there would rule out repair.",
  },
  provisional_leaning: { pathway: "repurpose", reason: "Provisional: rim chip makes drinking unsafe." },
};

const pathway = (type, fit) => ({
  type,
  fit,
  headline: `${type} plan`,
  why: `Because of the evidence, ${type} is ${fit}.`,
  steps: fit === "not_advised" ? [] : ["Step one", "Step two", "Step three"],
  materials: ["Item"],
  tools: ["Tool"],
  difficulty: "easy",
  time_estimate: "30 minutes",
  safety: ["Wear gloves"],
  remaining_uncertainty: ["Hidden damage"],
});

export const refinedJson = {
  object: { name: "Ceramic mug", confidence: "high" },
  visible: ["Chipped rim", "Handle joint intact in new photo"],
  inferred: [],
  uncertain: ["Glaze composition"],
  evidence_used: "A side photo of the handle joint showing no crack.",
  what_changed: ["The hairline mark is a glaze line, not a crack."],
  pathways: [pathway("repair", "weak"), pathway("repurpose", "strong"), pathway("recycle", "possible")],
  top_recommendation: { pathway: "repurpose", reason: "Safe as a pen holder." },
};

export const config = { apiKey: "test-key", model: "gemma-4-26b-a4b-it", rateLimitPerMinute: 100 };
