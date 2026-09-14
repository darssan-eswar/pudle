# Pudle submission overview

## One-line pitch

Pudle turns a phone into a private dashcam with Pudy, a foreground voice companion grounded in the road context currently displayed.

## What to show

1. Start at `/`: **A clearer view of the road.** Open the product at `/app`.
2. Record a short clip and play it back from the local library. Only bounded metadata syncs; full recording media and recording audio stay in the browser.
3. Prepare one observable road report, review it, and explicitly confirm it. A second signed-in user sees only a broad nearby distance band, with no reporter identity or coordinates.
4. Create an email-bound Ride invite, join from the second account, and exchange one persisted plain-text message.
5. Tap **Enable voice** and say “Hey Pudy, what is displayed?” Pudy answers from current displayed data, stops recognition while speaking, and resumes foreground listening while enabled and visible.
6. Ask Pudy to prepare a report. Pudy can open review but cannot confirm or share it.

## Precise boundaries

- Voice awakening uses the browser speech-recognition API only after **Enable voice**. The browser vendor may process microphone audio. It does not run in the background or on a locked phone, and text remains the fallback.
- Optional cloud analysis sends bounded compressed still frames only after separate consent. It never sends full recordings or audio. Without a configured server-side Gemini credential, the UI remains **Unconfigured** and produces no substitute result.
- Camera frames and raw recording audio otherwise remain in the browser. Pudle does not identify faces, plates, owners, intent, intoxication, or culpability.
- Nearby reports are limited to two miles and 30 minutes, use three-decimal coordinates at transmission, and return no precise location.

## Presenter fallback

If camera, speech, GPS, or Gemini is unavailable on the presentation device, use the text field, manual report controls, and visibly labeled demo area. Do not describe mocked speech or synthetic media checks as physical-device proof.
