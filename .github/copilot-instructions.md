# Pulzar Copilot instructions

Pulzar is a privacy-first road-intelligence product. Preserve these invariants in every generated change:

- Camera frames and raw audio never leave the browser.
- Do not add license-plate recognition, facial recognition, vehicle-owner identification, or persistent device tracking.
- Round report coordinates to three decimal places before network transmission.
- Nearby road events must be limited to a two-mile radius and expire after 30 minutes.
- Describe observable road behavior, never inferred intoxication, identity, intent, or culpability.
- Never expose server secrets in client components.
- Keep edge inference optional: camera and manual reporting must still work when an AI model fails to load.
- Use accessible buttons, visible permission states, mobile-first layouts, and concise driver-safe copy.
- Add a validation path for every new API input and return the minimum metadata needed by the interface.
- Treat LoRaWAN, MCP, vehicle integrations, parking inference, gas-price OCR, and signal timing as roadmap capabilities until their end-to-end implementation is verified.

Prefer small composable functions, explicit TypeScript types, and progressive enhancement over framework complexity.
