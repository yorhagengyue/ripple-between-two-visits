import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * PW_PORT (default 3200) moves both the dev server Playwright starts and baseURL, so a second builder
 * can point its run elsewhere. Note: Next 16 locks .next/dev, so two `next dev` cannot run in the same
 * web/ folder; a second port needs its own checkout (worktree) or an already running server there.
 */
const PORT = Number(process.env.PW_PORT || 3200);
const baseURL = `http://localhost:${PORT}`;

/**
 * Uploaded test files (label photos, visit recordings, her reminder clips) go to a folder under the OS temp dir,
 * one per PW_PORT, unless the run sets BLOB_LOCAL_DIR itself: e2e runs never write into web/.data and nothing needs
 * cleaning afterwards. Set here on process.env, so the dev server Playwright starts (webServer inherits the
 * environment) and the test workers (e2e/blob-upload.spec.ts reads the same variable) agree on the folder.
 * Only the local blob driver reads it (lib/blob localBlobDir); BLOB_DRIVER=supabase ignores it.
 */
if (!process.env.BLOB_LOCAL_DIR?.trim()) process.env.BLOB_LOCAL_DIR = path.join(os.tmpdir(), "ripple-e2e", `blob-${PORT}`);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
