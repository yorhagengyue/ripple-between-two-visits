/**
 * Binding by account (line bind; lib/care/bind.ts bindByAccount and acknowledgeLink, on the memory store): both
 * directions, both modes, the same request twice, himself, an account that is not there, two of a kind, a link that was
 * waiting from an invitation, the limits, a failure half-way, the names, and the records exactly as the design writes
 * them: what happened and nothing more. The mark on his account (family_bound, by: "family") is written before a link
 * she starts comes into force; with it and without his own record of sharing the link is unacknowledged, and every other
 * link is acknowledged as before (lib/care/ack.ts, the integrator's corrected rule). The routes are in
 * bind-routes.test.ts; what the rule opens and closes for her is in bind-ack.test.ts.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { LIMITS } from "@/lib/auth/limits";
import { getBus, type BusEvent } from "@/lib/bus";
import { acknowledgedIds, boundByFamilyIds, linkAcknowledged, unacknowledgedLinks } from "@/lib/care/ack";
import { acknowledgeLink, bindByAccount, bindMode, DIRECT_GRANTS, endedByHim, nameOnHisScreens, type BindDeps, type Bound, type BindRefusal } from "@/lib/care/bind";
import { cancelInvite, confirmLinkAs, createInviteFor, leaveLinkAs, patientLinks, revokeLinkAs, setLinkSwitches } from "@/lib/care/links";
import { hashToken } from "@/lib/care/tokens";
import { NO_GRANTS } from "@/lib/family/types";
import { ASSISTED_NOTE, currentConsent } from "@/lib/privacy/consents";
import { getMemoryStore } from "@/lib/store/memory";
import type { CareLinkRow, Store } from "@/lib/store/types";
import { bindEntryStore, type BindEntryStore } from "@/lib/subject/bind";
import { careEntryStore } from "@/lib/subject/care";
import { selfSubject } from "@/lib/subject/resolve";
import { scopedStore, ScopeViolation } from "@/lib/subject/scoped-store";

const store = getMemoryStore();
const PASSWORD = "a long test password";
const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;

async function elder(display: string | null = "陈先生", extra: { assisted?: boolean; login?: string } = {}): Promise<TestAccount> {
  return createAccountWithSpace(store, getAuthProvider(), { login: extra.login ?? login("t"), password: PASSWORD, space: "blank", display_name: display, assisted: extra.assisted });
}
async function family(display: string | null = "Wei Ling", loginName = login("w")): Promise<TestAccount> {
  return createAccountWithSpace(store, getAuthProvider(), { login: loginName, password: PASSWORD, space: "none", display_name: display });
}

/** The caller's own store, as requireUser hands it out: bound to his own space, or to no space at all. */
function ownStore(a: TestAccount): Store {
  return a.scope ? selfSubject(store, a.scope, a.userId).store : scopedStore(store, { id: `no-scope:${a.userId}` }, "self", { userId: a.userId, maskSessionId: true });
}

interface Told {
  bound: CareLinkRow[];
  accepted: CareLinkRow[];
}

function world(over: Partial<BindDeps> = {}): { deps: (a: TestAccount) => BindDeps; told: Told } {
  const told: Told = { bound: [], accepted: [] };
  return {
    told,
    deps: (a) => ({
      entry: bindEntryStore(store),
      own: ownStore(a),
      auth: getAuthProvider(),
      limits: store,
      notifyBound: async (link) => (told.bound.push(link as CareLinkRow), { recorded: true, sent: 1 }),
      notifyAccepted: async (link) => (told.accepted.push(link as CareLinkRow), { recorded: true, sent: 1 }),
      ...over,
    }),
  };
}

let ipCount = 0;
const caller = (a: TestAccount, locale: "zh-Hans" | "en" = "zh-Hans") => ({ userId: a.userId, account: a.account, ip: `10.20.${Math.floor(++ipCount / 250)}.${ipCount % 250}`, locale });
const shown = (a: TestAccount) => (a.login.kind === "username" ? a.login.username : a.login.email);
const ok = (r: Bound | BindRefusal): Bound => {
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  return r;
};

function capture(channel: string): { events: BusEvent[]; stop(): void } {
  const events: BusEvent[] = [];
  const stop = getBus().subscribe(channel, (e) => events.push(e));
  return { events, stop };
}

const shareRecords = async (him: TestAccount, linkId: string) => (await store.listConsentRecords(him.userId, { kind: "family_share" })).filter((r) => (r.evidence as { link_id?: string })?.link_id === linkId);
const acceptRecords = async (her: TestAccount, linkId: string) => (await store.listConsentRecords(her.userId, { kind: "family_accept" })).filter((r) => (r.evidence as { link_id?: string })?.link_id === linkId);
const boundEvents = async (a: TestAccount, linkId: string) => (await store.listAccountEvents(a.userId)).filter((e) => e.kind === "family_bound" && e.detail.link_id === linkId);
const openLinks = (him: TestAccount) => store.listCareLinks({ patient_id: him.userId, status: ["invited", "accepted", "active"] });

describe("she types his account (direct mode)", () => {
  it("the two are linked at once: an ordinary link in force, the four default switches on, his words off", async () => {
    const him = await elder();
    const her = await family();
    const w = world();
    const mine = capture(him.userId);
    const r = ok(await bindByAccount(w.deps(her), caller(her), { account: shown(him) }));
    mine.stop();

    expect(r).toMatchObject({ role: "family", made: true, state: "active", next: `/f?link=${r.link.id}` });
    const link = (await store.getCareLink(r.link.id))!;
    expect(link).toMatchObject({
      status: "active",
      patient_id: him.userId,
      family_id: her.userId,
      family_label: "Wei Ling",
      // no label chosen: his own name, never empty (her pages would say 「爸爸」 for an empty one, wrong for a mother)
      patient_label: "陈先生",
      relation: null,
      reset_helper: false,
      // the token was made, hashed and thrown away; once the link is in force not even its hash is left
      invite_token_hash: null,
      revoked_at: null,
    });
    expect(link.accepted_at).toBeTruthy();
    expect(link.confirmed_at).toBeTruthy();
    const grant = (await store.getFamilyGrant(him.userId, link.id))!;
    expect(grant.items).toEqual({ dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: false, notes: false });
    expect(grant.items).toEqual(DIRECT_GRANTS);
    expect(grant.version).toBe(1);
    expect((await store.listGrantHistory(link.id)).map((h) => h.version)).toEqual([1]);
    // his channel: the event the invitation flow uses for a link that came into force, and only that one
    expect(mine.events.map((e) => [e.type, e.data])).toEqual([["care_link.confirmed", { link: { id: link.id, status: "active" } }]]);
    // his phone is told, once
    expect(w.told.bound.map((l) => l.id)).toEqual([link.id]);
    expect(w.told.accepted).toEqual([]);
  });

  it("the records: her family_accept, family_bound on both accounts, and no consent record in his name", async () => {
    const him = await elder();
    const her = await family();
    const before = (await store.listConsentRecords(him.userId)).length;
    const r = ok(await bindByAccount(world().deps(her), caller(her, "en"), { account: shown(him), label: "爸爸" }));
    const id = r.link.id;

    const hers = await acceptRecords(her, id);
    const text = currentConsent("family_accept", "en");
    expect(hers).toHaveLength(1);
    expect(hers[0]).toMatchObject({ user_id: her.userId, scope_id: null, kind: "family_accept", decision: "granted", method: "direct_bind", assisted: false, version: text.version, text_sha256: text.sha256 });
    expect(hers[0].evidence).toEqual({ link_id: id, locale: "en" });
    // the words the record points at are published
    expect((await store.getConsentText("family_accept", text.version, "en"))?.sha256).toBe(text.sha256);

    // he did nothing: not one consent record of his was written, of any kind
    expect((await store.listConsentRecords(him.userId)).length).toBe(before);
    expect(await shareRecords(him, id)).toEqual([]);
    // no record of his in her name either
    expect((await store.listConsentRecords(her.userId, { kind: "family_share" }))).toEqual([]);

    expect((await boundEvents(her, id)).map((e) => e.detail)).toEqual([{ link_id: id, by: "family" }]);
    expect((await boundEvents(him, id)).map((e) => e.detail)).toEqual([{ link_id: id, by: "family", items: DIRECT_GRANTS }]);
    // how she calls him is the label she chose
    expect((await store.getCareLink(id))?.patient_label).toBe("爸爸");
    // and the link is not acknowledged: nothing of hers reaches his phone yet (bind-ack.test.ts)
    expect(await linkAcknowledged(store, r.link)).toBe(false);
  });

  it("finds him by his e-mail address too, through the identity provider", async () => {
    const him = await elder("Mdm Lim", { login: `${login("m")}@example.com` });
    const her = await family();
    expect(him.account.username).toBeNull();
    const r = ok(await bindByAccount(world().deps(her), caller(her), { account: `  ${shown(him).toUpperCase()} ` }));
    expect(r.link).toMatchObject({ patient_id: him.userId, family_id: her.userId, status: "active", patient_label: "Mdm Lim" });
  });
});

