/**
 * The account layer's part of the start-up check (instrumentation.ts, track A; docs/plan/real-app.md 3.4, 3.12). A real
 * deployment (RIPPLE_DEPLOYED=1) does not start when:
 *   - the foundation's rules say so (lib/dev/enabled.ts deployProblems: RIPPLE_DEV_TOOLS=1, which carries the test clock
 *     and the developer routes; AUTH_PROVIDER=memory or no provider; SPEECH_PROVIDER=devfake);
 *   - RIPPLE_TEST_CLOCK is set at all (the test clock belongs to the developer tools only);
 *   - AUTH_PROVIDER=supabase lacks SUPABASE_URL, SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY;
 *   - AUTH_COOKIE_SECRET, RATE_LIMIT_SALT or RECOVERY_PEPPER is missing, short, or the development value
 *     (lib/auth/secrets.ts).
 * Anywhere else (next dev, the tests, the recording build) nothing here stops the server. Server-only; no imports that
 * touch the Edge runtime.
 */
import { deployProblems, effectiveAuthProvider, isDeployed, type Env } from "@/lib/dev/enabled";
import { secretProblems } from "./secrets";

/** Everything that keeps this deployment from starting (empty: start). */
export function authDeployProblems(env: Env = process.env): string[] {
  if (!isDeployed(env)) return [];
  const out = [...deployProblems(env)];
  if ((env.RIPPLE_TEST_CLOCK ?? "").trim()) out.push("RIPPLE_TEST_CLOCK is set (the test clock is a developer tool)");
  if (effectiveAuthProvider(env) === "supabase") {
    for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_ANON_KEY"]) if (!(env[name] ?? "").trim()) out.push(`${name} is not set (AUTH_PROVIDER=supabase)`);
  }
  out.push(...secretProblems(env));
  return out;
}

/** Stop the process (exit 1) when this deployment is unsafe; the reasons go to the log, never a value. */
export function refuseUnsafeAuthStart(env: Env = process.env, exit: (code: number) => void = (code) => process.exit(code)): void {
  const problems = authDeployProblems(env);
  if (!problems.length) return;
  console.error(`[ripple] Refusing to start a deployment (RIPPLE_DEPLOYED=1): ${problems.join("; ")}`);
  exit(1);
}
