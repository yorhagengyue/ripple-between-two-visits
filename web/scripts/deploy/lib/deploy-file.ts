/**
 * The deploy file (web/.env.deploy): reading it, knowing every name in it, checking each value's shape and creating
 * the secrets that can be made on this computer (C2 track P; docs/plan/hosting.md 5.5).
 *
 * Nothing here returns or throws a value of the file: problems are sentences about a name.
 *
 * Which names exist:
 *   - local only (how to reach the server and the two host names): DEPLOY_*;
 *   - the production database's four: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_DB_URL
 *     (the first three also go to the server's web.env; the connection string goes to backup.env and nowhere else);
 *   - backup: BACKUP_*;
 *   - app settings: every name in web/.env.example, unless its line there is marked [not deployed].
 * Anything else in the file is a mistake (a typing error, a retired name such as DEEPSEEK_API_KEY, a test-only switch
 * such as RIPPLE_TEST_CLOCK) and stops every script.
 */
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { generateVapidKeys, vapidPairMatches } from "@/lib/push/crypto";
import { type Args, DeployError, type Output } from "./cli";

export type Values = Record<string, string>;

export interface EnvFile {
  path: string;
  exists: boolean;
  /** name → trimmed value; names with an empty value are not in it */
  values: Values;
  /** every name that has a line, empty or not, in file order */
  names: string[];
  duplicates: string[];
  /** 1-based numbers of lines that are neither empty, a comment, nor NAME=value */
  badLines: number[];
}

export function parseEnvText(text: string, file = ""): EnvFile {
  const names: string[] = [];
  const duplicates: string[] = [];
  const badLines: number[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!m) badLines.push(i + 1);
    else if (names.includes(m[1])) duplicates.push(m[1]);
    else names.push(m[1]);
  });
  const values: Values = {};
  // node:util parseEnv reads the file the way process.loadEnvFile does (quotes, trailing comments), which is how the
  // existing database scripts read web/.env
  for (const [name, value] of Object.entries(parseEnv(text))) {
    const v = (value ?? "").trim();
    if (v) values[name] = v;
  }
  return { path: file, exists: true, values, names, duplicates: [...new Set(duplicates)], badLines };
}

export function readEnvFile(file: string): EnvFile {
  if (!existsSync(file)) return { path: file, exists: false, values: {}, names: [], duplicates: [], badLines: [] };
  return parseEnvText(readFileSync(file, "utf8"), file);
}

// ------------------------------------------------------------------ names

export const SSH_NAMES = ["DEPLOY_HOST", "DEPLOY_USER", "DEPLOY_SSH_KEY"] as const;
export const DOMAIN_NAMES = ["DEPLOY_APP_DOMAIN", "DEPLOY_ORIGIN_DOMAIN"] as const;
/** optional, local only: the SSH port when it is not 22; the address Let's Encrypt may write to about the certificate */
export const LOCAL_OPTIONAL = ["DEPLOY_SSH_PORT", "DEPLOY_ACME_EMAIL"] as const;
export const DB_FOUR = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_DB_URL"] as const;
/** go to /etc/ripple/backup.env together with SUPABASE_DB_URL */
export const BACKUP_ENV_NAMES = ["BACKUP_COS_BUCKET", "BACKUP_COS_REGION", "BACKUP_COS_SECRET_ID", "BACKUP_COS_SECRET_KEY", "BACKUP_HEARTBEAT_URL"] as const;
/** a public key: goes to /etc/ripple/backup.age.pub */
export const BACKUP_RECIPIENT = "BACKUP_AGE_RECIPIENT";
export const BACKUP_NAMES = [...BACKUP_ENV_NAMES, BACKUP_RECIPIENT] as const;

/** Random values this computer can make: 32 random bytes each, written as 43 URL-safe characters. */
export const RANDOM_SECRETS = ["EDGE_SECRET", "BLOB_SIGNING_SECRET", "AUTH_COOKIE_SECRET", "RATE_LIMIT_SALT", "RECOVERY_PEPPER"] as const;
/** The push key pair this computer can make (lib/push/crypto.ts). Changing it later ends every phone's subscription. */
export const VAPID_PAIR = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"] as const;
export const CREATABLE = [...RANDOM_SECRETS, ...VAPID_PAIR] as const;

