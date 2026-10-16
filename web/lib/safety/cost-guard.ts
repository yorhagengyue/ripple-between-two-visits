/**
 * Cost guard for 问一句 (M1 item 6; real-app 3.5 「问一句，每人：每小时 60 次、每天 20 万 token」, 6.11 「成本保护按范围计，对账号
 * 就是按人」). Two guards behind one interface (AskGuard):
 *
 *   StoreCostGuard   what the app uses (C2 track S, round 2). The counts live in the store's rate_limit buckets, like
 *                    lib/auth/limits.ts, so a restart or a second instance does not reset them:
 *                      questions   one hit per ask in the bucket of the person's clock hour (store.rateHit); over the
 *                                  limit the hour's remaining questions are refused, and asking works again at the next
 *                                  full hour (「这个小时问得太多了，11:00 以后再问」)
 *                      tokens      the model tokens of his asks, summed in the bucket of his calendar day
 *                                  (store.rateAdd); at the limit, questions are refused until his next midnight
 *                      spend       the US$ of his model calls today (lib/llm/person-spend.ts): at the cap nothing is
 *                                  refused, the answer is made with no model call (rules and fixed templates)
 *                    "His" hour and day are the scope's own: its time zone (Asia/Singapore unless it says otherwise) on
 *                    its own clock, never the UTC day. Who is counted: an account's user, a demo scope by itself
 *                    (person-spend.ts usagePerson), the bucket named by an HMAC of it. One guard per ask: prepare()
 *                    starts the three reads at once (the route calls it next to his consent), admit() decides, the
 *                    tokens and the spend are written once at the end (settle()).
 *   CostGuard        the same two limits in memory, per key, with a sliding hour and the UTC day: for unit tests and
 *                    scripts that pass their own guard (ask()'s `costGuard`).
 *
 * Limits: COST_REQ_PER_HOUR (default 60) and COST_TOKENS_PER_DAY (default 200000), both from web/.env;
 * LLM_PERSON_SPEND_CAP_USD (default 0.20, lib/llm/spend.ts).
 * Crisis answers (emergency, self-harm, unknown medicine) use no model and are never refused by a guard; a note and a
 * message near crisis words are answered over the limit too, by the rules alone (lib/safety/pipeline.ts).
 * Counting never costs him an answer: a counter that cannot be read or written is logged once and the ask goes on.
 */
import { DAY_BUCKET_WINDOW_S, localMoment, PersonSpend, usageBucket, usagePerson, warnCounterOnce, type UsagePerson } from "@/lib/llm/person-spend";
import type { SessionRow, Store } from "@/lib/store/types";

export interface CostLimits {
  requestsPerHour: number;
  tokensPerDay: number;
}

export function costLimits(env: Record<string, string | undefined> = process.env): CostLimits {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
  };
  return { requestsPerHour: num(env.COST_REQ_PER_HOUR, 60), tokensPerDay: num(env.COST_TOKENS_PER_DAY, 200_000) };
}

export type CostDenial = "requests_per_hour" | "tokens_per_day";

