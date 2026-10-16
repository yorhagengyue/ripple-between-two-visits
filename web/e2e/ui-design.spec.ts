/**
 * /design (components/ui gallery) and /design/today/m1|m2|m3 (the approved mock's three Today states):
 * - no horizontal page scroll at 360, 390 and 1440 px;
 * - every visible text is at least 18px (F2, 10-10: tone v2's floor, labels and the tab bar included); the
 *   only exception is the gallery's fake phone status bar, marked data-check-allow;
 * - every link, button and input has at least a 48x48 hit area;
 * - <Said> renders in the serif stack (Literata first) and <LabelOriginal> in the mono stack, and the
 *   next/font families really load;
 * - filming mode puts body text at 22px (20px elsewhere);
 * - the live undo toast runs 12 s and undoes;
 * - screenshots: the three compositions at 390x844 @2x (and their English versions) and the whole
 *   gallery at 1440x900. Every run takes them and checks each is a PNG of the right size; only
 *   UPDATE_DESIGN_SHOTS=1 (exactly "1") writes them over the committed set in
 *   e2e/__screenshots__/design/. Without it (the full e2e run) nothing is written into the repo, and
 *   a guard after every test in this file fails the test if any file in that folder was added,
 *   removed, rewritten or even touched (a byte-identical rewrite still changes the mtime).
 *
 * Updating the committed screenshots (from web/, holding web/.e2e-lock like any e2e run; --output
 * keeps Playwright's own artifacts out of web/test-results):
 *   bash:        UPDATE_DESIGN_SHOTS=1 PW_PORT=3215 npx playwright test e2e/ui-design.spec.ts -g screenshots --output <a folder outside web/>
 *   PowerShell:  try { $env:UPDATE_DESIGN_SHOTS="1"; $env:PW_PORT="3215"; npx playwright test e2e/ui-design.spec.ts -g screenshots --output <a folder outside web/> } finally { Remove-Item Env:UPDATE_DESIGN_SHOTS, Env:PW_PORT }
 *   (the finally clears the variables even after Ctrl+C, so a later full run in that shell cannot write)
 * Each written file prints one line in the terminal (the test's stdout, which the configured "list"
 * reporter shows as the run goes; --quiet hides it) and keeps the same line as a note in the json and
 * html reports:
 *   [design shots] today-m1-390x844@2x.png: same bytes
 *   [design shots] gallery-1440x900.png: changed (1640866 -> 1640957 bytes)
 *   [design shots] <name>: new
 * Each screenshot test also prints whether it is writing at all ("UPDATE_DESIGN_SHOTS=1: writing ..."
 * or "... nothing written"), so a mistyped variable shows up as "nothing written" rather than as a
 * silent pass. From git's side, `git status --short e2e/__screenshots__/design` lists the committed
 * PNGs that now differ from HEAD.
 * Screenshots are taken with CSS animations disabled: the skeleton lines' endless "breathe" animation
 * used to make the whole-gallery PNG differ by a few dozen bytes on every run (pixel deltas of 1-2 in
 * the skeleton rows only). The committed gallery-1440x900.png predates this, so the next update
 * rewrites it once with the skeleton at rest (the "changed" line above); that one change is expected.
 * Any other "changed" line is a real change.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = path.join(__dirname, "__screenshots__", "design");
const STATES = ["m1", "m2", "m3"] as const;
const TODAY_SHOT_NAMES = (["zh", "en"] as const).flatMap((lang) =>
  STATES.map((state) => `today-${state}${lang === "en" ? "-en" : ""}-390x844@2x.png`),
);
const GALLERY_SHOT = "gallery-1440x900.png";
const GALLERY_FIRST_SCREEN_SHOT = "gallery-1440x900-first-screen.png";
/** Every file the committed folder holds, and nothing else. */
const COMMITTED_SHOTS = [...TODAY_SHOT_NAMES, GALLERY_SHOT, GALLERY_FIRST_SCREEN_SHOT].sort();

