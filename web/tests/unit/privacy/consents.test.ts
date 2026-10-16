/**
 * Every consent text through one module (lib/privacy/consents.ts; real-app 3.11 line 798 「同意文字的定稿……写进 consent_text，
 * 只插不改；测试核对代码里的哈希和库里的一致」, line 785 「每条带 version、text_sha256……assisted」; C2 track H):
 *   - every consent kind has its text in force, hashed exactly as its own track hashes it (A's sign-up texts, D's
 *     family texts, F's card for the doctor, H's two)
 *   - publishing writes every text to consent_text once, the hashes in the table are the hashes in the code, and a text
 *     changed without a new version is refused
 *   - a record written through recordConsent carries the stamp, has its text row, and says when someone helped him
 *   - every recorded hash has its text row once the texts are published, whoever wrote the record
 *   - every place that writes a consent record is known here, with what it stamps (a new writer turns this red)
 */
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FAMILY_CONSENT_TEXTS, familyConsentText } from "@/lib/care/consent";
import { setAiConsent } from "@/lib/privacy/ai";
import { CONSENT_TEXTS, consentBody, currentConsentText } from "@/lib/privacy/consent-texts";
import { MORE_CONSENT_TEXTS, moreConsentText } from "@/lib/privacy/consent-texts-more";
import {
  ALL_CONSENT_TEXTS,
  ASSISTED_NOTE,
  CONSENT_KINDS,
  assistedEvidence,
  consentStamp,
  consentTextOf,
  currentConsent,
  publishConsentTexts,
  recordConsent,
  unpublishedConsents,
} from "@/lib/privacy/consents";
import { MemoryStore } from "@/lib/store/memory";
import { CONSENT_CARD_EN, CONSENT_CARD_VERSION } from "@/lib/visit/consent";
import { consentCardSha } from "@/lib/visit/pipeline";

const WEB = fileURLToPath(new URL("../../../", import.meta.url));
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("the consent texts, all kinds", () => {
  it("every kind has its text in force: both languages, the doctor's card in English only", () => {
    for (const kind of CONSENT_KINDS) {
      const zh = currentConsent(kind, "zh-Hans");
      const en = currentConsent(kind, "en");
      expect(en.locale, kind).toBe("en");
      expect(zh.locale, kind).toBe(kind === "visit_recording" ? "en" : "zh-Hans");
      expect(zh.version).toBe(en.version);
      expect(consentTextOf(kind, en.version, "en")).toBe(en);
      expect(consentStamp(kind, "en")).toEqual({ version: en.version, text_sha256: en.sha256, locale: "en" });
    }
    expect(consentTextOf("terms_privacy", "1999-01-01", "en")).toBeNull();
  });

  it("each sha256 is the hash of exactly its text, and a kind, version and locale is published once", () => {
    for (const t of ALL_CONSENT_TEXTS) expect(t.sha256, `${t.kind} ${t.version} ${t.locale}: the right sha256 is ${sha(t.text)}`).toBe(sha(t.text));
    for (const t of MORE_CONSENT_TEXTS) expect(t.text).toBe(consentBody(t.title, t.paragraphs));
    const keys = ALL_CONSENT_TEXTS.map((t) => `${t.kind}|${t.version}|${t.locale}`);
    expect(new Set(keys).size).toBe(keys.length);
    // C2 track D (round two): the family texts have more than one version now; every version stays published
    expect(ALL_CONSENT_TEXTS.length).toBe(CONSENT_TEXTS.length + FAMILY_CONSENT_TEXTS.length + 1 + MORE_CONSENT_TEXTS.length);
  });

  it("the stamp is the one each track's own writer records: no recorded hash changes meaning", () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      for (const kind of ["terms_privacy", "ai_processing", "example_data"] as const) {
        expect(consentStamp(kind, locale)).toMatchObject({ version: currentConsentText(kind, locale).version, text_sha256: currentConsentText(kind, locale).sha256 });
      }
      for (const kind of ["family_accept", "family_share"] as const) {
        expect(consentStamp(kind, locale)).toMatchObject({ version: familyConsentText(kind, locale).version, text_sha256: familyConsentText(kind, locale).sha256 });
      }
      for (const kind of ["retention_keep_forever", "family_reset_helper"] as const) {
        expect(consentStamp(kind, locale)).toMatchObject({ version: moreConsentText(kind, locale).version, text_sha256: moreConsentText(kind, locale).sha256 });
      }
      // the card for the doctor: the sha256 of the one sentence, as lib/visit/pipeline.ts writes it
      expect(consentStamp("visit_recording", locale)).toEqual({ version: CONSENT_CARD_VERSION, text_sha256: consentCardSha(), locale: "en" });
    }
    expect(currentConsent("visit_recording", "en").text).toBe(CONSENT_CARD_EN);
  });

  it("the two new texts say what the code does: 90 days, the transcript stays; a 6-digit number, 10 minutes, once, his own phone", () => {
    const keepZh = moreConsentText("retention_keep_forever", "zh-Hans").text;
    const keepEn = moreConsentText("retention_keep_forever", "en").text;
    for (const w of ["90 天", "一直留着", "逐字稿", "删除账号"]) expect(keepZh).toContain(w);
    for (const w of ["90 days", "transcript", "delete your account"]) expect(keepEn).toContain(w);
    const helpZh = moreConsentText("family_reset_helper", "zh-Hans").text;
    const helpEn = moreConsentText("family_reset_helper", "en").text;
    for (const w of ["6 位数", "10 分钟", "只能用一次", "看不到你的密码", "随时可以关掉"]) expect(helpZh).toContain(w);
    for (const w of ["6-digit", "10 minutes", "only once", "never see your password", "switch this off at any time"]) expect(helpEn).toContain(w);
    // fixed text about the account, never a person's name and never anything clinical
    for (const t of MORE_CONSENT_TEXTS) expect(t.text).not.toMatch(/Wei Ling|陈先生|Mr Tan|mg|血压|blood pressure/);
  });
});

