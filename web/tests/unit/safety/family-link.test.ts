/**
 * Family words on an account come from the care link (C2 track S, round 2; real-app 3.10 line 747, 6.16 line 1268; audit
 * au3 row 14, au4 row 26). The demo has one built-in member ("wei-ling"); an account has links, each with its own relation,
 * the name he gave, and its own switches.
 *
 *   - an ask about sharing the visit recordings reads his active links and their switches (it used to read the demo's
 *     member row, which does not exist on an account, and always said "off"), and words who can see them from each
 *     link's relation and name: his own record under a fixed sentence
 *   - his reminder card says whose recording it is from the link's relation, never a fixed 女儿
 *   - the demo is as it was
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { newInviteToken } from "@/lib/care/tokens";
import { accountToday } from "@/lib/daily/account-today";
import { createMockLlm } from "@/lib/llm";
import { ask } from "@/lib/safety";
import { clipRelation, hisCareLinks, sharedWith } from "@/lib/safety/family-link";
import { TEMPLATES } from "@/lib/safety/templates";
import type { AskResult } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { FamilyGrantItems } from "@/lib/store/types";
import { scopedStore } from "@/lib/subject";
import { familyRecordingWords, familySaidWords, tapToHearWords, uiCopy } from "@/lib/ui/copy";

const store = getMemoryStore();
const PASSWORD = "a long test password";
const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const account = (space: "blank" | "example" | "none"): Promise<TestAccount> => createAccountWithSpace(store, getAuthProvider(), { login: login(space === "none" ? "f" : "p"), password: PASSWORD, space });

/** He invites someone, she accepts, he confirms, and he sets the link's switches. Returns the link id. */
async function linked(him: TestAccount, relation: string | null, label: string, items: Partial<FamilyGrantItems> = {}): Promise<{ linkId: string; her: TestAccount }> {
  const her = await account("none");
  const t = newInviteToken();
  const made = await store.createInvite({ id: t.linkId, patient_id: him.userId, relation, family_label: label, invite_token_hash: t.hash, invite_expires_at: new Date(Date.now() + 86_400_000).toISOString() }, {});
  if (!made.ok) throw new Error(made.code);
  const accepted = await store.acceptInvite(t.hash, her.userId, null);
  if (!accepted.ok) throw new Error(accepted.code);
  const confirmed = await store.confirmLink(t.linkId, him.userId, true);
  if (!confirmed.ok) throw new Error(confirmed.code);
  if (Object.keys(items).length) await store.setFamilyGrant(him.userId, t.linkId, items);
  return { linkId: t.linkId, her };
}

const own = (him: TestAccount) => scopedStore(store, him.scope!, "self", { userId: him.userId, maskSessionId: true });
const askHim = (him: TestAccount, text: string, locale: "zh-Hans" | "en" = "zh-Hans"): Promise<AskResult> =>
  ask({ sessionId: him.userId, text, locale }, { store: own(him), llm: createMockLlm(), checker: null, costGuard: null, publish: () => undefined });
const shown = (r: AskResult, locale: "zh-Hans" | "en" = "zh-Hans") => r.sentences.map((s) => (locale === "zh-Hans" ? (s.zh ?? s.en) : s.en));

const ASK_ZH = "家人能不能看到我的看诊录音？";
const ASK_EN = "Can my family see the recording of my visit?";

