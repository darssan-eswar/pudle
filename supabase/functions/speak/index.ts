// POST { text: string (<= 300 chars), persona: "copilot" | "buddy" | "pro" | "hype" }
// -> audio/wav (24 kHz mono 16-bit). The text is the app's fixed alert phrase; the server only
// chooses the voice and delivery style. Nothing is stored.
import { allow, cors, GeminiError, interact, json, outputBlocks, userId } from "../_shared/gemini.ts";

const MODEL = Deno.env.get("GEMINI_TTS_MODEL") ?? "gemini-3.8-flash-tts";

const PERSONAS: Record<string, { voice: string; style: string }> = {
  copilot: { voice: "Kore", style: "calm, clear and reassuring, like a steady co-pilot; brisk pace" },
  buddy: { voice: "Puck", style: "casual and friendly, like a friend riding shotgun; upbeat but not shouting; brisk pace" },
  pro: { voice: "Charon", style: "neutral and professional, like a navigation announcement; brisk pace" },
  hype: { voice: "Fenrir", style: "energetic and alert, urgent but not panicked; fast pace" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const user = userId(req);
  if (!user) return json({ error: "Sign in required" }, 401);
  if (!allow(`speak:${user}`, 40, 60_000)) return json({ error: "Too many requests" }, 429);

  let text = "";
  let persona = "copilot";
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text.trim() : "";
    persona = typeof body?.persona === "string" ? body.persona : "copilot";
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!text || text.length > 300) return json({ error: "text must be 1-300 characters" }, 400);
  const chosen = PERSONAS[persona] ?? PERSONAS.copilot;

  try {
    const result = await interact({
      model: MODEL,
      input: [{
        type: "user_input",
        content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: chosen.style }] }],
      }],
      response_format: { type: "audio", mime_type: "audio/wav", sample_rate: 24000 },
      generation_config: { speech_config: [{ voice: chosen.voice }] },
    }, 10_000);
    const audio = outputBlocks(result, "audio").pop()?.data;
    if (typeof audio !== "string") throw new GeminiError("Gemini returned no audio.");
    const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
    return new Response(bytes, { headers: { ...cors, "content-type": "audio/wav", "cache-control": "no-store" } });
  } catch (error) {
    const status = error instanceof GeminiError ? error.status : 502;
    return json({ error: (error as Error).message }, status);
  }
});