describe("publishing to consent_text", () => {
  it("writes every text once; the table's hashes are the code's; publishing again changes nothing", async () => {
    const store = new MemoryStore();
    expect(await publishConsentTexts(store)).toEqual({ texts: ALL_CONSENT_TEXTS.length, failed: 0 });
    for (const t of ALL_CONSENT_TEXTS) {
      const row = await store.getConsentText(t.kind, t.version, t.locale);
      expect(row, `${t.kind} ${t.version} ${t.locale}`).toMatchObject({ sha256: t.sha256, text: t.text });
      expect(sha(row!.text)).toBe(row!.sha256);
    }
    const first = (await store.getConsentText("terms_privacy", currentConsentText("terms_privacy", "en").version, "en"))!.published_at;
    expect(await publishConsentTexts(store)).toEqual({ texts: ALL_CONSENT_TEXTS.length, failed: 0 });
    expect((await store.getConsentText("terms_privacy", currentConsentText("terms_privacy", "en").version, "en"))!.published_at).toBe(first);
  });

  it("a text that changed without a new version is refused and counted; the published words stay", async () => {
    const store = new MemoryStore();
    const t = moreConsentText("family_reset_helper", "en");
    await store.putConsentText({ kind: t.kind, version: t.version, locale: t.locale, sha256: sha("older words"), text: "older words" });
    expect(await publishConsentTexts(store)).toEqual({ texts: ALL_CONSENT_TEXTS.length - 1, failed: 1 });
    expect((await store.getConsentText(t.kind, t.version, "en"))!.text).toBe("older words");
  });
});

async function person(store: MemoryStore) {
  const uid = randomUUID();
  await store.createAccount({ user_id: uid, login_kind: "username", username: `c${uid.slice(0, 8)}` });
  const scope = await store.createAccountScope({ user_id: uid, d0: "2026-10-01" });
  return { uid, scope };
}

describe("recordConsent", () => {
  it("stamps the version and hash of the text in force, publishes that text first, and keeps the language", async () => {
    const store = new MemoryStore();
    const { uid, scope } = await person(store);
    const row = await recordConsent({ records: store, texts: store }, { user_id: uid, scope_id: scope.id, kind: "retention_keep_forever", decision: "granted", locale: "zh-Hans", method: "tap", evidence: { visit_id: "v-1" } });
    const text = moreConsentText("retention_keep_forever", "zh-Hans");
    expect(row).toMatchObject({ kind: "retention_keep_forever", decision: "granted", version: text.version, text_sha256: text.sha256, method: "tap", assisted: false, scope_id: scope.id });
    expect(row.evidence).toEqual({ visit_id: "v-1", locale: "zh-Hans" });
    expect(await store.getConsentText("retention_keep_forever", text.version, "zh-Hans")).toMatchObject({ sha256: text.sha256 });
    expect(await unpublishedConsents(store, [row])).toEqual([]);
  });

  it("someone helping him on his device: assisted = true and the note, in the design's words", async () => {
    const store = new MemoryStore();
    const { uid, scope } = await person(store);
    const row = await recordConsent({ records: store, texts: store }, { user_id: uid, scope_id: scope.id, kind: "family_reset_helper", decision: "granted", locale: "en", method: "me_screen", assisted: true });
    expect(row.assisted).toBe(true);
    expect(row.evidence).toEqual({ locale: "en", assisted_note: "在他的设备上，有人协助" });
    expect(ASSISTED_NOTE).toBe("在他的设备上，有人协助");
    expect(assistedEvidence(false)).toEqual({});
    expect(assistedEvidence(undefined)).toEqual({});
    // his own AI switch passes it through the same way
    await setAiConsent({ store, texts: store }, { userId: uid, scopeId: scope.id, on: true, locale: "zh-Hans", assisted: true });
    const ai = (await store.listConsentRecords(uid, { kind: "ai_processing" })).at(-1)!;
    expect(ai).toMatchObject({ assisted: true, decision: "granted", text_sha256: currentConsentText("ai_processing", "zh-Hans").sha256 });
    expect(ai.evidence).toMatchObject({ screen: "/p/me/ai", locale: "zh-Hans", assisted_note: ASSISTED_NOTE });
    await setAiConsent({ store, texts: store }, { userId: uid, scopeId: scope.id, on: false, locale: "zh-Hans" });
    const alone = (await store.listConsentRecords(uid, { kind: "ai_processing" })).at(-1)!;
    expect(alone.assisted).toBe(false);
    expect(alone.evidence).not.toHaveProperty("assisted_note");
  });
});

