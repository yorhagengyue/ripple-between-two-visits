/**
 * The server's start-up check (instrumentation.ts runs it once, in the Node.js runtime, before the server answers
 * anything). A real deployment (RIPPLE_DEPLOYED=1) with RIPPLE_DEV_TOOLS=1, AUTH_PROVIDER=memory (or no provider) or
 * SPEECH_PROVIDER=devfake stops here with exit code 1 (lib/dev/enabled.ts assertDeployable); everything else starts as
 * before. Its own module, loaded only for the Node.js runtime: Next.js also builds instrumentation.ts for the Edge
 * runtime, where process.exit does not exist. Server-only.
 */
import { assertDeployable, type Env } from "./enabled";

export function refuseUnsafeStart(env: Env = process.env, exit: (code: number) => void = (code) => process.exit(code)): void {
  try {
    assertDeployable(env);
  } catch (err) {
    console.error(`[ripple] ${err instanceof Error ? err.message : String(err)}`);
    exit(1);
  }
}
