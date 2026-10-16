/**
 * The M3 routes end to end on the local blob driver: upload link -> PUT -> /api/labels/read -> /api/meds, plus
 * the card, relabel, the answer link and the sample photos.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUT as blobPUT } from "@/app/api/blob/upload/route";
import { POST as readPOST } from "@/app/api/labels/read/route";
import { GET as sampleGET } from "@/app/api/labels/sample/route";
import { POST as answerPOST } from "@/app/api/meds/[id]/answer/route";
import { GET as cardGET, PATCH as medPATCH } from "@/app/api/meds/[id]/route";
import { GET as medsGET, POST as medsPOST } from "@/app/api/meds/route";
import { POST as uploadUrlPOST } from "@/app/api/upload-url/route";
import { UNKNOWN_MED_SENTENCE } from "@/lib/safety";
import { getMemoryStore } from "@/lib/store/memory";
import { expectedLabel, labelPng, type LabelName } from "./helpers";

const BASE = "http://localhost:3200";
let dir: string;
const savedEnv = { ...process.env };

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-m3-routes-"));
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.BLOB_DRIVER;
  process.env.LLM_PROVIDER = "mock";
  process.env.SPEECH_PROVIDER = "mock";
});
afterAll(() => {
  process.env = savedEnv;
  rmSync(dir, { recursive: true, force: true });
});

const req = (method: string, url: string, sessionId: string | null, body?: unknown) => {
  const u = new URL(url, BASE);
  if (sessionId) u.searchParams.set("session", sessionId);
  return new NextRequest(u, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
};
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function newSession(day: number) {
  return (await getMemoryStore().createSession({ story_day: day, ttl_hours: 1 })).id;
}

async function uploadPhoto(sid: string, name: LabelName): Promise<string> {
  const link = await (await uploadUrlPOST(req("POST", "/api/upload-url", sid, { kind: "label", content_type: "image/png" }))).json();
  const put = await blobPUT(new NextRequest(new URL(link.url, BASE), { method: "PUT", headers: link.headers, body: Buffer.from(labelPng(name)) }));
  expect(put.status).toBe(200);
  return link.path;
}

async function readPhoto(sid: string, name: LabelName) {
  const res = await readPOST(req("POST", "/api/labels/read", sid, { path: await uploadPhoto(sid, name) }));
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return { json: JSON.parse(text), text };
}

const confirmAll = (fields: Record<string, unknown>) => ["drug_text", "strength", "directions", "dispensed", "clinic"].filter((k) => fields[k] !== null);

describe("label photo -> fields -> medicine list", () => {
  it("amlodipine: fields equal expected.json; confirmed -> label_confirmed; the card follows", async () => {
    const sid = await newSession(8);
    expect((await medPATCH(req("PATCH", "/api/meds/med-amlodipine", sid, { action: "relabel" }), params("med-amlodipine"))).status).toBe(200);
    const before = await (await cardGET(req("GET", "/api/meds/med-amlodipine?locale=en", sid), params("med-amlodipine"))).json();
    expect(before.card.awaitingLabel).toBe(true);
    expect(before.card.howToTake).toEqual([]);
    expect(before.card.purpose[0].chip.kind).toBe("doctor");

    const { json, text } = await readPhoto(sid, "amlodipine");
    const want = expectedLabel("amlodipine");
    for (const k of ["drug_text", "drug_id", "strength", "directions", "slots", "dispensed", "clinic"]) expect(json.fields[k], k).toEqual(want[k]);
    expect(text).not.toContain("Keep out of reach");

    const missing = await medsPOST(req("POST", "/api/meds", sid, { read_token: json.read_token, confirmed: ["drug_text"], origin: "prescription" }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("not_all_confirmed");

    const res = await medsPOST(req("POST", "/api/meds", sid, { read_token: json.read_token, confirmed: confirmAll(json.fields), med_id: "med-amlodipine", locale: "en" }));
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.outcome).toBe("label_confirmed");
    expect(out.med.status).toBe("label_confirmed");
    expect(out.questions).toEqual([]);

    const after = await (await cardGET(req("GET", "/api/meds/med-amlodipine?locale=en", sid), params("med-amlodipine"))).json();
    expect(after.card.purpose.map((l: { chip: { kind: string } }) => l.chip.kind)).toEqual(["doctor", "leaflet"]);
    expect(after.card.howToTake[0].text).toBe("Take ONE tablet every MORNING");
  });

  it("relative box: the fixed sentence and one pharmacist question; the dosing on the box never leaves the server", async () => {
    const sid = await newSession(8);
    const { json, text } = await readPhoto(sid, "relative_box");
    expect(json.fields.drug_id).toBeNull();
    expect(text).not.toContain("六粒");
    const store = getMemoryStore();
    const before = (await store.listQuestions(sid, { for: "pharmacist" })).length;
    const res = await medsPOST(req("POST", "/api/meds", sid, { read_token: json.read_token, confirmed: confirmAll(json.fields), origin: "relative" }));
    expect(res.status).toBe(201);
    const body = await res.text();
    expect(body).not.toContain("六粒");
    const out = JSON.parse(body);
    expect(out.outcome).toBe("unidentified");
    expect(out.answer.fixedText).toBe(UNKNOWN_MED_SENTENCE);
    expect(out.questions).toHaveLength(1);
    expect((await store.listQuestions(sid, { for: "pharmacist" })).length).toBe(before + 1);

    // D12: the pharmacist's answer links to that question
    const early = await answerPOST(req("POST", `/api/meds/${out.med.id}/answer`, sid, { visit_id: "p1", utterance_id: "p1-u03" }), params(out.med.id));
    expect(early.status).toBe(409);
    await store.setStoryDay(sid, 12);
    const post = (body: unknown) => answerPOST(req("POST", `/api/meds/${out.med.id}/answer`, sid, body), params(out.med.id));
    expect((await post({ visit_id: "p1", utterance_id: "p1-u03", speaker: "patient" })).status).toBe(400); // not a speaker he can name
    const wrongRole = await post({ visit_id: "p1", utterance_id: "p1-u03", speaker: "doctor" });
    expect(wrongRole.status).toBe(400);
    expect((await wrongRole.json()).error).toBe("speaker_not_at_visit");
    const linked = await post({ visit_id: "p1", utterance_id: "p1-u03", speaker: "pharmacist" });
    expect(linked.status).toBe(200);
    const { question } = await linked.json();
    expect(question).toMatchObject({ id: out.questions[0].id, status: "answered", answer_utterance_id: "p1-u03", answer_visit_id: "p1", answer_speaker: "pharmacist" });
    expect(question.answer_text).toBe("The label is only in Chinese and I can't confirm what's inside. Please don't take it for now. Bring it to your doctor at your next visit.");
  });

  it("ibuprofen: label_confirmed and his question for the pharmacist; the card has no blood pressure or amlodipine", async () => {
    const sid = await newSession(29);
    const { json } = await readPhoto(sid, "ibuprofen");
    const res = await medsPOST(req("POST", "/api/meds", sid, { read_token: json.read_token, confirmed: confirmAll(json.fields), origin: "self_bought", locale: "zh-Hans" }));
    const out = await res.json();
    expect(out.outcome).toBe("label_confirmed");
    expect(out.questions.map((q: { text: string }) => q.text)).toEqual(["这个药和我其他的药一起吃，要问药剂师"]);
    for (const locale of ["en", "zh-Hans"]) {
      const card = await (await cardGET(req("GET", `/api/meds/med-ibuprofen?locale=${locale}`, sid), params("med-ibuprofen"))).text();
      for (const b of ["blood pressure", "血压", "amlodipine"]) expect(card.toLowerCase(), `${locale} ${b}`).not.toContain(b);
    }
  });

  it("errors: foreign or missing photo, bad bodies, unknown medicine, relabel of an unidentified box", async () => {
    const sid = await newSession(29);
    const other = await newSession(29);
    const foreign = await uploadPhoto(other, "amlodipine");
    expect((await readPOST(req("POST", "/api/labels/read", sid, { path: foreign }))).status).toBe(403);
    expect((await readPOST(req("POST", "/api/labels/read", sid, { path: `${sid}/labels/nope.png` }))).status).toBe(404);
    expect((await readPOST(req("POST", "/api/labels/read", sid, { path: "x", extra: 1 }))).status).toBe(400);
    expect((await readPOST(req("POST", "/api/labels/read", null, { path: "x" }))).status).toBe(400);
    expect((await medsPOST(req("POST", "/api/meds", sid, { read_token: "x".repeat(20), confirmed: [] }))).status).toBe(400); // no origin, no med_id
    expect((await medsPOST(req("POST", "/api/meds", sid, { read_token: "x".repeat(20), confirmed: [], origin: "relative" }))).status).toBe(400); // bad token
    expect((await cardGET(req("GET", "/api/meds/nope", sid), params("nope"))).status).toBe(404);
    expect((await medPATCH(req("PATCH", "/api/meds/med-relative-box", sid, { action: "relabel" }), params("med-relative-box"))).status).toBe(409);
    expect((await medPATCH(req("PATCH", "/api/meds/med-amlodipine", sid, { action: "delete" }), params("med-amlodipine"))).status).toBe(400);
  });

  it("GET /api/meds groups by origin; sample photos are served", async () => {
    const sid = await newSession(29);
    const list = await (await medsGET(req("GET", "/api/meds?locale=en", sid))).json();
    expect(list.groups.map((g: { origin: string }) => g.origin)).toEqual(["prescription", "self_bought", "relative"]);
    const png = await sampleGET(req("GET", "/api/labels/sample?name=amlodipine", null));
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await png.arrayBuffer()).equals(Buffer.from(labelPng("amlodipine")))).toBe(true);
    expect((await sampleGET(req("GET", "/api/labels/sample?name=../../.env", null))).status).toBe(404);
  });
});
