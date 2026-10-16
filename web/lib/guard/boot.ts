/**
 * Track L's part of the start-up check (instrumentation.ts; lib/dev/startup.ts and lib/auth/boot.ts are the other two).
 * A real deployment (RIPPLE_DEPLOYED=1) does not start when the per-IP limits could not tell one visitor from another:
 *   - TRUSTED_PROXY_HOPS is not set: with the default (0) the client is whoever connected to the app, and behind
 *     Caddy that is Caddy for every visitor, so ten judges opening the demo would use up the whole site's hour
 *     (docs/plan/real-app.md 3.5). The hosting plan's server sits behind Caddy: 1. A server reached directly says 0 on
 *     purpose.
 *   - EDGE_SECRET is set but shorter than 32 characters (it would be ignored: lib/guard/client-ip.ts).
 * Anywhere else (next dev, the tests, the recording build) nothing here stops the server. The rule in force is logged
 * once on a deployment, by names only.
 */
import { isDeployed, type Env } from "@/lib/dev/enabled";
import { clientAddressRule, MIN_EDGE_SECRET } from "./client-ip";

const val = (env: Env, name: string) => (env[name] ?? "").trim();

/** Everything that keeps this deployment from starting (empty: start). */
export function guardDeployProblems(env: Env = process.env): string[] {
  if (!isDeployed(env)) return [];
  const out: string[] = [];
  const hops = val(env, "TRUSTED_PROXY_HOPS");
  if (!hops) out.push("TRUSTED_PROXY_HOPS is not set (how many reverse proxies of ours are in front: 1 behind Caddy, 0 when the server is reached directly)");
  else if (!/^[0-8]$/.test(hops)) out.push("TRUSTED_PROXY_HOPS must be a number from 0 to 8");
  const secret = val(env, "EDGE_SECRET");
  if (secret && secret.length < MIN_EDGE_SECRET) out.push(`EDGE_SECRET is shorter than ${MIN_EDGE_SECRET} characters`);
  return out;
}

/** Stop the process (exit 1) when this deployment's limits could not work; the reasons go to the log, never a value. */
export function refuseUnsafeGuardStart(env: Env = process.env, exit: (code: number) => void = (code) => process.exit(code)): void {
  if (!isDeployed(env)) return;
  const problems = guardDeployProblems(env);
  if (problems.length) {
    console.error(`[ripple] Refusing to start a deployment (RIPPLE_DEPLOYED=1): ${problems.join("; ")}`);
    exit(1);
    return;
  }
  console.info(`[ripple] ${clientAddressRule(env)}`);
}
