/**
 * Which value of each model key this process is using: the one in web/.env, or one from the shell or the Windows
 * user environment that overrides it. `node --env-file=.env` and Next's @next/env both let an already-set variable
 * win, so a stale or leaked key in the user environment silently replaces web/.env's (round-2 check, 10-09: tonight's
 * live numbers ran on the user-environment key until a shell unset it). Prints names and set / same / differs only,
 * never a value or a hash.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/llm/env-check.ts            (what a plain shell would use)
 *   env -u HUNYUAN_API_KEY node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/llm/...   (use web/.env's key)
 *
 * The model is Tencent Cloud Hunyuan on TokenHub since 10-16: its key is HUNYUAN_API_KEY (lib/llm/hunyuan.ts).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { webRoot } from "@/lib/llm/root";

/** The model keys lib/llm reads (Hunyuan's TokenHub key, a separate checker key, OpenAI's). */
export const KEY_NAMES = ["HUNYUAN_API_KEY", "CHECKER_API_KEY", "OPENAI_API_KEY"] as const;

/** KEY=value lines of a .env file (no expansion; quotes stripped). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export type KeySource = "not set" | "web/.env" | "environment only" | "environment, DIFFERS from web/.env";

/**
 * Where `name`'s value in `env` comes from. `fileValues` are the values parsed from web/.env. When the process was
 * started with --env-file, a value equal to the file's is reported as web/.env.
 */
export function keySource(name: string, env: Record<string, string | undefined>, fileValues: Record<string, string>): KeySource {
  const live = env[name];
  const file = fileValues[name];
  if (!live) return "not set";
  if (!file) return "environment only";
  const h = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return h(live).equals(h(file)) ? "web/.env" : "environment, DIFFERS from web/.env";
}

/** One line per key name: "HUNYUAN_API_KEY: web/.env" etc. */
export function keySourceLines(env: Record<string, string | undefined> = process.env, file = path.join(webRoot(), ".env")): string[] {
  const values = existsSync(file) ? parseEnvFile(readFileSync(file, "utf8")) : {};
  return KEY_NAMES.map((n) => `${n}: ${keySource(n, env, values)}`);
}

if (/[\\/]scripts[\\/]llm[\\/]env-check\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  for (const line of keySourceLines()) console.log(line);
}
