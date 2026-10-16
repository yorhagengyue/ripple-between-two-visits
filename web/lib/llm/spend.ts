/**
 * Spend ledger and budget for paid model calls (the US$ cost guard). Server-only (node:fs).
 *
 * Every call a live client (lib/llm/openai.ts: OpenAI, DeepSeek, any compatible vendor) makes is priced and
 * appended as one JSON line to the ledger file; before each call the client reserves the call's worst-case cost
 * and the call is refused (LlmError "budget", 402) when the spend in the window plus everything in flight would
 * pass the cap. Mock and replay clients never touch it.
 *
 *   LLM_SPEND_CAP_USD        cap for the window; default 5 (the 10-09 overnight cap)
 *   LLM_PERSON_SPEND_CAP_USD the other cap of real-app 3.5: one person's calls per local calendar day; default 0.20. It is
 *                            not kept in this file's ledger: it is counted per person in the store (person-spend.ts),
 *                            where a restart or a second instance cannot reset it
 *   LLM_SPEND_WINDOW_HOURS   rolling window; default 24
 *   LLM_SPEND_LOG            ledger file; default web/.data/llm-spend.jsonl (.data/ is gitignored), found from the
 *                            package folder (root.ts), not the working folder: a script started from the repository
 *                            root or web/scripts shares the same ledger and cap. Under vitest the ledger is in
 *                            memory only, even with this variable set (fix round 2), so unit tests never write it. When web/ cannot be found
 *                            (root.ts findWebRoot: neither above the working folder nor above this module), every
 *                            paid call is refused with "ledger_unavailable" (no_web_root): fail closed, never a
 *                            fresh ledger somewhere else (fix round 1)
 *   LLM_PRICES_JSON          optional price overrides: {"<model>": {"input": <US$ per 1M>, "output": <US$ per 1M>}}
 *   LLM_LOG_SPEND=0          silence the one-line console log per call
 *   LLM_RUN_LABEL            optional label written on every line this process records (letters, digits, . _ : -,
 *                            up to 40), for example "eval-run1" or "e2e"; every line also carries the process id, so
 *                            "this run spent nothing" can be checked by label or pid while other processes call the
 *                            model at the same time (round-2 check: the line count alone could not show it)
 *
 * The file is shared by every process on the machine (the eval script, the `next dev` Playwright starts, the
 * scripts in scripts/llm/): each process re-reads the lines other processes appended before it checks the cap.
 * Two processes checking at the same instant can overshoot by at most the calls they have in flight.
 * A call reserves its estimate once per attempt it may make (openai.ts), so retries that time out and are charged
 * can never take the spend past what was reserved.
 * Reset: delete or move the ledger file (an empty or missing file is zero spend).
 *
 * A ledger line holds only: time, provider, model, purpose, ok / error code, attempts, latency, token counts, US$,
 * the run label and the process id. Never the prompt, the answer, the patient's words or a key.
 * A line with a negative usd counts as 0, never as a refund. A line that is not a ledger line at all (not JSON, no
 * time, a usd that is not a finite number) is damage: the ledger refuses every paid call ("ledger_unavailable",
 * corrupt_line) until the file is repaired, moved or truncated (fix round 2: it used to count as US$0).
 *
 * Pricing is deliberately an upper bound: every prompt token is charged at the cache-miss price (cache hits are
 * recorded but not discounted), at the vendor's peak rates; an attempt that timed out is charged at its estimate,
 * because the vendor may still have run it.
 *
 * Fail closed (10-09 wave B; round-3 safety check problem 4): the cap is only as good as the ledger, so a paid call
 * is refused with LlmError "ledger_unavailable" (HTTP 507, not a "provider down" status, so there is no failover)
 * whenever the ledger file cannot be read (any error but "no file yet", or the path is not a file: a folder read as
 * size 0 used to count as US$0 spent) or cannot be appended (checked before every call by a zero-byte append, which
 * also creates a missing file and folder). A call that already happened and then could not be written is kept in
 * memory, still counts against the cap, and makes every later call wait until the ledger takes those lines again
 * (they are written first, then the call goes ahead). The error carries the file-system code, never a path or text.
 *
 * Fix round 3 (10-10): summary() makes reserve()'s file test without writing (a read-only ledger file was reported
 * healthy while every call was refused); a line cut off by a dead write counts as TRUNCATED_LINE_USD, more than any one
 * call, while it waits for its newline and after (it counted as 0), and the next line starts on a line of its own instead
 * of being glued onto it; spentByThisProcess() is one script's own spend (the eval's "spend this run").
 */
