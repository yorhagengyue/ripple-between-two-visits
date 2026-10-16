/**
 * M6 Wei Ling's view and Mr Tan's switches, through the routes.
 *
 * Literal requirements covered here: /f shows only what he granted (defaults from the seed's family_grants: this
 * week's medicine days, blood pressure count, questions waiting; transcripts and notes off); only the patient changes
 * the switches (family 403 from the grants API); the family role also gets 403 from POST /api/doses, confirming a
 * medicine, linking an answer to a question and confirming a visit; a switch changes only from a device with a row as
 * him (or a judge's own sandbox), never from a call with no identity; with visit_transcripts off nothing said at a
 * visit is in the view; her newest own recording is the clip that plays. The 1 s sync, the page text scan and her
 * recording on /f are e2e (e2e/m6-*.spec.ts).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as dosesPost } from "@/app/api/doses/route";
import { GET as grantsGet, POST as grantsPost } from "@/app/api/family/grants/route";
import { GET as viewGet } from "@/app/api/family/view/route";
import { POST as medAnswerPost } from "@/app/api/meds/[id]/answer/route";
import { POST as medsPost } from "@/app/api/meds/route";
import { POST as visitConfirmPost } from "@/app/api/visits/[id]/confirm/route";
import { getBus } from "@/lib/bus";
import type { ReminderClipView } from "@/lib/daily/types";
import { preferredClip } from "@/lib/family/clips";
import { allFamilyStrings } from "@/lib/family/i18n";
import { requesterRole } from "@/lib/family/role";
import type { FamilyViewData } from "@/lib/family/types";
import { familyView } from "@/lib/family/view";
import { judgementHits } from "@/lib/safety/judgement";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { summarizeDoses } from "@/lib/summary/doses";
import { thisWeek } from "@/lib/summary/window";
import { d0Of, routineOf } from "@/lib/daily/doses";

const FIXTURES = path.join(process.cwd(), "fixtures");

async function sessionAt(day: number, time: string | null = null): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: day, story_time: time, ttl_hours: 1 });
}

function req(method: "GET" | "POST", p: string, sessionId: string, body?: unknown, cookie?: string): NextRequest {
  const sep = p.includes("?") ? "&" : "?";
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`http://localhost${p}${sep}session=${encodeURIComponent(sessionId)}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A device that joined the session as `role` (the member row and cookies /join sets). */
async function deviceCookie(s: SessionRow, role: "patient" | "family" | "backstage" | "director" | "judge"): Promise<string> {
  const member = await getMemoryStore().addMember(s.id, { role });
  return `rp_session=${s.id}; rp_member=${member.id}; rp_role=${role}`;
}

async function view(s: SessionRow): Promise<FamilyViewData> {
  const res = await viewGet(req("GET", "/api/family/view", s.id));
  expect(res.status).toBe(200);
  return (await res.json()) as FamilyViewData;
}

/** Everything said at a visit in the story: R1-R4, every replay transcript line, every recorded answer. */
function visitTexts(): string[] {
  const seed = JSON.parse(readFileSync(path.join(FIXTURES, "timeline.seed.json"), "utf8")) as {
    required_doctor_lines: { text: string }[];
    questions: { answer?: { text: string } }[];
  };
  const out = [...seed.required_doctor_lines.map((r) => r.text), ...seed.questions.flatMap((q) => (q.answer ? [q.answer.text] : []))];
  for (const v of ["v1", "v2", "p1", "v3"]) {
    const f = JSON.parse(readFileSync(path.join(FIXTURES, "visits", `${v}.utterances.json`), "utf8")) as { utterances: { text: string }[] };
    out.push(...f.utterances.map((u) => u.text));
  }
  return out;
}

