/**
 * The /design gallery shows real words (app/design/content.ts). That module never throws while it loads (a fixture
 * edited by another track must not break `next build`), so the agreements it relies on are checked here instead:
 * every utterance it quotes exists, the doctor's lines in the seed are word for word the transcript's, the label and
 * the dates it shows still match the seed, and the numbers it recomputes are the brief's (appendix D).
 */
import { describe, expect, it } from "vitest";
import {
  ANKLE_LINE,
  briefNumbers,
  CAPTIONS,
  COUNTER_LINES,
  DOCTOR,
  EXTRA_TABLET_ANSWER,
  familyWeek,
  HERO_READING,
  KEYPAD_READING,
  LABEL,
  LEAFLET,
  NOTES,
  PHARMACIST_LINE,
  question,
  utt,
  WEI_LING,
} from "@/app/design/content";

describe("the gallery's words are still in the fixtures", () => {
  it("every quoted utterance exists, and R1-R4 in the seed are the transcript's words", () => {
    for (const id of ["v1-u05", "v1-u08", "v1-u09", "v1-u12", "v2-u06", "v2-u07", "v2-u08", "v2-u12", "v2-u13", "v3-u19", "p1-u03"]) {
      expect(utt(id).text, id).not.toBe("");
    }
    for (const [k, line] of Object.entries(DOCTOR)) {
      expect(line.text, k).not.toBe("");
      expect(utt(line.ref).text, `${k} = ${line.ref}`).toBe(line.text);
    }
    expect(DOCTOR.R1.at).toBe("0:49");
    expect(DOCTOR.R4.at).toBe("0:43");
    for (const l of [ANKLE_LINE, ...COUNTER_LINES, PHARMACIST_LINE, EXTRA_TABLET_ANSWER]) expect(l.text, l.ref).not.toBe("");
    expect(CAPTIONS.now).toBe(DOCTOR.R1.text);
  });

  it("the label, the clip, the notes, the leaflet and the questions are there", () => {
    expect(LABEL.printed).toBe("Take ONE tablet every MORNING");
    expect(LABEL.printedName).toBe("AMLODIPINE 5MG TABLET");
    expect(LABEL.dispensedIso, "the gallery shows 9月1日 / 1 Sep").toBe("2026-09-01");
    expect(WEI_LING.text).toBe("爸，早餐吃了吗？药记得吃哦。");
    expect(WEI_LING.lines).toHaveLength(2);
    expect(NOTES.tired).not.toBe("");
    expect(NOTES.ankle).not.toBe("");
    expect(LEAFLET.purpose["zh-Hans"]).not.toBe("");
    expect(LEAFLET.title).not.toBe("");
    for (const id of ["q-tai-chi", "q-extra-tablet", "q-relative-box", "q-machine", "q-knee-2"]) expect(question(id).text, id).not.toBe("");
    expect(question("q-machine").answer).not.toBe("");
    expect(HERO_READING).toMatchObject({ systolic: 150, diastolic: 95 });
    expect(KEYPAD_READING.systolic).toBeGreaterThan(0);
  });

  it("the recomputed numbers are the brief's (appendix D)", () => {
    expect(briefNumbers()).toEqual({
      readings: 10,
      average: "140/85",
      notBelow: 9,
      target: "135/85",
      mornings: 33,
      taken: 29,
      missed: 4,
      missedWeekdays: ["Tue", "Thu"],
    });
    expect(familyWeek(26)).toEqual({ daysTaken: 5, daysDue: 6, readings: 2, questions: 1 });
  });
});