describe("every recorded hash has its text row", () => {
  it("records stamped the way each writer stamps them: missing before the texts are published, all found after", async () => {
    const store = new MemoryStore();
    const { uid, scope } = await person(store);
    const base = { user_id: uid, scope_id: scope.id, method: "test" };
    // one record per kind and language, each with the stamp its writer takes from the registry or from its own module
    for (const kind of CONSENT_KINDS) {
      for (const locale of ["zh-Hans", "en"] as const) {
        const stamp = consentStamp(kind, locale);
        await store.addConsentRecord({ ...base, kind, decision: "granted", version: stamp.version, text_sha256: stamp.text_sha256 });
      }
    }
    const fam = familyConsentText("family_share", "en");
    await store.addConsentRecord({ ...base, kind: "family_share", decision: "withdrawn", version: fam.version, text_sha256: fam.sha256 });
    await store.addConsentRecord({ ...base, kind: "visit_recording", decision: "declined", version: CONSENT_CARD_VERSION, text_sha256: consentCardSha() });
    const records = await store.listConsentRecords(uid);
    expect(records).toHaveLength(CONSENT_KINDS.length * 2 + 2);

    const before = await unpublishedConsents(store, records);
    expect(before).toHaveLength(records.length);
    expect(new Set(before.map((x) => x.why))).toEqual(new Set(["no_text_row"]));

    await publishConsentTexts(store);
    expect(await unpublishedConsents(store, records)).toEqual([]);
  });

  it("a record with no version or hash, or with a hash no text has, is reported", async () => {
    const store = new MemoryStore();
    const { uid } = await person(store);
    await publishConsentTexts(store);
    const bare = await store.addConsentRecord({ user_id: uid, kind: "example_data", decision: "withdrawn", method: "old_button" });
    const wrong = await store.addConsentRecord({ user_id: uid, kind: "terms_privacy", decision: "granted", version: currentConsentText("terms_privacy", "en").version, text_sha256: sha("other words") });
    expect(await unpublishedConsents(store, [bare, wrong])).toEqual([
      { id: bare.id, kind: "example_data", why: "no_stamp" },
      { id: wrong.id, kind: "terms_privacy", why: "no_text_row" },
    ]);
  });
});

/**
 * Every source file that writes a consent record, and what it stamps:
 *   stamped   the record carries version and text_sha256 of a text in the registry
 *   pending   a known gap in another track's file, reported to the integrator (the reason is the value)
 *   dev       the developer tools' helper account (not a person's consent; version "dev")
 */
const WRITERS: Record<string, "stamped" | "dev" | `pending: ${string}`> = {
  "lib/privacy/consents.ts": "stamped",
  "lib/auth/service.ts": "stamped",
  // C2 track D (round two): lib/care/links.ts writes through recordConsent (lib/privacy/consents.ts) and is no longer a direct writer
  "lib/visit/pipeline.ts": "stamped",
  "app/api/me/example/route.ts": "stamped",
  // C2 track F (round two): the route now stamps the record (consentStamp("retention_keep_forever", locale))
  "app/api/visits/[id]/keep/route.ts": "stamped",
  "lib/auth/dev-accounts.ts": "dev",
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("the places that write a consent record", () => {
  it("are exactly the known ones, and each stamped one writes version and text_sha256", () => {
    const files = [...sources(path.join(WEB, "app")), ...sources(path.join(WEB, "lib"))];
    expect(files.length).toBeGreaterThan(300);
    const found = new Map<string, string>();
    for (const f of files) {
      const rel = path.relative(WEB, f).split(path.sep).join("/");
      if (rel.startsWith("lib/store/") || rel.startsWith("lib/subject/")) continue; // the stores themselves and their rule table
      const src = readFileSync(f, "utf8");
      if (/\.addConsentRecord\(/.test(src)) found.set(rel, src);
    }
    expect([...found.keys()].sort()).toEqual(Object.keys(WRITERS).sort());
    for (const [rel, state] of Object.entries(WRITERS)) {
      const src = found.get(rel)!;
      // a pending entry is another track's to fix: nothing is asserted about it, so their fix never turns this red
      if (state === "stamped") {
        expect(src, rel).toMatch(/text_sha256/);
        expect(src, rel).toMatch(/version/);
      }
    }
  });
});