export class CostLimitError extends Error {
  readonly limit: CostDenial;
  readonly retryAfterSec: number;
  constructor(limit: CostDenial, retryAfterSec: number) {
    super(limit === "requests_per_hour" ? "Too many questions this hour for this session" : "Daily model budget for this session is used up");
    this.name = "CostLimitError";
    this.limit = limit;
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * What ask() needs of a guard. admit() counts one ask and throws CostLimitError when a limit is reached (never for an
 * exempt one); addTokens() adds the model tokens an answer used. The per-person spend (optional): spendCapped() says
 * today's US$ are used up, addSpend() adds a paid call, settle() writes what the ask used.
 */
export interface AskGuard {
  admit(sessionId: string, opts?: { exempt?: boolean }): void | Promise<void>;
  /**
   * owner 10-15: after an exempt admit (a crisis the rules found is always answered), whether he is over a limit all the
   * same; the crisis answer then keeps its fixed sentences and asks no model to word them (crisis-words.ts)
   */
  overLimit?(sessionId: string): boolean | Promise<boolean>;
  addTokens(sessionId: string, tokens: number): void | Promise<void>;
  spendCapped?(): boolean | Promise<boolean>;
  addSpend?(usd: number | undefined | null): void;
  settle?(): Promise<void>;
}

interface SessionUsage {
  requests: number[]; // epoch ms
  tokenDay: string; // YYYY-MM-DD (UTC)
  tokens: number;
}

const HOUR_MS = 3_600_000;

export class CostGuard implements AskGuard {
  private usage = new Map<string, SessionUsage>();
  constructor(
    private limits: CostLimits = costLimits(),
    private now: () => number = Date.now,
  ) {}

  private get(sessionId: string): SessionUsage {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    let u = this.usage.get(sessionId);
    if (!u) {
      u = { requests: [], tokenDay: today, tokens: 0 };
      this.usage.set(sessionId, u);
    }
    if (u.tokenDay !== today) {
      u.tokenDay = today;
      u.tokens = 0;
    }
    const cutoff = this.now() - HOUR_MS;
    u.requests = u.requests.filter((t) => t > cutoff);
    return u;
  }

  /** Count one request. Throws CostLimitError when a limit is reached (unless exempt). */
  admit(sessionId: string, opts: { exempt?: boolean } = {}): void {
    const u = this.get(sessionId);
    if (!opts.exempt) {
      if (u.requests.length >= this.limits.requestsPerHour) {
        const retry = Math.max(1, Math.ceil((u.requests[0] + HOUR_MS - this.now()) / 1000));
        throw new CostLimitError("requests_per_hour", retry);
      }
      if (u.tokens >= this.limits.tokensPerDay) {
        const midnight = new Date(this.now());
        midnight.setUTCHours(24, 0, 0, 0);
        throw new CostLimitError("tokens_per_day", Math.max(1, Math.ceil((midnight.getTime() - this.now()) / 1000)));
      }
    }
    u.requests.push(this.now());
  }

  overLimit(sessionId: string): boolean {
    const u = this.get(sessionId);
    // (admit counted this ask already)
    return u.requests.length > this.limits.requestsPerHour || u.tokens >= this.limits.tokensPerDay;
  }

  addTokens(sessionId: string, tokens: number): void {
    if (tokens > 0) this.get(sessionId).tokens += tokens;
  }

  snapshot(sessionId: string): { requestsLastHour: number; tokensToday: number; limits: CostLimits } {
    const u = this.get(sessionId);
    return { requestsLastHour: u.requests.length, tokensToday: u.tokens, limits: { ...this.limits } };
  }

  reset(sessionId?: string): void {
    if (sessionId) this.usage.delete(sessionId);
    else this.usage.clear();
  }
}

type GlobalWithGuard = typeof globalThis & { __rippleCostGuard?: CostGuard };

/** A process-wide in-memory guard (scripts and tests; the app counts in the store: storeCostGuard). */
export function getCostGuard(): CostGuard {
  const g = globalThis as GlobalWithGuard;
  g.__rippleCostGuard ??= new CostGuard();
  return g.__rippleCostGuard;
}

// ---------------------------------------------------------------- counted in the store (C2 track S, round 2)

/** The store methods the counters use (lib/subject/usage.ts usageStore hands out exactly these). */
export type CostStore = Pick<Store, "rateHit" | "rateAdd" | "getRateWindow">;

/** The hour bucket outlives its hour (its name carries the hour), so it never starts again inside it. */
const HOUR_BUCKET_WINDOW_S = 3600;

interface Begun {
  /** asks counted in his clock hour, this one included; null when the counter could not be read */
  requests: number | null;
  /** model tokens counted today before this ask */
  tokens: number;
  toNextHourS: number;
  toMidnightS: number;
}

/** One ask's guard for one person (see the header). */
export class StoreCostGuard implements AskGuard {
  private begun: Promise<Begun> | null = null;
  private pendingTokens = 0;
  private writing: Promise<void> = Promise.resolve();
  private readonly spend: PersonSpend;
  private readonly env: Record<string, string | undefined>;
  readonly limits: CostLimits;

  constructor(
    private readonly store: CostStore,
    private readonly person: UsagePerson,
    opts: { limits?: CostLimits; spendCapUsd?: number; env?: Record<string, string | undefined> } = {},
  ) {
    this.env = opts.env ?? process.env;
    this.limits = opts.limits ?? costLimits(this.env);
    this.spend = new PersonSpend(store, person, { capUsd: opts.spendCapUsd, env: this.env });
  }

  private hourBucket(m: { date: string; hour: string }): string {
    return usageBucket("ask:h", this.person, `${m.date}T${m.hour}`, this.env);
  }

  private dayBucket(m: { date: string }): string {
    return usageBucket("ask:t", this.person, m.date, this.env);
  }

  /** Count this ask and read today's tokens and spend, side by side, once (the route starts it early). */
  prepare(): Promise<void> {
    return this.begin().then(() => undefined);
  }

  private begin(): Promise<Begun> {
    this.begun ??= (async () => {
      const m = localMoment(this.person);
      const [hit, day] = await Promise.all([
        this.store.rateHit(this.hourBucket(m), HOUR_BUCKET_WINDOW_S, this.limits.requestsPerHour).catch((err: unknown) => {
          warnCounterOnce("the questions of an hour", err);
          return null;
        }),
        this.store.getRateWindow(this.dayBucket(m)).catch((err: unknown) => {
          warnCounterOnce("the model tokens of a day", err);
          return null;
        }),
        this.spend.spentUsd(),
      ]);
      return { requests: hit ? hit.count : null, tokens: day?.count ?? 0, toNextHourS: m.toNextHourS, toMidnightS: m.toMidnightS };
    })();
    return this.begun;
  }

  /** Throws CostLimitError when his hour's questions or his day's tokens are used up (never for an exempt ask). */
  async admit(_sessionId: string, opts: { exempt?: boolean } = {}): Promise<void> {
    const b = await this.begin();
    if (opts.exempt) return;
    if (b.requests !== null && b.requests > this.limits.requestsPerHour) throw new CostLimitError("requests_per_hour", b.toNextHourS);
    if (b.tokens >= this.limits.tokensPerDay) throw new CostLimitError("tokens_per_day", b.toMidnightS);
  }

  async overLimit(): Promise<boolean> {
    const b = await this.begin();
    return (b.requests !== null && b.requests > this.limits.requestsPerHour) || b.tokens >= this.limits.tokensPerDay;
  }

  addTokens(_sessionId: string, tokens: number): void {
    if (Number.isFinite(tokens) && tokens > 0) this.pendingTokens += Math.ceil(tokens);
  }

  spendCapped(): Promise<boolean> {
    return this.spend.capped();
  }

  addSpend(usd: number | undefined | null): void {
    this.spend.add(usd);
  }

  /** Write the tokens and the spend this ask used; resolves once the counters hold them. Never throws. */
  settle(): Promise<void> {
    const tokens = this.pendingTokens;
    this.pendingTokens = 0;
    if (tokens > 0) {
      const bucket = this.dayBucket(localMoment(this.person));
      this.writing = this.writing.then(() =>
        this.store.rateAdd(bucket, DAY_BUCKET_WINDOW_S, this.limits.tokensPerDay, tokens).then(
          () => undefined,
          (err: unknown) => warnCounterOnce("the model tokens of a day", err),
        ),
      );
    }
    const spent = this.spend.settle();
    return Promise.all([this.writing, spent]).then(() => undefined);
  }

  /** What the counters hold for him now (tests, the operator's look): this hour's asks, today's tokens and US$. */
  async snapshot(): Promise<{ requestsThisHour: number; tokensToday: number; spendUsdToday: number }> {
    const m = localMoment(this.person);
    const [hour, day, usd] = await Promise.all([
      this.store.getRateWindow(this.hourBucket(m)),
      this.store.getRateWindow(this.dayBucket(m)),
      new PersonSpend(this.store, this.person, { capUsd: this.spend.capUsd, env: this.env }).spentUsd(),
    ]);
    return { requestsThisHour: hour?.count ?? 0, tokensToday: day?.count ?? 0, spendUsdToday: usd };
  }
}

type ScopeForGuard = Pick<SessionRow, "id"> & Partial<Pick<SessionRow, "kind" | "owner_user_id" | "tz" | "filming" | "clock_offset_ms">>;

/** The guard of one ask for the person behind `scope`, counting in `store` (lib/subject/usage.ts usageStore()). */
export function storeCostGuard(store: CostStore, scope: ScopeForGuard, opts: { limits?: CostLimits; spendCapUsd?: number; env?: Record<string, string | undefined>; nowMs?: () => number } = {}): StoreCostGuard {
  return new StoreCostGuard(store, usagePerson(scope, opts.nowMs), opts);
}
