/**
 * One rule for a recording's time point, wherever it is shown: whole seconds, cut, never rounded (C2 track B, fix round
 * 10-11; found by track G's journey 23). The line 「At home, we want it below 135 over 85.」 starts 49.5 s into its
 * recording: the review, the question list and the medicine card said 0:49, the brief and the blood pressure page said
 * 0:50 (lib/ui/props.ts clipTime rounded). A person who sees 0:50 on the brief and 0:49 next to the same sentence in the
 * review cannot tell they are the same moment.
 *
 * The formatters live in several tracks' files. This test holds them to one answer, and scans the screens for a time
 * point formatted in place.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clipTime as dailyClipTime } from "@/lib/daily/i18n";
import { formatClipTime } from "@/lib/meds/i18n";
import { clipAt } from "@/lib/profile/dates";
import { clipTime } from "@/lib/ui/props";
import { clipTimeLabel } from "@/lib/visit/account-copy";
import { formatMs } from "@/lib/visit/text";

const WEB = process.cwd();

/** Every function that writes where in a recording a sentence was said, and who shows it. */
const FORMATTERS: Record<string, (ms: number) => string> = {
  "lib/ui/props.ts clipTime (the brief, the blood pressure page, the answer card, the doctor's warning line, the players)": clipTime,
  "lib/daily/i18n.ts clipTime (Today's lines, the chat, diet and prevention views)": dailyClipTime,
  "lib/meds/i18n.ts formatClipTime (the medicine card)": formatClipTime,
  "lib/visit/account-copy.ts clipTimeLabel (the review)": clipTimeLabel,
  "lib/profile/dates.ts clipAt (the question list, the profile)": clipAt,
  "lib/visit/text.ts formatMs (the visit record)": formatMs,
};

/** Time points and what each must read as. */
const POINTS: [number, string][] = [
  [0, "0:00"],
  [999, "0:00"],
  [1000, "0:01"],
  [43_320, "0:43"],
  [49_500, "0:49"], // R1 in v1: the one that read 0:50 on the brief
  [49_999, "0:49"],
  [59_500, "0:59"], // rounding would make this 1:00
  [59_999, "0:59"],
  [60_000, "1:00"],
  [65_166, "1:05"],
  [94_772, "1:34"],
  [750_499, "12:30"],
  [750_500, "12:30"],
];

describe("a recording's time point: one rule everywhere", () => {
  it("every formatter cuts to whole seconds and agrees with the others", () => {
    for (const [ms, want] of POINTS) {
      for (const [name, format] of Object.entries(FORMATTERS)) expect(format(ms), `${name} at ${ms} ms`).toBe(want);
    }
  });

  it("no formatter shows a second that has not been reached yet (it never reads later than the moment itself)", () => {
    const seconds = (label: string) => label.split(":").reduce((a, part) => a * 60 + Number(part), 0);
    for (let ms = 0; ms <= 125_000; ms += 137) {
      for (const [name, format] of Object.entries(FORMATTERS)) {
        const shown = seconds(format(ms));
        expect(shown * 1000 <= ms && ms < (shown + 1) * 1000, `${name} at ${ms} ms says ${format(ms)}`).toBe(true);
      }
    }
  });

  it("the screen that formats a time point in place cuts as well, and the medicine page formats none itself", () => {
    // her shared visit page writes m:ss itself
    const shared = readFileSync(path.join(WEB, "app", "f", "shared", "visit", "[id]", "page.tsx"), "utf8");
    expect(shared).toContain("`${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, \"0\")}`");
    // the medicine page used to write m:ss next to 「听」; since the timeline layout (web/progress/fe-06.md) the time
    // point is on the entry's head line only, through lib/meds/chips.ts chipDetailText -> formatClipTime (held above)
    const meds = readFileSync(path.join(WEB, "components", "meds", "elder", "pages.tsx"), "utf8");
    expect(meds).toContain("chipDetailText(");
    expect(meds).not.toMatch(/tStartMs\s*[/%]/);
    expect(meds).not.toMatch(/\/\s*(1000|60000)\b/);
  });

  it("no screen rounds milliseconds to seconds, but for a length of time (listed here with its reason)", () => {
    /** A length is not a time point: 「录了 12 分 30 秒」 may round. A new entry needs its reason. */
    const LENGTHS: Record<string, string> = {
      "components/visit/elder/AccountVisitFlow.tsx": "how long a kept recording is (「12 分 30 秒」)",
      "app/p/me/export/recordings/RecordingRow.tsx": "how long a recording is, in his export list",
    };
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = path.join(dir, name);
        return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(name) ? [p] : [];
      });
    const rounding = [...files(path.join(WEB, "app")), ...files(path.join(WEB, "components"))]
      .filter((p) => /Math\.round\([^;\n]*\/\s*1000\s*\)/.test(readFileSync(p, "utf8")))
      .map((p) => path.relative(WEB, p).split(path.sep).join("/"))
      .sort();
    expect(rounding).toEqual(Object.keys(LENGTHS).sort());
  });
});