/** Strictly "1": any other value (unset, "0", "true", " 1") leaves the committed screenshots alone. */
function writeShotsFrom(env: Record<string, string | undefined>): boolean {
  return env.UPDATE_DESIGN_SHOTS === "1";
}
const WRITE_SHOTS = writeShotsFrom(process.env);

type FileState = { name: string; kind: "file" | "other"; size: number; mtimeMs: number; sha256: string };

/** What is on disk in a folder: name, size, mtime and content hash of each entry; null when it does not exist. */
function folderState(dir: string): FileState[] | null {
  if (!existsSync(dir)) return null;
  return readdirSync(dir, { withFileTypes: true })
    .map((entry): FileState => {
      const file = path.join(dir, entry.name);
      const st = statSync(file);
      if (!entry.isFile()) return { name: entry.name, kind: "other", size: 0, mtimeMs: st.mtimeMs, sha256: "" };
      return {
        name: entry.name,
        kind: "file",
        size: st.size,
        mtimeMs: st.mtimeMs,
        sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/*
 * The write guard. Unless UPDATE_DESIGN_SHOTS=1, every test in this file must leave the committed
 * folder exactly as it found it: same entries, same bytes and the same mtime. The mtime is the check
 * that matters: a re-added `path:` on page.screenshot usually rewrites the same bytes (the render is
 * deterministic), which a hash-only guard would miss. Another process copying files into the folder
 * during the run (e.g. restoring a backup) trips it too; re-run once in that case.
 */
let shotsBefore: FileState[] | null = null;
test.beforeEach(() => {
  if (!WRITE_SHOTS) shotsBefore = folderState(SHOTS);
});
test.afterEach(() => {
  if (WRITE_SHOTS) return;
  expect(
    folderState(SHOTS),
    `UPDATE_DESIGN_SHOTS is not 1: this test added, removed, rewrote or touched a file in ${SHOTS}`,
  ).toEqual(shotsBefore);
});

/** Width and height from a PNG's IHDR chunk; throws when the buffer is not a PNG. */
function pngSize(buf: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(signature) || buf.toString("latin1", 12, 16) !== "IHDR") {
    throw new Error(`not a PNG (${buf.length} bytes)`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Every line this file reports in the terminal starts with this, so it can be picked out of a full run. */
const REPORT_PREFIX = "[design shots]";

/** What writing `next` over <name> did, given the bytes that were there before (null: no file). */
function shotWriteNote(name: string, previous: Buffer | null, next: Buffer): string {
  if (previous === null) return `${name}: new`;
  if (previous.equals(next)) return `${name}: same bytes`;
  return `${name}: changed (${previous.length} -> ${next.length} bytes)`;
}

/**
 * One line for whoever runs this file: printed on the test's stdout, which the "list" reporter shows
 * in the terminal (annotations alone are not printed there), and kept as a note annotation for the
 * json and html reports.
 */
function report(line: string) {
  test.info().annotations.push({ type: "note", description: line });
  console.log(`${REPORT_PREFIX} ${line}`);
}

/**
 * Takes the screenshot in memory either way (never through page.screenshot's `path`); writes it to
 * <dir>/<name> only when `write` is true, which defaults to UPDATE_DESIGN_SHOTS=1 and the committed
 * folder. A write reports whether the file is new, the same bytes, or changed. Returns the PNG's
 * pixel size for the caller to check.
 */
async function designShot(
  page: Page,
  name: string,
  options: { fullPage?: boolean; dir?: string; write?: boolean } = {},
) {
  const { fullPage = false, dir = SHOTS, write = WRITE_SHOTS } = options;
  // animations off: the skeleton lines breathe forever (rpu-breathe), which made the whole-gallery
  // PNG come out a few dozen bytes different on every run
  const buf = await page.screenshot({ fullPage, animations: "disabled" });
  const size = pngSize(buf);
  if (write) {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    const previous = existsSync(file) ? readFileSync(file) : null;
    writeFileSync(file, buf);
    report(shotWriteNote(name, previous, buf));
  }
  return size;
}

function writeModeLine(write: boolean): string {
  return write
    ? `UPDATE_DESIGN_SHOTS=1: writing screenshots to ${SHOTS}`
    : `UPDATE_DESIGN_SHOTS is not 1: screenshots checked in memory, nothing written to ${SHOTS}`;
}

function noteWriteMode() {
  report(writeModeLine(WRITE_SHOTS));
}

/**
 * Runs `body` and returns what it printed with console.log. The lines are held back rather than
 * printed, so the gate test's throwaway "on.png" lines do not show up among the real ones in a run.
 */
async function captureConsoleLog(body: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await body();
  } finally {
    console.log = original;
  }
  return lines;
}

async function ready(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // let the unicode-range slices of Noto Serif SC that the first layout asked for arrive
  await page.waitForFunction(() => [...document.fonts].every((f) => f.status !== "loading"), undefined, { timeout: 30_000 });
}

/** The Next dev-tools badge (bottom left, in a shadow root) would sit on the tab bar in screenshots. */
async function hideDevBadge(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));
}

/** Visible text nodes under 15px, and under 18px outside the marked exceptions ([data-check-allow]). */
async function smallText(page: Page) {
  return page.evaluate(() => {
    const under15: string[] = [];
    const unmarked: string[] = [];
    const describe = (el: Element) => `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(".")}`;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let checked = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || el.closest("script, style, noscript, template, title")) continue;
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue; // visually hidden (screen-reader text)
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (![...range.getClientRects()].some((r) => r.width > 0 && r.height > 0)) continue;
      checked++;
      const px = parseFloat(cs.fontSize);
      if (px < 15) under15.push(`${px}px ${describe(el)} "${text.slice(0, 30)}"`);
      else if (px < 18 && !el.closest("[data-check-allow]")) unmarked.push(`${px}px ${describe(el)} "${text.slice(0, 30)}"`);
    }
    // input values and placeholders are text too
    for (const input of document.querySelectorAll("input, textarea")) {
      const px = parseFloat(getComputedStyle(input).fontSize);
      if (px < 18 && !input.closest("[data-check-allow]")) unmarked.push(`${px}px input "${(input as HTMLInputElement).placeholder}"`);
      checked++;
    }
    return { checked, under15, unmarked };
  });
}

/** Interactive elements smaller than 48x48. */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const bad: string[] = [];
    const els = document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=button]");
    let checked = 0;
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      checked++;
      if (r.width < 47.5 || r.height < 47.5) {
        bad.push(`${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 2).join(".")} "${(el.textContent ?? "").trim().slice(0, 24)}" ${r.width.toFixed(1)}x${r.height.toFixed(1)}`);
      }
    }
    return { checked, bad };
  });
}