import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { findWebRoot } from "./root";
import { LlmError, type ChatUsage, type LlmPurpose } from "./types";

type Env = Record<string, string | undefined>;

export interface ModelPrice {
  /** US$ per 1M prompt tokens (cache miss, peak) */
  inputPerM: number;
  /** US$ per 1M completion tokens (peak; reasoning tokens are completion tokens) */
  outputPerM: number;
  source: string;
}

const DEEPSEEK_SOURCE = "api-docs.deepseek.com/quick_start/pricing, peak, input cache miss (read 2026-10-09)";

/** Known prices. DeepSeek's legacy names are served and billed as deepseek-flash. */
export const PRICES: Record<string, ModelPrice> = {
  "deepseek-flash": { inputPerM: 0.3, outputPerM: 1.2, source: DEEPSEEK_SOURCE },
  "deepseek-v4-flash": { inputPerM: 0.3, outputPerM: 1.2, source: DEEPSEEK_SOURCE },
  "deepseek-v4-flash-vision-exp": { inputPerM: 0.3, outputPerM: 1.2, source: DEEPSEEK_SOURCE },
  "deepseek-v4-pro": { inputPerM: 1.32, outputPerM: 3.96, source: DEEPSEEK_SOURCE },
};

/** A model without a price row is charged at this conservative rate, so the cap still bounds the spend. */
export const UNKNOWN_MODEL_PRICE: ModelPrice = { inputPerM: 5, outputPerM: 20, source: "conservative default (no price row for this model)" };

/** Tokens an image costs at most (DeepSeek: images are resized to at most 1024 tokens each). */
export const IMAGE_TOKENS = 1100;

export function priceFor(model: string, env: Env = process.env): ModelPrice {
  const raw = env.LLM_PRICES_JSON;
  if (raw) {
    try {
      const o = JSON.parse(raw) as Record<string, { input?: unknown; output?: unknown }>;
      const p = o[model];
      if (p && typeof p.input === "number" && typeof p.output === "number" && p.input >= 0 && p.output >= 0) {
        return { inputPerM: p.input, outputPerM: p.output, source: "LLM_PRICES_JSON" };
      }
    } catch {
      console.warn("[llm] LLM_PRICES_JSON is not valid JSON; using the built-in price table");
    }
  }
  return PRICES[model] ?? UNKNOWN_MODEL_PRICE;
}

/** US$ for one call from the usage the vendor returned (upper bound: all prompt tokens at the cache-miss price). */
export function costUsd(model: string, usage: Pick<ChatUsage, "promptTokens" | "completionTokens">, env: Env = process.env): number {
  const p = priceFor(model, env);
  return (Math.max(0, usage.promptTokens) * p.inputPerM + Math.max(0, usage.completionTokens) * p.outputPerM) / 1_000_000;
}

/**
 * Worst-case US$ before a call: prompt tokens estimated as UTF-8 bytes / 3 (one CJK character is 3 bytes and about
 * one token; English is about 4 characters a token, so this over-counts), images at IMAGE_TOKENS each, and the full
 * max_tokens as output.
 */
export function estimateUsd(model: string, input: { text: string; images?: number; maxTokens?: number }, env: Env = process.env): number {
  const p = priceFor(model, env);
  const promptTokens = Math.ceil(Buffer.byteLength(input.text, "utf8") / 3) + (input.images ?? 0) * IMAGE_TOKENS;
  const outTokens = input.maxTokens && input.maxTokens > 0 ? input.maxTokens : 2000;
  return (promptTokens * p.inputPerM + outTokens * p.outputPerM) / 1_000_000;
}

