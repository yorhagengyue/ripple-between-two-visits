/**
 * The per-person model spend cap (C2 track S, round 2; real-app 3.5 「DeepSeek 花费，每人 / 全站：每天 US$0.20 / 24 小时 US$5
 * ……不发请求，安全层照旧把关」). Server-only.
 *
 * The site-wide cap is the ledger file (spend.ts: every paid call of every process, a rolling 24 hours). This is the other
 * half: what one person's requests cost today. It is counted where a restart or a second instance cannot reset it, in the
 * store's rate_limit buckets (store.rateAdd, 0015_l_rate_add.sql), as whole micro-dollars (1 US$ = 1,000,000), one bucket
 * per person and local calendar day:
 *
 *   who     an account's user, else the demo scope (usagePerson); the bucket is named by an HMAC of it (RATE_LIMIT_SALT,
 *           lib/auth/limits.ts bucketKey), never the id
 *   day     the person's own calendar day: the scope's time zone (Asia/Singapore unless it says otherwise) on the
 *           scope's own clock (a filming account's offset included), not the UTC day
 *   cap     LLM_PERSON_SPEND_CAP_USD, default 0.20 (spend.ts personSpendCapUsd)
 *   price   what the client reports for the call (ChatResult.usd: spend.ts costUsd, the cache-miss peak price, an upper
 *           bound); the offline mock and the replay cassettes report nothing and cost nothing
 *
 * Over the cap no request is sent for that person: capped() is asked before the first model call of a piece of work, and
 * the caller then does what it does without a model (an ask: the rules and fixed templates, lib/safety/pipeline.ts; a
 * translation: none, the original words alone). The cap is checked once per piece of work, so the calls of one answer can
 * take a person a little past it, by at most that answer's cost. A call that failed is not counted here (its cost is not
 * known to the caller; the site ledger charges its estimate).
 *
 * Counting never costs him the answer: a store that cannot count (the migration not applied yet, a read that fails) is
 * logged once and the work goes on, bounded by the site-wide cap.
 */
import { bucketKey } from "@/lib/auth/limits";
import type { SessionRow, Store } from "@/lib/store/types";
import { DEFAULT_TZ, localParts, scopeNowMs, zonedTimeToUtcMs } from "@/lib/time/clock";
import { nowMs as appNowMs } from "@/lib/time/now";
import { personSpendCapUsd } from "./spend";
import type { LlmClient } from "./types";

type Env = Record<string, string | undefined>;

/** Who a per-person counter counts, and what time it is for them. */
export interface UsagePerson {
  /** "u:<user id>" for an account, "s:<scope id>" for a demo scope */
  key: string;
  /** IANA time zone of the person's calendar */
  tz: string;
  /** the person's own clock in epoch ms (the app's clock, plus a filming account's offset) */
  nowMs: () => number;
}

type ScopeForUsage = Pick<SessionRow, "id"> & Partial<Pick<SessionRow, "kind" | "owner_user_id" | "tz" | "filming" | "clock_offset_ms">>;

/** The person behind a scope: an account's owner, else the demo scope itself (a sandbox has no user). */
export function usagePerson(scope: ScopeForUsage, now: () => number = appNowMs): UsagePerson {
  const account = scope.kind === "account";
  return {
    key: account ? `u:${scope.owner_user_id ?? scope.id}` : `s:${scope.id}`,
    tz: scope.tz && scope.tz.trim() ? scope.tz : DEFAULT_TZ,
    nowMs: () => scopeNowMs({ kind: scope.kind ?? "sandbox", filming: scope.filming ?? false, clock_offset_ms: scope.clock_offset_ms ?? null }, now()),
  };
}

export interface LocalMoment {
  /** "YYYY-MM-DD" in the person's zone */
  date: string;
  /** "HH" (00-23) in the person's zone */
  hour: string;
  /** seconds until the next full hour on the person's clock (at least 1) */
  toNextHourS: number;
  /** seconds until the person's next midnight (at least 1) */
  toMidnightS: number;
}