describe("he types her account", () => {
  it("the link is in force at once, he lands on his switches for her, and nothing is sent to his own phone", async () => {
    const him = await elder();
    const her = await family();
    const w = world();
    const mine = capture(him.userId);
    const r = ok(await bindByAccount(w.deps(him), caller(him), { account: shown(her) }));
    mine.stop();
    expect(r).toMatchObject({ role: "patient", made: true, state: "active", next: `/p/family/${r.link.id}` });
    expect(await store.getCareLink(r.link.id)).toMatchObject({ status: "active", patient_id: him.userId, family_id: her.userId, family_label: "Wei Ling", patient_label: "陈先生", relation: null, reset_helper: false, invite_token_hash: null });
    expect((await store.getFamilyGrant(him.userId, r.link.id))?.items).toEqual(DIRECT_GRANTS);
    expect(mine.events.map((e) => e.type)).toEqual(["care_link.confirmed"]);
    expect(w.told).toEqual({ bound: [], accepted: [] });
  });

  it("the records: his family_share with the switches, family_bound on both accounts, and no record in her name", async () => {
    const him = await elder();
    const her = await family();
    const before = (await store.listConsentRecords(her.userId)).length;
    const r = ok(await bindByAccount(world().deps(him), caller(him), { account: shown(her) }));
    const id = r.link.id;

    const his = await shareRecords(him, id);
    const text = currentConsent("family_share", "zh-Hans");
    expect(his).toHaveLength(1);
    expect(his[0]).toMatchObject({ user_id: him.userId, scope_id: him.userId, kind: "family_share", decision: "granted", method: "direct_bind", assisted: false, version: text.version, text_sha256: text.sha256 });
    expect(his[0].evidence).toEqual({ link_id: id, version: 1, items: DIRECT_GRANTS, locale: "zh-Hans" });

    expect((await store.listConsentRecords(her.userId)).length).toBe(before);
    expect(await acceptRecords(her, id)).toEqual([]);

    expect((await boundEvents(him, id)).map((e) => e.detail)).toEqual([{ link_id: id, by: "patient" }]);
    expect((await boundEvents(her, id)).map((e) => e.detail)).toEqual([{ link_id: id, by: "patient" }]);
    // a link he bound himself is acknowledged from the start
    expect(await linkAcknowledged(store, r.link)).toBe(true);
  });

  it("someone is helping him on his device: his record says so, from what his sign-up recorded or from what the request says", async () => {
    const helped = await elder("陈先生", { assisted: true });
    const a = ok(await bindByAccount(world().deps(helped), caller(helped), { account: shown(await family()) }));
    const rec = (await shareRecords(helped, a.link.id))[0];
    expect(rec.assisted).toBe(true);
    expect(rec.evidence).toMatchObject({ assisted_note: ASSISTED_NOTE });

    const alone = await elder();
    const b = ok(await bindByAccount(world().deps(alone), { ...caller(alone), assisted: true }, { account: shown(await family()) }));
    expect((await shareRecords(alone, b.link.id))[0].assisted).toBe(true);
    // and the request can say he is acting alone now
    const c = ok(await bindByAccount(world().deps(helped), { ...caller(helped), assisted: false }, { account: shown(await family()) }));
    expect((await shareRecords(helped, c.link.id))[0].assisted).toBe(false);
  });
});

