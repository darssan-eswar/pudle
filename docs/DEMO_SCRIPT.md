# Pudle demo script (two iPhones, controlled course)

Safety: record on a closed or very quiet road. A passenger operates phones; the driver only speaks.
Say on camera that hazards are staged and detections are a prototype.

## Before recording (once)
- Both phones signed in, same convoy, "Share hazard locations" on (see apps/mobile/ios/README.md).
- Demo road recorded by driving it once in the travel direction.
- Phone B (following car): destination + reviewed detour set; check the detour route in Google Maps.
- Run a parked test: Phone A dashcam at the staged object, say "report it"; Phone B with Google Maps open
  should speak within a few seconds. Check Delivery log on both phones.

## Demo 1: object at the roadside (~45 s)
1. Phone B: Start drive → Navigate in Google Maps (Pudle in background). Car B waits ~0.5–1 mile behind.
2. Phone A: Start drive → Dashcam on, mounted, Pudle on screen. Drive slowly toward the object.
3. Phone A speaks: "Heads up. Possible object on the right side of the road coming up, in case you didn't notice.
   Want me to warn drivers behind you? Say report it, or cancel." Driver: "Go ahead and report it."
4. Phone A: "Done. I warned drivers behind you."
5. Phone B (Google Maps in front): "Heads up. Something on the right side of the road, about a mile ahead,
   reported by a Pudle driver."

## Demo 2: branch blocking the road (~45 s)
1. Same setup; branch placed across the lane.
2. Phone A: "Looks like a fallen branch might be blocking the road ahead. Want me to warn drivers behind you
   so they can take another route?" Driver: "Yeah."
3. Phone B: "Possible road blockage about half a mile ahead: a fallen branch, reported by a Pudle driver.
   You might want to reroute." + notification "Reroute in Google Maps".
4. Passenger taps the notification → Google Maps opens via the detour → car B turns.

## Evidence to keep
Delivery log → Export evidence on both phones after each take (no locations in the export):
device, iOS, build, receipt→speech latency, Gemini round-trip latency, and drive battery change.
