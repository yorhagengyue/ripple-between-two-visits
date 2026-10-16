/**
 * session.member_joined without the member's id (M6 privacy, 10-10 leftovers). A member row's id is that device's
 * rp_member cookie, its credential: GET /api/session already lists members without it, and the join event now carries
 * the same three fields (lib/session/members.ts memberView: role, device_label, created_at). Checked where the event
 * goes: the bus itself, every stream on his side (the judge's sandbox device and his phone) live and on a replay after
 * Last-Event-ID, the page renders' recent events (lib/session/server.ts recentEvents, for /backstage, /director and the
 * landing feed) and her stream. The joining device itself still gets its own row, id included, with its cookies.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as eventsGET } from "@/app/api/events/route";
import { POST as joinPOST } from "@/app/api/session/join/route";
import { GET as sessionGET, POST as sessionPOST } from "@/app/api/session/route";
import { renderEvent } from "@/components/backstage/sentences";
import { getBus, type BusEvent } from "@/lib/bus";
import { CREW_HEADER, resetCrewAttempts } from "@/lib/session/crew-key";
import { MEMBER_VIEW_FIELDS, memberView } from "@/lib/session/members";
import { recentEvents } from "@/lib/session/server";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";

const BASE = "http://localhost:3200";
const decoder = new TextDecoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function post(p: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${BASE}${p}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

/** The name=value pairs a response set, as the Cookie header the browser sends back. */
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";", 1)[0])
    .join("; ");

/** A judge's sandbox as the landing page makes it: POST /api/session, the creating device's own judge row. */
async function sandbox(): Promise<{ id: string; code: string; judge: { cookie: string; member: string } }> {
  const res = await sessionPOST(post("/api/session", { story_day: 29, story_time: "20:15" }));
  expect(res.status).toBe(201);
  const body = (await res.json()) as { session: { id: string; join_code: string }; member: { id: string } };
  return { id: body.session.id, code: body.session.join_code, judge: { cookie: cookieOf(res), member: body.member.id } };
}

/** Join with the code through the route; the device's cookie and its own row as the route returns them. */
async function join(code: string, role: string, label: string, headers: Record<string, string> = {}) {
  const res = await joinPOST(post("/api/session/join", { code, role, device_label: label }, headers));
  expect(res.status, `${role}: ${res.status}`).toBe(200);
  const body = (await res.json()) as { member: { id: string; role: string; device_label: string | null; created_at: string } };
  return { cookie: cookieOf(res), member: body.member };
}

/** Everything a stream sends, collected in the background. */
function collect(body: ReadableStream<Uint8Array>): { text(): string } {
  let text = "";
  const reader = body.getReader();
  void (async () => {
    for (;;) {
      const r = await reader.read();
      if (r.done) return;
      text += decoder.decode(r.value, { stream: true });
    }
  })().catch(() => {});
  return { text: () => text };
}

async function stream(sessionId: string, cookie: string, signal: AbortSignal, lastEventId?: number) {
  const headers: Record<string, string> = { cookie };
  if (lastEventId !== undefined) headers["last-event-id"] = String(lastEventId);
  const res = await eventsGET(new NextRequest(`${BASE}/api/events?session=${sessionId}`, { headers, signal }));
  expect(res.status).toBe(200);
  return collect(res.body!);
}

/** The session.member_joined events in a stream's text. */
const joinedFrames = (text: string): BusEvent[] =>
  text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)) as BusEvent)
    .filter((e) => e.type === "session.member_joined");

const crew = { [CREW_HEADER]: DEV_ONLY_CREW_KEY };

beforeEach(() => resetCrewAttempts());
afterEach(() => resetCrewAttempts());

