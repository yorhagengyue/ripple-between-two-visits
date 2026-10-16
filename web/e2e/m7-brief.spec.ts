/**
 * M7 visit brief on the phone (docs/plan/tasks/M7-brief.md and this round's literal requirements):
 *   - D41 with the seed: 10 readings, average 140/85, 9 not below the doctor's 135/85 of 24 Aug (R1 word for word,
 *     its date, mirrored as 不低于 / not below); 29 of 33 doses, the 4 missed all on Tuesdays and Thursdays; the D37
 *     note word for word; at most three questions, refused > pattern > his own;
 *   - no judgement words anywhere on /p/brief, zh and en;
 *   - what changed since the last visit is marked, and only that: the accent rule on its left and its tag (DOM colour
 *     test, with a medicine added after the last visit). Nothing on the brief is red: until the demo phone took the
 *     timeline design's look (front-end line fe-demo, 2026-10-11) this mark was the page's one red;
 *   - story-day gating (nothing after the story day; the page follows the clock).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { judgementHits } from "../lib/safety/judgement";
import { api, BASE_URL, closeAll, createSession, openDevice, textBelow, waitLive, CREW_HEADERS } from "./helpers";

// C2 (lib/crew/gate.ts): the story clock and reset are the film crew's; this file's request fixture carries the crew key
test.use({ extraHTTPHeaders: CREW_HEADERS });

const R1 = "At home, we want it below 135 over 85.";
const D37 = "今天在大巴窑中心走了一圈，脚踝有点肿。";

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  const s = await createSession(request, { story_day: 41 });
  for (const p of ["/p/brief", "/p/today"]) await request.get(p, { headers: { cookie: `rp_session=${s.id}` } });
});

async function briefPage(page: Page) {
  await expect(page.getByTestId("page-brief")).toBeVisible();
}

/** Ripple's own words on the brief: quoted words (data-verbatim) and the line mirroring R1 (data-mirror) left out. */
async function ownWords(page: Page): Promise<string> {
  return page.getByTestId("page-brief").evaluate((root) => {
    const clone = root.cloneNode(true) as HTMLElement;
    // a question's recorded summary (data-recorded, wave B) is the seeded wording, labelled as not his words
    clone.querySelectorAll("[data-verbatim], [data-recorded], [data-mirror]").forEach((el) => el.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ");
  });
}

function extraHits(text: string): string[] {
  return [...["正常", "偏高", "危险"].filter((w) => text.includes(w)), ...["normal", "high", "dangerous", "good"].filter((w) => new RegExp(`\\b${w}\\b`, "i").test(text))];
}

/** Photograph the relative's box through the API on the current story day (a medicine new since the last visit). */
async function addRelativeBox(request: APIRequestContext, sid: string) {
  const link = (await api(request, "/api/upload-url", sid, { kind: "label", content_type: "image/png" })) as { path: string; url: string; method: string; headers: Record<string, string> };
  const put = await request.fetch(link.url, { method: link.method, headers: link.headers, data: readFileSync(path.join(__dirname, "..", "fixtures", "labels", "relative_box.png")) });
  expect(put.status()).toBe(200);
  const read = (await api(request, "/api/labels/read", sid, { path: link.path })) as { read_token: string };
  const res = await request.post(`/api/meds?session=${sid}`, { data: { read_token: read.read_token, confirmed: ["drug_text"], origin: "relative", locale: "zh-Hans" } });
  expect(res.status()).toBe(201);
  return (await res.json()).med as { id: string; start_day: number };
}

test("D41 (seed), 华语 and English: the numbers, R1 word for word with its date, the D37 note, three questions in order", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 41 });
  const phone = await openDevice(browser, s.id, "/p/brief");
  const page = phone.page;
  await briefPage(page);
  await expect(page.getByTestId("brief-window")).toContainText("上次看诊（9月1日）之后：9月2日到10月4日");
  const bp = page.getByTestId("brief-bp");
  await expect(bp).toHaveAttribute("data-count", "10");
  await expect(bp).toHaveAttribute("data-avg", "140/85");
  await expect(bp).toHaveAttribute("data-not-below", "9");
  await expect(page.getByTestId("brief-bp-summary")).toHaveText("记了 10 次，平均 140/85");
  await expect(page.getByTestId("brief-bp-mirror")).toHaveText("其中 9 次不低于医生 8月24日 说的 135/85");
  const r1 = page.getByTestId("brief-r1");
  await expect(r1).toContainText(R1);
  await expect(r1).toContainText("医生说");
  await expect(r1).toContainText("2026年8月24日 · 0:49 处 · 代录音");
  const doses = page.getByTestId("brief-doses");
  await expect(doses).toHaveAttribute("data-due", "33");
  await expect(doses).toHaveAttribute("data-taken", "29");
  await expect(doses).toHaveAttribute("data-missed", "4");
  await expect(doses).toHaveAttribute("data-unconfirmed", "0");
  await expect(page.getByTestId("brief-doses-headline")).toHaveText("33 次里吃了 29 次");
  await expect(page.getByTestId("brief-doses-missed")).toHaveText("没吃的 4 次都在周二、周四（打太极的早上）：9月8日、9月10日、9月17日、9月29日");
  await expect(page.getByTestId("brief-notes")).toContainText(`「${D37}」`);
  const questions = page.getByTestId("brief-question");
  await expect(questions).toHaveCount(3);
  expect(await questions.evaluateAll((els) => els.map((e) => e.getAttribute("data-origin")))).toEqual(["refused_question", "pattern", "own"]);
  expect(await textBelow(page, 18)).toEqual([]);

  await phone.context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
  await page.reload();
  await waitLive(page);
  await expect(page.getByTestId("brief-window")).toContainText("Since the visit on 1 Sep: 2 Sep to 4 Oct");
  await expect(page.getByTestId("brief-bp-summary")).toHaveText("10 readings, average 140/85");
  await expect(page.getByTestId("brief-bp-mirror")).toHaveText("9 of them not below the doctor's 135/85 of 24 Aug");
  await expect(page.getByTestId("brief-r1")).toContainText("24 Aug 2026 · at 0:49 · stand-in recording");
  await expect(page.getByTestId("brief-doses-headline")).toHaveText("29 of 33 doses taken");
  await expect(page.getByTestId("brief-doses-missed")).toHaveText("The 4 missed were all on Tuesdays and Thursdays (tai chi mornings): 8 Sep, 10 Sep, 17 Sep, 29 Sep");
  await expect(page.getByTestId("brief-notes")).toContainText(`「${D37}」`);
  await expect(page.getByTestId("brief-question")).toHaveCount(3);
  expect(await textBelow(page, 18)).toEqual([]);
  await closeAll([phone]);
});

