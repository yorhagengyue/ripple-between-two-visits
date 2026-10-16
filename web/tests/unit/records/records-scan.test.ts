/**
 * 「拍药盒，看怎么吃」 / "Scan a medicine box" (scene 3 of the owner's film, 10-15) under his medicines on 「记录」 and on
 * 「我的药物」: one button that opens the phone's camera (a file on a computer). The pages are server components: called
 * as one here, with the page's subject stood in, and rendered to HTML (no browser). The sheet itself is
 * tests/unit/meds/scan.test.ts.
 */
import { randomUUID } from "node:crypto";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getMemoryStore } from "@/lib/store/memory";
import { pageSubjectFor, selfSubject } from "@/lib/subject";
import { setTestClock } from "@/lib/time/now";

const page = vi.hoisted(() => ({ ctx: null as unknown, locale: "en" as "zh-Hans" | "en" }));
vi.mock("@/lib/subject", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subject")>()),
  getPageSubject: async () => page.ctx,
}));
vi.mock("@/lib/session/server", () => ({ getPatientLocale: async () => page.locale }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}));

import RecordsPage from "@/app/p/records/page";
import MedsPage from "@/app/p/meds/page";

const store = getMemoryStore();
let him: TestAccount;

beforeAll(async () => {
  setTestClock({ at: "2026-10-15T10:00:00+08:00", frozen: true });
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `scn${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
});
afterAll(() => {
  setTestClock(null);
  page.ctx = null;
});

async function render(Page: (p: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement | null>, locale: "zh-Hans" | "en"): Promise<string> {
  const scope = (await store.getSession(him.userId))!;
  page.ctx = pageSubjectFor(selfSubject(store, scope, him.userId));
  page.locale = locale;
  let el = await Page({ searchParams: Promise.resolve({}) });
  while (el && typeof el.type === "function" && el.type.constructor.name === "AsyncFunction") {
    el = await (el.type as (props: unknown) => Promise<ReactElement | null>)(el.props);
  }
  return el ? renderToStaticMarkup(el) : "";
}

const tagWith = (html: string, testId: string) => {
  const m = new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html);
  expect(m, testId).not.toBeNull();
  return m![0];
};
const textOf = (html: string, testId: string) => {
  const at = html.indexOf(`data-testid="${testId}"`);
  const close = html.indexOf("</button>", at);
  return html.slice(at, close).replace(/<[^>]+>/g, " ").replace(/^[^>]*>/, "").replace(/\s+/g, " ").trim();
};

describe("the scan button under his medicines", () => {
  it("「记录」: 「拍药盒，看怎么吃」 / Scan a medicine box, with the camera input; the add button is as it was", async () => {
    for (const [locale, words, add] of [
      ["en", "Scan a medicine box", "Photograph a label to add"],
      ["zh-Hans", "拍药盒，看怎么吃", "拍药袋新增药物"],
    ] as const) {
      const html = await render(RecordsPage as never, locale);
      expect(textOf(html, "records-meds-scan")).toBe(words);
      const input = tagWith(html, "scan-file");
      expect(input).toContain('type="file"');
      expect(input).toContain('capture="environment"');
      expect(input).toContain('accept="image/png,image/jpeg,image/webp"');
      // the sheet is not on the page until a photo is taken
      expect(html).not.toContain('data-testid="scan-sheet"');
      expect(html).toContain(add);
      // the scan comes first in the medicines' buttons
      expect(html.indexOf('data-testid="records-meds-scan"')).toBeLessThan(html.indexOf('data-testid="records-meds-add"'));
    }
  });

  it("「我的药物」: the same button", async () => {
    const html = await render(MedsPage as never, "en");
    expect(textOf(html, "meds-scan")).toBe("Scan a medicine box");
    expect(tagWith(html, "scan-file")).toContain('capture="environment"');
  });
});
