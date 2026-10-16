import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/ask/route";
import { getBus } from "@/lib/bus";
import { setMockInjection } from "@/lib/llm";
import { storeCostGuard } from "@/lib/safety/cost-guard";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { getMemoryStore } from "@/lib/store/memory";

function post(url: string, body: unknown, cookie?: string): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

describe("POST /api/ask", () => {
  afterEach(() => setMockInjection(null));

  it("needs a known session and a valid body", async () => {
    expect((await POST(post("http://localhost/api/ask", { text: "hi" }))).status).toBe(400);
    expect((await POST(post("http://localhost/api/ask?session=nope", { text: "hi" }))).status).toBe(404);
    const s = await getMemoryStore().createSession();
    expect((await POST(post(`http://localhost/api/ask?session=${s.id}`, { text: "" }))).status).toBe(400);
    expect((await POST(post(`http://localhost/api/ask?session=${s.id}`, "{not json"))).status).toBe(400);
  });

  it("answers the hero question from the rp_session cookie, writes safety_event and pushes backstage events", async () => {
    const store = getMemoryStore();
    const s = await store.createSession();
    const res = await POST(post("http://localhost/api/ask", { text: "今天 150/95，我能不能多吃一粒？", locale: "zh-Hans" }, `${SESSION_COOKIE}=${s.id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.route).toBe("refuse_route");
    // D29 (the landing day): the seeded q-extra-tablet is reused, not duplicated (M4)
    expect(body.addedQuestionId).toBe("q-extra-tablet");
    expect(body.questionReused).toBe(true);
    expect(body.sentences.map((x: { sourceId: string }) => x.sourceId)).toEqual(expect.arrayContaining(["visit:v2:R4", "label:med-amlodipine"]));
    expect(await store.listSafetyEvents(s.id)).toHaveLength(1);
    const types = getBus().recent(s.id).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["ask.received", "ask.route", "verify.layer1", "verify.layer2", "verify.layer3", "question.updated", "ask.blocked", "ask.answered"]));
  });

  it("blocks an injected unsourced instruction through the global mock hook and reports it backstage", async () => {
    const s = await getMemoryStore().createSession();
    setMockInjection(() => [{ speechAct: "restate", sourceId: "", span: "", slots: {}, en: "You can take an extra tablet when your reading is high." }]);
    const res = await POST(post(`http://localhost/api/ask?session=${s.id}`, { text: "What is amlodipine for?", locale: "en" }));
    const body = await res.json();
    expect(body.blocked).toHaveLength(1);
    expect(JSON.stringify(body.sentences)).not.toContain("extra tablet");
    expect(getBus().recent(s.id).some((e) => e.type === "ask.blocked")).toBe(true);
  });

  it("returns 429 with Retry-After when the session's hourly cap is used up (counted in the store)", async () => {
    const store = getMemoryStore();
    const s = await store.createSession();
    // the hour's questions, used up in the store's own bucket (one guard per ask, as the route makes them)
    const cap = storeCostGuard(store, s).limits.requestsPerHour;
    for (let i = 0; i < cap; i++) await storeCostGuard(store, s).admit(s.id);
    const before = Date.now();
    const res = await POST(post(`http://localhost/api/ask?session=${s.id}`, { text: "What is amlodipine for?" }));
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    const body = await res.json();
    expect(body.limit).toBe("requests_per_hour");
    // retryAt is the next full hour on his clock
    const at = Date.parse(body.retryAt);
    expect(at).toBeGreaterThan(before);
    expect(Math.abs((at % 3_600_000) - 0) < 2000 || 3_600_000 - (at % 3_600_000) < 2000).toBe(true);
    // an emergency still gets 995
    const em = await POST(post(`http://localhost/api/ask?session=${s.id}`, { text: "我右手突然没力，说话也说不清楚" }));
    expect(em.status).toBe(200);
    expect(JSON.stringify(await em.json())).toContain("995");
  });

  it("has no role field: a body that still carries one is read without it (who asks is the server's to say)", async () => {
    const s = await getMemoryStore().createSession({ story_day: 29, ttl_hours: 1 });
    const res = await POST(post(`http://localhost/api/ask?session=${s.id}`, { text: "今天 150/95，我能不能多吃一粒？", locale: "zh-Hans", role: "backstage" }));
    expect(res.status).toBe(200);
    const ev = (await getMemoryStore().listSafetyEvents(s.id)).at(-1)!;
    expect((ev.output as { askedBy: string }).askedBy).toBe("patient");
  });
});
