#!/usr/bin/env node
/**
 * Fetch five PriMock57 consultations (github.com/babylonhealth/primock57, CC BY 4.0) for the
 * "real recording" work: Whisper accuracy against the human transcripts, and the
 * "try it with a real recording" demo.
 *
 *   cd web && node scripts/data/fetch_primock57.mjs              fetch, verify, mix, write the manifest
 *   cd web && node scripts/data/fetch_primock57.mjs --dry-run    resolve the commit, read the LFS pointers, print sizes
 *   cd web && node scripts/data/fetch_primock57.mjs --check      no network: verify every local file against the manifest
 *   options: --ids day1_consultation06,day3_consultation08   (default: the five below)
 *            --manifest <file.json>                           (required with --ids other than the five: where that
 *                                                              selection's manifest goes; never the committed one)
 *            --ref <branch|tag|40-hex commit>                 (default: main, resolved to a commit and pinned)
 *            --no-gh                                          (do not ask the GitHub CLI for its login token)
 *
 * The committed fixtures/real/primock57.manifest.json describes exactly the five default consultations (the
 * attribution file and the tests name them), so a run with other --ids must write its manifest elsewhere
 * (--manifest); it is refused before anything is fetched otherwise (exit 2).
 *
 * GitHub token: GH_TOKEN, then GITHUB_TOKEN, then `gh auth token` (the GitHub CLI's stored login). Without any,
 * the API allows 60 requests an hour and one run makes 14 of them. A token the API rejects (HTTP 401) is dropped
 * and the run carries on without it (the repository is public).
 *
 * What it does, per consultation:
 *  1. Reads each audio file's Git LFS pointer through the GitHub contents API at the pinned commit
 *     (the pointer blob is checked against its git blob sha1) and parses it strictly.
 *  2. Downloads the audio from media.githubusercontent.com at the same commit, streaming to a .part file
 *     while hashing; the size and sha256 must equal the pointer, then the file is renamed into place.
 *     A file already on disk with the right size and sha256 is kept and not downloaded again.
 *  3. Downloads the two human transcripts (Praat TextGrid) and the clinician's note (JSON) from
 *     raw.githubusercontent.com at the same commit; each must match the size and git blob sha1 that the
 *     contents API lists for it.
 *  4. Writes two derived files: a mono 16 kHz 16-bit WAV with the doctor and patient channels summed
 *     (the shorter channel zero-padded, one gain for the whole file so nothing clips), and a JSON list of
 *     the human-transcribed utterances in the shape of fixtures/visits/*.utterances.json. A derived file
 *     already on disk with the same bytes is left alone (not rewritten).
 *  5. Writes fixtures/real/primock57.manifest.json (ids, files, sizes, sha256, source URLs, licence), again
 *     only when its bytes change.
 *
 * Everything downloaded lives in web/.data/real/primock57/ (gitignored; audio is never committed).
 * Downloaded files are untrusted data: they are parsed as bytes / text with size limits and never
 * imported, required or executed. The script prints no token: it only reports "set (<where from>)" or
 * "not set", and the token is only sent to api.github.com.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const OWNER = "babylonhealth";
export const REPO = "primock57";
export const REPO_URL = `https://github.com/${OWNER}/${REPO}`;
export const API_BASE = `https://api.github.com/repos/${OWNER}/${REPO}`;
export const MEDIA_BASE = `https://media.githubusercontent.com/media/${OWNER}/${REPO}`;
export const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${REPO}`;

/** Relative to web/, forward slashes (they go into the manifest). */
export const LOCAL_ROOT_REL = ".data/real/primock57";
export const MANIFEST_REL = "fixtures/real/primock57.manifest.json";
export const ATTRIBUTION_REL = "fixtures/real/PRIMOCK57-ATTRIBUTION.md";
export const SCRIPT_REL = "scripts/data/fetch_primock57.mjs";

export const LICENCE = Object.freeze({
  id: "CC-BY-4.0",
  name: "Creative Commons Attribution 4.0 International",
  url: "https://creativecommons.org/licenses/by/4.0/",
  legalcode: "https://creativecommons.org/licenses/by/4.0/legalcode",
});

export const DATASET = Object.freeze({
  name: "PriMock57",
  title: "PriMock57: A Dataset Of Primary Care Mock Consultations",
  creator: "Babylon Health",
  authors: ["Alex Papadopoulos Korfiatis", "Francesco Moramarco", "Radmila Sarac", "Aleksandar Savkov"],
  year: 2022,
  venue: "Proceedings of the 60th Annual Meeting of the Association for Computational Linguistics (ACL 2022)",
  paper: "https://arxiv.org/abs/2204.00333",
  related_paper: "https://arxiv.org/abs/2204.00447",
  repository: REPO_URL,
  nature:
    "Mock primary-care consultations: Babylon clinicians consulting Babylon employees who acted as patients from case cards. Not real patient data.",
});

/**
 * The credit any screen must show next to PriMock57 material (CC BY 4.0, section 3(a)(1)): creator, the short
 * citation with the first author's full surname, a link to the source, the licence name with a link to it, that
 * it is a mock consultation, and the change we made (channel mixing). Both links are spelled out in the text so the
 * line still complies where nothing can be clicked (filming mode, screenshots, a printed page); a screen that can
 * link should also make the dataset name link to `source_url` and "CC BY 4.0" link to `licence_url`.
 * The manifest carries the same object (`credit`), so client code can read it from JSON instead of importing this
 * Node script; fixtures/real/PRIMOCK57-ATTRIBUTION.md quotes `en` and `zh` verbatim (tests check all three agree).
 */
export const CREDIT = Object.freeze({
  short_citation: "Papadopoulos Korfiatis et al., 2022",
  source_url: REPO_URL,
  licence_name: "CC BY 4.0",
  licence_url: LICENCE.url,
  en:
    "Recording: PriMock57 (Babylon Health; Papadopoulos Korfiatis et al., 2022), https://github.com/babylonhealth/primock57, " +
    "licensed under CC BY 4.0, https://creativecommons.org/licenses/by/4.0/. " +
    "A mock consultation, not a real patient. Doctor and patient channels mixed into one track by Ripple.",
  zh:
    "录音：PriMock57（Babylon Health；Papadopoulos Korfiatis 等，2022），https://github.com/babylonhealth/primock57 ，" +
    "许可证 CC BY 4.0，https://creativecommons.org/licenses/by/4.0/ 。" +
    "这是门诊模拟，不是真病人。医生和病人两条声道由 Ripple 混成一条。",
});

/**
 * One consultation from each of the five recording days. Picked for clear clinician instructions
 * (medicines, tests, reviews, when to come back) that the card extraction can quote.
 */
export const DEFAULT_SELECTION = Object.freeze({
  day1_consultation06:
    "Long-term condition on several regular medicines; the clinician changes a dose, orders tests and books a review.",
  day2_consultation02:
    "New problem; the clinician plans a medicine, blood tests and a review, and says when to get in touch sooner.",
  day3_consultation08:
    "Patient with diabetes and high blood pressure on regular medicines, seen for a cough; closest to Ripple's own patient.",
  day4_consultation07:
    "Viral illness; safety-netting advice and when to come back for review.",
  day5_consultation08:
    "Asthma flare; the clinician gives inhaler, peak-flow and review instructions with numbers.",
});
export const DEFAULT_IDS = Object.freeze(Object.keys(DEFAULT_SELECTION));

export const CHANGES = Object.freeze([
  "Selected 5 of the 57 consultations (one per recording day); the other 52 are not used.",
  "Mixed the separate doctor and patient channel WAVs of each consultation into one mono 16 kHz 16-bit WAV: the shorter channel is zero-padded at the end, the two are summed, and one gain for the whole file (listed per consultation in this manifest, 1 when the sum already fits) keeps every sample inside the 16-bit range, so no sample is clipped. The original channel files are kept unchanged.",
  "Converted the two Praat TextGrid transcripts of each consultation into one JSON list of utterances (start and end in milliseconds, speaker from the file name, transcriber tags removed in `text` and kept in `text_raw`, intervals with no words left out). The original TextGrid files are kept unchanged.",
]);

