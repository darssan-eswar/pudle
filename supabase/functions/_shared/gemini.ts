// Minimal Gemini Interactions API client for Pudle edge functions.
// GEMINI_API_KEY is an Edge Function secret; it never reaches the app.

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

export class GeminiError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export function geminiKey(): string {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new GeminiError("Gemini is not configured on the server (GEMINI_API_KEY missing).", 503);
  return key;
}

export async function interact(body: Record<string, unknown>, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": geminiKey() },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      // Log status only; responses may echo request content.
      console.error("gemini_error", response.status, text.slice(0, 300));
      throw new GeminiError(`Gemini request failed (${response.status}).`, response.status === 429 ? 429 : 502);
    }
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    if ((error as Error).name === "AbortError") throw new GeminiError("Gemini timed out.", 504);
    throw new GeminiError("Gemini unreachable.", 502);
  } finally {
    clearTimeout(timer);
  }
}

/** Collects output content blocks of a type from an interaction response (newest last). */
export function outputBlocks(result: any, type: string): any[] {
  const blocks: any[] = [];
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  for (const step of steps) {
    if (step?.type && step.type !== "model_output") continue;
    for (const block of Array.isArray(step?.content) ? step.content : []) {
      if (block?.type === type) blocks.push(block);
    }
  }
  // Older/alternate shapes.
  for (const block of Array.isArray(result?.outputs) ? result.outputs : []) {
    if (block?.type === type) blocks.push(block);
  }
  return blocks;
}

export function outputText(result: any): string {
  const blocks = outputBlocks(result, "text");
  if (blocks.length) return blocks.map((b) => b.text ?? "").join("");
  if (typeof result?.output_text === "string") return result.output_text;
  throw new GeminiError("Gemini returned no text.");
}

export const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
}

/** Subject of the (gateway-verified) JWT, used only for per-user rate limiting. */
export function userId(req: Request): string | null {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "authenticated" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

const buckets = new Map<string, number[]>();
/** Best-effort per-instance sliding window. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}
