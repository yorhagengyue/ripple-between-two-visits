/**
 * The store bound to one scope (C2 architecture review, finding 9: "认人这一步交出一个绑好空间的存储层"). Server-only.
 *
 * requireSubject / getPageSubject (lib/subject) hand every route and page a ScopedStore instead of the process-wide
 * store. It has the Store interface, so the modules that take `store` keep working, but every call is checked first:
 *
 *   scope methods        the session id named must be this scope's id, or the call throws ScopeViolation (a server bug,
 *                        never a 404: an answer about another person's data must not be possible to ask for)
 *   user methods         the user id named must be the subject's own (his account rows, her consent, their devices)
 *   link methods         only links the subject is party to (he invites, confirms, revokes; she leaves)
 *   global methods       (creating demo sessions, listing every scope, rate limits, job leases, eval runs) are not here:
 *                        the demo entry (lib/subject/entry.ts), the jobs (lib/jobs) and scripts use their own access
 *
 * Four modes:
 *   self     his own account scope: read and write, his own account rows; the store itself still refuses the demo-only
 *            operations (story clock, reset, joining devices) for an account
 *   family   his scope read through her active care link: read only, plus a few writes, each checked: her reminder clip
 *            (by her, through this link), a profile fact she proposes (source "family", unconfirmed) and the access log
 *            of her own reads. Nothing that settles or changes his records.
 *            C2 track I (follow-up; real-app 2.24 「她看到通知」): and a fourth, the opened mark on the no-reply alert
 *            that was sent to her own link (markDeliveryOpened, checked against the stored row).
 *            Owner, 2026-10-14 (her 「留意」: a follow-up she can put on his question list with one tap), and a fifth: a
 *            question for his doctor or pharmacist in her own name (addQuestion: open, origin "own", asked_by_user_id
 *            hers, nothing answered or merged in it). No change to a question that is there: not its words, not its
 *            answer, not setting it aside, and not putting back one he set aside (asking or not is his). The words come
 *            from the server (lib/care/family-questions.ts), and the route checks his switch and that he has
 *            acknowledged her link; the store checks neither, as for every other read.
 *            The family texts asked again (owner, 2026-10-14; lib/care/reconsent.ts): her switches are read in one
 *            place, this store's getFamilyGrant, and in family mode the row's items pass through `switches` when the
 *            subject was given one (lib/subject/resolve.ts: the alert-only form while either of them has not agreed to
 *            the family text in force). Every reader of her switches gets them cut that way; his rows are not changed.
 *   system   a scheduled job working on one account scope: read and write within it
 *   demo     a judge sandbox or the crew's filming session: everything about that one session, as before
 *
 * For an account (self, family) the rows handed out carry session_id "" instead of the scope id, so no response or
 * event built from them shows it (architecture review: 真账号用的页面、链接、事件里不带空间编号). The scope row itself
 * (getSession) keeps its id for the server; pages give the browser lib/subject's masked copy.
 */
import { StoreError, type CareLinkRow, type FamilyGrantItems, type SessionRow, type Store } from "@/lib/store/types";

export type ScopeMode = "self" | "family" | "system" | "demo";

/** A route or page asked the scoped store for something outside its scope or its rights. Always a bug: 500. */
export class ScopeViolation extends Error {
  constructor(
    readonly method: string,
    readonly why: string,
  ) {
    super(`scoped store: ${method} ${why}`);
    this.name = "ScopeViolation";
  }

  /** Production builds can bundle this module more than once: recognise the error by its name. */
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && (value as { name?: unknown }).name === "ScopeViolation";
  }
}

export interface ScopedStore extends Store {
  readonly scopeId: string;
  readonly mode: ScopeMode;
  /** the subject's own user id (account modes) */
  readonly userId: string | null;
  /** her care link (family mode) */
  readonly linkId: string | null;
  /** family mode: what her switches are cut to before any reader gets them (null: as stored); her stream cuts by it too */
  readonly switches: ((items: FamilyGrantItems) => FamilyGrantItems) | null;
}

type StoreMethod = Exclude<keyof Store, "kind">;

