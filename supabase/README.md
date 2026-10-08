# Pudle backend

Shared backend for the native iPhone demo and web convoy application.

- `functions/detect-hazard/`: authenticated camera-frame analysis through Google Gemini.
- `functions/speak/`: authenticated Gemini natural speech generation.
- `functions/_shared/`: session validation, provider client and response helpers.
- `migrations/`: convoy access, hazard events, consent and retention schema changes.
- `tests/`: database access-rule verification.

See the [main implementation overview](../README.md#configure-the-backend) and [native setup](../apps/mobile/ios/README.md). Keep API keys in Edge Function secrets, never in the repository. Apply migrations deliberately; files in this folder do not imply that every optional migration is already deployed.
