# Movyza Native UI and Player Manual Validation

This checklist is for validating the Android UI/player overhaul on a real device. A successful Gradle build is not a substitute for these runtime checks.

## Video framing
- [ ] Play a 16:9 movie and confirm the complete frame is visible without stretching.
- [ ] Play a 21:9/cinematic source and confirm any unused screen area stays black/carbon, rather than cropping the picture.
- [ ] Play a 4:3 source and, if available, a portrait source.
- [ ] Tap the fit-frame control and confirm it resets to the original complete frame.
- [ ] Verify orientation and system bars do not leave the video unexpectedly tiny or clipped.

## Subtitle/Hardsub presentation
- [ ] Confirm the default white outlined Arabic subtitle is comfortably readable.
- [ ] Open player settings, change subtitle size, and verify the visible subtitle changes immediately.
- [ ] Close/reopen the player and verify the chosen subtitle size persists.
- [ ] Check multi-speaker cues and Arabic/Latin text for clipping, overlap, or incorrect line breaks.

## Timeline and playback controls
- [ ] In Arabic RTL, verify the playhead progresses physically from left to right.
- [ ] Repeat in English/LTR.
- [ ] During loading/reload, verify the centered play/pause button is not displayed over the loading state.
- [ ] After the player becomes ready, verify play/pause works.
- [ ] Trigger a failed source and verify a visible retry/error state appears.
- [ ] Seek with the buttons and double-tap; confirm the -10s/+10s feedback is animated and the playback position changes.
- [ ] Check the start and end boundaries; seeking must never move before 0 or beyond the duration.

## Navigation and visual polish
- [ ] Verify the dock has no unwanted bright top outline and remains above the system gesture area.
- [ ] Navigate across Home, Movies, Series, Search, Profile, detail and settings screens.
- [ ] Check text contrast, card loading/empty states, and smooth scrolling on a small-width device.
- [ ] Repeat essential checks after switching between Arabic and English.

## Results
Record device model/Android version, media title/source type, each failed item, and a logcat excerpt when useful. Do not mark a check passed without observing it on the device.
