/**
 * The check cards on his account's review (C2 track F, fix round; real-app 4.4 「核对卡和简报用同一口径」, 4.6;
 * web/progress/g.md 「旅程查到的」 7: no account screen showed them).
 *
 * On the example's sample visit the review's summary shows what he said next to his own records, with the numbers and
 * the sentences of the brief he could have opened when the visit started: ten readings, average 140/85, nine not below
 * the doctor's 135/85 with Dr Lim's own sentence; 29 of 33 doses, the four missed on his two tai chi days, the label's
 * first line. Nothing on it judges a reading, and a visit without such a line has no block at all.
 */
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { missedText } from "@/components/brief/words";
import { ReviewChecks, checkCards } from "@/components/visit/elder/ReviewChecks";
import { fixtureUtterances, getSpeechProvider } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { shortDay } from "@/lib/daily/i18n";
import { judgementHits } from "@/lib/safety/judgement";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { buildAccountBrief } from "@/lib/summary/account-brief";
import { bt } from "@/lib/summary/i18n";
import { setTestClock } from "@/lib/time/now";
import { finalizeVisit, processChunk, startVisit } from "@/lib/visit/pipeline";
import type { CheckCardView, VisitView } from "@/lib/visit/types";
import { buildVisitView } from "@/lib/visit/view";

const store = getMemoryStore();
const AT = "2026-10-12T10:00:00+08:00";

beforeAll(() => {
  process.env.MOCK_ASR_JOB_MS = "0";
  delete process.env.SPEECH_PROVIDER;
});
afterAll(() => setTestClock(null));

async function account(space: "example" | "blank"): Promise<SessionRow> {
  setTestClock({ at: AT, frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `rc${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  return (await store.getSession(a.scope!.id))!;
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const render = (view: VisitView, locale: "zh-Hans" | "en") => renderToStaticMarkup(createElement(ReviewChecks, { view, locale }));
const card = <K extends CheckCardView["check"]>(view: VisitView, kind: K) => checkCards(view).find((c): c is Extract<CheckCardView, { check: K }> => c.check === kind)!;

describe("the example's sample visit: his words next to his records, as the brief says them", () => {
  it("the block on the review has the brief's numbers and sentences, the doctor's own words, the label's own line", async () => {
    const scope = await account("example");
    const brief = await buildAccountBrief(store, scope, "zh-Hans", { nowMs: Date.parse(AT), translate: "cache" });
    await startVisit(store, scope, { mode: "replay", fixture: "v3" });
    await processChunk(store, scope, "v3", fixtureUtterances("v3")!);
    const speech = getSpeechProvider();
    const { jobId } = await speech.createFileJob({ url: "fixture:v3", lang: "zh-en-mixed", fixture: "v3" });
    await finalizeVisit(store, scope, "v3", await speech.getFileJob(jobId));
    const view = (await buildVisitView(store, scope.id, "v3", { session: scope }))!;

    const bp = card(view, "bp");
    const med = card(view, "med");
    expect(checkCards(view).map((c) => c.check)).toEqual(expect.arrayContaining(["bp", "med"]));
    // the medicine card carries the brief's own summary of the missed doses
    expect(med.doses).toBeDefined();
    expect(missedText("zh-Hans", med.doses!)).toBe(missedText("zh-Hans", brief.doses));
    expect(med.doses!.days.every((d) => d.missed > 0)).toBe(true);

    const html = render(view, "zh-Hans");
    const shown = text(html);
    // the block, one card per thing he said, each under the line of the visit that brought it up
    expect(html).toContain(`data-testid="review-checks" data-count="${checkCards(view).length}"`);
    expect(shown).toContain("你说到的，和你的记录");
    expect(shown).toContain("就诊时说到：“Quite okay lah. Around 130, I think.”");
    expect(shown).toContain("就诊时说到：“Yes, every morning. The small white one, I forget the name.”");
    // readings: the brief's sentences, word for word, with the same numbers
    expect(shown).toContain(bt("zh-Hans", "brief.bp.summary", { n: brief.bp.count, s: brief.bp.avgSystolic!, d: brief.bp.avgDiastolic! }));
    expect(shown).toContain("记了 10 次，平均 140/85");
    expect(shown).toContain(bt("zh-Hans", "brief.bp.mirror", { n: brief.bp.notBelow!, s: 135, d: 85, date: shortDay("zh-Hans", bp.target!.date) }));
    expect(shown).toContain("其中 9 次不低于医生");
    // the doctor's sentence itself, in the quote face, with who said it
    expect(html).toMatch(/data-rp="said"[^>]*data-kind="doctor"[^>]*>\s*“At home, we want it below 135 over 85\.”/);
    expect(html).toContain('data-testid="review-check-target" data-state="confirmed"');
    expect(html).toMatch(/data-check="bp"[^>]*data-count="10"[^>]*data-avg="140\/85"[^>]*data-not-below="9"/);
    // medicine: the label's first line as printed, the brief's count and its sentence about the missed doses
    expect(shown).toContain("AMLODIPINE 5MG TABLET");
    expect(shown).toContain(bt("zh-Hans", "brief.doses.headline", { taken: brief.doses.taken, due: brief.doses.due }));
    expect(shown).toContain("33 次中已服药 29 次");
    expect(shown).toContain(missedText("zh-Hans", brief.doses)!);
    expect(html).toMatch(/data-check="med"[^>]*data-due="33"[^>]*data-taken="29"[^>]*data-missed="4"/);
    // his own days only: no day of the story, and nothing that judges a reading
    expect(shown).not.toMatch(/第\s*\d+\s*天|Day \d+/);
    // (as the brief's own test reads it: everything but quoted words and the line that mirrors the doctor's number)
    const own = text(html.replace(/<span[^>]*data-(?:verbatim|mirror)=[^>]*>.*?<\/span>/g, " ").replace(/<blockquote[^>]*data-rp="said".*?<\/blockquote>/g, " "));
    expect(own).toContain("记了 10 次，平均 140/85");
    expect(own).not.toContain("Quite okay lah");
    expect(judgementHits(own)).toEqual([]);

    // in English: the same numbers in the brief's English sentences
    const en = text(render(view, "en"));
    expect(en).toContain(bt("en", "brief.bp.summary", { n: 10, s: 140, d: 85 }));
    expect(en).toContain(bt("en", "brief.doses.headline", { taken: 29, due: 33 }));
    expect(en).toContain("Said in the visit: “Quite okay lah. Around 130, I think.”");
  });
});

describe("a visit with nothing to put next to his records", () => {
  it("a blank account's first visit: no check card, no block", async () => {
    const scope = await account("blank");
    const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
    const speech = getSpeechProvider();
    const { jobId } = await speech.createFileJob({ url: "fixture:v1", lang: "zh-en-mixed", fixture: "v1" });
    await finalizeVisit(store, scope, visit.id, await speech.getFileJob(jobId));
    const view = (await buildVisitView(store, scope.id, visit.id, { session: scope }))!;
    expect(checkCards(view)).toEqual([]);
    expect(render(view, "zh-Hans")).toBe("");
  });
});