/** Only the owner has these (an account somewhere else, or a decision). */
export const OWNER_ONLY: Record<string, string> = {
  RIPPLE_DEEPSEEK_API_KEY: "the DeepSeek API key (platform.deepseek.com)",
  AUTH_USERNAME_DOMAIN: "the internal mail domain a username maps to; it cannot change after the first account exists",
  BACKUP_COS_BUCKET: "the private COS bucket for backups, versioning on",
  BACKUP_COS_REGION: "that bucket's region, e.g. ap-singapore",
  BACKUP_COS_SECRET_ID: "the backup sub-account's key id (upload, read, list; no delete)",
  BACKUP_COS_SECRET_KEY: "the backup sub-account's key",
  BACKUP_HEARTBEAT_URL: "the https address the backup check pings when everything is fine",
  BACKUP_AGE_RECIPIENT: "the public half (age1...) of an age key pair made with age-keygen on the owner's computer",
  WHISPER_URL: "https address of the transcription service (only with --speech whisper)",
  WHISPER_TOKEN: "the token shared with the transcription service (only with --speech whisper)",
  TRTC_SDK_APP_ID: "the TRTC application id (only with --tts trtc)",
  TENCENT_SECRET_ID: "a Tencent Cloud API key id (with --speech tencent or --tts trtc; one pair for both)",
  TENCENT_SECRET_KEY: "that key (with --speech tencent or --tts trtc)",
};

const NOT_DEPLOYED_MARK = "[not deployed]";

export interface AppNames {
  /** every NAME= line of .env.example */
  all: string[];
  /** those whose line carries [not deployed] */
  notDeployed: string[];
}

/** The app's variable names, from web/.env.example: one decision per name, made in that file (hosting.md 5.5). */
export function appNamesFrom(exampleText: string): AppNames {
  const all: string[] = [];
  const notDeployed: string[] = [];
  for (const raw of exampleText.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(raw);
    if (!m || all.includes(m[1])) continue;
    all.push(m[1]);
    if (raw.includes(NOT_DEPLOYED_MARK)) notDeployed.push(m[1]);
  }
  return { all, notDeployed };
}

export function readAppNames(webDir: string): AppNames {
  const file = path.join(webDir, ".env.example");
  if (!existsSync(file)) throw new DeployError("web/.env.example is missing: the list of app settings comes from it");
  return appNamesFrom(readFileSync(file, "utf8"));
}

/** Names the deploy file may hold although the app never gets them (the scripts use them, or they go to another file). */
export function fileOnlyNames(): string[] {
  return [...SSH_NAMES, ...DOMAIN_NAMES, ...LOCAL_OPTIONAL, ...BACKUP_NAMES, "SUPABASE_DB_URL"];
}

/** What is wrong with the file's names: unknown ones, duplicates, lines that are not NAME=value, forbidden ones. */
export function nameProblems(file: EnvFile, app: AppNames): string[] {
  const out: string[] = [];
  const allowedHere = new Set(fileOnlyNames());
  const known = new Set([...app.all, ...allowedHere]);
  for (const n of file.badLines) out.push(`line ${n} is not NAME=value`);
  for (const name of file.duplicates) out.push(`${name} appears more than once`);
  for (const name of file.names) {
    if (!known.has(name)) out.push(`${name} is not a name these scripts know (a typing mistake, a retired name or a test-only switch); remove it`);
    else if (app.notDeployed.includes(name) && !allowedHere.has(name) && file.values[name]) out.push(`${name} is marked [not deployed] in web/.env.example and has a value; remove it`);
  }
  return out;
}

// ------------------------------------------------------------------ shapes

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function isHostname(v: string): boolean {
  return HOSTNAME.test(v);
}

export function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

/** The project reference in https://<ref>.supabase.co, or null. */
export function projectRefOfUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = /^([a-z0-9]{15,40})\.supabase\.(co|in|red)$/.exec(u.hostname);
    return u.protocol === "https:" && m ? m[1] : null;
  } catch {
    return null;
  }
}

