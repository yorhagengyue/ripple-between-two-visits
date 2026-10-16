/**
 * 「我 → AI 处理」 (lib/privacy/ai.ts; real-app 3.11 「AI 处理同意可以拒绝」; journey 15; C2 track H): the switch appends
 * a consent record with the version and the hash of the text his screen showed, publishes that text once, and
 * lib/safety/consent.ts aiConsent follows the newest record on the next ask.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aiState, setAiConsent } from "@/lib/privacy/ai";
import { currentConsentText } from "@/lib/privacy/consent-texts";
import { aiConsent } from "@/lib/safety/consent";
import { MemoryStore } from "@/lib/store/memory";
import { selfSubject } from "@/lib/subject/resolve";

async function account(signup?: "granted" | "declined") {
  const store = new MemoryStore();
  const uid = randomUUID();
  await store.createAccount({ user_id: uid, login_kind: "username", username: `ai${uid.slice(0, 8)}` });
  const scope = await store.createAccountScope({ user_id: uid, d0: "2026-10-01" });
  if (signup) await store.addConsentRecord({ user_id: uid, scope_id: uid, kind: "ai_processing", decision: signup, version: "2026-10-10", method: "signup_screen" });
  return { store, uid, scope, own: selfSubject(store, scope, uid).store };
}

describe("setAiConsent", () => {
  it("off after a yes is a withdrawal with the text's version and hash; aiConsent follows it; on again is granted", async () => {
    const a = await account("granted");
    // his yes to the 2026-10-10 text still counts under the 2026-10-15 one (nothing asks him again)
    expect(await aiConsent(a.own, a.scope)).toBe(true);
    const off = await setAiConsent({ store: a.own, texts: a.store }, { userId: a.uid, scopeId: a.scope.id, on: false, locale: "zh-Hans" });
    expect(off).toMatchObject({ changed: true, state: { on: false, decision: "withdrawn", version: "2026-10-15" } });
    expect(await aiConsent(a.own, a.scope)).toBe(false);
    const text = currentConsentText("ai_processing", "zh-Hans");
    const last = (await a.store.listConsentRecords(a.uid, { kind: "ai_processing" })).at(-1)!;
    expect(last).toMatchObject({ decision: "withdrawn", version: text.version, text_sha256: text.sha256, method: "me_screen", scope_id: a.scope.id, assisted: false });
    expect(await a.store.getConsentText("ai_processing", text.version, "zh-Hans")).toMatchObject({ sha256: text.sha256 });

    const on = await setAiConsent({ store: a.own, texts: a.store }, { userId: a.uid, scopeId: a.scope.id, on: true, locale: "en" });
    expect(on).toMatchObject({ changed: true, state: { on: true, decision: "granted" } });
    expect((await a.store.listConsentRecords(a.uid, { kind: "ai_processing" })).at(-1)).toMatchObject({ text_sha256: currentConsentText("ai_processing", "en").sha256 });
    expect(await aiConsent(a.own, a.scope)).toBe(true);
    expect(await aiState(a.own, a.uid)).toMatchObject({ on: true, decision: "granted" });
  });

  it("asking for the state he is in writes nothing; off when he never chose is a no (declined)", async () => {
    const a = await account("granted");
    expect(await setAiConsent({ store: a.own, texts: a.store }, { userId: a.uid, scopeId: a.scope.id, on: true, locale: "zh-Hans" })).toMatchObject({ changed: false });
    expect(await a.store.listConsentRecords(a.uid, { kind: "ai_processing" })).toHaveLength(1);

    const b = await account();
    expect(await aiState(b.own, b.uid)).toEqual({ on: false, decision: null, at: null, version: null });
    expect(await setAiConsent({ store: b.own, texts: b.store }, { userId: b.uid, scopeId: b.scope.id, on: false, locale: "zh-Hans" })).toMatchObject({ changed: true, state: { decision: "declined", on: false } });
  });

  it("only his own records: another user's id through his store is a scope violation", async () => {
    const a = await account("granted");
    await expect(setAiConsent({ store: a.own, texts: a.store }, { userId: randomUUID(), scopeId: a.scope.id, on: false, locale: "zh-Hans" })).rejects.toThrow(/named another user/);
  });
});
