import { env } from 'cloudflare:workers';
import { requireUser } from '@/server/auth/runtime';
import { createGeminiProvider } from '@/server/analysis/gemini-provider';
import { createAnalysisService } from '@/server/analysis/service';
import { D1AnalysisStore } from '@/server/analysis/d1-store';
import { getD1 } from '@/db';
import { errorResponse, json } from '@/server/http';

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const service = createAnalysisService({
      store: new D1AnalysisStore(getD1()),
      provider: createGeminiProvider({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL,
      }),
    });
    return json(service.configured());
  } catch (error) {
    return errorResponse(error);
  }
}
