/**
 * aiConsent (lib/safety/consent.ts): an account's latest ai_processing decision; the demo's synthetic story is allowed.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { aiConsent } from "@/lib/safety/consent";
import { getMemoryStore } from "@/lib/store/memory";
import { scopedStore } from "@/lib/subject";

const store = getMemoryStore();
const login = () => `cs${randomUUID().slice(0, 10)}`;

describe("aiConsent", () => {
  it("a demo sandbox: allowed", async () => {
    expect(await aiConsent(store, await store.createSession({ ttl_hours: 1 }))).toBe(true);
  });

  it("an account: the latest decision counts; no record at all is no", async () => {
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: login(), password: "a long test password", space: "blank" });
    const own = scopedStore(store, a.scope!, "self", { userId: a.userId, maskSessionId: true });
    expect(await aiConsent(own, a.scope!)).toBe(true); // the dev helper grants terms and AI processing
    await own.addConsentRecord({ user_id: a.userId, scope_id: a.scope!.id, kind: "ai_processing", decision: "withdrawn", method: "test" });
    expect(await aiConsent(own, a.scope!)).toBe(false);
    await own.addConsentRecord({ user_id: a.userId, scope_id: a.scope!.id, kind: "ai_processing", decision: "granted", method: "test" });
    expect(await aiConsent(own, a.scope!)).toBe(true);

    const b = await createAccountWithSpace(store, getAuthProvider(), { login: login(), password: "a long test password", space: "blank", consents: ["terms_privacy"] });
    expect(await aiConsent(store, b.scope!)).toBe(false);
  });
});
