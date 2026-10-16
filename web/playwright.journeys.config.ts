import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";
import type { JourneyOptions } from "./e2e/journeys/_kit";

/**
 * Journey scripts (e2e/journeys/<编号>-<短名>.journey.ts): end-to-end tests that also record each journey as an mp4 for the
 * progress vault (主文档.md). Normally started by scripts/record/run.mjs; how to write one: e2e/journeys/README.md.
 *
 *   JOURNEY_BASE_URL  the running app (default http://localhost:3430). Start it with scripts/record/serve.mjs:
 *                     `next build` + `next start` (never `next dev`: it falls into reload loops) with
 *                     RIPPLE_DEV_TOOLS=1, so the foundation's dev tools (test clock, dev accounts, devfake
 *                     transcription) answer on the production build. No webServer here: the app must already run.
 *   JOURNEY_REC_DIR   root for recordings (default D:/ripple-c2/rec on Windows, <tmp>/ripple-c2/rec elsewhere);
 *                     raw output goes under <root>/raw unless JOURNEY_RAW_DIR (or --output) says otherwise.
 *   JOURNEY_PACE      pause multiplier: 1 (default) paced for a person watching, 0 = no pauses (quick check only).
 *
 * The phone: 390×844 CSS px at device scale factor 2, recorded at 780×1688. Chromium's screencast only delivers
 * full-resolution frames when the browser itself runs at that scale, hence --force-device-scale-factor below; change
 * both together.
 */
const VIEWPORT = { width: 390, height: 844 };
const DSF = 2;
const BASE_URL = (process.env.JOURNEY_BASE_URL?.trim() || "http://localhost:3430").replace(/\/+$/, "");
const REC_DIR = process.env.JOURNEY_REC_DIR?.trim() || (process.platform === "win32" ? "D:/ripple-c2/rec" : path.join(os.tmpdir(), "ripple-c2", "rec"));

// e2e/helpers.ts derives its BASE_URL from PW_PORT: point the shared helpers at the same server, always (a shell
// left with PW_PORT=3200 from ordinary e2e work would otherwise send them elsewhere). Set here, so the workers, which
// load this file too, agree.
process.env.PW_PORT = new URL(BASE_URL).port || (BASE_URL.startsWith("https:") ? "443" : "80");

export default defineConfig<JourneyOptions>({
  testDir: "./e2e/journeys",
  // *.journey.ts, not *.spec.ts: the default playwright.config.ts (testDir ./e2e) must not pick journeys up
  testMatch: /\d\d-[a-z0-9-]+\.journey\.ts$/,
  outputDir: process.env.JOURNEY_RAW_DIR?.trim() || path.join(REC_DIR, "raw", "direct"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // pacing makes a journey take a minute or two; composing and encoding the mp4 runs inside the test as well
  timeout: 420_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    deviceScaleFactor: DSF,
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
    timezoneId: "Asia/Singapore",
    pace: Number(process.env.JOURNEY_PACE ?? 1),
    video: {
      mode: "on",
      size: { width: VIEWPORT.width * DSF, height: VIEWPORT.height * DSF },
      show: {
        // every tap, fill and type is marked on screen for 650 ms before it happens: the deliberate pause that lets
        // a person follow the hand; the action title (Playwright's selector text) is hidden
        actions: {
          duration: 650,
          cursor: "none",
          style: {
            point:
              "width: 46px; height: 46px; border-radius: 50%; background: rgba(255, 183, 0, 0.30); border: 3px solid rgba(255, 153, 0, 0.95); box-shadow: 0 0 0 7px rgba(255, 153, 0, 0.18)",
            highlight: "outline: 3px solid rgba(255, 153, 0, 0.85); outline-offset: 2px; border-radius: 10px; background: rgba(255, 183, 0, 0.08)",
            title: "display: none",
          },
        },
      },
    },
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required", `--force-device-scale-factor=${DSF}`],
    },
    trace: "retain-on-failure",
  },
  projects: [{ name: "phone" }],
});
