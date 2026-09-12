# Recording and cloud-analysis privacy

## Data boundaries

- Recording files stay in the browser. The backend recording API accepts JSON metadata only and never accepts media bytes.
- Recording metadata is owner-scoped and is logically unavailable after 24 hours. Owners can delete it sooner.
- Cloud analysis is a separate action requiring an explicit consent header on every request. It accepts exactly one JPEG/WebP still, not audio, video, or a full recording.
- Pudle retains submitted frame bytes for **zero time after processing**: bytes exist only in request memory and the provider request, are never written to D1 or logs, and references are released when the request finishes.
- Analysis job and validated result metadata become logically unavailable after 30 minutes. Stored data contains no frame, face data, plate text, coordinates, or provider payload.

Expired rows are excluded from application reads. Physical D1 deletion is opportunistic: analysis
traffic deletes expired analysis rows and stale processing reservations, while recording list/create
traffic deletes expired recording metadata. This deployment does not currently configure a
Cloudflare scheduled handler, so Pudle does not promise physical deletion at the exact expiry
instant; an expired row can remain until relevant traffic next runs cleanup. Provider retention and
database backup retention remain governed by their respective operators.

## Provider processing

When configured, the server sends the opted-in frame to Google Gemini. Provider handling is outside Pudle's application retention boundary. Google's Gemini API terms effective March 23, 2026 state that unpaid services may use submitted content and responses for product improvement and may involve human review. For paid services, Google states prompts and responses are not used to improve products, but are logged for a limited period for abuse detection and may be transiently stored or cached in countries where Google or its agents operate. Terms and account settings can change; review the current [Gemini API terms](https://ai.google.dev/gemini-api/terms) before enabling the integration. Pudle makes no provider-side deletion guarantee.

## Analysis limits

- Maximum request/frame size: 512KB
- Accepted formats: JPEG and WebP only
- Maximum width or height: 1920px
- Minimum accepted cadence: five seconds per user
- Maximum in-flight analyses: one per user
- Request rate: 12/user/minute and 30/IP/minute
- Provider timeout: eight seconds per attempt; only transient provider/network failures receive one bounded retry

The provider is instructed to report only observable road conditions and to treat visual text as untrusted. It may not identify people; inspect faces; extract plates or identifying text; infer intoxication, intent, wrongdoing, or culpability; provide navigation; or make safety guarantees. Provider JSON is restricted to allowlisted observation enums and numeric confidence. Returned and persisted summary/uncertainty text is generated deterministically by Pudle from those values, never from provider-authored free-form text. Invalid output fails closed and is not returned as analysis.

If `GEMINI_API_KEY` is missing, the status endpoint reports unconfigured and analysis fails explicitly. There is no simulated live result. Live verification is blocked until an operator supplies a valid key under an appropriate provider account.