/** Limits for untrusted input. */
export const LIMITS = Object.freeze({
  pointerBytes: 1024,
  wavBytes: 100 * 1024 * 1024,
  textGridBytes: 2 * 1024 * 1024,
  noteBytes: 64 * 1024,
  licenceBytes: 64 * 1024,
  apiJsonBytes: 1024 * 1024,
});

export const CONSULTATION_ID = /^day([1-5])_consultation(0[1-9]|1[0-5])$/;
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const USER_AGENT = "ripple-web-fetch-primock57";

// ---------------------------------------------------------------------------------------------
// small helpers

export class FetchError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, retryable?: boolean, retryAfterMs?: number }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = "FetchError";
    this.status = opts.status ?? 0;
    this.retryable = opts.retryable ?? false;
    /** The server's own "wait this long" (Retry-After), when it gave one. */
    this.retryAfterMs = opts.retryAfterMs ?? 0;
  }
}

/** @param {string} id */
export function parseConsultationId(id) {
  const m = CONSULTATION_ID.exec(String(id));
  if (!m) throw new Error(`not a PriMock57 consultation id: ${JSON.stringify(String(id)).slice(0, 60)}`);
  return { id: m[0], day: Number(m[1]), consultation: Number(m[2]) };
}

/** @param {Uint8Array} bytes */
export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** git's blob id: sha1("blob <size>\0" + bytes). @param {Uint8Array} bytes */
export function gitBlobSha1(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** @param {number} n */
export function mb(n) {
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Forward-slash path for the manifest. @param {...string} parts */
function posix(...parts) {
  return path.posix.join(...parts);
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rejects as soon as `signal` aborts, otherwise settles like `promise`.
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal} signal
 * @returns {Promise<T>}
 */
function raceAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** Turn whatever fetch threw into a FetchError (network trouble and timeouts are retryable). @param {unknown} err @param {string} what */
function asFetchError(err, what) {
  if (err instanceof FetchError) return err;
  const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (name === "TimeoutError" || name === "AbortError") return new FetchError(`${what}: timed out (${msg})`, { retryable: true });
  return new FetchError(`${what}: ${msg}`, { retryable: true });
}

/**
 * Run `fn` up to `retries + 1` times while it throws a retryable FetchError.
 * @template T
 * @param {(attempt: number) => Promise<T>} fn
 * @param {{ retries?: number, backoffMs?: number, label?: string, log?: (s: string) => void }} [opts]
 * @returns {Promise<T>}
 */
export async function withRetries(fn, opts = {}) {
  const retries = opts.retries ?? 3;
  const backoffMs = opts.backoffMs ?? 1000;
  const log = opts.log ?? (() => {});
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      const e = asFetchError(err, opts.label ?? "request");
      if (!e.retryable || attempt > retries) throw e;
      const wait = Math.max(backoffMs * 2 ** (attempt - 1), e.retryAfterMs);
      log(`  retry ${attempt}/${retries} after ${wait} ms: ${e.message}`);
      await sleep(wait);
    }
  }
}

/** Status codes worth retrying. @param {number} status */
function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Read a whole response body, refusing more than `maxBytes`.
 * @param {Response} res
 * @param {number} maxBytes
 * @param {AbortSignal} signal
 * @param {string} what
 */
export async function readBodyLimited(res, maxBytes, signal, what) {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new FetchError(`${what}: response is ${declared} bytes, limit ${maxBytes}`);
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new FetchError(`${what}: response exceeds ${maxBytes} bytes`);
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
  return new Uint8Array(Buffer.concat(chunks, total));
}

// ---------------------------------------------------------------------------------------------
// GitHub

/**
 * @typedef {object} Ctx
 * @property {typeof fetch} fetchImpl
 * @property {string} [token]           only sent to api.github.com
 * @property {(s: string) => void} log
 * @property {number} [apiTimeoutMs]
 * @property {number} [retries]
 * @property {number} [backoffMs]
 * @property {number} [apiCalls]        incremented per API request
 * @property {number} [networkBytes]    incremented per byte received
 * @property {boolean} [tokenDropped]   set when the API rejected the token and the run went on without it
 */

/** GitHub token shapes (classic 40-hex, ghp_/gho_/ghs_/ghu_, github_pat_): letters, digits, _ . - only. */
const TOKEN_SHAPE = /^[A-Za-z0-9_.-]{20,255}$/;
/** The longest Retry-After (seconds) worth waiting for inside a run. */
const MAX_RETRY_AFTER_S = 60;
/** API requests one default run makes (commit, licence, 10 pointers, 2 listings). */
export const API_CALLS_PER_RUN = 14;

/**
 * @typedef {object} TokenChoice
 * @property {string | undefined} token
 * @property {"GH_TOKEN" | "GITHUB_TOKEN" | "gh auth token" | null} source
 * @property {string} [note] why there is no token
 */

/**
 * Run a program without a shell and resolve to its stdout (10 s timeout, 64 KB cap, no window, no prompt).
 * @param {string} file @param {string[]} args
 * @returns {Promise<string>}
 */
function execText(file, args) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: 10_000, windowsHide: true, maxBuffer: 64 * 1024, encoding: "utf8", env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
    );
  });
}

/**
 * The token for api.github.com: GH_TOKEN, then GITHUB_TOKEN, then the GitHub CLI's stored login
 * (`gh auth token --hostname github.com`, skipped with useGh: false). A malformed GH_TOKEN / GITHUB_TOKEN is an
 * error (it would otherwise be silently ignored); a missing or unusable gh login just means no token. The value
 * is never part of an error or note.
 * @param {{ env?: Record<string, string | undefined>, exec?: (file: string, args: string[]) => Promise<string>, useGh?: boolean }} [opts]
 * @returns {Promise<TokenChoice>}
 */
export async function resolveGithubToken(opts = {}) {
  const env = opts.env ?? process.env;
  for (const name of /** @type {const} */ (["GH_TOKEN", "GITHUB_TOKEN"])) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") continue;
    const value = raw.trim();
    if (!TOKEN_SHAPE.test(value)) {
      throw new Error(`${name} is set but does not look like a GitHub token (20-255 letters, digits, _ . -); fix or unset it`);
    }
    return { token: value, source: name };
  }
  if (opts.useGh === false) return { token: undefined, source: null, note: "--no-gh" };
  let out;
  try {
    out = await (opts.exec ?? execText)("gh", ["auth", "token", "--hostname", "github.com"]);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    return { token: undefined, source: null, note: code === "ENOENT" ? "GitHub CLI (gh) not found" : "`gh auth token` gave no token" };
  }
  const value = String(out ?? "").trim();
  if (!TOKEN_SHAPE.test(value)) return { token: undefined, source: null, note: "`gh auth token` gave no usable token" };
  return { token: value, source: "gh auth token" };
}

/** The one line printed about the token: where it came from, never its value. @param {TokenChoice} choice */
export function tokenStatusLine(choice) {
  if (choice.token) return `GitHub token: set (${choice.source})`;
  return `GitHub token: not set${choice.note ? ` (${choice.note})` : ""}; without one the GitHub API allows 60 requests an hour and a default run makes ${API_CALLS_PER_RUN}`;
}

/**
 * One request to the GitHub API with the current token (if any).
 * @param {Ctx} ctx @param {string} url @param {AbortSignal} signal @param {string} what
 */
async function apiRequest(ctx, url, signal, what) {
  /** @type {Record<string, string>} */
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
  if (ctx.token) headers.Authorization = `Bearer ${ctx.token}`;
  let res;
  try {
    res = await ctx.fetchImpl(url, { headers, signal, redirect: "follow" });
  } catch (err) {
    throw asFetchError(err, `GitHub API ${what}`);
  }
  ctx.apiCalls = (ctx.apiCalls ?? 0) + 1;
  return res;
}

/**
 * GET a GitHub REST API path under the repo and parse the JSON.
 * A 401 with a token drops the token (for the rest of the run) and asks once more without it. A primary rate
 * limit (remaining 0) stops with the reset time; a secondary one (Retry-After up to 60 s) waits and retries.
 * @param {Ctx} ctx
 * @param {string} pathAndQuery e.g. "contents/audio/x.wav?ref=<sha>"
 */