describe("session.member_joined: the new device's role, label and time, never its id", () => {
  it("on the bus: exactly the three fields of the members list; the id appears nowhere in the event", async () => {
    const s = await sandbox();
    const his = await join(s.code, "patient", "Mr Tan's phone");
    // the joining device itself: its own row, id included, and the same id as its rp_member cookie
    expect(his.member.id).toMatch(/\S/);
    expect(his.cookie).toContain(`rp_member=${his.member.id}`);

    const joined = getBus()
      .recent(s.id)
      .filter((e) => e.type === "session.member_joined");
    expect(joined).toHaveLength(1);
    const data = joined[0].data as { member: Record<string, unknown> };
    expect(Object.keys(data)).toEqual(["member"]);
    expect(Object.keys(data.member).sort()).toEqual([...MEMBER_VIEW_FIELDS].sort());
    expect(data.member).toEqual({ role: "patient", device_label: "Mr Tan's phone", created_at: his.member.created_at });
    expect(JSON.stringify(joined[0])).not.toContain(his.member.id);
    // what the backstage feed shows still reads from the event's own data
    expect(renderEvent(joined[0]).sentence).toBe("Mr Tan's phone joined.");

    // the same shape GET /api/session lists (one function makes both)
    const list = (await (await sessionGET(new NextRequest(`${BASE}/api/session?session=${s.id}`, { headers: { cookie: his.cookie } }))).json()) as {
      members: Record<string, unknown>[];
    };
    expect(list.members).toContainEqual(data.member);
    for (const m of list.members) expect(Object.keys(m).sort()).toEqual([...MEMBER_VIEW_FIELDS].sort());
  });

  it("memberView keeps only role, device_label and created_at", () => {
    const row = { id: "m-secret", session_id: "s-1", role: "family" as const, device_label: "Wei Ling", created_at: "2026-10-10T03:00:00.000Z", extra: 1 };
    expect(memberView(row)).toEqual({ role: "family", device_label: "Wei Ling", created_at: "2026-10-10T03:00:00.000Z" });
    expect(JSON.stringify(memberView(row))).not.toContain("m-secret");
  });

  it("his side's streams (the judge's sandbox device, his phone) see who joined, live and on a replay, and no member id at all", async () => {
    const s = await sandbox();
    const his = await join(s.code, "patient", "Mr Tan's phone");
    const live = new AbortController();
    const judgeStream = await stream(s.id, s.judge.cookie, live.signal);
    const hisStream = await stream(s.id, his.cookie, live.signal);
    await sleep(20);
    const her = await join(s.code, "family", "Wei Ling's phone");
    const backstage = await join(s.code, "backstage", "crew laptop", crew);
    const herStream = await stream(s.id, her.cookie, live.signal);
    const director = await join(s.code, "director", "director laptop", crew);
    await sleep(60);
    live.abort();

    const ids = [s.judge.member, his.member.id, her.member.id, backstage.member.id, director.member.id];
    for (const [who, text] of [
      ["judge", judgeStream.text()],
      ["his phone", hisStream.text()],
    ] as const) {
      const frames = joinedFrames(text);
      expect(frames.map((e) => (e.data as { member: { role: string } }).member.role), who).toEqual(["family", "backstage", "director"]);
      for (const e of frames) expect(Object.keys((e.data as { member: object }).member).sort(), who).toEqual([...MEMBER_VIEW_FIELDS].sort());
      for (const id of ids) expect(text, `${who} stream carries a member id`).not.toContain(id);
    }
    // her stream drops the type altogether (lib/family/events.ts), and has no member id either
    expect(joinedFrames(herStream.text())).toEqual([]);
    for (const id of ids) expect(herStream.text()).not.toContain(id);

    // a reconnect from the start replays the history (the memory bus keeps it): still no ids
    const again = new AbortController();
    const replay = await stream(s.id, s.judge.cookie, again.signal, 0);
    await sleep(30);
    again.abort();
    expect(joinedFrames(replay.text()).map((e) => (e.data as { member: { role: string } }).member.role)).toEqual(["patient", "family", "backstage", "director"]);
    for (const id of ids) expect(replay.text()).not.toContain(id);

    // the events a page renders with (the backstage feed, the director's console, the judges' landing)
    const rendered = JSON.stringify(recentEvents(s.id, 200));
    expect(rendered).toContain("session.member_joined");
    for (const id of ids) expect(rendered).not.toContain(id);
  });
});