describe("what is refused, and what a second request does", () => {
  it("the same request twice: the second answers with the link that is there, made false, and writes nothing", async () => {
    const him = await elder();
    const her = await family();
    const w = world();
    const first = ok(await bindByAccount(w.deps(her), caller(her), { account: shown(him) }));
    const counts = async () => ({
      links: (await store.listCareLinks({ patient_id: him.userId })).length,
      hers: (await store.listConsentRecords(her.userId)).length,
      his: (await store.listConsentRecords(him.userId)).length,
      herEvents: (await store.listAccountEvents(her.userId)).length,
      hisEvents: (await store.listAccountEvents(him.userId)).length,
      history: (await store.listGrantHistory(first.link.id)).length,
    });
    const before = await counts();
    const mine = capture(him.userId);
    const again = ok(await bindByAccount(w.deps(her), caller(her), { account: shown(him), label: "妈妈" }));
    // and from his side, typing her account: the same link
    const fromHim = ok(await bindByAccount(w.deps(him), caller(him), { account: shown(her) }));
    mine.stop();
    expect(again).toMatchObject({ made: false, state: "active", role: "family", next: `/f?link=${first.link.id}` });
    expect(again.link.id).toBe(first.link.id);
    expect(fromHim).toMatchObject({ made: false, state: "active", role: "patient", next: `/p/family/${first.link.id}` });
    expect(await counts()).toEqual(before);
    expect(mine.events).toEqual([]);
    expect(w.told.bound).toHaveLength(1);
    // the label is as the first request set it
    expect((await store.getCareLink(first.link.id))?.patient_label).toBe("陈先生");
  });

  it("his own account: 409 bind_self", async () => {
    const him = await elder();
    const her = await family();
    expect(await bindByAccount(world().deps(him), caller(him), { account: shown(him) })).toEqual({ ok: false, status: 409, error: "bind_self" });
    expect(await bindByAccount(world().deps(her), caller(her), { account: shown(her) })).toEqual({ ok: false, status: 409, error: "bind_self" });
    expect(await openLinks(him)).toEqual([]);
  });

  it("not a login, or no such account: one answer, 404 account_not_found", async () => {
    const her = await family();
    const w = world();
    const notFound = { ok: false, status: 404, error: "account_not_found" };
    for (const typed of ["", "   ", "a b", "ab", "admin", "nobody-" + login("x"), `${login("n")}@example.com`, "not an address@", `x@users.ripple.invalid`]) {
      expect(await bindByAccount(w.deps(her), caller(her), { account: typed }), JSON.stringify(typed)).toEqual(notFound);
    }
    expect(w.told).toEqual({ bound: [], accepted: [] });
  });

  it("two elders, or two family members: 409 bind_wrong_kind with which", async () => {
    const him = await elder();
    const other = await elder("林女士");
    const her = await family();
    const sister = await family("Hui Min");
    expect(await bindByAccount(world().deps(him), caller(him), { account: shown(other) })).toEqual({ ok: false, status: 409, error: "bind_wrong_kind", detail: "both_elder" });
    expect(await bindByAccount(world().deps(her), caller(her), { account: shown(sister) })).toEqual({ ok: false, status: 409, error: "bind_wrong_kind", detail: "both_family" });
    expect(await openLinks(him)).toEqual([]);
    expect(await openLinks(other)).toEqual([]);
  });

  it("the limits: 10 an hour per signed-in person, 30 an hour per IP; refused with when it opens again", async () => {
    expect(LIMITS.bindPerUser).toEqual({ windowS: 3600, limit: 10 });
    expect(LIMITS.bindPerIp).toEqual({ windowS: 3600, limit: 30 });
    // the developer tools make the per-IP style limits 100 times looser: off here, as on a real server
    const env = { NODE_ENV: "production" };
    const her = await family();
    const w = world({ env });
    const from = (ip: string) => ({ userId: her.userId, account: her.account, ip, locale: "zh-Hans" as const });
    const typed = { account: "nobody-" + login("x") };
    // one person, a new address each time: the tenth is still looked up, the eleventh is not
    for (let i = 1; i <= 10; i++) expect((await bindByAccount(w.deps(her), from(`10.30.1.${i}`), typed)), String(i)).toMatchObject({ status: 404, error: "account_not_found" });
    const over = await bindByAccount(w.deps(her), from("10.30.1.99"), typed);
    expect(over).toMatchObject({ ok: false, status: 429, error: "too_many" });
    const until = Date.parse((over as BindRefusal).until!);
    expect(until - Date.now()).toBeGreaterThan(3500_000);
    expect(until - Date.now()).toBeLessThanOrEqual(3600_000 + 1000);
    // a real account is not bound once the limit is reached
    const him = await elder();
    expect(await bindByAccount(w.deps(her), from("10.30.1.98"), { account: shown(him) })).toMatchObject({ status: 429 });
    expect(await openLinks(him)).toEqual([]);

    // one address, many people (three tries each): the thirty-first from it is refused, another address is not
    const ip = `10.31.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    let n = 0;
    for (let person = 0; person < 10; person++) {
      const p = await family(`P${"abcdefghij"[person]}`);
      for (let i = 0; i < 3; i++) expect(await bindByAccount(world({ env }).deps(p), { userId: p.userId, account: p.account, ip, locale: "zh-Hans" }, typed), String(++n)).toMatchObject({ status: 404 });
    }
    const last = await family("Last");
    expect(await bindByAccount(world({ env }).deps(last), { userId: last.userId, account: last.account, ip, locale: "zh-Hans" }, typed)).toMatchObject({ status: 429, error: "too_many" });
    expect(await bindByAccount(world({ env }).deps(last), { userId: last.userId, account: last.account, ip: `${ip}9`, locale: "zh-Hans" }, typed)).toMatchObject({ status: 404 });
  });

  it("a step that fails after the link was started leaves no open link, and the failure comes back", async () => {
    const real = bindEntryStore(store);
    type Step = "acceptInvite" | "addAccountEvent" | "confirmLink";
    const failing = (method: Step, how: "refuses" | "throws"): BindEntryStore =>
      new Proxy(real, {
        get(target, prop, receiver) {
          if (prop !== method) return Reflect.get(target, prop, receiver);
          return async () => {
            if (how === "throws") throw new Error("the store is away");
            return { ok: false, code: method === "acceptInvite" ? "invite_expired" : "link_not_accepted" };
          };
        },
      });
    const cases: [Step, "refuses" | "throws"][] = [
      ["acceptInvite", "refuses"],
      ["acceptInvite", "throws"],
      // the mark on his account cannot be written: the link must not come into force without it
      ["addAccountEvent", "throws"],
      ["confirmLink", "refuses"],
      ["confirmLink", "throws"],
    ];
    for (const [method, how] of cases) {
      const him = await elder();
      const her = await family();
      const w = world({ entry: failing(method, how) });
      const mine = capture(him.userId);
      const attempt = bindByAccount(w.deps(her), caller(her), { account: shown(him) });
      if (how === "throws") await expect(attempt, `${method} ${how}`).rejects.toThrow("the store is away");
      else expect(await attempt, `${method} ${how}`).toMatchObject({ ok: false, error: method === "acceptInvite" ? "invite_expired" : "link_not_accepted" });
      mine.stop();
      // the half-made link is ended, as the patient, and was never in force; nothing is left open between them
      expect(await openLinks(him), `${method} ${how}`).toEqual([]);
      const all = await store.listCareLinks({ patient_id: him.userId });
      expect(all.map((l) => [l.status, l.revoked_by, l.invite_token_hash, l.confirmed_at]), `${method} ${how}`).toEqual([["revoked", "patient", null, null]]);
      // nothing says a link came into force: no event on his channel, no consent record, no notice, nothing on her account
      expect(mine.events).toEqual([]);
      expect(await store.listConsentRecords(her.userId, { kind: "family_accept" })).toEqual([]);
      expect((await store.listAccountEvents(her.userId)).filter((e) => e.kind === "family_bound")).toEqual([]);
      // the mark is written before the last step, so it is there (naming the ended link) only when that last step failed
      expect((await store.listAccountEvents(him.userId)).filter((e) => e.kind === "family_bound").map((e) => e.detail), `${method} ${how}`).toEqual(
        method === "confirmLink" ? [{ link_id: all[0].id, by: "family", items: DIRECT_GRANTS }] : [],
      );
      expect(w.told).toEqual({ bound: [], accepted: [] });
      // a new try with the store back works, and makes one link
      ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
      expect((await openLinks(him)).map((l) => l.status)).toEqual(["active"]);
    }
  });

  it("the mark on his account is written before a link she starts comes into force, in both modes", async () => {
    for (const mode of ["direct", "confirm"]) {
      const him = await elder();
      const her = await family();
      const real = bindEntryStore(store);
      const steps: string[] = [];
      const watching = new Proxy(real, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if (typeof prop !== "string" || typeof value !== "function" || !["createInvite", "acceptInvite", "addAccountEvent", "confirmLink"].includes(prop)) return value;
          return async (...args: unknown[]) => {
            if (prop === "addAccountEvent") {
              // whose account, and how the link stands at this very moment
              const detail = args[2] as { link_id: string };
              steps.push(`${prop}:${args[0] === him.userId ? "his" : "hers"}:${(await store.getCareLink(detail.link_id))?.status}`);
            } else steps.push(prop);
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      }) as BindEntryStore;
      ok(await bindByAccount(world({ entry: watching, env: { FAMILY_BIND_MODE: mode } }).deps(her), caller(her), { account: shown(him) }));
      expect(steps, mode).toEqual(
        mode === "direct"
          ? ["createInvite", "acceptInvite", "addAccountEvent:his:accepted", "confirmLink", "addAccountEvent:hers:active"]
          : ["createInvite", "acceptInvite", "addAccountEvent:his:accepted", "addAccountEvent:hers:accepted"],
      );
    }
  });
});

describe("a link that was waiting from an invitation of his", () => {
  /** He invites, she accepts through the store's own step: the link waits for his 「是她」, every switch off. */
  async function waiting(him: TestAccount, her: TestAccount): Promise<string> {
    const made = await createInviteFor(ownStore(him), him.scope!, him.userId, { familyLabel: "女儿 Wei Ling", relation: "daughter", patientLabel: "爸爸" }, Date.now());
    if (!("token" in made)) throw new Error("invitation");
    const accepted = await store.acceptInvite(hashToken(made.token), her.userId);
    if (!accepted.ok) throw new Error(accepted.code);
    return accepted.link.id;
  }

  it("she types his account in direct mode: that link is confirmed, with the direct switches, and no second link is made", async () => {
    const him = await elder();
    const her = await family();
    const id = await waiting(him, her);
    const w = world();
    const r = ok(await bindByAccount(w.deps(her), caller(her), { account: shown(him), label: "妈妈" }));
    expect(r).toMatchObject({ made: false, state: "active", role: "family" });
    expect(r.link.id).toBe(id);
    expect((await store.listCareLinks({ patient_id: him.userId })).map((l) => [l.id, l.status])).toEqual([[id, "active"]]);
    // what he wrote when he invited stays: his name for her, what she is to him, how she calls him
    expect(await store.getCareLink(id)).toMatchObject({ family_label: "女儿 Wei Ling", relation: "daughter", patient_label: "爸爸", reset_helper: false, invite_token_hash: null });
    const grant = (await store.getFamilyGrant(him.userId, id))!;
    expect(grant.items).toEqual(DIRECT_GRANTS);
    expect(grant.version).toBe(2);
    expect((await acceptRecords(her, id)).map((x) => x.method)).toEqual(["direct_bind"]);
    expect((await boundEvents(him, id)).map((e) => e.detail)).toEqual([{ link_id: id, by: "family", items: DIRECT_GRANTS }]);
    expect(await shareRecords(him, id)).toEqual([]);
    expect(w.told.bound.map((l) => l.id)).toEqual([id]);
  });

  it("he types her account: that link is confirmed in either mode, and his record carries the switches as they are now", async () => {
    for (const mode of ["direct", "confirm"]) {
      const him = await elder();
      const her = await family();
      const id = await waiting(him, her);
      const r = ok(await bindByAccount(world({ env: { FAMILY_BIND_MODE: mode } }).deps(him), caller(him), { account: shown(her) }));
      expect(r, mode).toMatchObject({ made: false, state: "active", role: "patient", next: `/p/family/${id}` });
      const his = await shareRecords(him, id);
      expect(his.map((x) => x.method), mode).toEqual(["direct_bind"]);
      expect(his[0].evidence, mode).toEqual({ link_id: id, version: 2, items: DIRECT_GRANTS, locale: "zh-Hans" });
      expect((await openLinks(him)).map((l) => l.status), mode).toEqual(["active"]);
    }
  });

  it("she types his account in confirm mode: it still waits for his 「是她」, and nothing is written", async () => {
    const him = await elder();
    const her = await family();
    const id = await waiting(him, her);
    const w = world({ env: { FAMILY_BIND_MODE: "confirm" } });
    const before = { hers: (await store.listConsentRecords(her.userId)).length, events: (await store.listAccountEvents(him.userId)).length };
    const mine = capture(him.userId);
    const r = ok(await bindByAccount(w.deps(her), caller(her), { account: shown(him) }));
    mine.stop();
    expect(r).toMatchObject({ made: false, state: "accepted", role: "family", next: `/f?link=${id}` });
    expect((await store.getCareLink(id))?.status).toBe("accepted");
    expect((await store.getFamilyGrant(him.userId, id))?.items).toEqual(NO_GRANTS);
    expect({ hers: (await store.listConsentRecords(her.userId)).length, events: (await store.listAccountEvents(him.userId)).length }).toEqual(before);
    expect(mine.events).toEqual([]);
    expect(w.told).toEqual({ bound: [], accepted: [] });
  });
});

describe("FAMILY_BIND_MODE", () => {
  it("is direct unless it says confirm", () => {
    expect(bindMode({})).toBe("direct");
    expect(bindMode({ FAMILY_BIND_MODE: "" })).toBe("direct");
    expect(bindMode({ FAMILY_BIND_MODE: "direct" })).toBe("direct");
    expect(bindMode({ FAMILY_BIND_MODE: " Confirm " })).toBe("confirm");
    expect(bindMode({ FAMILY_BIND_MODE: "anything" })).toBe("direct");
  });

  it("confirm: a link she starts stops at accepted and waits for his 「是她」 exactly as an invitation does", async () => {
    const him = await elder();
    const her = await family();
    const w = world({ env: { FAMILY_BIND_MODE: "confirm" } });
    const mine = capture(him.userId);
    const r = ok(await bindByAccount(w.deps(her), caller(her), { account: shown(him), label: "爸爸" }));
    mine.stop();
    expect(r).toMatchObject({ made: true, state: "accepted", role: "family", next: `/f?link=${r.link.id}` });
    const id = r.link.id;
    expect(await store.getCareLink(id)).toMatchObject({ status: "accepted", family_id: her.userId, family_label: "Wei Ling", patient_label: "爸爸", confirmed_at: null, reset_helper: false });
    // every switch off, as for an invitation: what he turns on after 「是她」 is his own choice
    expect((await store.getFamilyGrant(him.userId, id))?.items).toEqual(NO_GRANTS);
    expect(mine.events.map((e) => [e.type, e.data])).toEqual([["care_link.accepted", { link: { id, status: "accepted" } }]]);
    // her consent is recorded, and the same mark is on his account, with the switches the link was made with
    expect((await acceptRecords(her, id)).map((x) => [x.decision, x.method])).toEqual([["granted", "direct_bind"]]);
    expect((await boundEvents(him, id)).map((e) => e.detail)).toEqual([{ link_id: id, by: "family", items: NO_GRANTS }]);
    expect((await boundEvents(her, id)).map((e) => e.detail)).toEqual([{ link_id: id, by: "family" }]);
    expect(await shareRecords(him, id)).toEqual([]);
    // the existing notice 「Wei Ling 已经接受」, not the bound one
    expect(w.told.accepted.map((l) => l.id)).toEqual([id]);
    expect(w.told.bound).toEqual([]);

    // his 「是她」 is the invitation flow's own step, untouched: the link comes into force with every switch still off
    const yes = await confirmLinkAs(ownStore(him), him.scope!, him.userId, id, true, "zh-Hans", { texts: careEntryStore(store) });
    expect(yes.ok).toBe(true);
    expect((await store.getCareLink(id))?.status).toBe("active");
    expect((await store.getFamilyGrant(him.userId, id))?.items).toEqual(NO_GRANTS);
    expect((await shareRecords(him, id)).map((x) => x.method)).toEqual(["family_confirm"]);
    // the mark does no harm: his 「是她」 wrote his own record, so the link is acknowledged the moment it is in force
    expect(await linkAcknowledged(store, { id, patient_id: him.userId })).toBe(true);
  });

  it("confirm: a link he starts is in force at once all the same", async () => {
    const him = await elder();
    const her = await family();
    const w = world({ env: { FAMILY_BIND_MODE: "confirm" } });
    const r = ok(await bindByAccount(w.deps(him), caller(him), { account: shown(her) }));
    expect(r).toMatchObject({ made: true, state: "active", role: "patient" });
    expect((await store.getFamilyGrant(him.userId, r.link.id))?.items).toEqual(DIRECT_GRANTS);
    expect((await shareRecords(him, r.link.id)).map((x) => x.method)).toEqual(["direct_bind"]);
  });
});

describe("the names on a bound link", () => {
  it("her own name goes on his screens only when it reads as a name; otherwise her account name stands there", () => {
    expect(nameOnHisScreens({ display_name: "Wei Ling", username: "weiling88" })).toBe("Wei Ling");
    expect(nameOnHisScreens({ display_name: "  陈 慧玲  ", username: null })).toBe("陈 慧玲");
    expect(nameOnHisScreens({ display_name: "O’Brien-Tan Jr.", username: "x" })).toBe("O’Brien-Tan Jr.");
    // a number to call, an address, a sentence with punctuation, a name too long to be one
    for (const odd of ["请打 9123 4567", "www.example.com/a", "医生说：马上停药！", "Wei Ling 2", "a".repeat(25), "＠＃"]) {
      expect(nameOnHisScreens({ display_name: odd, username: "weiling88" }), odd).toBe("weiling88");
      expect(nameOnHisScreens({ display_name: odd, username: null }), odd).toBeNull();
    }
    expect(nameOnHisScreens({ display_name: null, username: null })).toBeNull();
  });

  it("the link carries them: her name for him, and for her his own name, his account name, or a plain word, never nothing", async () => {
    const her = await family("请打 9123 4567", login("w"));
    const him = await elder(null);
    const r = ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
    expect(r.link.family_label).toBe(her.account.username);
    expect(r.link.patient_label).toBe(him.account.username);

    // an elder with neither a name nor a username (an e-mail account made without a name)
    const nameless = await elder(null, { login: `${login("e")}@example.com` });
    const daughter = await family();
    const zh = ok(await bindByAccount(world().deps(daughter), caller(daughter), { account: shown(nameless) }));
    expect(zh.link.patient_label).toBe("家人");
    const sister = await family("Hui Min");
    const en = ok(await bindByAccount(world().deps(sister), caller(sister, "en"), { account: shown(nameless) }));
    expect(en.link.patient_label).toBe("Family");
    // a label she chose is cleaned like every label: one line, forty characters at most
    const other = await elder();
    const long = ok(await bindByAccount(world().deps(sister), caller(sister), { account: shown(other), label: `  妈妈\n\n${"长".repeat(60)} ` }));
    expect(long.link.patient_label).toBe(`妈妈 ${"长".repeat(37)}`);
  });
});

describe("binding's narrow store", () => {
  it("hands out only what the flow needs; the care flow's own way in is as it was", async () => {
    const entry = bindEntryStore(store) as unknown as Store;
    const him = await elder();
    for (const call of [
      () => entry.listDoses(him.userId),
      () => entry.listNotes(him.userId),
      () => entry.addConsentRecord({ user_id: him.userId, kind: "family_share", decision: "granted" }),
      () => entry.deleteAccount(him.userId),
      () => entry.setLinkResetHelper("x", him.userId, true),
      () => entry.listPushSubscriptions(him.userId),
      () => entry.updateAccount(him.userId, { display_name: "x" }),
      () => entry.rateHit("b", 60, 1),
    ]) {
      expect(call).toThrow(ScopeViolation);
    }
    expect(await entry.getAccount(him.userId)).toMatchObject({ user_id: him.userId });
    // not widened for this flow: the care flow's store still refuses the steps only binding takes
    const care = careEntryStore(store) as unknown as Store;
    for (const call of [() => care.createInvite({ patient_id: him.userId, invite_token_hash: "h", invite_expires_at: new Date().toISOString() }), () => care.confirmLink("x", him.userId, true), () => care.addAccountEvent(him.userId, "family_bound"), () => care.listAccountEvents(him.userId), () => care.listConsentRecords(him.userId), () => care.getAccountByUsername("x")]) {
      expect(call).toThrow(ScopeViolation);
    }
  });

  it("her own store cannot take the steps that are his, nor his hers: the rules for everyone else are as they were", async () => {
    const him = await elder();
    const her = await family();
    const hers = ownStore(her);
    await expect(hers.createInvite({ patient_id: him.userId, invite_token_hash: "h".repeat(64), invite_expires_at: new Date().toISOString() })).rejects.toBeInstanceOf(ScopeViolation);
    await expect(hers.confirmLink("x", him.userId, true)).rejects.toBeInstanceOf(ScopeViolation);
    await expect(hers.addAccountEvent(him.userId, "family_bound")).rejects.toBeInstanceOf(ScopeViolation);
    await expect(hers.listConsentRecords(him.userId)).rejects.toBeInstanceOf(ScopeViolation);
    await expect(hers.listAccountEvents(him.userId)).rejects.toBeInstanceOf(ScopeViolation);
    await expect(ownStore(him).acceptInvite("h".repeat(64), her.userId)).rejects.toBeInstanceOf(ScopeViolation);
  });
});

describe("「知道了」: he acknowledges a link she bound", () => {
  it("writes his family_share once, with the switches as they stand; a second tap writes nothing", async () => {
    const him = await elder();
    const her = await family();
    const r = ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
    const id = r.link.id;
    expect(await linkAcknowledged(store, r.link)).toBe(false);
    const mine = capture(him.userId);
    const first = await acknowledgeLink(ownStore(him), him.scope!, him.userId, id, "zh-Hans", { texts: careEntryStore(store) });
    expect(first).toMatchObject({ ok: true, written: true });
    const his = await shareRecords(him, id);
    const text = currentConsent("family_share", "zh-Hans");
    expect(his).toHaveLength(1);
    expect(his[0]).toMatchObject({ user_id: him.userId, scope_id: him.userId, decision: "granted", method: "direct_bind_ack", assisted: false, version: text.version, text_sha256: text.sha256 });
    expect(his[0].evidence).toEqual({ link_id: id, version: 1, items: DIRECT_GRANTS, locale: "zh-Hans" });
    expect(await linkAcknowledged(store, r.link)).toBe(true);
    // his other open pages put the card away
    expect(mine.events.map((e) => e.type)).toEqual(["care_link.confirmed"]);

    expect(await acknowledgeLink(ownStore(him), him.scope!, him.userId, id, "zh-Hans", { texts: careEntryStore(store) })).toMatchObject({ ok: true, written: false });
    mine.stop();
    expect(await shareRecords(him, id)).toHaveLength(1);
    expect(mine.events).toHaveLength(1);
    // nothing changed on the link or its switches
    expect((await store.getFamilyGrant(him.userId, id))?.version).toBe(1);
  });

  it("a link acknowledged another way gets no second record: one he bound, one whose switch he changed", async () => {
    const him = await elder();
    const mine = ok(await bindByAccount(world().deps(him), caller(him), { account: shown(await family()) }));
    expect(await acknowledgeLink(ownStore(him), him.scope!, him.userId, mine.link.id, "zh-Hans", { texts: careEntryStore(store) })).toMatchObject({ ok: true, written: false });
    expect((await shareRecords(him, mine.link.id)).map((x) => x.method)).toEqual(["direct_bind"]);

    const her = await family("Hui Min");
    const hers = ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
    expect(await linkAcknowledged(store, hers.link)).toBe(false);
    // he turns one of the four off without ever tapping 「知道了」: the record of that change names the link
    const changed = await setLinkSwitches(ownStore(him), him.scope!, him.userId, hers.link.id, { bp_summary: false }, "zh-Hans", () => undefined, { texts: careEntryStore(store) });
    expect(changed.ok).toBe(true);
    expect(await linkAcknowledged(store, hers.link)).toBe(true);
    expect(await acknowledgeLink(ownStore(him), him.scope!, him.userId, hers.link.id, "zh-Hans", { texts: careEntryStore(store) })).toMatchObject({ ok: true, written: false });
    expect((await shareRecords(him, hers.link.id)).map((x) => x.method)).toEqual(["family_switches"]);
  });

  it("only his own link, and only while it is in force", async () => {
    const him = await elder();
    const stranger = await elder("林女士");
    const her = await family();
    const r = ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
    const ack = (who: TestAccount, id: string) => acknowledgeLink(ownStore(who), who.scope!, who.userId, id, "zh-Hans", { texts: careEntryStore(store) });
    expect(await ack(stranger, r.link.id)).toMatchObject({ ok: false, status: 404, code: "link_not_found" });
    expect(await ack(him, randomUUID())).toMatchObject({ ok: false, status: 404, code: "link_not_found" });
    // a link that still waits (confirm mode) is not his to acknowledge: he answers 「是她」 or 「不是」
    const sister = await family("Hui Min");
    const waits = ok(await bindByAccount(world({ env: { FAMILY_BIND_MODE: "confirm" } }).deps(sister), caller(sister), { account: shown(him) }));
    expect(await ack(him, waits.link.id)).toMatchObject({ ok: false, status: 409, code: "link_not_active" });
    // he removes her: nothing is granted afterwards
    expect((await store.revokeLink(r.link.id, him.userId, "patient")).ok).toBe(true);
    expect(await ack(him, r.link.id)).toMatchObject({ ok: false, status: 409, code: "link_closed" });
    expect(await shareRecords(him, r.link.id)).toEqual([]);
  });
});

describe("which links are unacknowledged: the mark on his account AND no record of his own (the corrected rule)", () => {
  /** A link made straight through the store, as many older tests and tools make one: no mark, no record of his at all. */
  async function rawLink(him: TestAccount, her: TestAccount): Promise<CareLinkRow> {
    const hash = hashToken(randomUUID());
    const made = await store.createInvite({ patient_id: him.userId, family_label: "Raw", invite_token_hash: hash, invite_expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    if (!made.ok) throw new Error(made.code);
    const accepted = await store.acceptInvite(hash, her.userId);
    if (!accepted.ok) throw new Error(accepted.code);
    const confirmed = await store.confirmLink(made.link.id, him.userId, true);
    if (!confirmed.ok) throw new Error(confirmed.code);
    return confirmed.link;
  }

  it("only a link a family member bound herself; an invitation he confirmed, a link he bound and one made through the store are acknowledged as before", async () => {
    const him = await elder();
    const raw = await rawLink(him, await family("Raw"));
    expect(await store.listConsentRecords(him.userId, { kind: "family_share" })).toEqual([]);

    const invitedHer = await family("Invited");
    const invitation = await createInviteFor(ownStore(him), him.scope!, him.userId, { familyLabel: "Invited" }, Date.now());
    if (!("token" in invitation)) throw new Error("invitation");
    const accepted = await store.acceptInvite(hashToken(invitation.token), invitedHer.userId);
    if (!accepted.ok) throw new Error(accepted.code);
    expect((await confirmLinkAs(ownStore(him), him.scope!, him.userId, accepted.link.id, true, "zh-Hans", { texts: careEntryStore(store) })).ok).toBe(true);

    const mine = ok(await bindByAccount(world().deps(him), caller(him), { account: shown(await family("Mine")) }));
    const sister = await family("Hers");
    const hers = ok(await bindByAccount(world().deps(sister), caller(sister), { account: shown(him) }));

    const all = { raw: raw.id, invited: accepted.link.id, mine: mine.link.id, hers: hers.link.id };
    // asked by his own pages through his own store, and from her side through binding's narrow store: the same answers
    for (const reader of [ownStore(him), bindEntryStore(store)]) {
      const answers: Record<string, boolean> = {};
      for (const [name, id] of Object.entries(all)) answers[name] = await linkAcknowledged(reader, { id, patient_id: him.userId });
      expect(answers).toEqual({ raw: true, invited: true, mine: true, hers: false });
    }
    const views = await patientLinks(ownStore(him), careEntryStore(store), him.scope!, him.userId, Date.now());
    expect(views.filter((l) => l.state === "active")).toHaveLength(4);
    expect((await unacknowledgedLinks(ownStore(him), him.userId, views)).map((l) => l.id)).toEqual([hers.link.id]);

    // 「知道了」 is for that one link only: on any of the others it writes nothing
    for (const id of [all.raw, all.invited, all.mine]) {
      expect(await acknowledgeLink(ownStore(him), him.scope!, him.userId, id, "zh-Hans", { texts: careEntryStore(store) })).toMatchObject({ ok: true, written: false });
    }
    expect(await shareRecords(him, all.raw)).toEqual([]);
    expect(await acknowledgeLink(ownStore(him), him.scope!, him.userId, all.hers, "zh-Hans", { texts: careEntryStore(store) })).toMatchObject({ ok: true, written: true });
    expect(await unacknowledgedLinks(ownStore(him), him.userId, views)).toEqual([]);
  });

  it("the two readers take only what the rule names", () => {
    expect([
      ...boundByFamilyIds([
        { kind: "family_bound", detail: { link_id: "a", by: "family", items: DIRECT_GRANTS } },
        { kind: "family_bound", detail: { link_id: "b", by: "patient" } },
        { kind: "family_bound", detail: { by: "family" } },
        { kind: "family_bound", detail: { link_id: 7, by: "family" } },
        { kind: "password_reset", detail: { link_id: "c", by: "family" } },
        { kind: "family_bound", detail: { link_id: "d", by: "family" } },
      ]),
    ]).toEqual(["a", "d"]);
    expect([
      ...acknowledgedIds([
        { kind: "family_share", decision: "granted", evidence: { link_id: "a", version: 1 } },
        { kind: "family_share", decision: "withdrawn", evidence: { link_id: "b" } },
        { kind: "family_accept", decision: "granted", evidence: { link_id: "c" } },
        { kind: "family_share", decision: "granted", evidence: null },
        { kind: "family_share", decision: "granted", evidence: { link_id: "" } },
        { kind: "family_share", decision: "granted", evidence: { link_id: "d" } },
      ]),
    ]).toEqual(["a", "d"]);
  });

  it("costs his page nothing without a link in force, one read without a marked link, two with one", async () => {
    const him = await elder();
    const reads: string[] = [];
    const counting = new Proxy(ownStore(him), {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (prop !== "listAccountEvents" && prop !== "listConsentRecords") return value;
        return (...args: unknown[]) => (reads.push(prop), (value as (...a: unknown[]) => unknown).apply(target, args));
      },
    });
    const views = () => patientLinks(ownStore(him), careEntryStore(store), him.scope!, him.userId, Date.now());
    expect(await unacknowledgedLinks(counting, him.userId, await views())).toEqual([]);
    expect(reads).toEqual([]);
    await rawLink(him, await family("Raw"));
    expect(await unacknowledgedLinks(counting, him.userId, await views())).toEqual([]);
    expect(reads).toEqual(["listAccountEvents"]);
    const her = await family();
    const hers = ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
    reads.length = 0;
    expect((await unacknowledgedLinks(counting, him.userId, await views())).map((l) => l.id)).toEqual([hers.link.id]);
    expect(reads).toEqual(["listAccountEvents", "listConsentRecords"]);
  });
});

describe("after he removed her (round two): she does not come back by her own act", () => {
  /** 「不认识这个人，解除」 / 「停止分享」: his own stop, as the route runs it. */
  const stop = (him: TestAccount, id: string) => revokeLinkAs(ownStore(him), him.scope!, him.userId, id, "zh-Hans", { texts: careEntryStore(store) });
  const counts = async (him: TestAccount, her: TestAccount) => ({
    links: (await store.listCareLinks({ patient_id: him.userId })).length,
    his: (await store.listConsentRecords(him.userId)).length,
    hisEvents: (await store.listAccountEvents(him.userId)).length,
    hers: (await store.listConsentRecords(her.userId)).length,
    herEvents: (await store.listAccountEvents(her.userId)).length,
  });

  it("she bound, he removed her: her own binding is refused with 403 bind_removed, in both modes, and writes nothing", async () => {
    const him = await elder();
    const her = await family();
    const first = ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
    expect((await stop(him, first.link.id)).ok).toBe(true);
    const before = await counts(him, her);
    for (const mode of ["direct", "confirm"]) {
      const w = world({ env: { FAMILY_BIND_MODE: mode } });
      const mine = capture(him.userId);
      const again = await bindByAccount(w.deps(her), caller(her), { account: shown(him), label: "爸爸" });
      mine.stop();
      expect(again, mode).toEqual({ ok: false, status: 403, error: "bind_removed" });
      expect(mine.events, mode).toEqual([]);
      expect(w.told, mode).toEqual({ bound: [], accepted: [] });
    }
    expect(await counts(him, her)).toEqual(before);
    expect(await openLinks(him)).toEqual([]);
  });

  it("he can still bind her himself: she is in at once; her own typing then finds the link, and a second removal closes her way again", async () => {
    const him = await elder();
    const her = await family();
    const first = ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
    expect((await stop(him, first.link.id)).ok).toBe(true);

    const his = ok(await bindByAccount(world().deps(him), caller(him), { account: shown(her) }));
    expect(his).toMatchObject({ role: "patient", made: true, state: "active" });
    expect(his.link.id).not.toBe(first.link.id);
    expect((await shareRecords(him, his.link.id)).map((x) => x.method)).toEqual(["direct_bind"]);
    expect(await linkAcknowledged(store, his.link)).toBe(true);
    // she types his account while his own link stands: the same link, nothing made
    expect(ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }))).toMatchObject({ made: false, state: "active", link: { id: his.link.id } });

    expect((await stop(him, his.link.id)).ok).toBe(true);
    expect(await bindByAccount(world().deps(her), caller(her), { account: shown(him) })).toMatchObject({ ok: false, status: 403, error: "bind_removed" });
    // and he can bind her once more
    expect(ok(await bindByAccount(world().deps(him), caller(him), { account: shown(her) }))).toMatchObject({ made: true, state: "active" });
  });

  it("the invitation path still works, and stays his to confirm: her typing his account does not confirm it for him", async () => {
    const him = await elder();
    const her = await family();
    const first = ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
    expect((await stop(him, first.link.id)).ok).toBe(true);

    const made = await createInviteFor(ownStore(him), him.scope!, him.userId, { familyLabel: "Wei Ling", patientLabel: "爸爸" }, Date.now());
    if (!("token" in made)) throw new Error("invitation");
    const accepted = await store.acceptInvite(hashToken(made.token), her.userId);
    if (!accepted.ok) throw new Error(accepted.code);
    const id = accepted.link.id;
    // in direct mode this would have confirmed a waiting invitation for anyone he had not removed
    expect(await bindByAccount(world().deps(her), caller(her), { account: shown(him) })).toMatchObject({ ok: false, status: 403, error: "bind_removed" });
    expect((await store.getCareLink(id))?.status).toBe("accepted");
    expect(await boundEvents(him, id)).toEqual([]);
    // his own 「是她」 lets her in, every switch off as an invitation starts
    expect((await confirmLinkAs(ownStore(him), him.scope!, him.userId, id, true, "zh-Hans", { texts: careEntryStore(store) })).ok).toBe(true);
    expect((await store.getCareLink(id))?.status).toBe("active");
    expect((await store.getFamilyGrant(him.userId, id))?.items).toEqual(NO_GRANTS);
    expect(ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }))).toMatchObject({ made: false, link: { id } });
  });

  it("she left by herself: he never removed her, so she may bind again (and waits for his answer again)", async () => {
    const him = await elder();
    const her = await family();
    const first = ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
    expect((await leaveLinkAs(careEntryStore(store), ownStore(her), her.userId, first.link.id, "zh-Hans")).ok).toBe(true);
    expect(await store.getCareLink(first.link.id)).toMatchObject({ status: "revoked", revoked_by: "family" });
    const again = ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
    expect(again).toMatchObject({ made: true, state: "active" });
    expect(again.link.id).not.toBe(first.link.id);
    expect(await linkAcknowledged(store, again.link)).toBe(false);
  });

  it("「不是」 is his removing her too (what a removal is in confirm mode); once he has said it she is refused in either mode", async () => {
    const him = await elder();
    const her = await family();
    const waits = ok(await bindByAccount(world({ env: { FAMILY_BIND_MODE: "confirm" } }).deps(her), caller(her), { account: shown(him) }));
    expect(waits.state).toBe("accepted");
    expect((await confirmLinkAs(ownStore(him), him.scope!, him.userId, waits.link.id, false, "zh-Hans", { texts: careEntryStore(store) })).ok).toBe(true);
    expect((await store.getCareLink(waits.link.id))?.status).toBe("declined");
    for (const mode of ["confirm", "direct"]) {
      expect(await bindByAccount(world({ env: { FAMILY_BIND_MODE: mode } }).deps(her), caller(her), { account: shown(him) }), mode).toMatchObject({ ok: false, status: 403, error: "bind_removed" });
    }
    expect(await openLinks(him)).toEqual([]);
  });

  it("only that pair: his other family members, and her other elders, bind as before; an invitation he took back is not a removal", async () => {
    const him = await elder();
    const her = await family();
    const first = ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
    expect((await stop(him, first.link.id)).ok).toBe(true);
    const sister = await family("Hui Min");
    expect(ok(await bindByAccount(world().deps(sister), caller(sister), { account: shown(him) }))).toMatchObject({ made: true, state: "active" });
    const mother = await elder("林女士");
    expect(ok(await bindByAccount(world().deps(her), caller(her), { account: shown(mother) }))).toMatchObject({ made: true, state: "active" });

    // he made an invitation and took it back before anyone accepted: it names nobody, so nobody is removed by it
    const father = await elder("李先生");
    const son = await family("Wei Jie");
    const made = await createInviteFor(ownStore(father), father.scope!, father.userId, { familyLabel: "Wei Jie" }, Date.now());
    if (!("token" in made)) throw new Error("invitation");
    expect((await cancelInvite(ownStore(father), father.scope!, father.userId, made.link.id)).ok).toBe(true);
    expect(ok(await bindByAccount(world().deps(son), caller(son), { account: shown(father) }))).toMatchObject({ made: true, state: "active" });
  });

  it("which ended links are his removing her", () => {
    const at = "2026-10-11T12:00:00.000Z";
    // in force once, then stopped by him; or his 「不是」
    expect(endedByHim({ status: "revoked", revoked_by: "patient", confirmed_at: at })).toBe(true);
    expect(endedByHim({ status: "declined", revoked_by: null, confirmed_at: null })).toBe(true);
    // she left; a half-made binding undone or an accepted invitation taken back (never in force); one in force or waiting
    expect(endedByHim({ status: "revoked", revoked_by: "family", confirmed_at: at })).toBe(false);
    expect(endedByHim({ status: "revoked", revoked_by: "patient", confirmed_at: null })).toBe(false);
    expect(endedByHim({ status: "active", revoked_by: null, confirmed_at: at })).toBe(false);
    expect(endedByHim({ status: "accepted", revoked_by: null, confirmed_at: null })).toBe(false);
    expect(endedByHim({ status: "expired", revoked_by: null, confirmed_at: null })).toBe(false);
  });
});

describe("his stop writes a withdrawal only where he gave a consent (round two)", () => {
  const stop = (him: TestAccount, id: string) => revokeLinkAs(ownStore(him), him.scope!, him.userId, id, "zh-Hans", { texts: careEntryStore(store) });
  const removedEvents = async (him: TestAccount, linkId: string) => (await store.listAccountEvents(him.userId)).filter((e) => e.kind === "family_bound_removed" && e.detail.link_id === linkId);

  it("a link she bound and he never acknowledged: no family_share record at all, and family_bound_removed on his account", async () => {
    const him = await elder();
    const her = await family();
    const r = ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
    const mine = capture(him.userId);
    expect((await stop(him, r.link.id)).ok).toBe(true);
    mine.stop();
    expect(mine.events.map((e) => [e.type, e.data])).toEqual([["care_link.revoked", { link: { id: r.link.id, status: "revoked" } }]]);
    expect(await shareRecords(him, r.link.id)).toEqual([]);
    expect((await removedEvents(him, r.link.id)).map((e) => e.detail)).toEqual([{ link_id: r.link.id }]);
    // nothing on her account, and her own record of following him stays as it was (she did not leave)
    expect((await store.listAccountEvents(her.userId)).filter((e) => e.kind === "family_bound_removed")).toEqual([]);
    expect((await acceptRecords(her, r.link.id)).map((x) => x.decision)).toEqual(["granted"]);
  });

  it("a link he acknowledged, one he bound himself, an invitation he confirmed: his family_share is withdrawn as before, and no event", async () => {
    const him = await elder();
    // she bound, he tapped 「知道了」
    const her = await family();
    const acked = ok(await bindByAccount(world().deps(her), caller(her), { account: shown(him) }));
    expect(await acknowledgeLink(ownStore(him), him.scope!, him.userId, acked.link.id, "zh-Hans", { texts: careEntryStore(store) })).toMatchObject({ ok: true, written: true });
    // she bound, he changed a switch without tapping
    const sister = await family("Hui Min");
    const switched = ok(await bindByAccount(world().deps(sister), caller(sister), { account: shown(him) }));
    expect((await setLinkSwitches(ownStore(him), him.scope!, him.userId, switched.link.id, { bp_summary: false }, "zh-Hans", () => undefined, { texts: careEntryStore(store) })).ok).toBe(true);
    // he bound her
    const own = ok(await bindByAccount(world().deps(him), caller(him), { account: shown(await family("Mine")) }));
    // he invited and confirmed
    const invitedHer = await family("Invited");
    const made = await createInviteFor(ownStore(him), him.scope!, him.userId, { familyLabel: "Invited" }, Date.now());
    if (!("token" in made)) throw new Error("invitation");
    const accepted = await store.acceptInvite(hashToken(made.token), invitedHer.userId);
    if (!accepted.ok) throw new Error(accepted.code);
    expect((await confirmLinkAs(ownStore(him), him.scope!, him.userId, accepted.link.id, true, "zh-Hans", { texts: careEntryStore(store) })).ok).toBe(true);

    const text = currentConsent("family_share", "zh-Hans");
    for (const [name, id, methods] of [
      ["acknowledged", acked.link.id, ["direct_bind_ack", "family_stop"]],
      ["a switch changed", switched.link.id, ["family_switches", "family_stop"]],
      ["bound by him", own.link.id, ["direct_bind", "family_stop"]],
      ["invited", accepted.link.id, ["family_confirm", "family_stop"]],
    ] as const) {
      expect((await stop(him, id)).ok, name).toBe(true);
      const his = await shareRecords(him, id);
      expect(his.map((x) => x.method), name).toEqual(methods);
      expect(his.at(-1), name).toMatchObject({ decision: "withdrawn", version: text.version, text_sha256: text.sha256, assisted: false });
      expect(await removedEvents(him, id), name).toEqual([]);
    }
  });

  it("the withdrawal keeps who was tapping: what the request says, else what his sign-up recorded, from the one read", async () => {
    const him = await elder("陈先生", { assisted: true });
    const her = await family();
    const one = ok(await bindByAccount(world().deps(him), caller(him), { account: shown(her) }));
    const reads: string[] = [];
    const counting = new Proxy(ownStore(him), {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (prop !== "listAccountEvents" && prop !== "listConsentRecords") return value;
        return (...args: unknown[]) => (reads.push(`${prop}:${JSON.stringify(args[1] ?? null)}`), (value as (...a: unknown[]) => unknown).apply(target, args));
      },
    });
    expect((await revokeLinkAs(counting, him.scope!, him.userId, one.link.id, "zh-Hans", { texts: careEntryStore(store) })).ok).toBe(true);
    // one read of his consent records, every kind, and none of his account events
    expect(reads).toEqual(["listConsentRecords:null"]);
    expect((await shareRecords(him, one.link.id)).at(-1)).toMatchObject({ decision: "withdrawn", assisted: true, evidence: { link_id: one.link.id, assisted_note: ASSISTED_NOTE } });
    // the request says he is alone now
    const two = ok(await bindByAccount(world().deps(him), caller(him), { account: shown(await family("Hui Min")) }));
    expect((await revokeLinkAs(ownStore(him), him.scope!, him.userId, two.link.id, "zh-Hans", { texts: careEntryStore(store), assisted: false })).ok).toBe(true);
    expect((await shareRecords(him, two.link.id)).at(-1)).toMatchObject({ decision: "withdrawn", assisted: false });
  });

  it("a link made straight through the store, with no consent of his and no mark: the stop writes neither", async () => {
    const him = await elder();
    const her = await family("Raw");
    const hash = hashToken(randomUUID());
    const made = await store.createInvite({ patient_id: him.userId, family_label: "Raw", invite_token_hash: hash, invite_expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    if (!made.ok) throw new Error(made.code);
    expect((await store.acceptInvite(hash, her.userId)).ok).toBe(true);
    expect((await store.confirmLink(made.link.id, him.userId, true)).ok).toBe(true);
    expect((await stop(him, made.link.id)).ok).toBe(true);
    expect(await shareRecords(him, made.link.id)).toEqual([]);
    expect(await removedEvents(him, made.link.id)).toEqual([]);
    expect((await store.getCareLink(made.link.id))?.status).toBe("revoked");
  });
});