export async function githubApi(ctx, pathAndQuery) {
  const url = `${API_BASE}/${pathAndQuery}`;
  return withRetries(
    async () => {
      const signal = AbortSignal.timeout(ctx.apiTimeoutMs ?? 30_000);
      let res = await apiRequest(ctx, url, signal, pathAndQuery);
      if (res.status === 401 && ctx.token) {
        await res.body?.cancel().catch(() => {});
        ctx.token = undefined;
        ctx.tokenDropped = true;
        ctx.log("GitHub rejected the token (HTTP 401); carrying on without it (public repository, 60 API requests an hour)");
        res = await apiRequest(ctx, url, signal, pathAndQuery);
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        const limited = res.status === 403 || res.status === 429;
        const remaining = res.headers.get("x-ratelimit-remaining");
        const retryAfter = res.headers.get("retry-after");
        if (limited && remaining === "0") {
          const reset = Number(res.headers.get("x-ratelimit-reset") ?? NaN);
          const when = Number.isFinite(reset)
            ? `${new Date(reset * 1000).toISOString()}, in ${Math.max(0, Math.ceil((reset * 1000 - Date.now()) / 60_000))} min`
            : "later";
          const advice = ctx.token
            ? "this token's hourly quota is used up; wait for the reset"
            : `without a token GitHub allows 60 requests an hour and a default run makes ${API_CALLS_PER_RUN}: log in with \`gh auth login\` (the script then uses \`gh auth token\`), or set GH_TOKEN or GITHUB_TOKEN, or wait`;
          throw new FetchError(`GitHub API rate limit reached (resets ${when}); ${advice}`, { status: res.status });
        }
        if (limited && retryAfter !== null) {
          const s = Number(retryAfter.trim());
          if (retryAfter.trim() !== "" && Number.isFinite(s) && s >= 0 && s <= MAX_RETRY_AFTER_S) {
            throw new FetchError(`GitHub API ${pathAndQuery}: HTTP ${res.status} (secondary rate limit, Retry-After ${s} s)`, {
              status: res.status,
              retryable: true,
              retryAfterMs: s * 1000,
            });
          }
          throw new FetchError(`GitHub API ${pathAndQuery}: HTTP ${res.status}; GitHub asks to wait ${retryAfter.slice(0, 40)} s (secondary rate limit), try again later`, {
            status: res.status,
          });
        }
        throw new FetchError(`GitHub API ${pathAndQuery}: HTTP ${res.status}`, {
          status: res.status,
          retryable: retryableStatus(res.status),
        });
      }
      const body = await readBodyLimited(res, LIMITS.apiJsonBytes, signal, `GitHub API ${pathAndQuery}`);
      ctx.networkBytes = (ctx.networkBytes ?? 0) + body.byteLength;
      try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      } catch {
        throw new FetchError(`GitHub API ${pathAndQuery}: response is not JSON`);
      }
    },
    { retries: ctx.retries, backoffMs: ctx.backoffMs, label: `GitHub API ${pathAndQuery}`, log: ctx.log },
  );
}

/** Resolve a branch / tag / sha to a 40-hex commit sha. @param {Ctx} ctx @param {string} ref */
export async function resolveCommit(ctx, ref) {
  if (HEX40.test(ref)) return ref;
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(ref)) throw new Error(`bad --ref ${JSON.stringify(ref).slice(0, 60)}`);
  const json = await githubApi(ctx, `commits/${encodeURIComponent(ref)}`);
  const sha = json && typeof json === "object" ? json.sha : undefined;
  if (typeof sha !== "string" || !HEX40.test(sha)) throw new Error(`could not resolve ${ref} to a commit`);
  return sha;
}

/**
 * One file through the contents API, decoded and checked against its git blob sha1.
 * For a Git LFS file (`lfs: true`) the API returns the pointer as `content` but reports the size of
 * the LFS object in `size`; that size is returned as `reportedSize` for the caller to cross-check.
 * @param {Ctx} ctx @param {string} repoPath @param {string} commit @param {number} maxBytes
 * @param {{ lfs?: boolean }} [opts]
 */
export async function getContentFile(ctx, repoPath, commit, maxBytes, opts = {}) {
  const json = await githubApi(ctx, `contents/${repoPath.split("/").map(encodeURIComponent).join("/")}?ref=${commit}`);
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error(`${repoPath}: not a file`);
  if (json.type !== "file" || json.path !== repoPath) throw new Error(`${repoPath}: contents API returned ${json.type} ${json.path}`);
  if (json.encoding !== "base64" || typeof json.content !== "string") throw new Error(`${repoPath}: unexpected encoding ${json.encoding}`);
  if (typeof json.size !== "number" || !Number.isSafeInteger(json.size) || json.size < 0) throw new Error(`${repoPath}: bad size in the API response`);
  if (!opts.lfs && json.size > maxBytes) throw new Error(`${repoPath}: size ${json.size} over limit ${maxBytes}`);
  const b64 = json.content.replace(/\s+/g, "");
  if (b64.length > Math.ceil(maxBytes / 3) * 4) throw new Error(`${repoPath}: content over limit ${maxBytes}`);
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  if (bytes.byteLength > maxBytes) throw new Error(`${repoPath}: content over limit ${maxBytes}`);
  if (!opts.lfs && bytes.byteLength !== json.size) throw new Error(`${repoPath}: decoded ${bytes.byteLength} bytes, API says ${json.size}`);
  const blob = gitBlobSha1(bytes);
  if (blob !== json.sha) throw new Error(`${repoPath}: git blob sha1 ${blob} does not match the API's ${json.sha}`);
  return { bytes, blobSha: blob, reportedSize: json.size };
}

/**
 * Directory listing at a commit: name -> { size, sha } for files.
 * @param {Ctx} ctx @param {string} dir @param {string} commit
 */
export async function listDir(ctx, dir, commit) {
  const json = await githubApi(ctx, `contents/${encodeURIComponent(dir)}?ref=${commit}`);
  if (!Array.isArray(json)) throw new Error(`${dir}: not a directory listing`);
  /** @type {Map<string, { size: number, sha: string }>} */
  const out = new Map();
  for (const e of json) {
    if (e && e.type === "file" && typeof e.name === "string" && typeof e.size === "number" && typeof e.sha === "string") {
      out.set(e.name, { size: e.size, sha: e.sha });
    }
  }
  return out;
}

/**
 * Parse a Git LFS pointer strictly (spec v1: version, oid sha256, size; nothing else).
 * @param {Uint8Array | string} input
 */
export function parseLfsPointer(input) {
  const text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
  if (text.length > LIMITS.pointerBytes) throw new Error("LFS pointer too long");
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length !== 3) throw new Error(`LFS pointer has ${lines.length} lines, expected 3`);
  if (lines[0] !== "version https://git-lfs.github.com/spec/v1") throw new Error("LFS pointer: unknown version line");
  const oid = /^oid sha256:([0-9a-f]{64})$/.exec(lines[1]);
  if (!oid) throw new Error("LFS pointer: bad oid line");
  const size = /^size (0|[1-9][0-9]{0,15})$/.exec(lines[2]);
  if (!size) throw new Error("LFS pointer: bad size line");
  const n = Number(size[1]);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("LFS pointer: size must be a positive integer");
  return { oid: oid[1], size: n };
}

// ---------------------------------------------------------------------------------------------
// downloads

/** sha256 and size of a file on disk, streamed. @param {string} file */
export async function fileDigest(file) {
  const fh = await open(file, "r");
  try {
    const hash = createHash("sha256");
    const buf = Buffer.allocUnsafe(1 << 20);
    let bytes = 0;
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
      bytes += bytesRead;
    }
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    await fh.close();
  }
}

/** True when `file` exists with exactly this size and sha256. @param {string} file @param {number} size @param {string} sha256 */
export async function matchesOnDisk(file, size, sha256) {
  try {
    const st = await stat(file);
    if (!st.isFile() || st.size !== size) return false;
    return (await fileDigest(file)).sha256 === sha256;
  } catch {
    return false;
  }
}

