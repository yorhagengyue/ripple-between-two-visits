/**
 * <DoctorZh> and <ZhUnder> (components/translate; C2 track S, round 2): what a page draws under a doctor's English line.
 * DoctorZh is a server component (an async function): here it is called as one, with the page's subject stood in, and
 * what it returns is rendered to HTML.
 */
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZhUnder } from "@/components/translate/ZhUnder";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getMemoryStore } from "@/lib/store/memory";
import { scopedStore } from "@/lib/subject/scoped-store";
import { translationKey } from "@/lib/translate";

const page = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/subject", () => ({ getPageSubject: async () => page.ctx }));

const store = getMemoryStore();
const R1 = "At home, we want it below 135 over 85.";
const R1_ZH = "在家里，我们希望血压低于 135/85。";

async function accountWith(consents?: ("terms_privacy" | "ai_processing")[]): Promise<TestAccount> {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `dz${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank", ...(consents ? { consents } : {}) });
  await store.putTranslation(a.userId, { direction: "en>zh-Hans", source_sha256: translationKey(R1), source_text: R1, text: R1_ZH, status: "checked", checks: {} });
  return a;
}
const asPage = (a: TestAccount) => ({ subject: { kind: "account", relation: "self", userId: a.userId }, session: a.scope!, store: scopedStore(store, a.scope!, "self", { userId: a.userId, maskSessionId: true }) });

async function drawn(text: string | null, locale: string): Promise<string> {
  const { DoctorZh } = await import("@/components/translate/DoctorZh");
  const el = await DoctorZh({ text, locale });
  return el ? renderToStaticMarkup(el) : "";
}

beforeEach(() => {
  page.ctx = null;
});

describe("ZhUnder", () => {
  it("draws the translation with the line that says which one counts under it, on the Chinese page, and nothing otherwise", () => {
    const html = renderToStaticMarkup(createElement(ZhUnder, { text: R1_ZH, locale: "zh-Hans" }));
    expect(html).toContain("中文翻译，以英文原话为准");
    expect(html).toContain(R1_ZH);
    expect(html).toContain('data-testid="line-translation"');
    // the timeline design's shape: the Chinese first (serif, a rule on its left), the label as one line under it
    expect(html.indexOf(R1_ZH)).toBeLessThan(html.indexOf("中文翻译，以英文原话为准"));
    expect(renderToStaticMarkup(createElement(ZhUnder, { text: R1_ZH, locale: "en" }))).toBe("");
    expect(renderToStaticMarkup(createElement(ZhUnder, { text: null, locale: "zh-Hans" }))).toBe("");
    expect(renderToStaticMarkup(createElement(ZhUnder, { text: R1_ZH, locale: "zh-Hans", testId: "relay-translation" }))).toContain('data-testid="relay-translation"');
  });
});

describe("DoctorZh", () => {
  it("his own page in Chinese, with his consent: the checked translation of that line", async () => {
    page.ctx = asPage(await accountWith());
    const html = await drawn(R1, "zh-Hans");
    expect(html).toContain(R1_ZH);
    expect(html).toContain("中文翻译，以英文原话为准");
    // a line with no checked translation, a Chinese line, no line: nothing
    expect(await drawn("Come back in about a week with your readings.", "zh-Hans")).toBe("");
    expect(await drawn("手腕的不太准。", "zh-Hans")).toBe("");
    expect(await drawn(null, "zh-Hans")).toBe("");
  });

  it("the English page, no consent to AI processing, the demo, or no subject at all: nothing", async () => {
    const him = await accountWith();
    page.ctx = asPage(him);
    expect(await drawn(R1, "en")).toBe("");
    page.ctx = asPage(await accountWith(["terms_privacy"]));
    expect(await drawn(R1, "zh-Hans")).toBe("");
    const demo = await store.createSession({ ttl_hours: 1 });
    page.ctx = { subject: { kind: "demo", relation: "demo", userId: null }, session: demo, store };
    expect(await drawn(R1, "zh-Hans")).toBe("");
    page.ctx = null;
    expect(await drawn(R1, "zh-Hans")).toBe("");
  });
});