type Rule =
  /** first argument is the scope id; reading */
  | { k: "read" }
  /** first argument is the scope id; changing his records (not in family mode) */
  | { k: "write" }
  /** first argument is the scope id; one of the few writes family mode may make, each checked */
  | { k: "familyWrite"; check?: (args: unknown[], ctx: Ctx) => string | null }
  /** first argument is the scope id; the demo-only operations (the store refuses them for an account too) */
  | { k: "demoOnly" }
  /** first argument is the scope id; the scope row's own settings (self, system) */
  | { k: "scopeAdmin" }
  /** first argument (or its user_id field) is a user id: the subject's own */
  | { k: "user"; field?: "user_id" }
  /** a care link operation, checked against the subject */
  | { k: "link"; check: (args: unknown[], ctx: Ctx, store: Store) => Promise<string | null> }
  /** never through a scoped store */
  | { k: "global" };

interface Ctx {
  scopeId: string;
  mode: ScopeMode;
  userId: string | null;
  linkId: string | null;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

/** her reminder clip: by her, through her link */
const clipByHer = (args: unknown[], ctx: Ctx): string | null => {
  const clip = args[1];
  if (!isObj(clip)) return "needs a clip";
  if (clip.by_user_id !== ctx.userId || clip.link_id !== ctx.linkId) return "a family clip must name her and her link";
  return null;
};

/** a fact she proposes: source family, not confirmed, by her, through her link */
const factProposed = (args: unknown[], ctx: Ctx): string | null => {
  const fact = args[1];
  if (!isObj(fact)) return "needs a fact";
  if (fact.source !== "family" || (fact.confirmed_by ?? null) !== null || (fact.confirmed_at ?? null) !== null) return "a family fact is a proposal (source family, unconfirmed)";
  if (fact.entered_by_user_id !== ctx.userId || fact.link_id !== ctx.linkId) return "a family fact must name her and her link";
  return null;
};

/** a question she puts on his list: open, his own kind of question, in her name, and nothing in it but its words */
const questionByHer = (args: unknown[], ctx: Ctx): string | null => {
  const q = args[1];
  if (!isObj(q)) return "needs a question";
  if (!ctx.userId || q.asked_by_user_id !== ctx.userId) return "a family question must name her";
  if (q.origin !== "own" || (q.status ?? "open") !== "open") return "a family question is an open question of origin own";
  for (const k of ["answer_text", "answer_utterance_id", "answer_visit_id", "answer_speaker", "asked_at_visit_id", "merged_into", "edited_at"]) {
    if ((q[k] ?? null) !== null) return "a family question carries no answer, no visit and no change of his";
  }
  return null;
};

/** the access log of her own reads, through her link */
const ownAccess = (args: unknown[], ctx: Ctx): string | null => {
  const entry = args[1];
  if (!isObj(entry)) return "needs an entry";
  if (entry.family_user_id !== ctx.userId || entry.link_id !== ctx.linkId) return "an access-log entry must name her and her link";
  return null;
};

async function linkOf(store: Store, id: unknown): Promise<CareLinkRow | null> {
  return typeof id === "string" ? store.getCareLink(id) : null;
}

const party = (l: CareLinkRow | null, userId: string | null) => !!l && !!userId && (l.patient_id === userId || l.family_id === userId);

/** Every Store method and how a scoped store treats it. Adding a Store method without a rule fails typecheck. */
const RULES: Record<StoreMethod, Rule> = {
  // sessions and scopes
  createSession: { k: "global" },
  getSession: { k: "read" },
  getSessionByJoinCode: { k: "global" },
  listSessions: { k: "global" },
  setStoryDay: { k: "demoOnly" },
  setFilmingMode: { k: "demoOnly" },
  resetSession: { k: "demoOnly" },
  deleteSession: { k: "global" },
  deleteExpiredSandboxes: { k: "global" },
  createAccountScope: { k: "global" },
  listAccountScopes: { k: "global" },
  updateScope: { k: "scopeAdmin" },
  setFilmingAccount: { k: "scopeAdmin" },
  setClockOffset: { k: "scopeAdmin" },
  reseedAccount: { k: "scopeAdmin" },
  addMember: { k: "demoOnly" },
  listMembers: { k: "read" },
  // his records
  listVisits: { k: "read" },
  getVisit: { k: "read" },
  upsertVisit: { k: "write" },
  updateVisit: { k: "write" },
  deleteVisit: { k: "write" }, // C2 track F: a planned follow-up he takes back in the review
  addUtterances: { k: "write" },
  listUtterances: { k: "read" },
  updateUtterance: { k: "write" },
  addVisitItems: { k: "write" },
  listVisitItems: { k: "read" },
  updateVisitItem: { k: "write" },
  listMeds: { k: "read" },
  getMed: { k: "read" },
  upsertMed: { k: "write" },
  updateMed: { k: "write" },
  deleteMed: { k: "write" }, // C2 track F: a prescription awaiting its label he takes back in the review
  logDose: { k: "write" },
  listDoses: { k: "read" },
  deleteDose: { k: "write" }, // C2 track B: his undo

  addBp: { k: "write" },
  listBp: { k: "read" },
  updateBp: { k: "write" },
  deleteBp: { k: "write" },
  addNote: { k: "write" },
  listNotes: { k: "read" },
  listQuestions: { k: "read" },
  getQuestion: { k: "read" },
  // owner 10-14: in family mode a question in her own name (checked); a question that is there is never changed by her
  addQuestion: { k: "familyWrite", check: questionByHer },
  updateQuestion: { k: "write" },
  getFamilyGrant: { k: "read" },
  setFamilyGrant: { k: "write" },
  addReminderClip: { k: "familyWrite", check: clipByHer },
  listReminderClips: { k: "read" },
  deleteReminderClip: { k: "familyWrite" }, // her own clip only: checked against the stored row below
  addSafetyEvent: { k: "write" },
  listSafetyEvents: { k: "read" },
  listProfileFacts: { k: "read" },
  addProfileFact: { k: "familyWrite", check: factProposed },
  updateProfileFact: { k: "write" },
  listPreventDone: { k: "read" },
  addPreventDone: { k: "write" },
  deletePreventDone: { k: "write" },
  addWatchMetrics: { k: "write" },
  listWatchMetrics: { k: "read" },
  setDietCheck: { k: "write" },
  listDietChecks: { k: "read" },
  addChatMessage: { k: "write" },
  listChatMessages: { k: "read" },
  addBriefSnapshot: { k: "write" },
  getBriefSnapshot: { k: "read" },
  listBriefSnapshots: { k: "read" },
  markBriefShown: { k: "write" },
  // C2 track S: the translation cache (lib/translate); her view may read a translation, never make one
  getTranslation: { k: "read" },
  putTranslation: { k: "write" },
  // C2 track F: his understanding-checklist answers (lib/explain/understanding.ts)
  setUnderstandingAnswer: { k: "write" },
  listUnderstandingAnswers: { k: "read" },
  // C2 track H: the retention job (system mode) drops safety events past their 90 days (lib/jobs/retention.ts)
  pruneSafetyEvents: { k: "write" },
  // C2 track H: the account deletion's last check reads every table for one id (the process-wide store only)
  countAccountRows: { k: "global" },
  listTranslations: { k: "read" },
  recordDelivery: { k: "write" },
  // C2 track I (follow-up): in family mode only the alert sent to her own link, checked against the stored row below
  markDeliveryOpened: { k: "familyWrite" },
  listDeliveries: { k: "read" },
  addCareAccessLog: { k: "familyWrite", check: ownAccess },
  listCareAccessLog: { k: "read" },
  // eval runs
  addEvalRun: { k: "global" },
  getLatestEvalRun: { k: "global" },
  // the subject's own account rows
  createAccount: { k: "global" },
  getAccount: { k: "user" },
  getAccountByUsername: { k: "global" },
  updateAccount: { k: "user" },
  deleteAccount: { k: "user" },
  setRecoveryCode: { k: "user" },
  getRecoveryCode: { k: "user" },
  touchKnownDevice: { k: "user" },
  listKnownDevices: { k: "user" },
  createResetRequest: { k: "user", field: "user_id" },
  getResetRequest: { k: "global" },
  useResetRequest: { k: "global" },
  addAccountEvent: { k: "user" },
  listAccountEvents: { k: "user" },
  addConsentRecord: { k: "user", field: "user_id" },
  listConsentRecords: { k: "user" },
  savePushSubscription: { k: "user", field: "user_id" },
  listPushSubscriptions: { k: "user" },
  deletePushSubscription: { k: "global" },
  // care links: only those the subject is party to
  createInvite: {
    k: "link",
    check: async (args, ctx) => (ctx.mode === "self" && isObj(args[0]) && args[0].patient_id === ctx.userId && ctx.scopeId === ctx.userId ? null : "he invites, from his own scope"),
  },
  acceptInvite: { k: "global" }, // she accepts as herself, before any link binds her: lib/subject requireUser
  confirmLink: { k: "link", check: async (args, ctx) => (ctx.mode === "self" && args[1] === ctx.userId ? null : "only he confirms") },
  revokeLink: {
    k: "link",
    check: async (args, ctx) =>
      args[1] === ctx.userId && ((args[2] === "patient" && ctx.mode === "self") || (args[2] === "family" && ctx.mode === "family" && args[0] === ctx.linkId)) ? null : "only a party revokes or leaves",
  },
  getCareLink: { k: "link", check: async (args, ctx, store) => (party(await linkOf(store, args[0]), ctx.userId) ? null : "not a party to this link") },
  listCareLinks: {
    k: "link",
    check: async (args, ctx) => (isObj(args[0]) && (args[0].patient_id === ctx.userId || args[0].family_id === ctx.userId) && ctx.userId ? null : "only one's own links"),
  },
  expireInvites: { k: "global" },
  listGrantHistory: {
    k: "link",
    check: async (args, ctx, store) => {
      const l = await linkOf(store, args[0]);
      return l && ctx.userId && l.patient_id === ctx.userId ? null : "only he reads a link's history";
    },
  },
  addServiceReadLog: { k: "global" },
  listServiceReadLog: { k: "global" },
  putConsentText: { k: "global" },
  getConsentText: { k: "global" },
  rateHit: { k: "global" },
  pruneRateLimits: { k: "global" },
  acquireJobLease: { k: "global" },
  releaseJobLease: { k: "global" },
  addOpsRun: { k: "global" },
  listOpsRuns: { k: "global" },
  // C2 track A: the sign-in lockout reads and clears rate-limit buckets (account routes, lib/subject/account.ts)
  getRateWindow: { k: "global" },
  clearRate: { k: "global" },
  rateAdd: { k: "global" }, // C2 track L: an allowance counted as a sum (lib/subject/limits.ts is its way in)
  // C2 track A: family-assisted reset (real-app 3.6). The switch is his, on his own link; the requests are read and
  // given a code by the account routes on the process-wide store (lib/subject/account.ts), before anyone is signed in
  setLinkResetHelper: { k: "link", check: async (args, ctx) => (ctx.mode === "self" && !!ctx.userId && args[1] === ctx.userId ? null : "only he says who may help him reset") },
  listResetRequests: { k: "user" },
  setResetRequestCode: { k: "global" },
  // C2 track I: a person turns off reminders on one of their own phones (app/api/push/subscribe DELETE)
  deleteOwnPushSubscription: { k: "user" },
};

/** The scope-read methods that hand out the scope row itself (its id stays for the server). */
const SCOPE_ROW_METHODS = new Set<StoreMethod>(["getSession", "updateScope", "setFilmingAccount", "setClockOffset", "reseedAccount", "setStoryDay", "setFilmingMode", "resetSession"]);

/** Rows as an account's subject gets them: session_id "" where it is this scope's id (one level of nesting). */
function masked(value: unknown, scopeId: string, depth = 0): unknown {
  if (Array.isArray(value)) return value.map((v) => masked(v, scopeId, depth));
  if (!isObj(value)) return value;
  let out: Record<string, unknown> | null = null;
  if (value.session_id === scopeId) out = { ...value, session_id: "" };
  if (depth < 1) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "session_id" || !isObj(v)) continue;
      const m = masked(v, scopeId, depth + 1);
      if (m !== v) {
        out ??= { ...value };
        out[k] = m;
      }
    }
  }
  return out ?? value;
}