/**
 * Stream `url` into `dest` through `dest.part`; the size and sha256 must match or nothing is kept.
 * Retries network trouble, 5xx, 429, short or corrupted bodies. Returns the bytes received over the
 * network (all attempts).
 * @param {Ctx} ctx
 * @param {string} url
 * @param {string} dest
 * @param {{ size: number, sha256: string, stallMs?: number, totalMs?: number }} expect
 */
export async function downloadVerified(ctx, url, dest, expect) {
  if (!Number.isSafeInteger(expect.size) || expect.size <= 0) throw new Error(`${url}: bad expected size`);
  if (!HEX64.test(expect.sha256)) throw new Error(`${url}: bad expected sha256`);
  const part = `${dest}.part`;
  let received = 0;
  await withRetries(
    async () => {
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(expect.totalMs ?? 15 * 60_000)]);
      const stallMs = expect.stallMs ?? 60_000;
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let stallTimer;
      const armStall = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          const e = new Error(`no data for ${stallMs} ms`);
          e.name = "TimeoutError";
          controller.abort(e);
        }, stallMs);
      };
      let fh;
      try {
        armStall();
        let res;
        try {
          res = await raceAbort(ctx.fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal, redirect: "follow" }), signal);
        } catch (err) {
          throw asFetchError(err, url);
        }
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          throw new FetchError(`${url}: HTTP ${res.status}`, { status: res.status, retryable: retryableStatus(res.status) });
        }
        const declared = res.headers.get("content-length");
        if (declared !== null && Number(declared) !== expect.size) {
          await res.body?.cancel().catch(() => {});
          throw new FetchError(`${url}: Content-Length ${declared}, LFS pointer says ${expect.size}`, { retryable: true });
        }
        if (!res.body) throw new FetchError(`${url}: empty body`, { retryable: true });
        const hash = createHash("sha256");
        let bytes = 0;
        fh = await open(part, "w");
        const reader = res.body.getReader();
        try {
          for (;;) {
            const { done, value } = await raceAbort(reader.read(), signal);
            if (done) break;
            armStall();
            bytes += value.byteLength;
            received += value.byteLength;
            ctx.networkBytes = (ctx.networkBytes ?? 0) + value.byteLength;
            if (bytes > expect.size) throw new FetchError(`${url}: more than ${expect.size} bytes`, { retryable: true });
            hash.update(value);
            for (let w = 0; w < value.byteLength; ) {
              const { bytesWritten } = await fh.write(value, w, value.byteLength - w);
              if (bytesWritten <= 0) throw new Error(`${part}: write made no progress`);
              w += bytesWritten;
            }
          }
        } catch (err) {
          await reader.cancel().catch(() => {});
          throw asFetchError(err, url);
        }
        await fh.sync();
        await fh.close();
        fh = undefined;
        if (bytes !== expect.size) throw new FetchError(`${url}: got ${bytes} bytes, expected ${expect.size}`, { retryable: true });
        const got = hash.digest("hex");
        if (got !== expect.sha256) throw new FetchError(`${url}: sha256 ${got} does not match ${expect.sha256}`, { retryable: true });
        await rename(part, dest);
      } catch (err) {
        if (fh) await fh.close().catch(() => {});
        await rm(part, { force: true });
        throw err;
      } finally {
        clearTimeout(stallTimer);
      }
    },
    { retries: ctx.retries, backoffMs: ctx.backoffMs, label: url, log: ctx.log },
  );
  return received;
}

/**
 * GET a small text file whole, with a size limit and a timeout (retried like the rest).
 * @param {Ctx} ctx @param {string} url @param {number} maxBytes
 */
export async function getSmall(ctx, url, maxBytes) {
  return withRetries(
    async () => {
      const signal = AbortSignal.timeout(ctx.apiTimeoutMs ?? 30_000);
      let res;
      try {
        res = await ctx.fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal, redirect: "follow" });
      } catch (err) {
        throw asFetchError(err, url);
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new FetchError(`${url}: HTTP ${res.status}`, { status: res.status, retryable: retryableStatus(res.status) });
      }
      const body = await readBodyLimited(res, maxBytes, signal, url);
      ctx.networkBytes = (ctx.networkBytes ?? 0) + body.byteLength;
      return body;
    },
    { retries: ctx.retries, backoffMs: ctx.backoffMs, label: url, log: ctx.log },
  );
}

/** Error codes Windows gives when another process (a player, an indexer, antivirus) has the target open. */
const RENAME_BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);

/**
 * Write a file atomically (tmp + rename). On Windows a rename onto a file another process has open fails with
 * EPERM / EACCES / EBUSY for a moment; that is retried with short waits, then reported in plain words.
 * @param {string} file @param {string | Uint8Array} data
 * @param {{ renameImpl?: (from: string, to: string) => Promise<void>, retryDelaysMs?: number[] }} [opts]
 */
export async function writeAtomic(file, data, opts = {}) {
  const tmp = `${file}.tmp-${process.pid}`;
  const doRename = opts.renameImpl ?? rename;
  const delays = opts.retryDelaysMs ?? [100, 250, 500, 1000, 2000];
  try {
    await writeFile(tmp, data);
    for (let attempt = 0; ; attempt++) {
      try {
        await doRename(tmp, file);
        break;
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
        if (!RENAME_BUSY.has(code)) throw err;
        if (attempt >= delays.length) {
          throw new Error(`could not replace ${file} (${code}); is it open in another program? Close it and run again`, { cause: err });
        }
        await sleep(delays[attempt]);
      }
    }
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Write `data` to `file` (atomically) unless the file already holds exactly these bytes.
 * Returns true when it wrote, false when the file was already identical (left untouched, mtime unchanged).
 * @param {string} file @param {string | Uint8Array} data
 * @param {Parameters<typeof writeAtomic>[2]} [opts]
 */
export async function writeIfChanged(file, data, opts) {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  if (await matchesOnDisk(file, bytes.byteLength, sha256Hex(bytes))) return false;
  await writeAtomic(file, bytes, opts);
  return true;
}

// ---------------------------------------------------------------------------------------------
// WAV

/**
 * Parse a RIFF/WAVE header by walking its chunks (the data chunk need not follow fmt directly).
 * Only uncompressed 16-bit PCM is accepted.
 * @param {Uint8Array} input
 */
export function parseWav(input) {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  /** @type {{ format: number, channels: number, sampleRate: number, byteRate: number, blockAlign: number, bitsPerSample: number } | null} */
  let fmt = null;
  /** @type {{ offset: number, bytes: number } | null} */
  let data = null;
  let off = 12;
  while (off + 8 <= buf.length && !(fmt && data)) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      if (size < 16 || body + size > buf.length) throw new Error("WAV fmt chunk is truncated");
      let format = buf.readUInt16LE(body);
      if (format === 0xfffe) {
        if (size < 40) throw new Error("WAV extensible fmt chunk is truncated");
        format = buf.readUInt16LE(body + 24); // first two bytes of the sub-format GUID
      }
      fmt = {
        format,
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        byteRate: buf.readUInt32LE(body + 8),
        blockAlign: buf.readUInt16LE(body + 12),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      if (body + size > buf.length) throw new Error(`WAV data chunk is truncated (${size} bytes declared, ${buf.length - body} present)`);
      data = { offset: body, bytes: size };
    }
    off = body + size + (size & 1);
  }
  if (!fmt) throw new Error("WAV has no fmt chunk");
  if (!data) throw new Error("WAV has no data chunk");
  if (fmt.format !== 1) throw new Error(`WAV is not PCM (format ${fmt.format})`);
  if (fmt.bitsPerSample !== 16) throw new Error(`WAV is ${fmt.bitsPerSample}-bit, expected 16-bit`);
  if (fmt.channels < 1 || fmt.channels > 2) throw new Error(`WAV has ${fmt.channels} channels, expected 1 or 2`);
  if (fmt.sampleRate < 8000 || fmt.sampleRate > 192000) throw new Error(`WAV sample rate ${fmt.sampleRate} out of range`);
  if (fmt.blockAlign !== fmt.channels * 2) throw new Error("WAV block align does not match 16-bit samples");
  if (fmt.byteRate !== fmt.sampleRate * fmt.blockAlign) throw new Error("WAV byte rate does not match");
  if (data.bytes % fmt.blockAlign !== 0) throw new Error("WAV data is not a whole number of frames");
  const frames = data.bytes / fmt.blockAlign;
  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    dataOffset: data.offset,
    dataBytes: data.bytes,
    frames,
    durationS: frames / fmt.sampleRate,
  };
}

