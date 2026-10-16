/**
 * Shared helpers for web/scripts/db/*.mjs: load web/.env, open a pg client on SUPABASE_DB_URL
 * (the session pooler string), and keep secrets out of every message.
 *
 * Nothing here prints the connection string, the host, the user or the password. Errors are reduced
 * to the Postgres error code and a message with anything that looks like a URL or a host removed.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Load web/.env into process.env (values already set in the environment win). */
export function loadEnv() {
  const file = path.join(WEB, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

/** Error text that is safe to print: no URLs, hosts, users or passwords. */
export function safeError(err) {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  let msg = err instanceof Error ? err.message : String(err);
  const secrets = [process.env.SUPABASE_DB_URL, process.env.SUPABASE_SERVICE_KEY, process.env.SUPABASE_ANON_KEY]
    .filter((s) => s && s.length > 6);
  for (const s of secrets) msg = msg.split(s).join("<redacted>");
  try {
    const u = new URL(process.env.SUPABASE_DB_URL ?? "");
    for (const part of [u.password, u.username, u.hostname, decodeURIComponent(u.password)]) {
      if (part && part.length > 3) msg = msg.split(part).join("<redacted>");
    }
  } catch {
    /* no URL */
  }
  msg = msg.replace(/postgres(ql)?:\/\/\S+/gi, "<redacted-url>").replace(/\b[\w.-]+\.(supabase\.(co|com)|pooler\.\S+)\b/gi, "<redacted-host>");
  return code ? `${code}: ${msg}` : msg;
}

/** A connected pg client on SUPABASE_DB_URL. Throws a secret-free error when it is not set. */
export async function connect() {
  loadEnv();
  const raw = (process.env.SUPABASE_DB_URL ?? "").trim();
  if (!raw) throw new Error("SUPABASE_DB_URL not set (web/.env)");
  let connectionString = raw;
  try {
    // sslmode in the URL would override the ssl option below; the pooler always speaks TLS.
    const u = new URL(raw);
    u.searchParams.delete("sslmode");
    connectionString = u.toString();
  } catch {
    throw new Error("SUPABASE_DB_URL is not a valid URL");
  }
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    application_name: "ripple-web-scripts",
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(`could not connect to the database (${safeError(err)})`);
  }
  return client;
}