describe("an ask about sharing the visit recordings, on an account", () => {
  it("no link at all: not shared, said to him, with no name in it", async () => {
    const him = await account("blank");
    const r = await askHim(him, ASK_ZH);
    expect(r.route).toBe("logistics");
    expect(r.sentences.map((s) => s.templateId)).toEqual(["grant_recordings_off_self"]);
    expect(shown(r)).toEqual([TEMPLATES.grant_recordings_off_self.zh]);
    expect(shown(r).join("")).not.toMatch(/陈先生|Mr Tan|Wei Ling/);
    expect(r.blocked).toEqual([]);
  });

  it("an active link with the switch off: still not shared; the switch on: who can see them, from the link's relation and name", async () => {
    const him = await account("blank");
    const { linkId } = await linked(him, "son", "阿明", { dose_summary: true });
    expect(sharedWith(await hisCareLinks(own(him), him.scope!), "visit_transcripts", "zh-Hans")).toEqual([]);
    expect((await askHim(him, ASK_ZH)).sentences.map((s) => s.templateId)).toEqual(["grant_recordings_off_self"]);

    await store.setFamilyGrant(him.userId, linkId, { visit_transcripts: true });
    const r = await askHim(him, ASK_ZH);
    expect(r.route).toBe("logistics");
    expect(r.sentences.map((s) => s.templateId ?? s.sourceId)).toEqual(["grant_recordings_on_self", "log:family"]);
    expect(shown(r)).toEqual(["你已打开就诊录音的分享。", "现在能看到的家人：儿子 阿明。"]);
    expect(r.blocked).toEqual([]);
    // never the demo's cast
    expect(shown(r).join("")).not.toMatch(/女儿|Wei Ling|陈先生/);
    const en = await askHim(him, ASK_EN, "en");
    expect(shown(en, "en")).toEqual(["You have turned on sharing of your visit recordings.", "Family who can see them now: 阿明 (son)."]);
  });

  it("several links: each has its own switch, and only the ones that are on are named, in the order he made them", async () => {
    const him = await account("blank");
    await linked(him, "daughter", "Wei Ling", { visit_transcripts: true });
    await linked(him, "wife", "Mei", {});
    await linked(him, null, "Uncle Bo", { visit_transcripts: true });
    const links = await hisCareLinks(own(him), him.scope!);
    expect(links).toHaveLength(3);
    expect(sharedWith(links, "visit_transcripts", "zh-Hans")).toEqual(["女儿 Wei Ling", "Uncle Bo"]);
    expect(shown(await askHim(him, ASK_ZH))[1]).toBe("现在能看到的家人：女儿 Wei Ling、Uncle Bo。");
  });

  it("a link that is not active (invited only, or stopped) is not family who can see anything", async () => {
    const him = await account("blank");
    const t = newInviteToken();
    await store.createInvite({ id: t.linkId, patient_id: him.userId, relation: "daughter", family_label: "Wei Ling", invite_token_hash: t.hash, invite_expires_at: new Date(Date.now() + 86_400_000).toISOString() }, {});
    expect(await hisCareLinks(own(him), him.scope!)).toEqual([]);
    const { linkId } = await linked(him, "daughter", "Wei Ling", { visit_transcripts: true });
    expect((await askHim(him, ASK_ZH)).sentences.map((s) => s.templateId ?? s.sourceId)).toEqual(["grant_recordings_on_self", "log:family"]);
    await store.revokeLink(linkId, him.userId, "patient");
    expect((await askHim(him, ASK_ZH)).sentences.map((s) => s.templateId)).toEqual(["grant_recordings_off_self"]);
  });

  it("the demo is as it was: its one built-in member and the story's two sentences", async () => {
    const s = await store.createSession({ story_day: 29, ttl_hours: 1 });
    const off = await ask({ sessionId: s.id, text: ASK_EN, locale: "en" }, { store, llm: createMockLlm(), checker: null, costGuard: null, publish: () => undefined });
    expect(off.sentences.map((x) => x.templateId)).toEqual(["grant_recordings_off"]);
    await store.setFamilyGrant(s.id, "wei-ling", { visit_transcripts: true });
    const on = await ask({ sessionId: s.id, text: ASK_EN, locale: "en" }, { store, llm: createMockLlm(), checker: null, costGuard: null, publish: () => undefined });
    expect(on.sentences.map((x) => x.templateId)).toEqual(["grant_recordings_on"]);
    expect(await hisCareLinks(store, s)).toEqual([]);
  });

  it("a store that may not read his links (her view) names nobody and never throws", async () => {
    const him = await account("blank");
    const { linkId, her } = await linked(him, "daughter", "Wei Ling", { visit_transcripts: true });
    const hers = scopedStore(store, him.scope!, "family", { userId: her.userId, linkId, maskSessionId: true });
    expect(await hisCareLinks(hers, him.scope!)).toEqual([]);
  });
});

describe("whose recording it is, on his reminder card", () => {
  it("a clip recorded through a link carries that link's relation on his Today; the words come from it", async () => {
    const him = await account("blank");
    const { linkId, her } = await linked(him, "son", "阿明", {});
    const clip = await store.addReminderClip(him.userId, { by: linkId, audio_path: null, plays_at: "after_breakfast", text: "爸，记得吃药。", lang: "zh-Hans", by_user_id: her.userId, by_label: "阿明", link_id: linkId });
    expect(await clipRelation(own(him), him.scope!, clip.id)).toBe("son");
    expect(familyRecordingWords("zh-Hans", "son")).toBe("儿子的录音");
    expect(familyRecordingWords("en", "son")).toBe("Your son's recording");
    // no relation on the link: family, never 女儿
    expect(familyRecordingWords("zh-Hans", null)).toBe("家人的录音");
    expect(tapToHearWords("zh-Hans", "son")).toBe("点一下，听儿子的提醒");
    expect(tapToHearWords("zh-Hans", "son", "阿明")).toBe("点一下，听 阿明 的提醒");
    expect(tapToHearWords("en", null)).toBe("Tap to hear your family's reminder");
    expect(familySaidWords("zh-Hans", "daughter", "Wei Ling")).toBe("女儿 Wei Ling 说");
    expect(familySaidWords("zh-Hans", null, null)).toBe("家人说");
    expect(familySaidWords("en", "daughter", "Wei Ling")).toBe("Wei Ling (daughter) said");
    // a clip with no link (the example's seeded one), and the demo: no relation
    const example = await account("example");
    const seeded = (await store.listReminderClips(example.userId))[0];
    expect(await clipRelation(own(example), example.scope!, seeded.id)).toBeNull();
    const demo = await store.createSession({ ttl_hours: 1 });
    expect(await clipRelation(store, demo, (await store.listReminderClips(demo.id))[0].id)).toBeNull();
  });

  it("the design system's fixed words no longer name a daughter or Wei Ling", () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      const c = uiCopy(locale);
      for (const s of [c.herRecording, c.tapToPlay, c.sources.family]) expect(s).not.toMatch(/女儿|Wei Ling|daughter/);
    }
    expect(uiCopy("zh-Hans").herRecording).toBe("家人的录音");
    expect(uiCopy("zh-Hans").sources.family).toBe("家人说");
  });

  it("accountToday hands the card the relation when her clip is due", async () => {
    const him = await account("blank");
    const { linkId, her } = await linked(him, "wife", "Mei", {});
    await store.addReminderClip(him.userId, { by: linkId, audio_path: null, plays_at: "after_breakfast", text: "记得吃药。", lang: "zh-Hans", by_user_id: her.userId, by_label: "Mei", link_id: linkId });
    const scope = (await store.getSession(him.userId))!;
    const view = await accountToday(own(him), scope, Date.now(), { remind: "dose-morning" }, "zh-Hans");
    // the card only shows at a reminder; whenever it does, the clip says whose it is
    if (view.reminder) expect(view.reminder.by_relation).toBe("wife");
    else expect(view.reminder).toBeNull();
  });
});
