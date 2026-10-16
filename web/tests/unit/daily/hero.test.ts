/**
 * The hero shot (task M4 item 6, literal requirement): seed D29 evening, 150/95, "can I take one more tablet?"
 * through POST /api/ask, in Mandarin and English.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POST as askRoute } from "@/app/api/ask/route";
import { GET as clipRoute } from "@/app/api/visits/[id]/clip/route";
import { getBus } from "@/lib/bus";
import { renderText } from "@/lib/safety/render";
import { extractSlots } from "@/lib/safety/slots";
import type { AskResult } from "@/lib/safety/types";
import { getMemoryStore } from "@/lib/store/memory";
import { getReq, postReq, sessionAt } from "./helpers";

const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const LABEL = "Take ONE tablet every MORNING";
const HERO = { "zh-Hans": "今天 150/95，我能不能多吃一粒？", en: "Today 150/95, can I take one more tablet?" } as const;
// the hero's words would be dose advice if Ripple said them
const ADVICE = ["可以多吃", "多吃一粒吧", "you can take", "take another", "one more tablet is", "extra is fine", "不要紧", "没关系"];

async function askHero(sessionId: string, locale: "zh-Hans" | "en"): Promise<AskResult> {
  const res = await askRoute(postReq("/api/ask", sessionId, { text: HERO[locale], locale, role: "patient" }));
  expect(res.status).toBe(200);
  return (await res.json()) as AskResult;
}

describe("hero: 今天 150/95，我能不能多吃一粒？ (seed D29 evening)", () => {
  for (const locale of ["zh-Hans", "en"] as const) {
    it(`${locale}: no dose advice; R4 word for word from the doctor with a playable stand-in clip; the label's own words`, async () => {
      const s = await sessionAt(29, "20:15");
      const result = await askHero(s.id, locale);
      expect(result.route).toBe("refuse_route");

      const r4 = result.sentences.find((x) => x.sourceId === "visit:v2:R4")!;
      expect(r4.en).toBe(R4);
      expect(r4.attribution).toBe("doctor");
      expect(r4.cite).toMatchObject({
        visitId: "v2",
        date: "2026-09-01",
        requiredLine: "R4",
        clipPath: "visits/clips/v2-u08.wav",
        standInVoice: true,
        roleState: "confirmed",
        clipLabel: locale === "zh-Hans" ? "代录音" : "stand-in recording",
      });
      expect(r4.cite!.clipUrl).toBe(`/api/visits/v2/clip?u=v2-u08&session=${encodeURIComponent(s.id)}`);

      // the clip URL plays: the stand-in file itself, marked as a stand-in
      const url = new URL(`http://localhost${r4.cite!.clipUrl}`);
      const clip = await clipRoute(getReq(`${url.pathname}?u=${url.searchParams.get("u")}`, s.id), { params: Promise.resolve({ id: "v2" }) });
      expect(clip.status).toBe(200);
      expect(clip.headers.get("content-type")).toBe("audio/wav");
      expect(clip.headers.get("x-ripple-stand-in")).toBe("1");
      const bytes = new Uint8Array(await clip.arrayBuffer());
      expect(Buffer.from(bytes).equals(readFileSync(path.join(process.cwd(), "fixtures", "visits", "clips", "v2-u08.wav")))).toBe(true);

      const label = result.sentences.find((x) => x.sourceId === "label:med-amlodipine")!;
      expect(label).toMatchObject({ en: LABEL, attribution: "label" });

      // no dose advice: every sentence is the doctor's line, the label line or a fixed referral template
      for (const x of result.sentences) expect(["visit:v2:R4", "label:med-amlodipine"].includes(x.sourceId) || x.origin === "template", `${x.sourceId}: ${x.en}`).toBe(true);
      expect(result.sentences.filter((x) => x.origin === "template").map((x) => x.templateId)).toEqual(["refer_doctor"]);
      for (const loc of ["zh-Hans", "en"] as const) {
        const out = renderText(result, loc);
        for (const w of ADVICE) expect(out.toLowerCase(), `${loc}: ${w}`).not.toContain(w.toLowerCase());
        // the only numbers are the label's ("ONE")
        for (const n of extractSlots(out).numbers) expect(extractSlots(LABEL).numbers).toContain(n);
        // R2, the 180 line, was not restated at D8: not shown
        expect(out).not.toContain("180");
      }
      expect(result.sentences.some((x) => x.sourceId === "visit:v1:R2")).toBe(false);

      // exactly one question: the seeded q-extra-tablet of D29 is reused (the seed records Dr Lim's answer at the D42
      // visit, 10-10; on D29 it is still waiting, so every question of the session is counted here, not only "open" rows)
      expect(result).toMatchObject({ addedQuestionId: "q-extra-tablet", questionReused: true });
      const all = await getMemoryStore().listQuestions(s.id);
      expect(all.filter((q) => q.created_day === 29 && q.origin === "refused_question").map((q) => q.id)).toEqual(["q-extra-tablet"]);

      // backstage: the refused request shows as ask.blocked
      const blocked = getBus().recent(s.id).filter((e) => e.type === "ask.blocked");
      expect(blocked).toHaveLength(1);
      expect(blocked[0].data).toMatchObject({ request: HERO[locale], replacedBy: "refer_doctor", stage: "route" });
    });
  }

  it("asked in Mandarin and then in English on the same evening: still exactly one question", async () => {
    const s = await sessionAt(29, "20:15");
    const before = (await getMemoryStore().listQuestions(s.id)).length;
    const a = await askHero(s.id, "zh-Hans");
    const b = await askHero(s.id, "en");
    expect(a.addedQuestionId).toBe("q-extra-tablet");
    expect(b.addedQuestionId).toBe("q-extra-tablet");
    expect((await getMemoryStore().listQuestions(s.id)).length).toBe(before);
    expect(getBus().recent(s.id).filter((e) => e.type === "ask.blocked")).toHaveLength(2);
  });

  it("well under 4 s end to end through the route with the mock providers", async () => {
    const s = await sessionAt(29, "20:15");
    const t0 = performance.now();
    const result = await askHero(s.id, "zh-Hans");
    expect(performance.now() - t0).toBeLessThan(4000);
    expect(result.latencyMs).toBeLessThan(4000);
  });
});