/**
 * The samples of a 16-bit WAV as one mono track. A two-channel file is reduced to the louder channel
 * (a "separate channel" recording stored as stereo with one silent side); which one is reported.
 * @param {Uint8Array} input
 * @param {ReturnType<typeof parseWav>} [info]
 */
export function readMonoPcm16(input, info = parseWav(input)) {
  const view = new DataView(input.buffer, input.byteOffset + info.dataOffset, info.dataBytes);
  const n = info.frames;
  if (info.channels === 1) {
    const samples = new Int16Array(n);
    for (let i = 0; i < n; i++) samples[i] = view.getInt16(i * 2, true);
    return { samples, channelUsed: null };
  }
  let e0 = 0;
  let e1 = 0;
  for (let i = 0; i < n; i++) {
    const a = view.getInt16(i * 4, true);
    const b = view.getInt16(i * 4 + 2, true);
    e0 += a * a;
    e1 += b * b;
  }
  const ch = e1 > e0 ? 1 : 0;
  const samples = new Int16Array(n);
  for (let i = 0; i < n; i++) samples[i] = view.getInt16(i * 4 + ch * 2, true);
  return { samples, channelUsed: ch };
}

/**
 * Sum mono 16-bit tracks (zero-padding the shorter ones at the end) with one gain for the whole
 * result so that no sample leaves [-ceiling, ceiling]. gain is 1 when the plain sum already fits.
 * @param {Int16Array[]} tracks
 * @param {number} [ceiling]
 */
export function mixPcm16(tracks, ceiling = 32767) {
  if (tracks.length === 0) throw new Error("nothing to mix");
  if (!(ceiling > 0 && ceiling <= 32767)) throw new Error("bad ceiling");
  const length = Math.max(...tracks.map((t) => t.length));
  const sum = new Int32Array(length);
  for (const t of tracks) for (let i = 0; i < t.length; i++) sum[i] += t[i];
  let peakIn = 0;
  for (let i = 0; i < length; i++) {
    const a = Math.abs(sum[i]);
    if (a > peakIn) peakIn = a;
  }
  const gain = peakIn > ceiling ? ceiling / peakIn : 1;
  const samples = new Int16Array(length);
  let peakOut = 0;
  let clipped = 0;
  for (let i = 0; i < length; i++) {
    let v = gain === 1 ? sum[i] : Math.round(sum[i] * gain);
    if (v > 32767) {
      v = 32767;
      clipped++;
    } else if (v < -32768) {
      v = -32768;
      clipped++;
    }
    samples[i] = v;
    const a = Math.abs(v);
    if (a > peakOut) peakOut = a;
  }
  return { samples, gain, peakIn, peakOut, clipped, paddedSamples: tracks.map((t) => length - t.length) };
}

/** A canonical 44-byte-header mono 16-bit PCM WAV. @param {Int16Array} samples @param {number} sampleRate */
export function encodeWavMono16(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  return buf;
}

// ---------------------------------------------------------------------------------------------
// TextGrid

/** UTF-8 (BOM optional) or UTF-16 with a BOM; anything else that is not valid UTF-8 is refused. @param {Uint8Array} bytes */
export function decodeText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2));
  const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start));
}

/**
 * Read a Praat string literal that starts at lines[i][col] (the opening quote). "" inside is one
 * quote; the literal may run over several lines.
 * @param {string[]} lines @param {number} i @param {number} col
 * @returns {{ value: string, next: number }} next = index of the line after the closing quote's line
 */
function readQuoted(lines, i, col) {
  let out = "";
  let line = lines[i];
  let k = col + 1;
  for (;;) {
    while (k < line.length) {
      const c = line[k];
      if (c === '"') {
        if (line[k + 1] === '"') {
          out += '"';
          k += 2;
          continue;
        }
        return { value: out, next: i + 1 };
      }
      out += c;
      k++;
    }
    i++;
    if (i >= lines.length) throw new Error("TextGrid: unterminated string");
    out += "\n";
    line = lines[i];
    k = 0;
  }
}

/**
 * Parse a Praat TextGrid in the long text format ("ooTextFile"). Returns the interval tiers with
 * their intervals; point tiers are skipped. Throws on anything malformed.
 * @param {string} text
 */
export function parseTextGrid(text) {
  const lines = text.split(/\r\n|\n|\r/);
  const head = lines.slice(0, 3).map((l) => l.trim());
  if (head[0] !== 'File type = "ooTextFile"' || head[1] !== 'Object class = "TextGrid"') {
    throw new Error("not a long-format Praat TextGrid");
  }
  /** @type {{ cls: string | null, name: string | null, declared: number | null, intervals: { xmin: number, xmax: number, text: string | null }[] }[]} */
  const tiers = [];
  /** @type {(typeof tiers)[number] | null} */
  let tier = null;
  /** @type {{ xmin: number, xmax: number, text: string | null } | null} */
  let iv = null;
  let xmax = NaN;
  const num = (/** @type {string} */ v, /** @type {number} */ line) => {
    const n = Number(v.trim());
    if (v.trim() === "" || !Number.isFinite(n)) throw new Error(`TextGrid line ${line + 1}: not a number`);
    return n;
  };
  for (let i = 2; i < lines.length; ) {
    const raw = lines[i];
    const t = raw.trim();
    let m;
    if ((m = /^item \[(\d+)\]:$/.exec(t))) {
      tier = { cls: null, name: null, declared: null, intervals: [] };
      tiers.push(tier);
      iv = null;
    } else if ((m = /^intervals \[(\d+)\]:$/.exec(t))) {
      if (!tier) throw new Error(`TextGrid line ${i + 1}: interval outside a tier`);
      iv = { xmin: NaN, xmax: NaN, text: null };
      tier.intervals.push(iv);
    } else if (/^points \[(\d+)\]:$/.test(t)) {
      iv = null;
    } else if ((m = /^intervals: size = (\d+)$/.exec(t))) {
      if (!tier) throw new Error(`TextGrid line ${i + 1}: size outside a tier`);
      tier.declared = Number(m[1]);
    } else if ((m = /^(\w+) = (.*)$/.exec(t))) {
      const key = m[1];
      const rest = m[2];
      if (rest.startsWith('"')) {
        const col = raw.indexOf('"', raw.indexOf("="));
        const { value, next } = readQuoted(lines, i, col);
        if (iv && key === "text") iv.text = value;
        else if (tier && !iv && key === "class") tier.cls = value;
        else if (tier && !iv && key === "name") tier.name = value;
        i = next;
        continue;
      }
      if (iv && key === "xmin") iv.xmin = num(rest, i);
      else if (iv && key === "xmax") iv.xmax = num(rest, i);
      else if (!tier && key === "xmax") xmax = num(rest, i);
    }
    i++;
  }
  const out = [];
  for (const [ti, tr] of tiers.entries()) {
    if (tr.cls !== "IntervalTier") continue;
    if (tr.declared !== null && tr.declared !== tr.intervals.length) {
      throw new Error(`TextGrid tier ${ti + 1}: declares ${tr.declared} intervals, has ${tr.intervals.length}`);
    }
    let prev = -Infinity;
    for (const [k, x] of tr.intervals.entries()) {
      if (!Number.isFinite(x.xmin) || !Number.isFinite(x.xmax) || x.text === null) {
        throw new Error(`TextGrid tier ${ti + 1} interval ${k + 1}: missing xmin, xmax or text`);
      }
      if (x.xmax < x.xmin) throw new Error(`TextGrid tier ${ti + 1} interval ${k + 1}: ends before it starts`);
      if (x.xmin < prev - 1e-6) throw new Error(`TextGrid tier ${ti + 1} interval ${k + 1}: out of order`);
      prev = x.xmin;
    }
    out.push({
      name: tr.name ?? "",
      intervals: tr.intervals.map((x) => ({ xmin: x.xmin, xmax: x.xmax, text: /** @type {string} */ (x.text) })),
    });
  }
  if (out.length === 0) throw new Error("TextGrid has no interval tier");
  return { xmax, tiers: out };
}