export interface ScopedStoreOptions {
  userId?: string | null;
  linkId?: string | null;
  /** hand out rows with session_id "" (account subjects) */
  maskSessionId?: boolean;
  /** family mode: her switches as every reader gets them (lib/care/reconsent.ts alertOnly); ignored in other modes */
  switches?: ((items: FamilyGrantItems) => FamilyGrantItems) | null;
}

/** The store bound to `scope` in `mode`. */
export function scopedStore(base: Store, scope: Pick<SessionRow, "id">, mode: ScopeMode, opts: ScopedStoreOptions = {}): ScopedStore {
  const ctx: Ctx = { scopeId: scope.id, mode, userId: opts.userId ?? null, linkId: opts.linkId ?? null };
  const mask = !!opts.maskSessionId && (mode === "self" || mode === "family");
  const switches = mode === "family" ? (opts.switches ?? null) : null;
  const extra = { scopeId: ctx.scopeId, mode, userId: ctx.userId, linkId: ctx.linkId, switches };

  const guard = async (name: StoreMethod, args: unknown[]): Promise<void> => {
    const rule = RULES[name];
    const fail = (why: string): never => {
      throw new ScopeViolation(name, why);
    };
    switch (rule.k) {
      case "global":
        return fail("is not available on a scoped store");
      case "read":
        if (args[0] !== ctx.scopeId) fail("named another scope");
        return;
      case "write":
        if (args[0] !== ctx.scopeId) fail("named another scope");
        if (mode === "family") fail("is a write; family mode only reads");
        return;
      case "familyWrite": {
        if (args[0] !== ctx.scopeId) fail("named another scope");
        if (mode !== "family") return;
        if (rule.check) {
          const why = rule.check(args, ctx);
          if (why) fail(why);
        }
        if (name === "deleteReminderClip") {
          const clip = (await base.listReminderClips(ctx.scopeId)).find((c) => c.id === args[1]);
          if (!clip || clip.by_user_id !== ctx.userId) fail("only her own clip");
        }
        // C2 track I (follow-up): her tap on her alert; never one of his reminders, never another link's alert
        if (name === "markDeliveryOpened") {
          const row = (await base.listDeliveries(ctx.scopeId)).find((d) => d.id === args[1]);
          // (owner 10-16, only add: 「爸爸跟 Ripple 说了…」, family_told, is hers to open too: lib/care/told.ts)
          if (!row || (row.kind !== "family_no_reply" && row.kind !== "family_told") || !ctx.linkId || row.ref !== ctx.linkId) fail("only the alert sent to her own link");
        }
        return;
      }
      case "demoOnly":
        if (args[0] !== ctx.scopeId) fail("named another scope");
        if (mode !== "demo") throw new StoreError("account_scope", `${name} is for demo sessions only`);
        return;
      case "scopeAdmin":
        if (args[0] !== ctx.scopeId) fail("named another scope");
        if (mode === "family" || mode === "demo") fail(`is not for ${mode} mode`);
        return;
      case "user": {
        const id = rule.field ? (isObj(args[0]) ? args[0][rule.field] : undefined) : args[0];
        if (!ctx.userId || id !== ctx.userId) fail("named another user");
        if (name === "addConsentRecord" && isObj(args[0]) && args[0].scope_id != null && args[0].scope_id !== ctx.scopeId) fail("named another scope");
        if (name === "deleteAccount" && mode !== "self") fail("only he deletes his account");
        return;
      }
      case "link": {
        if (!ctx.userId) fail("needs an account subject");
        const why = await rule.check(args, ctx, base);
        if (why) fail(why);
        return;
      }
    }
  };

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && prop in extra) return extra[prop as keyof typeof extra];
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function" || !(prop in RULES)) return value;
      const name = prop as StoreMethod;
      return async (...args: unknown[]) => {
        await guard(name, args);
        let out = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        // her switches, read in family mode: cut here, once, for every reader (lib/care/reconsent.ts)
        if (switches && name === "getFamilyGrant" && isObj(out) && isObj(out.items)) out = { ...out, items: switches(out.items as unknown as FamilyGrantItems) };
        return mask && !SCOPE_ROW_METHODS.has(name) ? masked(out, ctx.scopeId) : out;
      };
    },
  }) as ScopedStore;
}

/** Her switches through her link (family mode), or all off when the link has none. */
export async function familyGrantItems(store: ScopedStore): Promise<FamilyGrantItems | null> {
  if (store.mode !== "family" || !store.linkId) return null;
  return (await store.getFamilyGrant(store.scopeId, store.linkId))?.items ?? null;
}