export interface SpendEntry {
  at: string;
  provider: string;
  model: string;
  purpose: LlmPurpose;
  ok: boolean;
  /** LlmError code when the call failed (never the message: it can echo request text) */
  error: string | null;
  attempts: number;
  latency_ms: number;
  prompt_tokens: number;
  cache_hit_tokens: number;
  cache_miss_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  usd: number;
  /** true when usd is the pre-call estimate (a timed-out attempt the vendor may still bill) */
  estimated: boolean;
  /** LLM_RUN_LABEL of the process that made the call (filled in by record()) */
  run?: string;
  /** process id of the process that made the call (filled in by record()) */
  pid?: number;
}

/** LLM_RUN_LABEL when it is a short plain label, else "pid:<process id>". */
export function runLabel(env: Env = process.env): string {
  const raw = env.LLM_RUN_LABEL;
  return raw && /^[\w.:-]{1,40}$/.test(raw) ? raw : `pid:${process.pid}`;
}

/** US$ of one ledger line as counted against the cap: a finite number, never below 0. */
export function countedUsd(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * Fix round 3: what a ledger line that was cut off counts for (a process killed while appending, a disk that filled up):
 * the last line before its newline arrives, or a line that starts like a ledger line ({"at":") but is not whole JSON.
 * Its real US$ is unknown, so it counts as more than any one call this app makes (the costliest, deepseek-v4-pro with an
 * image and its full max_tokens, is about US$0.03): the spend is never under-counted. Any other line that is not a ledger
 * line is still damage (corrupt_line: every paid call refused).
 */
export const TRUNCATED_LINE_USD = 0.25;
/** A cut-off last line older than this (the file unchanged since) is a dead write: the next line starts on a new line. */
const STALE_PARTIAL_MS = 2000;
const LEDGER_LINE_START = /^\{"at":/;

export interface LedgerOptions {
  /** null = in memory only (unless `unavailable` is set) */
  file: string | null;
  /** no ledger can be kept (web/ not found: "no_web_root"): every paid call is refused, fail closed */
  unavailable?: string | null;
  capUsd: number;
  windowMs: number;
  now?: () => number;
  /** print one line per call (no content) */
  log?: boolean;
}

export interface SpendSummary {
  file: string | null;
  capUsd: number;
  windowHours: number;
  spentUsd: number;
  inFlightUsd: number;
  remainingUsd: number;
  calls: number;
  /** set when the ledger cannot be read or written: every paid call is refused until it can (fail closed) */
  ledgerError?: string;
  /** calls that happened but are not in the file yet (counted against the cap, written before the next call) */
  unwritten?: number;
  /** cut-off lines in the window, each counted as TRUNCATED_LINE_USD (fix round 3) */
  truncatedLines?: number;
}

/** The fail-closed error: the file-system code only (never the path, which may name a user folder). */
function ledgerError(code: string): LlmError & { ledgerCode: string } {
  return Object.assign(new LlmError("ledger_unavailable", `spend ledger unavailable (${code}): no paid model call until it can be read and written`, 507), { ledgerCode: code });
}

const fsCode = (e: unknown): string => (e as NodeJS.ErrnoException)?.code ?? "error";

/**
 * For a ledger path that does not exist: "ENOTDIR" when the nearest existing folder above it is not a folder (a path
 * under a regular file), the file-system code when that folder cannot be checked, else null (the file can be created).
 */
function blockingAncestor(file: string): string | null {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    try {
      return statSync(dir).isDirectory() ? null : "ENOTDIR";
    } catch (e) {
      const code = fsCode(e);
      if (code !== "ENOENT") return code;
    }
    if (path.dirname(dir) === dir) return null;
  }
}

export class SpendLedger {
  readonly file: string | null;
  readonly unavailable: string | null;
  readonly capUsd: number;
  readonly windowMs: number;
  private readonly now: () => number;
  private readonly log: boolean;
  private rows: { t: number; usd: number; pid?: number; run?: string; truncated?: boolean }[] = [];
  private offset = 0;
  private partial = "";
  /** when the cut-off last line was first seen (it counts from then until it is whole or the window passes it) */
  private partialSince = 0;
  private inFlight = 0;
  /** lines of calls that happened but could not be appended: counted, and written before the next call */
  private unwritten: { t: number; usd: number; line: string }[] = [];
  /** a damaged line was read: every paid call is refused until the file is repaired, moved or truncated (fix round 2) */
  private corrupted = false;

  private corrupt(): LlmError {
    this.corrupted = true;
    return ledgerError("corrupt_line");
  }

  constructor(opts: LedgerOptions) {
    this.file = opts.file;
    this.unavailable = opts.unavailable ?? null;
    this.capUsd = opts.capUsd;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? false;
  }

  /**
   * Pick up lines appended to the file since the last read (by this or any other process). Throws LlmError
   * "ledger_unavailable" when the file exists but cannot be read, or the path is not a file.
   */
  private sync(): void {
    if (this.unavailable) throw ledgerError(this.unavailable);
    if (!this.file) return;
    let size: number;
    try {
      const st = statSync(this.file);
      if (!st.isFile()) throw ledgerError("not_a_file");
      size = st.size;
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (fsCode(e) !== "ENOENT") throw ledgerError(fsCode(e));
      // "no file yet" only when the file could be created there: on Windows a path under a regular file is ENOENT
      // too (POSIX says ENOTDIR), and reserve() could never write it (fix round 1: summary() reported a healthy ledger)
      const blocked = blockingAncestor(this.file);
      if (blocked) throw ledgerError(blocked);
      // no file yet (or it was deleted to reset the budget)
      this.rows = [];
      this.offset = 0;
      this.partial = "";
      this.corrupted = false;
      return;
    }
    if (size < this.offset) {
      // truncated or replaced (also a damaged line taken out by hand): read it again from the start
      this.rows = [];
      this.offset = 0;
      this.partial = "";
      this.corrupted = false;
    }
    if (this.corrupted) throw ledgerError("corrupt_line");
    if (size === this.offset) return;
    let fd: number;
    try {
      fd = openSync(this.file, "r");
    } catch (e) {
      throw ledgerError(fsCode(e));
    }
    try {
      const buf = Buffer.alloc(size - this.offset);
      let n: number;
      try {
        n = readSync(fd, buf, 0, buf.length, this.offset);
      } catch (e) {
        throw ledgerError(fsCode(e));
      }
      this.offset += n;
      const text = this.partial + buf.subarray(0, n).toString("utf8");
      const lines = text.split("\n");
      const partial = lines.pop() ?? "";
      if (partial && partial !== this.partial) this.partialSince = this.now();
      this.partial = partial;
      const parsed: SpendLedger["rows"] = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        // fix round 2 (fail closed): a line that is not a ledger line (not JSON, no time, a usd that is not a finite
        // number) means the ledger was damaged, and what it hid cannot be counted. It used to count as US$0, so a
        // damaged ledger under-counted the spend. Every paid call is now refused ("corrupt_line") until a person
        // repairs or moves the file; summary() reports it.
        let e: { at?: unknown; usd?: unknown; pid?: unknown; run?: unknown };
        try {
          e = JSON.parse(line) as { at?: unknown; usd?: unknown; pid?: unknown; run?: unknown };
        } catch {
          // fix round 3: a ledger line cut off by a dead write (it starts as one) counts as TRUNCATED_LINE_USD at its own
          // time when that is readable, else from now; anything else is damage
          if (!LEDGER_LINE_START.test(line)) throw this.corrupt();
          const at = Date.parse(/^\{"at":"([^"]{20,30})"/.exec(line)?.[1] ?? "");
          parsed.push({ t: Number.isFinite(at) ? at : this.now(), usd: TRUNCATED_LINE_USD, truncated: true });
          continue;
        }
        const t = e && typeof e === "object" && typeof e.at === "string" ? Date.parse(e.at) : NaN;
        if (!Number.isFinite(t) || typeof e.usd !== "number" || !Number.isFinite(e.usd)) throw this.corrupt();
        parsed.push({ t, usd: countedUsd(e.usd), ...(typeof e.pid === "number" ? { pid: e.pid } : {}), ...(typeof e.run === "string" ? { run: e.run } : {}) });
      }
      this.rows.push(...parsed);
    } finally {
      closeSync(fd);
    }
  }

  /**
   * US$ recorded in the window (excludes calls in flight; includes calls not written to the file yet). Throws
   * LlmError "ledger_unavailable" when the file cannot be read.
   */
  spentUsd(): number {
    this.sync();
    const cutoff = this.now() - this.windowMs;
    this.rows = this.rows.filter((r) => r.t > cutoff);
    // a cut-off last line (no newline yet) counts as TRUNCATED_LINE_USD until it is whole (fix round 3: it counted as 0)
    const partial = this.partial.trim() && this.partialSince > cutoff ? TRUNCATED_LINE_USD : 0;
    return this.rows.reduce((s, r) => s + r.usd, 0) + this.unwritten.filter((r) => r.t > cutoff).reduce((s, r) => s + r.usd, 0) + partial;
  }

  /**
   * US$ in the file and in memory from calls this process made since `sinceMs` (its process id on the line): the "spend
   * this run" of one script, whatever other processes spent at the same time (fix round 3: the eval used to report the
   * window's difference, other processes' calls included).
   */
  spentByThisProcess(sinceMs: number): number {
    this.sync();
    const mine = (r: { t: number; pid?: number }) => r.t >= sinceMs && r.pid === process.pid;
    const unwritten = this.unwritten.filter((r) => r.t >= sinceMs).reduce((s, r) => s + r.usd, 0);
    return round6(this.rows.filter(mine).reduce((s, r) => s + r.usd, 0) + unwritten);
  }

  /** The window's numbers; never throws (a ledger that cannot be read or written reports ledgerError and nothing remaining). */
  summary(): SpendSummary {
    const base = { file: this.file, capUsd: this.capUsd, windowHours: this.windowMs / 3_600_000, inFlightUsd: round6(this.inFlight) };
    const unwritten = this.unwritten.length ? { unwritten: this.unwritten.length } : {};
    const codeOf = (e: unknown) => (e as { ledgerCode?: string }).ledgerCode ?? fsCode(e);
    let spent: number;
    try {
      spent = this.spentUsd();
    } catch (e) {
      return { ...base, spentUsd: 0, remainingUsd: 0, calls: this.rows.length + this.unwritten.length, ...unwritten, ledgerError: codeOf(e) };
    }
    // fix round 3: the same file-system test reserve() makes, without writing (a read-only ledger file was reported
    // healthy while every paid call was refused with EPERM); the spend read so far is still reported
    let writeError: string | null = null;
    try {
      this.probeWritable();
    } catch (e) {
      writeError = codeOf(e);
    }
    const truncated = this.rows.filter((r) => r.truncated).length + (this.partial.trim() ? 1 : 0);
    const ledgerErrorCode = writeError ?? (this.unwritten.length ? "unwritten_calls" : null);
    return {
      ...base,
      spentUsd: round6(spent),
      remainingUsd: writeError ? 0 : round6(Math.max(0, this.capUsd - spent - this.inFlight)),
      calls: this.rows.length + this.unwritten.length,
      ...unwritten,
      ...(truncated ? { truncatedLines: truncated } : {}),
      ...(ledgerErrorCode ? { ledgerError: ledgerErrorCode } : {}),
    };
  }

  /**
   * Could the ledger take a line now? reserve()'s test (assertWritable) without writing anything: an existing file must
   * open for writing (a read-only file: EPERM / EACCES); a missing one is created by reserve() (sync() already refused a
   * path under a regular file or a folder). Throws LlmError "ledger_unavailable".
   */
  private probeWritable(): void {
    if (this.unavailable) throw ledgerError(this.unavailable);
    if (!this.file) return;
    let fd: number | null = null;
    try {
      fd = openSync(this.file, "r+");
    } catch (e) {
      if (fsCode(e) === "ENOENT") return;
      throw ledgerError(fsCode(e));
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }

  /**
   * Before a paid call: the ledger must take a line now. A zero-byte append proves the file (and its folder) can be
   * written and creates them when missing; lines kept in memory after an earlier failed write are written first.
   * Throws LlmError "ledger_unavailable" otherwise.
   */
  private assertWritable(): void {
    if (this.unavailable) throw ledgerError(this.unavailable);
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      appendFileSync(this.file, "", "utf8");
      if (this.unwritten.length) {
        appendFileSync(this.file, this.repairPrefix() + this.unwritten.map((r) => r.line + "\n").join(""), "utf8");
        // written: from now on they come back through sync() like every other line
        this.unwritten = [];
      }
    } catch (e) {
      throw ledgerError(fsCode(e));
    }
  }

  /**
   * Hold `usd` (the call's worst case) against the cap until the call is recorded. Throws LlmError "budget" (402)
   * when the window's spend plus everything in flight plus this call would pass the cap, and LlmError
   * "ledger_unavailable" (507) when the ledger cannot be read or written (fail closed). Returns the release.
   */
  reserve(usd: number): () => void {
    this.assertWritable();
    const spent = this.spentUsd();
    if (spent + this.inFlight + usd > this.capUsd) {
      throw new LlmError(
        "budget",
        `model spend cap reached: US$${spent.toFixed(4)} spent in the last ${this.windowMs / 3_600_000} h (+US$${this.inFlight.toFixed(4)} in flight), cap US$${this.capUsd}`,
        402,
      );
    }
    this.inFlight += usd;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight = Math.max(0, this.inFlight - usd);
    };
  }

  /**
   * "\n" when the file's last line was cut off by a dead write (no newline at the end and the file unchanged for
   * STALE_PARTIAL_MS), so the next line starts on a line of its own instead of being glued onto it (fix round 3: the glued
   * line was damage, and one interrupted write stopped every paid call). The cut-off line then counts as
   * TRUNCATED_LINE_USD. A line being written right now (a fresh one) is left alone.
   */
  private repairPrefix(): string {
    if (!this.file) return "";
    let fd: number | null = null;
    try {
      const st = statSync(this.file);
      if (!st.isFile() || st.size === 0 || this.now() - st.mtimeMs < STALE_PARTIAL_MS) return "";
      fd = openSync(this.file, "r");
      const last = Buffer.alloc(1);
      readSync(fd, last, 0, 1, st.size - 1);
      return last[0] === 0x0a ? "" : "\n";
    } catch {
      return "";
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }

  record(entry: SpendEntry): void {
    const usd = countedUsd(entry.usd);
    const run = entry.run ?? runLabel();
    const pid = entry.pid ?? process.pid;
    const line = JSON.stringify({ ...entry, usd: round6(usd), run, pid });
    if (this.file) {
      try {
        if (this.unwritten.length) throw Object.assign(new Error("earlier lines unwritten"), { code: "EUNWRITTEN" });
        mkdirSync(path.dirname(this.file), { recursive: true });
        appendFileSync(this.file, this.repairPrefix() + line + "\n", "utf8");
      } catch (e) {
        // the call already happened and its answer stands; the spend is kept in memory (it still counts against the
        // cap) and every later call is refused until the ledger takes it (assertWritable): fail closed
        console.error("[llm] could not write the spend ledger:", fsCode(e), "- paid calls are refused until it can be written");
        this.unwritten.push({ t: Date.parse(entry.at), usd, line });
      }
    } else {
      this.rows.push({ t: Date.parse(entry.at), usd, pid, run });
    }
    if (this.log) {
      const s = this.summary();
      console.info(
        `[llm] ${entry.provider}/${entry.model} ${entry.purpose} ${entry.ok ? "ok" : `failed (${entry.error})`} ${entry.latency_ms} ms` +
          ` · in ${entry.prompt_tokens} (cache hit ${entry.cache_hit_tokens}) out ${entry.completion_tokens}` +
          ` · US$${entry.usd.toFixed(5)}${entry.estimated ? " (estimate)" : ""} · window US$${s.spentUsd.toFixed(4)} of ${this.capUsd}`,
      );
    }
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function spendCapUsd(env: Env = process.env): number {
  const n = Number(env.LLM_SPEND_CAP_USD);
  return env.LLM_SPEND_CAP_USD !== undefined && env.LLM_SPEND_CAP_USD !== "" && Number.isFinite(n) && n >= 0 ? n : 5;
}

/** One person's model spend per local day, US$ (real-app 3.5: 0.20; LLM_PERSON_SPEND_CAP_USD). Counted in person-spend.ts. */
export function personSpendCapUsd(env: Env = process.env): number {
  const n = Number(env.LLM_PERSON_SPEND_CAP_USD);
  return env.LLM_PERSON_SPEND_CAP_USD !== undefined && env.LLM_PERSON_SPEND_CAP_USD !== "" && Number.isFinite(n) && n >= 0 ? n : 0.2;
}

export function spendWindowMs(env: Env = process.env): number {
  const n = Number(env.LLM_SPEND_WINDOW_HOURS);
  return (Number.isFinite(n) && n > 0 ? n : 24) * 3_600_000;
}

/**
 * Where the ledger is: LLM_SPEND_LOG; else nothing (in memory) under vitest; else web/.data/llm-spend.jsonl found by
 * root.ts findWebRoot. When web/ cannot be found at all, there is no file and `unavailable` says why: that ledger
 * refuses every paid call (fix round 1: a fresh ledger in some other folder would restart the cap from 0).
 */
export function resolveSpendLog(env: Env = process.env, findRoot: () => string | null = () => findWebRoot()): { file: string | null; unavailable: string | null } {
  // vitest first (fix round 2): with LLM_SPEND_LOG exported in the shell, unit tests' fake calls were appended to the
  // shared ledger. A test that wants a file passes it with LLM_SPEND_LOG_IN_TESTS=1 (or builds its own SpendLedger).
  if (env.VITEST && env.LLM_SPEND_LOG_IN_TESTS !== "1") return { file: null, unavailable: null };
  if (env.LLM_SPEND_LOG) return { file: path.resolve(env.LLM_SPEND_LOG), unavailable: null };
  const root = findRoot();
  return root ? { file: path.join(root, ".data", "llm-spend.jsonl"), unavailable: null } : { file: null, unavailable: "no_web_root" };
}

/** The ledger file, or null for an in-memory ledger (vitest without LLM_SPEND_LOG) or when web/ cannot be found. */
export function spendLogPath(env: Env = process.env): string | null {
  return resolveSpendLog(env).file;
}

type GlobalWithLedger = typeof globalThis & { __rippleSpendLedgers?: Map<string, SpendLedger> };

/** The process-wide ledger for this configuration (one per file, shared by every client in the process). */
export function getSpendLedger(env: Env = process.env): SpendLedger {
  const g = globalThis as GlobalWithLedger;
  g.__rippleSpendLedgers ??= new Map();
  const { file, unavailable } = resolveSpendLog(env);
  const cap = spendCapUsd(env);
  const windowMs = spendWindowMs(env);
  const key = `${file ?? (unavailable ? `:unavailable:${unavailable}` : ":memory:")}|${cap}|${windowMs}`;
  let ledger = g.__rippleSpendLedgers.get(key);
  if (!ledger) {
    ledger = new SpendLedger({ file, unavailable, capUsd: cap, windowMs, log: file !== null && env.LLM_LOG_SPEND !== "0" });
    g.__rippleSpendLedgers.set(key, ledger);
  }
  return ledger;
}
