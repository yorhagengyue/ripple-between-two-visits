/**
 * How long a judge's copy stays on a browser (C2 track E, fix round of 10-11): the demo cookies (rp_session, rp_member,
 * rp_role) live as long as the copy has left, measured on the clock its expires_at was made with (the app's clock,
 * lib/time/now.ts; the store's own now).
 *
 * What happened on the real stack: a journey (06) left the developer test clock frozen at 2026-09-01 10:30 (Singapore).
 * The next judge's copy (journey 22) expired on 2026-09-03 by that clock; lib/session/http.ts measured that date against
 * the machine's Date.now(), in October, found it weeks in the past and gave the cookies its floor of 60 s. A minute into
 * /demo the browser dropped all three, and the phone's next POST /api/ask was a request with no device cookie naming a
 * session: 403 member_required. The journey read it as "the judge's own sentence never showed on the phone".
 */
import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST as sessionPOST } from "@/app/api/session/route";
import { FILMING_COOKIE_DAYS, SANDBOX_TTL_HOURS } from "@/lib/session/cookies";
import { setSessionCookies } from "@/lib/session/http";
import type { SessionMemberRow, SessionRow } from "@/lib/store/types";
import { nowMs, setTestClock } from "@/lib/time/now";

const BASE = "http://localhost:3200";
const COPY_S = SANDBOX_TTL_HOURS * 3600;
const THREE = ["rp_session", "rp_member", "rp_role"];

/** Max-Age of each cookie a response sets. */
function maxAges(res: Response): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of res.headers.getSetCookie()) {
    const age = /;\s*Max-Age=(\d+)/i.exec(line);
    if (age) out[line.slice(0, line.indexOf("="))] = Number(age[1]);
  }
  return out;
}

/** A judge opens /demo for the first time: POST /api/session, as components/landing/DemoReady sends it. */
async function newCopy(): Promise<{ res: Response; session: SessionRow; member: SessionMemberRow }> {
  const res = await sessionPOST(new NextRequest(`${BASE}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  expect(res.status).toBe(201);
  const body = (await res.clone().json()) as { session: SessionRow; member: SessionMemberRow };
  return { res, ...body };
}

afterEach(() => {
  setTestClock(null);
});

describe("the judge's copy and its cookies", () => {
  it("on real time the three cookies live as long as the copy: 48 h", async () => {
    const { res, session } = await newCopy();
    expect(Date.parse(session.expires_at!) - Date.now()).toBeGreaterThan((COPY_S - 10) * 1000);
    const ages = maxAges(res);
    for (const name of THREE) {
      expect(ages[name], name).toBeGreaterThan(COPY_S - 10);
      expect(ages[name], name).toBeLessThanOrEqual(COPY_S);
    }
  });

  it("with the test clock left frozen weeks back (2026-09-01 10:30, as journey 06 leaves it) they still live 48 h, not 60 s", async () => {
    setTestClock({ at: "2026-09-01T10:30:00+08:00", frozen: true });
    const { res, session } = await newCopy();
    // the copy's end is a date on the test clock, weeks before the machine's own time
    expect(session.expires_at).toBe("2026-09-03T02:30:00.000Z");
    expect(Date.parse(session.expires_at!)).toBeLessThan(Date.now());
    const ages = maxAges(res);
    for (const name of THREE) expect(ages[name], name).toBe(COPY_S);
  });

  it("with the test clock weeks ahead they live 48 h too, not the weeks in between", async () => {
    setTestClock({ at: Date.now() + 60 * 86_400_000 });
    const { res } = await newCopy();
    const ages = maxAges(res);
    for (const name of THREE) {
      expect(ages[name], name).toBeGreaterThan(COPY_S - 10);
      expect(ages[name], name).toBeLessThanOrEqual(COPY_S);
    }
  });

  it("a copy with less than a minute left keeps the 60 s floor; a filming session, which never ends, its 30 days", async () => {
    setTestClock({ at: "2026-09-01T10:30:00+08:00", frozen: true });
    const { session, member } = await newCopy();
    const ending = NextResponse.json({});
    setSessionCookies(ending, { ...session, expires_at: new Date(nowMs() + 5_000).toISOString() }, member);
    for (const name of THREE) expect(maxAges(ending)[name], name).toBe(60);
    const filming = NextResponse.json({});
    setSessionCookies(filming, { ...session, expires_at: null }, member);
    for (const name of THREE) expect(maxAges(filming)[name], name).toBe(FILMING_COOKIE_DAYS * 24 * 3600);
  });
});
