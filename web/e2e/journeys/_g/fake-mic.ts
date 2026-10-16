/**
 * Chromium's fake microphone for the whole-line journeys of track G: the journeys config's own launch args (they must
 * stay: autoplay, the 2x device scale the recording needs) plus the fake media device and its permission prompt
 * answered. No sound file is given, so the microphone is Chromium's own test tone: a recording that is really made,
 * uploaded and kept, with nothing of a real person in it. Use it with `journey.use({ launchOptions: FAKE_MIC_LAUNCH })`.
 */
export const FAKE_MIC_LAUNCH = {
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--force-device-scale-factor=2",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
};