test("no judgement words anywhere on /p/brief (zh and en); the comparison mirrors R1 and never says above or high", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 41 });
  const phone = await openDevice(browser, s.id, "/p/brief");
  const page = phone.page;
  for (const locale of ["zh-Hans", "en"]) {
    if (locale === "en") {
      await phone.context.addCookies([{ name: "rp_lang", value: "en", url: BASE_URL }]);
      await page.reload();
      await waitLive(page);
    }
    await briefPage(page);
    const whole = await page.evaluate(() => document.body.innerText);
    expect(extraHits(whole), `${locale}: whole page`).toEqual([]);
    expect(judgementHits(await ownWords(page)), `${locale}: Ripple's own words`).toEqual([]);
    const mirror = (await page.getByTestId("brief-bp-mirror").textContent()) ?? "";
    expect(mirror).toMatch(locale === "en" ? /not below/ : /不低于/);
    expect(mirror).not.toMatch(/above|high|over|高于|偏高|超过/i);
    // quoted words are quotes: R1 is the doctor's, the note and the questions are his
    expect(await page.locator("[data-verbatim='doctor']").allTextContents()).toEqual([R1]);
  }
  await closeAll([phone]);
});

test("the accent marks only what changed since the last visit, and nothing on the brief is red (DOM colours), with a medicine added after it", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const s = await createSession(request, { story_day: 30 });
  const med = await addRelativeBox(request, s.id); // on his list from D30, after the D8 visit
  expect(med.start_day).toBe(30);
  await api(request, "/api/clock", s.id, { day: 41 });
  const phone = await openDevice(browser, s.id, "/p/brief");
  const page = phone.page;
  await briefPage(page);
  await expect(page.locator(`[data-testid='brief-med'][data-med='${med.id}']`)).toHaveAttribute("data-changed", "true");
  const result = await page.getByTestId("page-brief").evaluate((root) => {
    const parse = (c: string) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const p = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const isRed = (c: string) => {
      const x = parse(c);
      return !!x && x.a > 0.2 && x.r >= 150 && x.r - Math.max(x.g, x.b) >= 80;
    };
    /** a colour of its own (the accent), not ink, grey or white */
    const isColour = (c: string) => {
      const x = parse(c);
      return !!x && x.a > 0.2 && Math.max(x.r, x.g, x.b) - Math.min(x.r, x.g, x.b) >= 40;
    };
    const describe = (el: Element) => `${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? ""}] ${(el.textContent ?? "").trim().slice(0, 30)}`;
    const red: Element[] = [];
    for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
      const cs = getComputedStyle(el);
      const colours: string[] = [];
      if ((el.textContent ?? "").trim()) colours.push(cs.color);
      colours.push(cs.backgroundColor);
      for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
        if (parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && cs.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none")
          colours.push(cs.getPropertyValue(`border-${side.toLowerCase()}-color`));
      }
      if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) colours.push(cs.outlineColor);
      if (colours.some(isRed)) red.push(el);
    }
    /** the mark on an item: a rule on its left, at least 3px wide, in a colour of its own */
    const rule = (el: Element) => {
      const cs = getComputedStyle(el);
      return parseFloat(cs.borderLeftWidth) >= 3 && cs.borderLeftStyle !== "none" && isColour(cs.borderLeftColor) ? cs.borderLeftColor : null;
    };
    const changed = Array.from(root.querySelectorAll("[data-changed='true']"));
    const items = Array.from(root.querySelectorAll("[data-testid='brief-note'], [data-testid='brief-med'], [data-testid='brief-question']"));
    const tags = Array.from(root.querySelectorAll("[data-testid='brief-changed-tag']"));
    return {
      red: red.map(describe),
      changed: changed.map((el) => `${el.getAttribute("data-testid")}:${el.getAttribute("data-note") ?? el.getAttribute("data-med")}`),
      // every changed item has the rule and one tag, the tag in the rule's own colour
      changedWithoutMark: changed
        .filter((el) => {
          const colour = rule(el);
          const own = el.querySelectorAll("[data-testid='brief-changed-tag']");
          return !colour || own.length !== 1 || getComputedStyle(own[0]).color !== colour;
        })
        .map(describe),
      // nothing else carries the rule or the tag
      markedWithoutChange: [...items.filter((el) => el.getAttribute("data-changed") !== "true" && rule(el)), ...tags.filter((el) => !el.closest("[data-changed='true']"))].map(describe),
    };
  });
  expect(result.red, "nothing on the brief is red").toEqual([]);
  expect(result.changedWithoutMark).toEqual([]);
  expect(result.markedWithoutChange).toEqual([]);
  // the changes: the two notes on topics new since D8 and the box from D30; no reading, count or question is marked
  expect(result.changed).toHaveLength(3);
  expect(result.changed).toEqual(expect.arrayContaining(["brief-med:" + med.id, "brief-note:note-d37-1"]));
  expect(result.changed.some((x) => /^brief-note:note-d20/.test(x))).toBe(true);
  await expect(page.locator("[data-changed='true']")).toHaveCount(3);
  await closeAll([phone]);
  await api(request, "/api/session/reset", s.id); // deletes the uploaded photo
});