/** The project reference a connection string names: the pooler's user postgres.<ref>, or the host db.<ref>.supabase.co. */
export function projectRefOfDbUrl(dbUrl: string): string | null {
  try {
    const u = new URL(dbUrl);
    const user = /^[a-z_]+\.([a-z0-9]{15,40})$/.exec(decodeURIComponent(u.username));
    if (user) return user[1];
    const host = /^db\.([a-z0-9]{15,40})\.supabase\.(co|in|red)$/.exec(u.hostname);
    return host ? host[1] : null;
  } catch {
    return null;
  }
}

/** The first 8 hex characters of sha256(text): how a project is named on screen without naming it. */
export function sha8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
}

/** What a Supabase API key is, read from the key itself (never printed): its role, or null when it cannot be told. */
export function keyRole(key: string): "publishable" | "secret" | null {
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const role = (JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: unknown }).role;
    if (role === "anon") return "publishable";
    if (role === "service_role") return "secret";
  } catch {
    // not a JWT
  }
  return null;
}

/** Two addresses of the same thing: compared without case, surrounding space or a trailing slash. */
export function sameAddress(a: string | undefined, b: string | undefined): boolean {
  const norm = (s: string) => s.trim().replace(/\/+$/, "").toLowerCase();
  return !!a && !!b && norm(a) === norm(b);
}

/** Problems with one value's shape (null: fine, or not a name with a shape rule). Never contains the value. */
export function shapeProblem(name: string, v: string, all: Values): string | null {
  switch (name) {
    case "DEPLOY_HOST":
      return IPV4.test(v) || isHostname(v) ? null : "is not an IPv4 address or a host name";
    case "DEPLOY_USER":
      return /^[a-z_][a-z0-9_-]{0,31}$/.test(v) ? null : "is not a Linux user name";
    case "DEPLOY_SSH_KEY":
      return existsSync(expandHome(v)) ? null : "names a file that does not exist on this computer";
    case "DEPLOY_SSH_PORT":
      return /^\d{1,5}$/.test(v) && Number(v) > 0 && Number(v) < 65536 ? null : "is not a port number";
    case "DEPLOY_ACME_EMAIL":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "is not an e-mail address";
    case "DEPLOY_APP_DOMAIN":
    case "DEPLOY_ORIGIN_DOMAIN": {
      if (!isHostname(v)) return "is not a host name (lower case, no https://, no path)";
      const other = name === "DEPLOY_APP_DOMAIN" ? all.DEPLOY_ORIGIN_DOMAIN : all.DEPLOY_APP_DOMAIN;
      return other && other === v ? "is the same as the other host name: the public name and the origin name must differ" : null;
    }
    case "AUTH_USERNAME_DOMAIN":
      return isHostname(v) ? null : "is not a host name";
    case "SUPABASE_URL":
      return projectRefOfUrl(v) ? null : "is not https://<project>.supabase.co";
    case "SUPABASE_DB_URL": {
      let u: URL;
      try {
        u = new URL(v);
      } catch {
        return "is not a connection string";
      }
      if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return "does not start with postgres:// or postgresql://";
      if (!u.password) return "has no password in it";
      if (/^db\./.test(u.hostname)) return "is the direct address (db.<project>...), which is IPv6 only: use the Session pooler string";
      const ref = projectRefOfDbUrl(v);
      if (!ref) return "does not name a project (the pooler's user is postgres.<project>)";
      const apiRef = all.SUPABASE_URL ? projectRefOfUrl(all.SUPABASE_URL) : null;
      return apiRef && apiRef !== ref ? "names another project than SUPABASE_URL" : null;
    }
    case "SUPABASE_ANON_KEY":
      if (all.SUPABASE_SERVICE_KEY && all.SUPABASE_SERVICE_KEY === v) return "is the same as SUPABASE_SERVICE_KEY";
      return keyRole(v) === "secret" ? "is a secret (service) key: the publishable key belongs here" : null;
    case "SUPABASE_SERVICE_KEY":
      return keyRole(v) === "publishable" ? "is a publishable (anon) key: the secret key belongs here" : null;
    case "EDGE_SECRET":
      // it travels in a request header and through Caddy's configuration: letters, digits, - and _ only
      return /^[A-Za-z0-9_-]{32,}$/.test(v) ? null : "must be 32 or more characters of letters, digits, - and _";
    case "BLOB_SIGNING_SECRET":
    case "AUTH_COOKIE_SECRET":
    case "RATE_LIMIT_SALT":
    case "RECOVERY_PEPPER":
      return v.length >= 32 ? null : "is shorter than 32 characters";
    case "VAPID_PUBLIC_KEY":
    case "VAPID_PRIVATE_KEY": {
      if (!all.VAPID_PUBLIC_KEY || !all.VAPID_PRIVATE_KEY) return "is one half of a pair whose other half is missing";
      return vapidPairMatches({ publicKey: all.VAPID_PUBLIC_KEY, privateKey: all.VAPID_PRIVATE_KEY }) ? null : "does not belong to the other half of the pair";
    }
    case "VAPID_SUBJECT":
      return /^(mailto:\S+@\S+|https:\/\/\S+)$/.test(v) ? null : "must start with mailto: or https://";
    case "BACKUP_AGE_RECIPIENT":
      return /^age1[ac-hj-np-z02-9]{58}$/.test(v) ? null : "is not an age public key (age1 followed by 58 characters)";
    case "BACKUP_HEARTBEAT_URL":
      try {
        return new URL(v).protocol === "https:" ? null : "is not an https:// address";
      } catch {
        return "is not an https:// address";
      }
    case "BACKUP_COS_BUCKET":
      return /^[a-z0-9][a-z0-9-]{0,48}-\d{6,}$/.test(v) ? null : "is not a COS bucket name (<name>-<appid>)";
    case "BACKUP_COS_REGION":
      return /^[a-z]{2}-[a-z]+(-\d+)?$/.test(v) ? null : "is not a region name like ap-singapore";
    case "BACKUP_COS_SECRET_ID":
    case "BACKUP_COS_SECRET_KEY":
    case "RIPPLE_DEEPSEEK_API_KEY":
      return /\s/.test(v) ? "has white space in it" : null;
    default:
      return null;
  }
}

