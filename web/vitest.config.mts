import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    // The suite often runs next to builds and browsers of other work on the same machine; the tests that read the
    // whole source tree then need more than the default 5 s. A slow test is not a failed one.
    testTimeout: 20_000,
    // the example account's extra everyday rows (lib/story/example-extra.ts, owner 10-15) are off here: the tests read the
    // story template as it is; tests/unit/story/example-extra.test.ts turns them on and checks them
    env: {
      RIPPLE_EXAMPLE_EXTRA: "off",
      // the example account's three more medicines (lib/story/example-meds.ts, scene 3, 10-15): off for the same reason;
      // tests/unit/story/example-meds.test.ts turns them on and checks them
      RIPPLE_EXAMPLE_MEDS: "off",
    },
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      reportsDirectory: "coverage",
    },
  },
});
