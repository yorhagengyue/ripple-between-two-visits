/**
 * When the developer tools may run, and when the server must refuse to start. Server-only; no imports, so the proxy,
 * instrumentation.ts and every route can use it.
 *
 * Developer tools: POST /api/dev/** (the test clock, a tick of the scheduled jobs, test accounts), the process-wide test
 * clock (lib/time/now.ts) and SPEECH_PROVIDER=devfake (lib/asr). They are on when
 *   NODE_ENV !== "production"            (next dev, vitest, scripts), or
 *   RIPPLE_DEV_TOOLS === "1"             (a production build the integrator records the journeys on: next build +
 *                                         next start on this machine, with the flag set on purpose).
 * Otherwise they refuse: the routes answer 404 as if they did not exist, setting the clock throws, devfake throws.
 *
 * A real deployment (RIPPLE_DEPLOYED === "1", set only on the hosting server) must never run with any of
 *   RIPPLE_DEV_TOOLS=1, AUTH_PROVIDER=memory (or no provider, which falls back to memory), SPEECH_PROVIDER=devfake:
 * assertDeployable() throws, and instrumentation.ts stops the server before it answers anything.
 */

export type Env = Record<string, string | undefined>;

const val = (env: Env, name: string) => (env[name] ?? "").trim();

/** Are the developer tools on for this process? */
export function devToolsEnabled(env: Env = process.env): boolean {
  return val(env, "NODE_ENV") !== "production" || val(env, "RIPPLE_DEV_TOOLS") === "1";
}

/** Is this the real hosting server? */
export function isDeployed(env: Env = process.env): boolean {
  return val(env, "RIPPLE_DEPLOYED") === "1";
}

/**
 * The identity provider this environment would use (lib/auth/provider.ts reads the same rule): AUTH_PROVIDER when it
 * is set, else supabase when the project's keys are there, else the in-memory one.
 */
export function effectiveAuthProvider(env: Env = process.env): string {
  const raw = val(env, "AUTH_PROVIDER").toLowerCase();
  if (raw) return raw;
  return val(env, "SUPABASE_URL") && val(env, "SUPABASE_SERVICE_KEY") && val(env, "SUPABASE_ANON_KEY") ? "supabase" : "memory";
}

/** What would make this deployment unsafe (empty when it is not a deployment, or when it is fine). */
export function deployProblems(env: Env = process.env): string[] {
  if (!isDeployed(env)) return [];
  const problems: string[] = [];
  if (val(env, "RIPPLE_DEV_TOOLS") === "1") problems.push("RIPPLE_DEV_TOOLS=1 (developer tools on a real deployment)");
  if (effectiveAuthProvider(env) === "memory") problems.push("AUTH_PROVIDER=memory (anyone could mint a session)");
  if (val(env, "SPEECH_PROVIDER").toLowerCase() === "devfake") problems.push("SPEECH_PROVIDER=devfake (a test transcript, not his visit)");
  return problems;
}

export class UnsafeDeployment extends Error {
  constructor(readonly problems: string[]) {
    super(`Refusing to start a deployment (RIPPLE_DEPLOYED=1) with ${problems.join("; ")}`);
    this.name = "UnsafeDeployment";
  }
}

/** Throws UnsafeDeployment when RIPPLE_DEPLOYED=1 comes with a developer tool or an unsafe provider. */
export function assertDeployable(env: Env = process.env): void {
  const problems = deployProblems(env);
  if (problems.length) throw new UnsafeDeployment(problems);
}

/** Throws when the developer tools are off (the caller is a developer tool that must not run here). */
export function assertDevTools(what: string, env: Env = process.env): void {
  if (!devToolsEnabled(env)) throw new Error(`${what} is a developer tool: off unless NODE_ENV is not production or RIPPLE_DEV_TOOLS=1`);
  assertDeployable(env);
}
