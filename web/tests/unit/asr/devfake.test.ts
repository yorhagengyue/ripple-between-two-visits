/**
 * SPEECH_PROVIDER=devfake (lib/asr/devfake.ts; C2 F1 item H): the developer tools' transcription stand-in. A visit's
 * transcript is the lines of the fixture its audio_fixture names, else the one the x-ripple-devfake-fixture header
 * names, else nothing (never a guess). The header means nothing to any other provider.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as jobGet, POST as jobsPost } from "@/app/api/asr/jobs/route";
import { GET as jobPoll } from "@/app/api/asr/jobs/[id]/route";
import { POST as visitsPost } from "@/app/api/visits/route";
import { DEVFAKE_HEADER, DevfakeSpeechProvider, fixtureUtterances, type FileJobResult } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { getMemoryStore } from "@/lib/store/memory";

const store = getMemoryStore();

beforeEach(() => {
  vi.stubEnv("MOCK_ASR_JOB_MS", "0");
});
afterEach(() => vi.unstubAllEnvs());

async function done(speech: DevfakeSpeechProvider, jobId: string): Promise<FileJobResult> {
  for (let i = 0; i < 50; i++) {
    const r = await speech.getFileJob(jobId);
    if (r.status !== "pending") return r;
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error("still pending");
}

describe("the provider", () => {
  it("the visit's own fixture first, then the one a test names; no fixture is a done job with no lines", async () => {
    const speech = new DevfakeSpeechProvider();
    const v2 = fixtureUtterances("v2")!;
    const own = await done(speech, (await speech.createFileJob({ url: "fixture:none", speakers: 2, lang: "en", fixture: "v2", devfakeFixture: "v1" })).jobId);
    expect(own.status).toBe("done");
    expect(own.utterances?.map((u) => u.text)).toEqual(v2.map((u) => u.text));
    const named = await done(speech, (await speech.createFileJob({ url: "fixture:none", speakers: 2, lang: "en", devfakeFixture: "p1" })).jobId);
    expect(named.utterances).toHaveLength(fixtureUtterances("p1")!.length);
    const none = await done(speech, (await speech.createFileJob({ url: "fixture:none", speakers: 2, lang: "en" })).jobId);
    expect(none).toMatchObject({ status: "done", utterances: [] });
    const unknown = await done(speech, (await speech.createFileJob({ url: "fixture:none", speakers: 2, lang: "en", devfakeFixture: "nope" })).jobId);
    expect(unknown.utterances).toEqual([]);
  });

  it("always says fixture: its lines are the fixture's (C2: never a slice of the test's fake microphone), with their fixture ids", async () => {
    const speech = new DevfakeSpeechProvider();
    const withAudio = await done(speech, (await speech.createFileJob({ url: "https://blob.example.test/x.wav", speakers: 2, lang: "en", devfakeFixture: "v1", audio: new Uint8Array([1, 2, 3]) })).jobId);
    expect(withAudio).toMatchObject({ status: "done", source: "fixture", model: "devfake" });
    expect(withAudio.utterances?.[7]).toMatchObject({ id: "v1-u08", text: "At home, we want it below 135 over 85." });
    const without = await done(speech, (await speech.createFileJob({ url: "fixture:none", speakers: 2, lang: "en", devfakeFixture: "v1" })).jobId);
    expect(without.source).toBe("fixture");
  });

  it("an unknown job is not_found", async () => {
    await expect(new DevfakeSpeechProvider().getFileJob(`devfake-${randomUUID()}`)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("through POST /api/asr/jobs for an account's own visit", () => {
  async function visitOfNewAccount(): Promise<{ token: string; visitId: string }> {
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `s${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    const token = a.tokens.access_token;
    const r = await visitsPost(
      new NextRequest("http://localhost/api/visits", { method: "POST", headers: { cookie: `rp_at=${token}`, "content-type": "application/json" }, body: JSON.stringify({ mode: "record", consent: { given: true } }) }),
    );
    expect(r.status).toBe(200);
    return { token, visitId: (await r.json()).visit.id };
  }

  async function transcript(token: string, visitId: string, fixture?: string): Promise<string[]> {
    const headers: Record<string, string> = { cookie: `rp_at=${token}`, "content-type": "application/json" };
    if (fixture) headers[DEVFAKE_HEADER] = fixture;
    const r = await jobsPost(new NextRequest("http://localhost/api/asr/jobs", { method: "POST", headers, body: JSON.stringify({ visit_id: visitId }) }));
    expect(r.status).toBe(200);
    const { job_id } = await r.json();
    for (let i = 0; i < 50; i++) {
      const poll = await jobPoll(new NextRequest(`http://localhost/api/asr/jobs/${job_id}`, { headers: { cookie: `rp_at=${token}` } }), { params: Promise.resolve({ id: job_id }) });
      const body = await poll.json();
      if (body.status === "done") return (body.utterances ?? []).map((u: { text: string }) => u.text);
      await new Promise((res) => setTimeout(res, 5));
    }
    throw new Error("still pending");
  }

  it("devfake: the header names the fixture his visit is transcribed as", async () => {
    vi.stubEnv("SPEECH_PROVIDER", "devfake");
    const { token, visitId } = await visitOfNewAccount();
    expect(await transcript(token, visitId, "v2")).toEqual(fixtureUtterances("v2")!.map((u) => u.text));
  });

  it("devfake without the header: no lines, never a script", async () => {
    vi.stubEnv("SPEECH_PROVIDER", "devfake");
    const { token, visitId } = await visitOfNewAccount();
    expect(await transcript(token, visitId)).toEqual([]);
  });

  it("the mock provider ignores the header: his visit waits for its transcript, never the demo's script (C2)", async () => {
    vi.stubEnv("SPEECH_PROVIDER", "mock");
    const { token, visitId } = await visitOfNewAccount();
    const r = await jobsPost(
      new NextRequest("http://localhost/api/asr/jobs", { method: "POST", headers: { cookie: `rp_at=${token}`, "content-type": "application/json", [DEVFAKE_HEADER]: "v2" }, body: JSON.stringify({ visit_id: visitId }) }),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ job_id: null, status: "awaiting_transcript", audio_saved: false });
    // the reopen check answers for his visit too: it waits for its transcript, with no job and no line
    const reopened = await jobGet(new NextRequest(`http://localhost/api/asr/jobs?visit_id=${visitId}`, { headers: { cookie: `rp_at=${token}` } }));
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toEqual({ job_id: null, visit_status: "awaiting_transcript" });
  });
});
