# Demo and submission guide

Pudle turns a phone into a private dashcam with Pudy, a voice companion.

## The problem

- Road conditions change before useful reports reach nearby drivers.
- A recording helps its owner, but useful observations often stay on that one phone.
- Recording, checking reports, and keeping in touch with a ride can mean switching between apps.

## The solution

Record locally. Share a short-lived road report after reviewing it. Keep ride messages in the same app. Ask Pudy about the observations currently displayed.

This MVP combines those tasks; it does not navigate the car or guarantee that a report is correct.

## Before recording

Use a parked setup or a passenger-operated phone. Prepare two separate browser profiles with the Driver and Passenger accounts from [local setup](SETUP.md). Use **Use demo area** for a local demo without sharing real GPS.

Check permissions and audio on the actual presentation phone. The public landing works today, but public access to the hosted app still needs approval. Cloud analysis is unconfigured. See [deployment gates](DEPLOYMENT.md).

## Suggested 60–90 second walkthrough

| Part | Show |
|---|---|
| Introduction | Open the landing page and explain the problem in one sentence. Select **Open Pudle**. |
| Recording | Start a short clip, stop it, then play it from Recordings. Explain that the file stays on the device. |
| Road report | Prepare a report, review it, and confirm it. Show the second account receiving a broad nearby distance band, then acknowledge or resolve it. |
| Ride messages | Redeem a prepared email-bound invitation and send a message between the two accounts. |
| Pudy | Enable voice and say “Hey Pudy, what is displayed?” Ask Pudy to prepare a report; show that sharing still needs confirmation. |
| Close | State what is working and what remains to be verified. |

Prepare the invitation before recording so setup does not take over the demonstration. A longer technical walkthrough can include reload, sign-out, storage isolation, and retention.

## Describe the limits plainly

- Foreground voice uses browser speech recognition after **Enable voice**. The browser vendor may process microphone audio. It does not listen on a locked phone or in the background.
- Full recordings and recording audio stay in the browser. Optional cloud analysis sends only bounded compressed still frames after separate consent.
- Without a provider credential, show **Unconfigured**. A test fixture is not live analysis.
- Nearby reports last up to 30 minutes and cover a two-mile area. Transmitted report coordinates are rounded; responses omit them.
- Camera and model observations can be wrong. Pudle does not identify faces, read plates, identify vehicle owners, or infer impairment or intent.

If speech is unavailable, demonstrate the text controls and say so. If the camera is unavailable, do not substitute synthetic video and describe it as a real camera test.

## Challenge checklist

The exact GitHub challenge has not been provided. No entry has been submitted, and no deadline or eligibility claim is verified.

Once the official rules are available, confirm:

- Eligibility and deadline, including timezone.
- Whether the repository and app must be public.
- License and attribution requirements.
- Required video length, screenshots, links, and written sections.
- Whether a social post, form, or other submission step is required.

Use [verification evidence](VERIFIED.md) for technical claims. Do not publish credentials, private road footage, or account details in the entry.