test("story-day gating: nothing after the story day; the brief follows the clock", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });
  const phone = await openDevice(browser, s.id, "/p/brief");
  const page = phone.page;
  await briefPage(page);
  await expect(page.getByTestId("brief-bp")).toHaveAttribute("data-count", "7"); // D11..D29 evening, not D32/D35/D39
  await expect(page.getByTestId("brief-doses")).toHaveAttribute("data-due", "21");
  await expect(page.getByTestId("brief-notes")).not.toContainText(D37);
  await expect(page.getByTestId("brief-notes")).toContainText("我今天好累。");
  expect(await page.getByTestId("brief-question").evaluateAll((els) => els.map((e) => e.getAttribute("data-question")))).toEqual(["q-extra-tablet", "q-tai-chi"]);
  // wave B: the seeded refused question is not his words: a labelled recorded summary, never data-verbatim
  const seeded = page.locator('[data-testid="brief-question"][data-question="q-extra-tablet"]');
  await expect(seeded).toHaveAttribute("data-wording", "recorded_summary");
  await expect(seeded.locator("[data-verbatim]")).toHaveCount(0);
  await expect(seeded.locator('[data-recorded="summary"]')).toHaveCount(1);
  await api(request, "/api/clock", s.id, { day: 41 });
  await expect(page.getByTestId("brief-bp")).toHaveAttribute("data-count", "10", { timeout: 5000 });
  await expect(page.getByTestId("brief-notes")).toContainText(D37);
  await api(request, "/api/clock", s.id, { day: 0, time: "09:30" });
  await expect(page.getByTestId("brief-bp")).toHaveAttribute("data-count", "0", { timeout: 5000 });
  await expect(page.getByTestId("brief-bp-no-target")).toBeVisible();
  await expect(page.getByTestId("brief-r1")).toHaveCount(0);
  await closeAll([phone]);
});

test("360px wide: no sideways scroll, text at least 18px (zh and en)", async ({ browser, request }) => {
  const s = await createSession(request, { story_day: 41 });
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 360, height: 780 } });
  await context.addCookies([{ name: "rp_session", value: s.id, url: BASE_URL }]);
  const page = await context.newPage();
  for (const lang of ["zh-Hans", "en"]) {
    await context.addCookies([{ name: "rp_lang", value: lang, url: BASE_URL }]);
    await page.goto("/p/brief");
    await waitLive(page);
    expect(await textBelow(page, 18), lang).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, lang).toBeLessThanOrEqual(0);
  }
  await context.close();
});