// ------------------------------------------------------------------ the two files a script works with

export interface DeployContext {
  webDir: string;
  deploy: EnvFile;
  /** the test project's file (web/.env): only ever compared with, never used */
  test: EnvFile;
  app: AppNames;
}

/**
 * Read the deploy file and the test file, and teach the output to hide both. Stops when the deploy file is missing or
 * has a name problem: every script starts here, so a mistyped name stops all of them.
 */
export function loadContext(args: Args, webDir: string, out: Output): DeployContext {
  const deployPath = path.resolve(args.value("deploy-file") ?? path.join(webDir, ".env.deploy"));
  const testPath = path.resolve(args.value("test-env") ?? path.join(webDir, ".env"));
  const deploy = readEnvFile(deployPath);
  if (!deploy.exists) throw new DeployError(`no deploy file (${args.value("deploy-file") ? "--deploy-file" : "web/.env.deploy"}): the owner fills it in first (scripts/deploy/README.md)`);
  const test = readEnvFile(testPath);
  out.hide(deploy.values);
  out.hide(test.values, (name) => `<test ${name}>`);
  const app = readAppNames(webDir);
  const problems = nameProblems(deploy, app);
  if (problems.length) throw new DeployError(`the deploy file has ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  return { webDir, deploy, test, app };
}

/** Stop unless every one of these names has a well-formed value. */
export function requireNames(ctx: DeployContext, names: readonly string[], what: string): void {
  const v = ctx.deploy.values;
  const missing = names.filter((n) => !v[n]);
  const bad = names.filter((n) => v[n]).flatMap((n) => {
    const p = shapeProblem(n, v[n], v);
    return p ? [`${n} ${p}`] : [];
  });
  if (!missing.length && !bad.length) return;
  const lines = [...missing.map((n) => `${n} is not set${OWNER_ONLY[n] ? ` (the owner supplies it: ${OWNER_ONLY[n]})` : (CREATABLE as readonly string[]).includes(n) ? " (it is created on first use with --yes, or by check-env --create-secrets)" : ""}`), ...bad];
  throw new DeployError(`${what} needs the deploy file to have:\n${lines.map((l) => `  - ${l}`).join("\n")}`);
}

/**
 * The production database must not be the test one: refuses when the deploy file's API address or connection string
 * equals web/.env's, or names the same project. Returns a note when there is no test file to compare with.
 */
export function refuseTestDatabase(ctx: DeployContext): string | null {
  const prod = ctx.deploy.values;
  const test = ctx.test.values;
  if (!ctx.test.exists) return "no test file to compare with (web/.env not found): could not check that this is not the test project";
  const prodRefs = [prod.SUPABASE_URL ? projectRefOfUrl(prod.SUPABASE_URL) : null, prod.SUPABASE_DB_URL ? projectRefOfDbUrl(prod.SUPABASE_DB_URL) : null].filter(Boolean);
  const testRefs = [test.SUPABASE_URL ? projectRefOfUrl(test.SUPABASE_URL) : null, test.SUPABASE_DB_URL ? projectRefOfDbUrl(test.SUPABASE_DB_URL) : null].filter(Boolean);
  if (sameAddress(prod.SUPABASE_URL, test.SUPABASE_URL)) throw new DeployError("SUPABASE_URL in the deploy file is the test project's (the same as web/.env): production must be another project");
  if (sameAddress(prod.SUPABASE_DB_URL, test.SUPABASE_DB_URL)) throw new DeployError("SUPABASE_DB_URL in the deploy file is the test database's (the same as web/.env): production must be another database");
  if (prod.SUPABASE_SERVICE_KEY && prod.SUPABASE_SERVICE_KEY === test.SUPABASE_SERVICE_KEY) throw new DeployError("SUPABASE_SERVICE_KEY in the deploy file is the test project's key (the same as web/.env)");
  if (prodRefs.some((r) => testRefs.includes(r))) throw new DeployError("the deploy file names the same Supabase project as web/.env (the test project): production must be another project");
  return null;
}

// ------------------------------------------------------------------ secrets made here

/** Which creatable names are missing from the file (a pair counts as missing when either half is). */
export function missingCreatable(values: Values, wanted: readonly string[] = CREATABLE): string[] {
  const out: string[] = wanted.filter((n) => (RANDOM_SECRETS as readonly string[]).includes(n) && !values[n]);
  if (wanted.some((n) => (VAPID_PAIR as readonly string[]).includes(n)) && !values.VAPID_PUBLIC_KEY && !values.VAPID_PRIVATE_KEY) out.push(...VAPID_PAIR);
  return out;
}

/**
 * Create the missing ones of `wanted` and append them to the deploy file. Returns the names created; the values are
 * never returned or printed. An existing value is never replaced, and half a key pair is left for the owner to sort out.
 */
export function createSecrets(file: EnvFile, wanted: readonly string[] = CREATABLE, today = new Date().toISOString().slice(0, 10)): string[] {
  const names = missingCreatable(file.values, wanted);
  if (!names.length) return [];
  const lines: string[] = [];
  for (const name of names) {
    if ((RANDOM_SECRETS as readonly string[]).includes(name)) lines.push(`${name}=${randomBytes(32).toString("base64url")}`);
  }
  if (names.includes("VAPID_PUBLIC_KEY")) {
    const pair = generateVapidKeys();
    lines.push(`VAPID_PUBLIC_KEY=${pair.publicKey}`, `VAPID_PRIVATE_KEY=${pair.privateKey}`);
  }
  const before = readFileSync(file.path, "utf8");
  const block = `${before.endsWith("\n") || before === "" ? "" : "\n"}# created by web/scripts/deploy on ${today}; never commit, never paste anywhere but where the README says\n${lines.join("\n")}\n`;
  appendFileSync(file.path, block, { encoding: "utf8" });
  return names;
}

/**
 * The first-use rule for a script that needs some creatable secrets: with --yes they are created and the context is
 * read again; otherwise the plan says which would be created. Returns the names (created, or that would be).
 */
export function ensureSecrets(ctx: DeployContext, wanted: readonly string[], act: boolean, out: Output): string[] {
  const missing = missingCreatable(ctx.deploy.values, wanted);
  if (!missing.length || !act) return missing;
  createSecrets(ctx.deploy, wanted);
  const again = readEnvFile(ctx.deploy.path);
  ctx.deploy = again;
  out.hide(again.values);
  return missing;
}
