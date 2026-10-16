/**
 * A planned follow-up's day is 「大约」 until he sets the day he booked (real-app 2.15), on every screen that names it:
 * the visit tab's row (lib/visit/pipeline.ts plannedIsApprox), the review page (lib/visit/view.ts) and Today's
 * countdown (lib/daily/account-today.ts). The three are compared here on the same two rows, because they once
 * disagreed: the visit tab said 「11月23日的复诊（计划）」 where the review said 「大约 11月23日」.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { plannedIsApprox } from "@/lib/visit/pipeline";
import type { Store } from "@/lib/store/types";

const none = {} as Store;
const row = (script_section: string) => ({ id: "v1-u09-planned", script_section });

describe("a planned follow-up's day: about, until he books it", () => {
  it("made from the doctor's line: about, whatever words his sentence used", async () => {
    expect(await plannedIsApprox(none, "s1", row("planned:v1"))).toBe(true);
  });

  it("the day he booked: no longer about", async () => {
    expect(await plannedIsApprox(none, "s1", row("planned:v1:booked"))).toBe(false);
  });

  it("a planned visit with no line of the doctor's behind it (the example's follow-up, a row set another way): its plain day", async () => {
    expect(await plannedIsApprox(none, "s1", { id: "p-1", script_section: null })).toBe(false);
    expect(await plannedIsApprox(none, "s1", row("example:follow-up"))).toBe(false);
  });

  it("the review page and Today's countdown use the same rule (not booked), not the wording of the doctor's sentence", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    expect(read("lib/visit/view.ts")).toMatch(/approx: !planned\.script_section\?\.endsWith\(":booked"\)/);
    expect(read("lib/daily/account-today.ts")).toMatch(/const approx = section\.startsWith\("planned:"\) && !section\.endsWith\(":booked"\)/);
  });
});