describe("switches: only Mr Tan changes them", () => {
  it("GET: the seed's defaults (transcripts and notes off)", async () => {
    const s = await sessionAt(29);
    const body = await (await grantsGet(req("GET", "/api/family/grants", s.id))).json();
    expect(body).toMatchObject({
      member: "wei-ling",
      items: { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: false, notes: false },
    });
  });

  it("his patient row (and a judge's own sandbox row) may change a switch; the change is published", async () => {
    const s = await sessionAt(29);
    const his = await deviceCookie(s, "patient");
    for (const cookie of [his, await deviceCookie(s, "judge")]) {
      const res = await grantsPost(req("POST", "/api/family/grants", s.id, { items: { notes: true } }, cookie));
      expect(res.status, cookie).toBe(200);
      expect((await res.json()).items.notes).toBe(true);
    }
    const res = await grantsPost(req("POST", "/api/family/grants", s.id, { items: { dose_summary: false } }, his));
    expect((await res.json()).items).toMatchObject({ dose_summary: false, notes: true, bp_summary: true });
    const events = getBus().recent(s.id).filter((e) => e.type === "family_grant.changed");
    expect(events.length).toBe(3);
    expect(events.at(-1)?.data).toMatchObject({ grant: { items: { dose_summary: false, notes: true } }, changed: { dose_summary: false } });
  });

  it("without a row nobody changes them: a call with no identity, or rp_role=patient / judge alone, is 403 (10-09: deny by default)", async () => {
    // a session nobody joined as family: these are "no role" / "cookie role", which still read and act elsewhere, but
    // what his family may see changes only from a device with a row (her phone with its cookies dropped is one of these)
    const s = await sessionAt(29);
    for (const cookie of [undefined, `rp_session=${s.id}; rp_role=patient`, `rp_session=${s.id}; rp_role=judge`, `rp_role=patient`]) {
      const res = await grantsPost(req("POST", "/api/family/grants", s.id, { items: { notes: true, visit_transcripts: true } }, cookie));
      expect(res.status, cookie ?? "no identity").toBe(403);
      expect((await res.json()).error, cookie ?? "no identity").toBe("patient_only");
    }
    // once she has joined, the same calls are strangers
    await deviceCookie(s, "family");
    for (const cookie of [undefined, `rp_session=${s.id}; rp_role=patient`]) {
      const res = await grantsPost(req("POST", "/api/family/grants", s.id, { items: { notes: true } }, cookie));
      expect(res.status, cookie ?? "no identity").toBe(403);
      expect((await res.json()).error, cookie ?? "no identity").toBe("member_required");
    }
    expect((await (await grantsGet(req("GET", "/api/family/grants", s.id, undefined, await deviceCookie(s, "patient")))).json()).items).toMatchObject({ notes: false, visit_transcripts: false });
    expect(getBus().recent(s.id).filter((e) => e.type === "family_grant.changed")).toEqual([]);
  });

  it("Wei Ling (family role) gets 403 from the grants API, by her member row or by her role cookie; so do backstage and director", async () => {
    const s = await sessionAt(29);
    const family = await deviceCookie(s, "family");
    const cases: [string, string][] = [
      [family, "patient_only"],
      [`rp_role=family`, "patient_only"], // a family phone outside its own session
      [await deviceCookie(s, "backstage"), "patient_only"],
      [await deviceCookie(s, "director"), "patient_only"],
      [`rp_session=${s.id}; rp_role=family`, "member_required"], // no row in a session she has joined: a stranger
    ];
    for (const [cookie, code] of cases) {
      const res = await grantsPost(req("POST", "/api/family/grants", s.id, { items: { visit_transcripts: true } }, cookie));
      expect(res.status, cookie).toBe(403);
      expect((await res.json()).error, cookie).toBe(code);
    }
    // a changed role cookie does not beat her member row
    const spoof = family.replace("rp_role=family", "rp_role=patient");
    expect((await grantsPost(req("POST", "/api/family/grants", s.id, { items: { visit_transcripts: true } }, spoof))).status).toBe(403);
    expect((await (await grantsGet(req("GET", "/api/family/grants", s.id, undefined, family))).json()).items.visit_transcripts).toBe(false);
    expect(getBus().recent(s.id).filter((e) => e.type === "family_grant.changed")).toEqual([]);
  });

  it("a role cookie from another session is not this session's role, except family (the one role that only takes away)", async () => {
    const s = await sessionAt(29);
    const other = await sessionAt(29);
    for (const role of ["patient", "judge", "director", "backstage"]) {
      expect(await requesterRole(req("POST", "/x", s.id, {}, `rp_session=${other.id}; rp_role=${role}`), s), role).toBeNull();
    }
    // 10-09 B1 fixer r1: a family device that names another session keeps its family role (otherwise it would be a
    // device with no role, which the routes treat as his side); the grants API refuses it
    expect(await requesterRole(req("POST", "/x", s.id, {}, `rp_session=${other.id}; rp_role=family`), s)).toBe("family");
    expect((await grantsPost(req("POST", "/api/family/grants", s.id, { items: { notes: true } }, `rp_session=${other.id}; rp_role=family`))).status).toBe(403);
    expect(await requesterRole(req("POST", "/x", s.id, {}, `rp_session=${s.id}; rp_role=family`), s)).toBe("family");
  });

  it("the body is checked: known switches, booleans, at least one", async () => {
    const s = await sessionAt(29);
    const his = await deviceCookie(s, "patient");
    for (const body of [{ items: {} }, { items: { secret: true } }, { items: { notes: "yes" } }, { notes: true }, { items: { notes: true }, member: "someone" }]) {
      expect((await grantsPost(req("POST", "/api/family/grants", s.id, body, his))).status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("Wei Ling cannot act for him: 403 from every route that acts", () => {
  it("POST /api/doses, POST /api/meds, POST /api/meds/[id]/answer, POST /api/visits/[id]/confirm", async () => {
    const s = await sessionAt(29);
    const family = await deviceCookie(s, "family");
    const id = (x: string) => ({ params: Promise.resolve({ id: x }) });
    const calls: [string, Promise<Response>][] = [
      ["doses", dosesPost(req("POST", "/api/doses", s.id, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }, family))],
      ["meds confirm", medsPost(req("POST", "/api/meds", s.id, { read_token: "x".repeat(20), confirmed: [], origin: "self_bought" }, family))],
      ["answer", medAnswerPost(req("POST", "/api/meds/med-relative-box/answer", s.id, { visit_id: "p1", utterance_id: "p1-u03" }, family), id("med-relative-box"))],
      ["visit confirm", visitConfirmPost(req("POST", "/api/visits/v1/confirm", s.id, { mine: [], items: {} }, family), id("v1"))],
    ];
    for (const [name, p] of calls) {
      const res = await p;
      expect(res.status, name).toBe(403);
      expect((await res.json()).error, name).toBe("patient_only");
    }
    // nothing was written: D29's dose is still the seed's
    const d29 = (await getMemoryStore().listDoses(s.id, { fromDay: 29, toDay: 29 }))[0];
    expect(d29.state).toBe("taken");
    expect(getBus().recent(s.id).filter((e) => e.type === "dose.logged")).toEqual([]);
  });

  it("Mr Tan's own device still acts (no role, or patient)", async () => {
    const s = await sessionAt(43);
    for (const cookie of [undefined, await deviceCookie(s, "patient")]) {
      const res = await dosesPost(req("POST", "/api/doses", s.id, { medication_id: "med-amlodipine", slot: "morning", state: "taken" }, cookie));
      expect(res.status).toBe(200);
    }
  });
});

describe("the view holds only what he granted", () => {
  it("D29 defaults: this week's medicine days, readings count, questions waiting; no transcripts, no notes", async () => {
    const s = await sessionAt(29);
    const v = await view(s);
    expect(v.grants).toMatchObject({ visit_transcripts: false, notes: false });
    expect(v.doses).toMatchObject({ week: { fromDay: 28, toDay: 29, fromDate: "2026-09-21", toDate: "2026-09-22" }, daysDue: 2, daysTaken: 2, daysMissed: 0, daysUnconfirmed: 0 });
    expect(v.doses?.today).toEqual([expect.objectContaining({ medication_id: "med-amlodipine", day: 29, state: "taken" })]);
    expect(v.bp).toEqual({ week: v.doses!.week, count: 2, unconfirmed: 0 });
    expect(v.questions).toEqual({ waiting: 2 });
    expect("visits" in v).toBe(false);
    expect("notes" in v).toBe(false);
  });

  it("the week's counts are lib/summary's (the brief's functions)", async () => {
    const s = await sessionAt(41);
    const v = await view(s);
    const store = getMemoryStore();
    const w = thisWeek(41, d0Of(s));
    const sum = summarizeDoses({ meds: await store.listMeds(s.id), doses: await store.listDoses(s.id, { toDay: 41 }), fromDay: w.fromDay, toDay: w.toDay, storyDay: 41, todayWindowClosed: false, d0: d0Of(s), routine: routineOf(s) });
    expect(v.doses).toMatchObject({ daysDue: sum.days.length, daysTaken: sum.daysAllTaken });
    expect(v.doses).toMatchObject({ daysDue: 7, daysTaken: 6, daysMissed: 1 }); // D35-D41, D36 (Tue) missed
  });

  it("with visit_transcripts off nothing said at a visit is in the view (R1-R4, every transcript line, every answer)", async () => {
    const texts = visitTexts();
    expect(texts.length).toBeGreaterThan(50);
    for (const day of [29, 43]) {
      const s = await sessionAt(day);
      await getMemoryStore().setFamilyGrant(s.id, "wei-ling", { notes: true }); // everything but the transcripts
      const json = JSON.stringify(await view(s));
      for (const t of texts) expect(json.includes(t), `D${day}: ${t}`).toBe(false);
    }
  });

  it("with visit_transcripts on: the visits so far, word for word, with who said it; off again removes them", async () => {
    const s = await sessionAt(29);
    const his = await deviceCookie(s, "patient");
    expect((await grantsPost(req("POST", "/api/family/grants", s.id, { items: { visit_transcripts: true } }, his))).status).toBe(200);
    const v = await view(s);
    expect(v.visits?.map((x) => x.id)).toEqual(["p1", "v2", "v1"]); // newest first, nothing after D29
    const v1 = v.visits!.find((x) => x.id === "v1")!;
    expect(v1.lines.map((l) => l.text)).toContain("At home, we want it below 135 over 85.");
    expect(v1.lines.find((l) => l.text.startsWith("At home"))?.chip).toMatchObject({ kind: "doctor", inferred: false });
    expect(v1.lines.find((l) => l.text === "手腕的不太准。买一个绑手臂的，upper arm 的。")?.chip.kind).toBe("doctor");
    expect(JSON.stringify(v)).not.toContain("Try not to take ibuprofen regularly"); // D42, after the story day
    expect((await grantsPost(req("POST", "/api/family/grants", s.id, { items: { visit_transcripts: false } }, his))).status).toBe(200);
    expect("visits" in (await view(s))).toBe(false);
  });

  it("notes only when he turns them on, word for word, up to the story day", async () => {
    const s = await sessionAt(29);
    expect(JSON.stringify(await view(s))).not.toContain("我今天好累");
    expect((await grantsPost(req("POST", "/api/family/grants", s.id, { items: { notes: true } }, await deviceCookie(s, "patient")))).status).toBe(200);
    const v = await view(s);
    expect(v.notes).toEqual([{ id: expect.any(String), day: 20, date: "2026-09-13", text: "我今天好累。", lang: expect.anything() }]);
  });

  it("each switch removes its section", async () => {
    const s = await sessionAt(29);
    const off = { dose_summary: false, bp_summary: false, questions_count: false };
    expect((await grantsPost(req("POST", "/api/family/grants", s.id, { items: off }, await deviceCookie(s, "patient")))).status).toBe(200);
    const v = await view(s);
    expect(Object.keys(v).sort()).toEqual(["day", "generatedAt", "grants"]);
    // the server-side builder is what the page renders too
    expect(Object.keys(await familyView(getMemoryStore(), s)).sort()).toEqual(["day", "generatedAt", "grants"]);
  });
});

describe("her reminder clip", () => {
  const clip = (id: string, standIn: boolean, audio = true): ReminderClipView => ({
    id,
    by: "wei-ling",
    text: null,
    lang: null,
    plays_at: "after_breakfast",
    audio_url: audio ? `/api/reminders/${id}/audio` : null,
    stand_in: standIn,
  });

  it("her newest own recording wins over the seed's stand-in voice", () => {
    expect(preferredClip([clip("seed", true)])?.id).toBe("seed");
    expect(preferredClip([clip("seed", true), clip("hers-1", false), clip("hers-2", false)])?.id).toBe("hers-2");
    expect(preferredClip([clip("no-audio", false, false), clip("seed", true)])?.id).toBe("seed");
    expect(preferredClip([])).toBeNull();
  });
});

describe("words", () => {
  it("no judgement words in Wei Ling's and the switch page's dictionary (zh and en)", () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      for (const s of allFamilyStrings(locale)) {
        expect(judgementHits(s), `${locale}: ${s}`).toEqual([]);
        expect(/正常|偏高|危险|\bnormal\b|\bhigh\b|\bdangerous\b|\bgood\b/i.test(s), `${locale}: ${s}`).toBe(false);
      }
    }
  });
});
