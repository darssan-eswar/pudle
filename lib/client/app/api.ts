export const APP_ENDPOINTS = {
  auth: {
    session: '/api/auth/session',
    signIn: '/api/auth/signin',
    signUp: '/api/auth/signup',
    signOut: '/api/auth/signout',
  },
  recordings: {
    collection: '/api/recordings',
    item: (id: string) => `/api/recordings/${encodeURIComponent(id)}`,
  },
  ride: null,
  analysis: {
    status: '/api/analysis/status',
    submit: '/api/analysis',
  },
} as const;

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface SignUpInput extends SignInInput {
  displayName: string;
}

export interface CloudAnalysisAvailabilityDto {
  configured: boolean;
  provider: string | null;
  model: string | null;
}

export type CloudAnalysisErrorCode =
  | 'provider_unconfigured'
  | 'provider_timeout'
  | 'provider_quota'
  | 'provider_error'
  | 'malformed_provider_response';

/**
 * Contract documentation only. This client intentionally exposes no submit
 * method and never samples or uploads camera frames.
 */
export interface CloudAnalysisSubmissionContract {
  contentType: 'image/jpeg' | 'image/webp';
  maximumBytes: 524288;
  headers: {
    'X-Pudle-CSRF': '1';
    'X-Pudle-Cloud-Analysis-Consent': 'true';
    'Idempotency-Key': string;
    'X-Pudle-Captured-At': string;
    'X-Pudle-Recording-Id'?: string;
  };
  response: { jobId: string; result: unknown };
}

export interface RecordingMetadataDto {
  id: string;
  clientRecordingId: string;
  durationMs: number;
  mimeType: 'video/webm' | 'video/mp4';
  byteLength: number;
  capturedAt: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

/**
 * Metadata-only endpoint locations. Blob fields are deliberately absent.
 */
export const recordingMetadataContract = {
  collection: APP_ENDPOINTS.recordings.collection,
  item: APP_ENDPOINTS.recordings.item,
  methods: {
    collection: ['GET', 'POST'],
    item: ['GET', 'PATCH', 'DELETE'],
  },
} as const;

export class ClientApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ClientApiError';
  }
}

export async function readResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown;
  };
  if (!response.ok) {
    throw new ClientApiError(
      typeof body.error === 'string' ? body.error : 'Pudle could not complete that request.',
      response.status,
    );
  }
  return body as T;
}

function mutation<T>(
  url: string,
  body?: object,
  options: { method?: 'POST' | 'PATCH' | 'DELETE'; idempotent?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Pudle-CSRF': '1',
  };
  if (options.idempotent) headers['Idempotency-Key'] = crypto.randomUUID();
  return fetch(url, {
    method: options.method ?? 'POST',
    credentials: 'same-origin',
    headers,
    body: body ? JSON.stringify(body) : '{}',
  }).then(readResponse<T>);
}

export const authApi = {
  session(): Promise<{ user: AppUser | null }> {
    return fetch(APP_ENDPOINTS.auth.session, {
      credentials: 'same-origin',
      cache: 'no-store',
    }).then(readResponse<{ user: AppUser | null }>);
  },
  signIn(input: SignInInput): Promise<{ user: AppUser }> {
    return mutation(APP_ENDPOINTS.auth.signIn, input);
  },
  signUp(input: SignUpInput): Promise<{ user: AppUser }> {
    return mutation(APP_ENDPOINTS.auth.signUp, input);
  },
  signOut(): Promise<{ signedOut: true }> {
    return mutation(APP_ENDPOINTS.auth.signOut);
  },
};

export interface CreateRecordingMetadataInput {
  clientRecordingId: string;
  durationMs: number;
  mimeType: 'video/webm' | 'video/mp4';
  byteLength: number;
  capturedAt: number;
}

export const recordingsApi = {
  list(): Promise<{ recordings: RecordingMetadataDto[] }> {
    return fetch(APP_ENDPOINTS.recordings.collection, {
      credentials: 'same-origin',
      cache: 'no-store',
    }).then(readResponse<{ recordings: RecordingMetadataDto[] }>);
  },
  create(input: CreateRecordingMetadataInput): Promise<{ recording: RecordingMetadataDto }> {
    return mutation(APP_ENDPOINTS.recordings.collection, input);
  },
  get(serverId: string): Promise<{ recording: RecordingMetadataDto }> {
    return fetch(APP_ENDPOINTS.recordings.item(serverId), {
      credentials: 'same-origin',
      cache: 'no-store',
    }).then(readResponse<{ recording: RecordingMetadataDto }>);
  },
  update(
    serverId: string,
    changes: Pick<CreateRecordingMetadataInput, 'durationMs' | 'byteLength'>,
  ): Promise<{ recording: RecordingMetadataDto }> {
    return mutation(
      APP_ENDPOINTS.recordings.item(serverId),
      changes,
      { method: 'PATCH' },
    );
  },
  delete(serverId: string): Promise<void> {
    return fetch(APP_ENDPOINTS.recordings.item(serverId), {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'X-Pudle-CSRF': '1' },
    }).then(async (response) => {
      if (!response.ok) await readResponse(response);
    });
  },
};