const nextDate = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** The person's calendar hour and day at this instant, and how long each still lasts. */
export function localMoment(person: Pick<UsagePerson, "tz" | "nowMs">): LocalMoment {
  const t = person.nowMs();
  const p = localParts(t, person.tz);
  const [hh, mm] = p.time.split(":").map(Number);
  const midnight = zonedTimeToUtcMs(nextDate(p.date), "00:00", person.tz);
  return {
    date: p.date,
    hour: String(hh).padStart(2, "0"),
    toNextHourS: Math.max(1, 3600 - (mm * 60 + p.seconds)),
    toMidnightS: Math.max(1, Math.ceil((midnight - t) / 1000)),
  };
}

/** A bucket's name for one person: `<prefix>:<hmac of the person>:<period>`. */
export function usageBucket(prefix: string, person: Pick<UsagePerson, "key">, period: string, env: Env = process.env): string {
  return `${prefix}:${bucketKey("user", person.key, env)}:${period}`;
}

/** A day bucket outlives its day (the name carries the date), so it never starts again inside it. */
export const DAY_BUCKET_WINDOW_S = 2 * 86_400;

export const MICRO = 1_000_000;

export type SpendStore = Pick<Store, "rateAdd" | "getRateWindow">;

const warned = new Set<string>();
/** Say once per process that a counter could not be read or written (never the person, never a message with data). */
export function warnCounterOnce(what: string, err: unknown): void {
  if (warned.has(what)) return;
  warned.add(what);
  const code = (err as { code?: unknown } | null)?.code;
  console.warn(`[usage] ${what} could not be counted (${typeof code === "string" ? code : "error"}); going on without it. If rp_rate_add is missing, apply supabase/migrations/0015_l_rate_add.sql.`);
}

/** One person's model spend today (see the header). One per piece of work: it reads the bucket once and writes once. */
export class PersonSpend {
  private read: Promise<number> | null = null;
  private pendingMicro = 0;
  private writing: Promise<void> = Promise.resolve();
  private readonly env: Env;
  readonly capUsd: number;

  constructor(
    private readonly store: SpendStore,
    private readonly person: UsagePerson,
    opts: { capUsd?: number; env?: Env } = {},
  ) {
    this.env = opts.env ?? process.env;
    this.capUsd = opts.capUsd ?? personSpendCapUsd(this.env);
  }

  private bucket(): string {
    return usageBucket("llm:u", this.person, localMoment(this.person).date, this.env);
  }

  /** US$ counted for this person today, as it stood when this piece of work began (read once). */
  spentUsd(): Promise<number> {
    this.read ??= this.store
      .getRateWindow(this.bucket())
      .then((w) => (w?.count ?? 0) / MICRO)
      .catch((err: unknown) => {
        warnCounterOnce("a person's model spend", err);
        return 0;
      });
    return this.read;
  }

  /** Today's cap is used up: send no request for this person. */
  async capped(): Promise<boolean> {
    return (await this.spentUsd()) >= this.capUsd;
  }

  /** A call was paid for (US$, the client's own figure). Kept until settle(). */
  add(usd: number | undefined | null): void {
    if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) this.pendingMicro += Math.ceil(usd * MICRO);
  }

  /** Write what was added since the last time; resolves once the counter holds it. Never throws. */
  settle(): Promise<void> {
    const micro = this.pendingMicro;
    this.pendingMicro = 0;
    if (micro > 0) {
      const cap = Math.round(this.capUsd * MICRO);
      this.writing = this.writing.then(() =>
        this.store.rateAdd(this.bucket(), DAY_BUCKET_WINDOW_S, cap, micro).then(
          () => undefined,
          (err: unknown) => warnCounterOnce("a person's model spend", err),
        ),
      );
    }
    return this.writing;
  }

  /** The same client, with every call it makes for this person added to their spend (settle() writes it). */
  wrap<T extends LlmClient | null>(client: T): T {
    if (!client) return client;
    const inner: LlmClient = client;
    const wrapped: LlmClient = {
      provider: inner.provider,
      model: inner.model,
      chat: async (opts) => {
        const res = await inner.chat(opts);
        this.add(res.usd);
        return res;
      },
    };
    return wrapped as T;
  }
}
