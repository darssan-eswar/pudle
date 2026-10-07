// POST { image: <base64 JPEG>, speed_mps?: number }
// -> { hazard, kind, side, blocks_road, confidence, label, model, latency_ms }
// The frame is forwarded to Gemini and not stored. Output is a *possible* observation:
// the app asks the driver to confirm before anything is shared.
import { allow, cors, GeminiError, interact, json, outputText, userId } from "../_shared/gemini.ts";

const MODEL = Deno.env.get("GEMINI_VISION_MODEL") ?? "gemini-3.8-flash";
const MAX_IMAGE_BYTES = 450_000;
const KINDS = ["tree", "debris", "stopped_vehicle", "animal", "pothole", "object", "other", "none"];
const SIDES = ["left", "right", "center", "unknown"];

const INSTRUCTIONS = `You are the forward-facing dashcam hazard spotter for a driver-assistance prototype.
The image is taken from inside a car looking ahead through the windshield.
Report a hazard only for a physical obstacle ON the roadway or its immediate edge/shoulder ahead that a driver
should slow down or steer around: a fallen tree or branch, debris (boxes, tires, rocks, trash, cones in the lane),
an animal, a stopped or broken-down vehicle in or partly in a travel lane, a large pothole, or another object.
Do NOT report: lane markings, shadows, wet patches, normal moving traffic, cars parked in parking spaces,
signs, poles, buildings, vegetation that is off the road, people on sidewalks, or the car's own hood/dashboard.
side = where the obstacle is relative to the camera's lane: left, right, center (in front of us), or unknown.
blocks_road = true only if the obstacle covers most of the travel lane(s) so a car could not pass without leaving the road
or crossing into oncoming traffic.
"tree" covers fallen trees and branches. Never identify people, faces or license plates.
If you are not clearly sure, set hazard=false and kind="none". confidence is your own 0-1 estimate, not a measured accuracy.
label = 1-4 plain words naming the object (e.g. "fallen branch"), or "" when hazard is false.`;

const SCHEMA = {
  type: "object",
  properties: {
    hazard: { type: "boolean" },
    kind: { type: "string", enum: KINDS },
    side: { type: "string", enum: SIDES },
    blocks_road: { type: "boolean" },
    confidence: { type: "number" },
    label: { type: "string" },
  },
  required: ["hazard", "kind", "side", "blocks_road", "confidence", "label"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const user = userId(req);
  if (!user) return json({ error: "Sign in required" }, 401);
  if (!allow(`detect:${user}`, 90, 60_000)) return json({ error: "Too many frames; slow down" }, 429);

  let image: string;
  try {
    const body = await req.json();
    image = typeof body?.image === "string" ? body.image : "";
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!image || image.length > (MAX_IMAGE_BYTES * 4) / 3 + 8 || !/^[A-Za-z0-9+/=]+$/.test(image)) {
    return json({ error: "image must be a base64 JPEG under 450 KB" }, 400);
  }

  const started = Date.now();
  try {
    const result = await interact({
      model: MODEL,
      input: [
        { type: "text", text: INSTRUCTIONS },
        { type: "image", data: image, mime_type: "image/jpeg" },
      ],
      response_format: { type: "text", mime_type: "application/json", schema: SCHEMA },
      generation_config: { thinking_level: "minimal", temperature: 0 },
    }, 12_000);
    const parsed = JSON.parse(outputText(result));
    // Never trust model output shape: clamp to the contract.
    const hazard = parsed.hazard === true && KINDS.includes(parsed.kind) && parsed.kind !== "none";
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
    return json({
      hazard,
      kind: hazard ? parsed.kind : "none",
      side: SIDES.includes(parsed.side) ? parsed.side : "unknown",
      blocks_road: hazard && parsed.blocks_road === true,
      confidence,
      label: hazard ? String(parsed.label ?? "").replace(/[^\p{L}\p{N} '-]/gu, "").slice(0, 40) : "",
      model: MODEL,
      latency_ms: Date.now() - started,
    });
  } catch (error) {
    const status = error instanceof GeminiError ? error.status : 502;
    return json({ error: (error as Error).message, latency_ms: Date.now() - started }, status);
  }
});