const norm = (s: string) => s.replace(/["']/g, "").replace(/\s+/g, "").toLowerCase();

for (const width of [360, 390, 1440]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 1440 ? 900 : 844 } });

    test(`/design: no sideways scroll, text sizes, 48px targets (${width})`, async ({ page }) => {
      const res = await page.goto("/design");
      expect(res?.status()).toBe(200);
      await ready(page);
      const over = await horizontalOverflow(page);
      expect(over.doc, "document wider than the viewport").toBeLessThanOrEqual(0);
      expect(over.body, "body wider than the viewport").toBeLessThanOrEqual(0);

      const text = await smallText(page);
      expect(text.checked).toBeGreaterThan(200);
      expect(text.under15, "text under 15px").toEqual([]);
      expect(text.unmarked, "text under 18px").toEqual([]);

      const targets = await smallTargets(page);
      expect(targets.checked).toBeGreaterThan(60);
      expect(targets.bad, "hit areas under 48x48").toEqual([]);
    });

    for (const state of STATES) {
      test(`/design/today/${state}: same rules (${width})`, async ({ page }) => {
        expect((await page.goto(`/design/today/${state}`))?.status()).toBe(200);
        await ready(page);
        const over = await horizontalOverflow(page);
        expect(over.doc).toBeLessThanOrEqual(0);
        const text = await smallText(page);
        expect(text.under15).toEqual([]);
        expect(text.unmarked).toEqual([]);
        expect((await smallTargets(page)).bad).toEqual([]);
      });
    }
  });
}