/** The transcriber tags of PriMock57 (and any other <UPPER_CASE/> tag) removed, spaces collapsed. @param {string} s */
export function stripTranscriptTags(s) {
  return s
    .replace(/<\/?UNSURE>|<UNIN\/>|<INAUDIBLE_SPEECH\/>/g, " ")
    .replace(/<\/?[A-Z][A-Z_]*\s*\/?>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The two channel transcripts as one utterance list in the shape of fixtures/visits/*.utterances.json.
 * Speaker comes from which file the interval is in (PriMock57 names both tiers "Speaker").
 * @param {string} id
 * @param {{ doctor: ReturnType<typeof parseTextGrid>, patient: ReturnType<typeof parseTextGrid> }} grids
 * @param {{ commit: string, sources: { doctor: string, patient: string } }} meta
 */
export function toUtterances(id, grids, meta) {
  const rows = [];
  let dropped = 0;
  for (const speaker of /** @type {const} */ (["doctor", "patient"])) {
    for (const tier of grids[speaker].tiers) {
      for (const x of tier.intervals) {
        if (x.text.trim() === "") continue;
        const clean = stripTranscriptTags(x.text);
        if (clean === "") {
          dropped++;
          continue;
        }
        rows.push({
          t_start_ms: Math.round(x.xmin * 1000),
          t_end_ms: Math.round(x.xmax * 1000),
          speaker_cluster: speaker === "doctor" ? 0 : 1,
          speaker,
          lang: "en-GB",
          text: clean,
          text_raw: x.text,
        });
      }
    }
  }
  rows.sort((a, b) => a.t_start_ms - b.t_start_ms || a.speaker_cluster - b.speaker_cluster || a.t_end_ms - b.t_end_ms);
  const utterances = rows.map((r, i) => ({ id: `${id}-u${String(i + 1).padStart(3, "0")}`, ...r }));
  return {
    meta: {
      dataset: DATASET.name,
      consultation: id,
      source: [meta.sources.doctor, meta.sources.patient],
      commit: meta.commit,
      licence: LICENCE.id,
      attribution: ATTRIBUTION_REL,
      timing: "human transcriber timings from the TextGrid files",
      speaker: "from the channel file (doctor / patient); not diarised",
      nature: DATASET.nature,
      intervals_without_words: dropped,
    },
    utterances,
  };
}

// ---------------------------------------------------------------------------------------------
// note

/**
 * Check a PriMock57 note (untrusted JSON) and pull out the presenting complaint.
 * @param {Uint8Array} bytes @param {{ day: number, consultation: number }} want
 */
export function readNote(bytes, want) {
  let json;
  try {
    json = JSON.parse(decodeText(bytes));
  } catch {
    throw new Error("note is not valid JSON");
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("note is not an object");
  if (json.day !== want.day || json.consultation !== want.consultation) {
    throw new Error(`note is for day ${json.day} consultation ${json.consultation}, expected ${want.day}/${want.consultation}`);
  }
  if (typeof json.presenting_complaint !== "string" || typeof json.note !== "string") throw new Error("note lacks presenting_complaint or note");
  const complaint = json.presenting_complaint
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return { presentingComplaint: complaint };
}

// ---------------------------------------------------------------------------------------------
// manifest check (no network)

/**
 * Verify every file listed in the manifest against the disk. Returns the problems (empty = all good).
 * @param {any} manifest
 * @param {string} [web]
 */
export async function verifyLocal(manifest, web = WEB) {
  const problems = [];
  const root = path.resolve(web, manifest.local_root);
  let files = 0;
  let bytes = 0;
  for (const c of manifest.consultations) {
    for (const f of c.files) {
      const p = path.resolve(root, f.path);
      if (!p.startsWith(root + path.sep)) {
        problems.push(`${f.path}: outside ${manifest.local_root}`);
        continue;
      }
      if (!existsSync(p)) {
        problems.push(`${f.path}: missing`);
        continue;
      }
      const d = await fileDigest(p);
      files++;
      bytes += d.bytes;
      if (d.bytes !== f.bytes) problems.push(`${f.path}: ${d.bytes} bytes, manifest says ${f.bytes}`);
      else if (d.sha256 !== f.sha256) problems.push(`${f.path}: sha256 differs from the manifest`);
    }
  }
  return { problems, files, bytes };
}

// ---------------------------------------------------------------------------------------------
// fetch run

/**
 * @param {{ ids: string[], ref: string, dryRun: boolean, web?: string, manifest?: string | null }} opts
 *   manifest: absolute path of the manifest to write (default: <web>/fixtures/real/primock57.manifest.json)
 * @param {Ctx} ctx
 */
export async function run(opts, ctx) {
  const web = opts.web ?? WEB;
  const root = path.join(web, ...LOCAL_ROOT_REL.split("/"));
  const parsed = opts.ids.map(parseConsultationId);
  const log = ctx.log;

  const commit = await resolveCommit(ctx, opts.ref);
  log(`PriMock57 ${opts.ref} -> commit ${commit}`);

  const licence = await getContentFile(ctx, "LICENSE.md", commit, LIMITS.licenceBytes);
  const licenceText = decodeText(licence.bytes);
  if (!/^# Creative Commons Attribution 4\.0 International\s*$/m.test(licenceText.split("\n")[0])) {
    throw new Error("LICENSE.md at this commit is not CC BY 4.0; stopping");
  }
  log("licence: LICENSE.md is Creative Commons Attribution 4.0 International");

  /** @type {Map<string, { oid: string, size: number }>} */
  const pointers = new Map();
  for (const c of parsed) {
    for (const who of ["doctor", "patient"]) {
      const repoPath = `audio/${c.id}_${who}.wav`;
      const { bytes, reportedSize } = await getContentFile(ctx, repoPath, commit, LIMITS.pointerBytes, { lfs: true });
      const ptr = parseLfsPointer(bytes);
      if (ptr.size !== reportedSize) throw new Error(`${repoPath}: LFS pointer says ${ptr.size} bytes, the contents API says ${reportedSize}`);
      if (ptr.size > LIMITS.wavBytes) throw new Error(`${repoPath}: ${ptr.size} bytes is over the ${LIMITS.wavBytes} limit`);
      pointers.set(repoPath, ptr);
    }
  }
  const audioTotal = [...pointers.values()].reduce((s, p) => s + p.size, 0);
  log(`LFS pointers: ${pointers.size} audio files, ${audioTotal} bytes (${mb(audioTotal)})`);
  if (opts.dryRun) {
    for (const [p, ptr] of pointers) log(`  ${p}  ${ptr.size}  sha256:${ptr.oid}`);
    return { commit, dryRun: true, audioTotal, manifest: null, downloaded: 0, reused: 0, derivedWritten: 0, derivedUnchanged: 0, manifestWritten: false };
  }

  const dirs = { audio: path.join(root, "audio"), transcripts: path.join(root, "transcripts"), notes: path.join(root, "notes"), mixed: path.join(root, "mixed") };
  for (const d of Object.values(dirs)) {
    await mkdir(d, { recursive: true });
    for (const name of await readdir(d)) if (name.endsWith(".part") || /\.tmp-\d+$/.test(name)) await rm(path.join(d, name), { force: true });
  }

  const transcriptsDir = await listDir(ctx, "transcripts", commit);
  const notesDir = await listDir(ctx, "notes", commit);

  let downloaded = 0;
  let reused = 0;
  let derivedWritten = 0;
  let derivedUnchanged = 0;
  const consultations = [];
  /** Derived files are only written when their bytes change (no needless rewrite of a file someone has open). */
  const writeDerived = async (/** @type {string} */ file, /** @type {Uint8Array} */ bytes) => {
    if (await writeIfChanged(file, bytes)) derivedWritten++;
    else derivedUnchanged++;
  };

  /** Small text file from raw.githubusercontent, checked against the directory listing. */
  const fetchText = async (/** @type {string} */ repoPath, /** @type {Map<string, {size:number, sha:string}>} */ listing, /** @type {string} */ dest, /** @type {number} */ maxBytes) => {
    const name = repoPath.split("/").pop() ?? "";
    const entry = listing.get(name);
    if (!entry) throw new Error(`${repoPath}: not in the repository at ${commit}`);
    if (entry.size > maxBytes) throw new Error(`${repoPath}: ${entry.size} bytes over the ${maxBytes} limit`);
    if (existsSync(dest)) {
      const local = new Uint8Array(await readFile(dest));
      if (local.byteLength === entry.size && gitBlobSha1(local) === entry.sha) {
        reused += local.byteLength;
        return local;
      }
    }
    const url = `${RAW_BASE}/${commit}/${repoPath}`;
    const bytes = await getSmall(ctx, url, maxBytes);
    if (bytes.byteLength !== entry.size || gitBlobSha1(bytes) !== entry.sha) {
      throw new Error(`${repoPath}: downloaded file does not match the git blob at ${commit}`);
    }
    downloaded += bytes.byteLength;
    await writeAtomic(dest, bytes);
    return bytes;
  };

  for (const c of parsed) {
    log(`${c.id} (day ${c.day}, consultation ${c.consultation})`);
    const files = [];
    /** @type {Record<string, { samples: Int16Array, info: ReturnType<typeof parseWav>, channelUsed: number | null }>} */
    const tracks = {};
    for (const who of ["doctor", "patient"]) {
      const repoPath = `audio/${c.id}_${who}.wav`;
      const ptr = /** @type {{ oid: string, size: number }} */ (pointers.get(repoPath));
      const dest = path.join(dirs.audio, `${c.id}_${who}.wav`);
      const url = `${MEDIA_BASE}/${commit}/${repoPath}`;
      if (await matchesOnDisk(dest, ptr.size, ptr.oid)) {
        reused += ptr.size;
        log(`  ${repoPath}: already on disk, size and sha256 match`);
      } else {
        const t0 = Date.now();
        const got = await downloadVerified(ctx, url, dest, { size: ptr.size, sha256: ptr.oid });
        downloaded += got;
        const s = Math.max(0.001, (Date.now() - t0) / 1000);
        log(`  ${repoPath}: downloaded ${got} bytes in ${s.toFixed(1)} s, size and sha256 match the LFS pointer`);
      }
      const bytes = new Uint8Array(await readFile(dest));
      const info = parseWav(bytes);
      if (info.sampleRate !== 16000) throw new Error(`${repoPath}: ${info.sampleRate} Hz, expected 16000`);
      const { samples, channelUsed } = readMonoPcm16(bytes, info);
      tracks[who] = { samples, info, channelUsed };
      files.push({
        role: `audio_${who}`,
        path: posix("audio", `${c.id}_${who}.wav`),
        bytes: ptr.size,
        sha256: ptr.oid,
        source: { path: repoPath, url, lfs_oid: `sha256:${ptr.oid}` },
        audio: {
          sample_rate: info.sampleRate,
          channels: info.channels,
          bits_per_sample: info.bitsPerSample,
          duration_s: Number(info.durationS.toFixed(3)),
          ...(channelUsed === null ? {} : { channel_used: channelUsed }),
        },
      });
    }

    /** @type {Record<string, ReturnType<typeof parseTextGrid>>} */
    const grids = {};
    for (const who of ["doctor", "patient"]) {
      const name = `${c.id}_${who}.TextGrid`;
      const repoPath = `transcripts/${name}`;
      const dest = path.join(dirs.transcripts, name);
      const bytes = await fetchText(repoPath, transcriptsDir, dest, LIMITS.textGridBytes);
      grids[who] = parseTextGrid(decodeText(bytes));
      files.push({
        role: `transcript_${who}`,
        path: posix("transcripts", name),
        bytes: bytes.byteLength,
        sha256: sha256Hex(bytes),
        source: { path: repoPath, url: `${RAW_BASE}/${commit}/${repoPath}`, git_blob_sha1: /** @type {{sha:string}} */ (transcriptsDir.get(name)).sha },
      });
    }

    const noteName = `${c.id}.json`;
    const noteBytes = await fetchText(`notes/${noteName}`, notesDir, path.join(dirs.notes, noteName), LIMITS.noteBytes);
    const note = readNote(noteBytes, c);
    files.push({
      role: "note",
      path: posix("notes", noteName),
      bytes: noteBytes.byteLength,
      sha256: sha256Hex(noteBytes),
      source: { path: `notes/${noteName}`, url: `${RAW_BASE}/${commit}/notes/${noteName}`, git_blob_sha1: /** @type {{sha:string}} */ (notesDir.get(noteName)).sha },
    });

    // derived 1: the mixed mono WAV
    const mix = mixPcm16([tracks.doctor.samples, tracks.patient.samples]);
    if (mix.clipped !== 0) throw new Error(`${c.id}: mixing clipped ${mix.clipped} samples`);
    const wav = encodeWavMono16(mix.samples, 16000);
    const back = parseWav(wav);
    if (back.frames !== mix.samples.length || back.sampleRate !== 16000 || back.channels !== 1) throw new Error(`${c.id}: mixed WAV did not read back`);
    const mixedName = `${c.id}.wav`;
    await writeDerived(path.join(dirs.mixed, mixedName), wav);
    files.push({
      role: "audio_mixed",
      path: posix("mixed", mixedName),
      bytes: wav.length,
      sha256: sha256Hex(wav),
      derived: true,
      derived_from: ["audio_doctor", "audio_patient"],
      audio: { sample_rate: 16000, channels: 1, bits_per_sample: 16, duration_s: Number(back.durationS.toFixed(3)) },
    });

    // derived 2: utterances JSON
    const utt = toUtterances(c.id, { doctor: grids.doctor, patient: grids.patient }, {
      commit,
      sources: { doctor: `transcripts/${c.id}_doctor.TextGrid`, patient: `transcripts/${c.id}_patient.TextGrid` },
    });
    const uttBytes = Buffer.from(`${JSON.stringify(utt, null, 2)}\n`, "utf8");
    const uttName = `${c.id}.utterances.json`;
    await writeDerived(path.join(dirs.transcripts, uttName), uttBytes);
    files.push({
      role: "utterances",
      path: posix("transcripts", uttName),
      bytes: uttBytes.length,
      sha256: sha256Hex(uttBytes),
      derived: true,
      derived_from: ["transcript_doctor", "transcript_patient"],
    });

    const byWho = { doctor: 0, patient: 0 };
    for (const u of utt.utterances) byWho[u.speaker]++;
    const gain = mix.gain; // full precision: ceiling / peak_in, so the mix can be recomputed exactly
    log(`  mixed: ${mb(wav.length)}, ${back.durationS.toFixed(1)} s, gain ${gain.toFixed(6)}, peak ${mix.peakIn} -> ${mix.peakOut}, clipped 0; utterances doctor ${byWho.doctor}, patient ${byWho.patient}`);
    consultations.push({
      id: c.id,
      day: c.day,
      consultation: c.consultation,
      presenting_complaint: note.presentingComplaint,
      why_selected: /** @type {Record<string, string>} */ (DEFAULT_SELECTION)[c.id] ?? "chosen with --ids",
      duration_s: Number(back.durationS.toFixed(3)),
      mix: {
        gain,
        peak_in: mix.peakIn,
        peak_out: mix.peakOut,
        clipped_samples: mix.clipped,
        padded_samples: { doctor: mix.paddedSamples[0], patient: mix.paddedSamples[1] },
      },
      utterances: byWho,
      files,
    });
  }

  const all = consultations.flatMap((c) => c.files);
  const source = all.filter((f) => !f.derived);
  const derived = all.filter((f) => f.derived);
  const sum = (/** @type {{bytes:number}[]} */ fs) => fs.reduce((s, f) => s + f.bytes, 0);

  const manifestPath = opts.manifest ?? path.join(web, ...MANIFEST_REL.split("/"));
  let retrievedOn = new Date().toISOString().slice(0, 10);
  try {
    const old = JSON.parse(await readFile(manifestPath, "utf8"));
    const oldHashes = old?.consultations?.flatMap((/** @type {any} */ c) => c.files.map((/** @type {any} */ f) => `${f.path}:${f.sha256}`)).sort().join("|");
    const newHashes = all.map((f) => `${f.path}:${f.sha256}`).sort().join("|");
    if (old?.dataset?.commit === commit && oldHashes === newHashes && typeof old.retrieved_on === "string") retrievedOn = old.retrieved_on;
  } catch {
    /* no previous manifest */
  }

  const manifest = {
    schema: "ripple/real-dataset-manifest@1",
    dataset: { ...DATASET, ref: opts.ref, commit },
    licence: { ...LICENCE, dataset_licence_file: `${REPO_URL}/blob/${commit}/LICENSE.md` },
    credit: CREDIT,
    attribution_file: ATTRIBUTION_REL,
    generator: SCRIPT_REL,
    local_root: LOCAL_ROOT_REL,
    audio_in_repo: false,
    retrieved_on: retrievedOn,
    changes: CHANGES,
    consultations,
    totals: {
      consultations: consultations.length,
      files: all.length,
      source_files: source.length,
      source_bytes: sum(source),
      source_audio_bytes: sum(source.filter((f) => f.role.startsWith("audio_"))),
      derived_files: derived.length,
      derived_bytes: sum(derived),
      bytes_on_disk: sum(all),
    },
  };
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const manifestWritten = await writeIfChanged(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`derived files: ${derivedWritten} written, ${derivedUnchanged} unchanged; manifest ${manifestWritten ? "written" : "unchanged"}`);
  return { commit, dryRun: false, audioTotal, manifest, downloaded, reused, derivedWritten, derivedUnchanged, manifestWritten };
}

// ---------------------------------------------------------------------------------------------
// CLI

/** Is this selection the five default consultations (in any order)? @param {string[]} ids */
export function isDefaultSelection(ids) {
  return ids.length === DEFAULT_IDS.length && DEFAULT_IDS.every((id) => ids.includes(id));
}

/** A --ref value the GitHub API can take (a 40-hex commit, or a branch / tag name). @param {string} ref */
export function validRef(ref) {
  return HEX40.test(ref) || /^[A-Za-z0-9._/-]{1,100}$/.test(ref);
}

/**
 * @param {string[]} argv
 * @param {string} [cwd] where a relative --manifest is resolved from (default process.cwd())
 * @param {string} [web] the web/ folder (default WEB): the committed manifest under it is never a --manifest target
 */
export function parseArgs(argv, cwd = process.cwd(), web = WEB) {
  /** @type {{ ids: string[], ref: string, dryRun: boolean, check: boolean, help: boolean, useGh: boolean, manifest: string | null }} */
  const out = { ids: [...DEFAULT_IDS], ref: "main", dryRun: false, check: false, help: false, useGh: true, manifest: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--check") out.check = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--no-gh") out.useGh = false;
    else if (a === "--ref") out.ref = val();
    else if (a === "--ids") {
      const ids = val().split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) throw new Error("--ids is empty");
      for (const id of ids) parseConsultationId(id);
      if (new Set(ids).size !== ids.length) throw new Error("--ids has duplicates");
      out.ids = ids.sort();
    } else if (a === "--manifest") {
      const v = val();
      if (!/\.json$/i.test(v)) throw new Error("--manifest must name a .json file");
      out.manifest = path.resolve(cwd, v);
    } else throw new Error(`unknown option ${a}`);
  }
  if (!validRef(out.ref)) throw new Error(`bad --ref ${JSON.stringify(out.ref).slice(0, 60)}: a branch, a tag or a 40-hex commit`);
  const committed = path.resolve(web, ...MANIFEST_REL.split("/"));
  const same = (/** @type {string} */ a, /** @type {string} */ b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!isDefaultSelection(out.ids) && !out.dryRun && !out.check) {
    if (!out.manifest) {
      throw new Error(`--ids other than the five default consultations needs --manifest <file.json>: ${MANIFEST_REL} is committed and lists the default five (${ATTRIBUTION_REL} names them)`);
    }
    if (same(out.manifest, committed)) throw new Error(`--manifest must not be ${MANIFEST_REL} for a selection other than the default five`);
  }
  return out;
}

/** A directory lock so two runs do not write the same files. @param {string} dir */
async function acquireLock(dir) {
  await mkdir(path.dirname(dir), { recursive: true });
  try {
    await mkdir(dir);
  } catch (err) {
    if (!(err && typeof err === "object" && "code" in err && err.code === "EEXIST")) throw err;
    const st = await stat(dir);
    if (Date.now() - st.mtimeMs < 2 * 60 * 60_000) throw new Error(`another fetch_primock57 run holds ${dir}; remove it if that run is dead`);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir);
  }
  await writeFile(path.join(dir, "owner.txt"), `fetch_primock57 pid ${process.pid} ${new Date().toISOString()}\n`);
  return async () => rm(dir, { recursive: true, force: true });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    console.log("usage: node scripts/data/fetch_primock57.mjs [--dry-run | --check] [--ids a,b,... --manifest <file.json>] [--ref main|<sha>] [--no-gh]");
    return;
  }
  if (args.check) {
    try {
      const manifestPath = args.manifest ?? path.join(WEB, ...MANIFEST_REL.split("/"));
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const { problems, files, bytes } = await verifyLocal(manifest);
      for (const p of problems) console.log(`  ${p}`);
      console.log(`checked ${files} files (${bytes} bytes, ${mb(bytes)}) under ${manifest.local_root}: ${problems.length === 0 ? "all match the manifest" : `${problems.length} problems`}`);
      if (problems.length) process.exitCode = 1;
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
    return;
  }
  /** @type {TokenChoice} */
  let auth;
  try {
    auth = await resolveGithubToken({ useGh: args.useGh });
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
    return;
  }
  console.log(tokenStatusLine(auth));
  let release;
  try {
    release = args.dryRun ? async () => {} : await acquireLock(path.join(WEB, ...LOCAL_ROOT_REL.split("/"), ".fetch-lock"));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }
  const onSignal = () => {
    release().finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  /** @type {Ctx} */
  const ctx = { fetchImpl: fetch, token: auth.token, log: (s) => console.log(s), apiCalls: 0, networkBytes: 0 };
  try {
    const r = await run({ ids: args.ids, ref: args.ref, dryRun: args.dryRun, manifest: args.manifest }, ctx);
    if (!r.dryRun && r.manifest) {
      const t = r.manifest.totals;
      console.log(`manifest: ${args.manifest ? path.relative(process.cwd(), args.manifest) : MANIFEST_REL} (${t.consultations} consultations, ${t.files} files)`);
      console.log(`source files on disk: ${t.source_files}, ${t.source_bytes} bytes (${mb(t.source_bytes)}); audio ${t.source_audio_bytes} bytes (${mb(t.source_audio_bytes)})`);
      console.log(`derived files: ${t.derived_files}, ${t.derived_bytes} bytes (${mb(t.derived_bytes)}); all on disk ${t.bytes_on_disk} bytes (${mb(t.bytes_on_disk)})`);
      console.log(`this run: dataset files downloaded ${r.downloaded} bytes (${mb(r.downloaded)}), reused from disk ${r.reused} bytes; network total ${ctx.networkBytes} bytes over ${ctx.apiCalls} GitHub API calls plus downloads`);
    } else {
      console.log(`this run: network total ${ctx.networkBytes} bytes over ${ctx.apiCalls} GitHub API calls, nothing downloaded (dry run)`);
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await release();
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
const self = fileURLToPath(import.meta.url);
if (invoked && (process.platform === "win32" ? invoked.toLowerCase() === self.toLowerCase() : invoked === self)) {
  await main();
}
