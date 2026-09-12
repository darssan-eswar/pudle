import {
  DEFAULT_GEMINI_MODEL,
  OBSERVATION_TYPES,
  ProviderFailure,
  type AnalysisProvider,
} from './contracts';
import { ROAD_ANALYSIS_PROMPT } from './prompt';
import type { SupportedImageType } from './image';

type Fetch = typeof fetch;

function toBase64(bytes: Uint8Array) {
  let result = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(result);
}

export class GeminiProvider implements AnalysisProvider {
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model = DEFAULT_GEMINI_MODEL,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    this.model = model;
  }

  async analyze(frame: Uint8Array, mimeType: SupportedImageType, signal: AbortSignal) {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { text: ROAD_ANALYSIS_PROMPT },
                { inlineData: { mimeType, data: toBase64(frame) } },
              ],
            }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 1_024,
              thinkingConfig: {
                thinkingLevel: 'low',
              },
              responseMimeType: 'application/json',
              responseJsonSchema: {
                type: 'object',
                additionalProperties: false,
                required: ['observations', 'confidence'],
                properties: {
                  observations: {
                    type: 'array',
                    maxItems: 5,
                    items: { type: 'string', enum: [...OBSERVATION_TYPES] },
                  },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                },
              },
            },
          }),
        },
      );
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new ProviderFailure('timeout', 'Analysis provider timed out.');
      }
      throw new ProviderFailure('provider', 'Analysis provider could not be reached.', true);
    }

    if (response.status === 429) {
      throw new ProviderFailure('quota', 'Analysis provider quota is unavailable.');
    }
    if (!response.ok) {
      throw new ProviderFailure(
        'provider',
        `Analysis provider returned status ${response.status}.`,
        response.status >= 500,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
      const candidate = (payload as {
        candidates?: Array<{
          finishReason?: unknown;
          content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
        }>;
      }).candidates?.[0];
      if (!candidate || candidate.finishReason !== 'STOP' || !Array.isArray(candidate.content?.parts)) {
        throw new Error('missing bounded text');
      }
      const text = candidate.content.parts
        .filter((part) => part.thought !== true && typeof part.text === 'string')
        .map((part) => part.text as string)
        .join('');
      if (text.length < 1 || text.length > 4_096) throw new Error('missing bounded text');
      return JSON.parse(text) as unknown;
    } catch {
      throw new ProviderFailure('malformed', 'Analysis provider returned malformed transport output.');
    }
  }
}

export function createGeminiProvider(config: {
  apiKey?: string;
  model?: string;
  fetchImpl?: Fetch;
}) {
  const key = config.apiKey?.trim();
  if (!key) return null;
  const model = config.model?.trim() || DEFAULT_GEMINI_MODEL;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) return null;
  return new GeminiProvider(key, model, config.fetchImpl);
}