test.describe("faces", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Said is in the serif stack and LabelOriginal in the mono stack; the next/font families load", async ({ page }) => {
    await page.goto("/design");
    await ready(page);
    const faces = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        serif: root.getPropertyValue("--rp-font-serif"),
        mono: root.getPropertyValue("--rp-font-mono"),
        sans: root.getPropertyValue("--rp-font-sans"),
        said: [...document.querySelectorAll("[data-rp=said]")].map((e) => getComputedStyle(e).fontFamily),
        orig: [...document.querySelectorAll("[data-rp=label-original]")].map((e) => getComputedStyle(e).fontFamily),
        body: [...document.querySelectorAll("[data-rp=text]")].slice(0, 5).map((e) => getComputedStyle(e).fontFamily),
        loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
      };
    });
    expect(faces.serif.trim()).not.toBe("");
    expect(faces.said.length).toBeGreaterThan(5);
    for (const f of faces.said) {
      expect(norm(f).startsWith(norm(faces.serif))).toBe(true);
      // the timeline draft: Noto Serif for Latin (not the Chinese family first)
      expect(f.split(",")[0]).toMatch(/noto.?serif(?!.?sc)/i);
    }
    // the Chinese serif follows the Latin one, ahead of any generic family
    const serifFamilies = faces.serif.split(",").map((s) => s.trim());
    const zhAt = serifFamilies.findIndex((s) => /noto.?serif.?sc/i.test(s));
    const genericAt = serifFamilies.findIndex((s) => /^(serif|sans-serif|system-ui)$/i.test(s.replace(/["']/g, "")));
    expect(zhAt).toBeGreaterThan(0);
    expect(genericAt).toBeGreaterThan(zhAt);

    expect(faces.orig.length).toBeGreaterThan(2);
    for (const f of faces.orig) {
      expect(norm(f).startsWith(norm(faces.mono))).toBe(true);
      // the draft loads no mono face: the label as printed is in the system's
      expect(f.split(",")[0]).toMatch(/ui-monospace/i);
    }
    for (const f of faces.body) expect(f.split(",")[0]).toMatch(/noto.?sans(?!.?sc)/i);

    // the four families of the draft (lib/ui/fonts.ts); the mono face is the system's, so nothing is loaded for it
    const loaded = faces.loaded;
    expect(loaded.some((f) => /noto.?serif$/i.test(f.replace(/["']/g, "").trim()))).toBe(true);
    expect(loaded.some((f) => /noto.?serif.?sc/i.test(f))).toBe(true);
    expect(loaded.some((f) => /noto.?sans$/i.test(f.replace(/["']/g, "").trim()))).toBe(true);
    expect(loaded.some((f) => /noto.?sans.?sc/i.test(f))).toBe(true);
  });

  test("filming mode puts body text at 23px and leaves it at 21px elsewhere", async ({ page }) => {
    await page.goto("/design");
    await ready(page);
    // the draft gives a row inside a list card (22) and what he types in a field (24) sizes of their own: filming does
    // not move those, only running text
    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll("[data-rp-role=body]")].map((e) => ({
        filming: e.closest("[data-filming]")?.getAttribute("data-filming") === "true",
        px: parseFloat(getComputedStyle(e).fontSize),
        kind: e.matches("input, textarea") ? "field" : e.closest(".rpu-rows") ? "row" : "text",
      })),
    );
    const text = sizes.filter((s) => s.kind === "text");
    const on = text.filter((s) => s.filming);
    const off = text.filter((s) => !s.filming);
    // (the gallery's filming column holds fewer running-text blocks since a helpline's sentence stands in a bubble)
    expect(on.length).toBeGreaterThan(4);
    expect(off.length).toBeGreaterThan(8);
    expect(on.filter((s) => s.px !== 23)).toEqual([]);
    expect(off.filter((s) => s.px !== 21)).toEqual([]);
    expect(sizes.filter((s) => s.kind === "row" && s.px !== 22)).toEqual([]);
    expect(sizes.filter((s) => s.kind === "field" && s.px !== 24)).toEqual([]);
  });

  test("the live undo toast runs 12 s and 撤销 undoes", async ({ page }) => {
    await page.goto("/design#undotoast");
    await page.getByTestId("toast-demo-zh-Hans").click();
    const toast = page.locator("[data-rp=toast][data-placement=inline]").filter({ hasText: "已记下：吃了" }).filter({ has: page.locator("[data-running=true]") });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute("data-duration-ms", "12000");
    await toast.getByRole("button", { name: "撤销" }).click();
    await expect(toast).toHaveCount(0);
    await expect(page.getByText("撤销了，没有记。")).toBeVisible();
  });

  test("an undo bar at the foot of a screen makes the page longer by its own height; a screen without one ends as before", async ({ page }) => {
    /** the bar's height, what it told its screen, and the room the page keeps under its last block */
    const measure = () =>
      page.evaluate(() => {
        const screen = document.querySelector<HTMLElement>(".rpu-screen")!;
        const bar = screen.querySelector<HTMLElement>(".rpu-toast");
        const foot = getComputedStyle(screen.querySelector(":scope > .rpu-page")!, "::after");
        return { bar: bar ? bar.offsetHeight : 0, told: screen.style.getPropertyValue("--rpu-toast-h"), room: parseFloat(foot.height) };
      });
    // 「已记下：吃了」 stands at the foot of this composed screen (frozen for the picture)
    await page.goto("/design/screens/elder-today-done");
    await ready(page);
    await expect.poll(async () => (await measure()).told).not.toBe("");
    const withBar = await measure();
    expect(withBar.bar).toBeGreaterThan(80);
    expect(withBar.told).toBe(`${withBar.bar}px`);
    expect(withBar.room).toBe(withBar.bar);
    // no bar: nothing is added
    await page.goto("/design/screens/elder-today-pending");
    await ready(page);
    expect(await measure()).toEqual({ bar: 0, told: "", room: 0 });
  });

  test("the timeline pieces of the gallery: a group keeps the line whole, two lines join, his own words are plain, the way back can be a button", async ({ page }) => {
    await page.goto("/design#timeline");
    await ready(page);
    const block = page.locator("#timeline");
    // two timelines joined: the upper one's rule reaches its bottom edge, the lower one's starts at its top edge
    const rule = (el: Element) => {
      const s = getComputedStyle(el.querySelector(":scope > .rpu-tl-rail")!, "::before");
      return { top: parseFloat(s.top), bottom: parseFloat(s.bottom), shown: s.display !== "none" };
    };
    const upper = await block.locator('.rpu-tl[data-join-next="true"] > .rpu-tl-item').last().evaluate(rule);
    const lower = await block.locator('.rpu-tl[data-join-prev="true"] > .rpu-tl-item').first().evaluate(rule);
    expect(upper).toMatchObject({ bottom: 0, shown: true });
    expect(lower).toMatchObject({ top: 0, shown: true });
    // a group: a real box, and every entry inside but the line's first and last is a middle one
    const groups = block.locator(".rpu-tl-group");
    await expect(groups).toHaveCount(2);
    const box = await groups.first().boundingBox();
    expect(box && box.height > 60 && box.width > 200).toBe(true);
    const rules = await block.locator(".rpu-tl-group > .rpu-tl-item").evaluateAll((els) =>
      els.map((el) => {
        const s = getComputedStyle(el.querySelector(":scope > .rpu-tl-rail")!, "::before");
        const h = (el as HTMLElement).offsetHeight;
        return { fromTop: parseFloat(s.top) === 0, toBottom: Math.abs(parseFloat(s.top) + parseFloat(s.height) - h) < 1 };
      }),
    );
    expect(rules).toEqual([
      { fromTop: false, toBottom: true },
      { fromTop: true, toBottom: true },
      { fromTop: true, toBottom: true },
      { fromTop: true, toBottom: false },
    ]);
    // his own words: the sans face, weight 500; someone else's next to them are in the serif
    const own = block.locator('[data-rp="own-words"] .rpu-bubble').first();
    const face = (el: Element) => getComputedStyle(el).fontFamily;
    expect(await own.evaluate(face)).not.toBe(await block.locator(".rpu-said").first().evaluate(face));
    expect(await own.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    // the Chinese under English words: 22px serif with a 3px rule on its left, one 18px line under it
    const zh = block.locator('[data-testid="line-translation"]');
    expect(await zh.locator(".rpu-said-zh").evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).borderLeftWidth, getComputedStyle(el).color])).toEqual(["22px", "3px", "rgb(44, 54, 68)"]);
    expect(await zh.locator(".rpu-said-note").evaluate((el) => getComputedStyle(el).fontSize)).toBe("18px");
    await expect(zh.locator(".rpu-said-note")).toHaveText("中文翻译，以英文原话为准");
    // the way back as a button goes back in place
    await expect(block.getByText("第 2 步，共 2 步")).toBeVisible();
    await block.getByTestId("demo-back").click();
    await expect(block.getByText("第 1 步，共 2 步")).toBeVisible();
    await expect(page).toHaveURL(/\/design#timeline$/);
    await expect(block.locator('[data-kind="me"]')).toHaveCount(0);
  });
});

test.describe("screenshot gate", () => {
  test("UPDATE_DESIGN_SHOTS counts only when it is exactly 1", () => {
    expect(writeShotsFrom({})).toBe(false);
    for (const value of ["", "0", "true", "yes", " 1", "1 ", "01", "on"]) {
      expect(writeShotsFrom({ UPDATE_DESIGN_SHOTS: value }), JSON.stringify(value)).toBe(false);
    }
    expect(writeShotsFrom({ UPDATE_DESIGN_SHOTS: "1" })).toBe(true);
  });

  test("the write note says new, same bytes, or changed with both sizes", () => {
    const a = Buffer.from([1, 2, 3]);
    expect(shotWriteNote("x.png", null, a)).toBe("x.png: new");
    expect(shotWriteNote("x.png", Buffer.from([1, 2, 3]), a)).toBe("x.png: same bytes");
    expect(shotWriteNote("x.png", Buffer.from([1, 2, 4]), a)).toBe("x.png: changed (3 -> 3 bytes)");
    expect(shotWriteNote("gallery-1440x900.png", Buffer.alloc(1640866), Buffer.alloc(1640957, 1))).toBe(
      "gallery-1440x900.png: changed (1640866 -> 1640957 bytes)",
    );
  });

  test("the write-mode line names the committed folder and says whether anything is written", () => {
    expect(writeModeLine(true)).toBe(`UPDATE_DESIGN_SHOTS=1: writing screenshots to ${SHOTS}`);
    expect(writeModeLine(false)).toBe(
      `UPDATE_DESIGN_SHOTS is not 1: screenshots checked in memory, nothing written to ${SHOTS}`,
    );
  });

  test("designShot writes nothing when write is off, and writes the PNG it returns when it is on", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 200 });
    await page.setContent("<p style='font: 24px sans-serif'>gate</p>");
    const dir = test.info().outputPath("gate");
    // path.relative gives an absolute path when the output folder is on another drive (Windows)
    const rel = path.relative(SHOTS, dir);
    expect(rel.startsWith("..") || path.isAbsolute(rel), "the gate test writes outside the committed folder").toBe(true);
    const notes = () => test.info().annotations.map((a) => a.description);

    const offLines = await captureConsoleLog(async () => {
      const off = await designShot(page, "off.png", { dir, write: false });
      expect(off).toEqual({ width: 320, height: 200 });
    });
    expect(existsSync(dir), "write off: the folder is not even made").toBe(false);
    expect(offLines, "write off: nothing printed").toEqual([]);
    expect(notes(), "write off: no note").toEqual([]);

    // each write prints its line on stdout (what the list reporter shows) and keeps it as a note
    const onLines = await captureConsoleLog(async () => {
      const on = await designShot(page, "on.png", { dir, write: true });
      expect(readdirSync(dir)).toEqual(["on.png"]);
      expect(pngSize(readFileSync(path.join(dir, "on.png")))).toEqual(on);
      await designShot(page, "on.png", { dir, write: true });
    });
    expect(onLines).toEqual([`${REPORT_PREFIX} on.png: new`, `${REPORT_PREFIX} on.png: same bytes`]);
    expect(notes()).toEqual(["on.png: new", "on.png: same bytes"]);

    // a different render over the same name
    await page.setContent("<p style='font: 24px sans-serif'>gate, changed</p>");
    const changedLines = await captureConsoleLog(async () => {
      await designShot(page, "on.png", { dir, write: true });
    });
    expect(changedLines).toHaveLength(1);
    expect(changedLines[0]).toMatch(/^\[design shots\] on\.png: changed \(\d+ -> \d+ bytes\)$/);
    expect(notes()).toHaveLength(3);
  });
});

test.describe("screenshots", () => {
  let runStart = 0;
  test.beforeAll(() => {
    runStart = Date.now();
  });

  test("the three Today compositions at 390x844 @2x", async ({ browser }) => {
    noteWriteMode();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    try {
      const page = await context.newPage();
      for (const lang of ["zh", "en"] as const) {
        for (const state of STATES) {
          const res = await page.goto(`/design/today/${state}${lang === "en" ? "?lang=en" : ""}`);
          expect(res?.status(), `/design/today/${state} (${lang})`).toBe(200);
          await ready(page);
          await hideDevBadge(page);
          await page.waitForTimeout(300);
          const name = `today-${state}${lang === "en" ? "-en" : ""}-390x844@2x.png`;
          expect(TODAY_SHOT_NAMES, "the name is one of the committed set").toContain(name);
          const size = await designShot(page, name);
          expect(size, `today-${state} (${lang}) at 390x844 @2x`).toEqual({ width: 780, height: 1688 });
        }
      }
    } finally {
      await context.close();
    }
  });

  test("the whole gallery at 1440x900", async ({ browser }) => {
    noteWriteMode();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      expect((await page.goto("/design"))?.status()).toBe(200);
      await ready(page);
      await hideDevBadge(page);
      await page.waitForTimeout(300);
      const whole = await designShot(page, GALLERY_SHOT, { fullPage: true });
      expect(whole.width, "whole gallery width").toBe(1440);
      expect(whole.height, "whole gallery is taller than one screen").toBeGreaterThan(900);
      const first = await designShot(page, GALLERY_FIRST_SCREEN_SHOT);
      expect(first, "gallery first screen").toEqual({ width: 1440, height: 900 });
    } finally {
      await context.close();
    }
  });

  // Runs after the two above (one worker, file order). Without UPDATE_DESIGN_SHOTS=1 the guard after
  // each test already proved nothing was touched; this checks the committed set itself is whole.
  test("the committed set: exactly the 8 PNGs at their sizes, all rewritten in this run when UPDATE_DESIGN_SHOTS=1", () => {
    const state = folderState(SHOTS);
    expect(state, `${SHOTS} exists`).not.toBeNull();
    expect(state!.map((f) => `${f.name} (${f.kind})`)).toEqual(COMMITTED_SHOTS.map((name) => `${name} (file)`));
    for (const name of COMMITTED_SHOTS) {
      const size = pngSize(readFileSync(path.join(SHOTS, name)));
      if (TODAY_SHOT_NAMES.includes(name)) expect(size, name).toEqual({ width: 780, height: 1688 });
      else if (name === GALLERY_FIRST_SCREEN_SHOT) expect(size, name).toEqual({ width: 1440, height: 900 });
      else {
        expect(size.width, name).toBe(1440);
        expect(size.height, name).toBeGreaterThan(900);
      }
    }
    if (WRITE_SHOTS) {
      // a write moves the mtime even when the bytes come out the same; allow coarse filesystem clocks
      const stale = state!.filter((f) => f.mtimeMs < runStart - 2_000).map((f) => f.name);
      expect(stale, "UPDATE_DESIGN_SHOTS=1: every committed PNG was written in this run").toEqual([]);
    }
  });
});
