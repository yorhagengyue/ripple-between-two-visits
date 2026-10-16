/**
 * /join says why a join was refused (components/session/JoinForm.tsx joinErrorMessage, 10-10 leftovers). Every refusal
 * is produced here by the real handlers: POST /api/session/join (lib/family/join.ts and its crew key check), the proxy
 * gate in front of it for Wei Ling's phone (lib/family/gate.ts), and lib/family/role.ts's own 403 and 503 answers. Each
 * is read back in his words (zh-Hans) and the crew's (en), as the form shows it from the response's status and `error`.
 * A network failure or an answer the page does not know keeps the general "could not join". No DOM: the form calls
 * joinErrorMessage with exactly those two values.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as joinPOST } from "@/app/api/session/join/route";
import { joinErrorMessage, joinFailure, type JoinFailure } from "@/components/session/JoinForm";
import { familyGate } from "@/lib/family/gate";
import { PATIENT_EXISTS, ROLE_NOT_JOINABLE } from "@/lib/family/join";
import { memberDirectory, membersFrom } from "@/lib/family/member-cache";
import { memberRequired, PATIENT_ONLY, roleUnavailable } from "@/lib/family/role";
import { t, type Locale } from "@/lib/i18n";
import { CREW_HEADER, MAX_WRONG_KEYS, resetCrewAttempts, WRONG_KEY_WINDOW_MS } from "@/lib/session/crew-key";
import { getMemoryStore } from "@/lib/store/memory";
import type { DemoSessionRow, MemberRole, SessionRow } from "@/lib/store/types";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";

const BASE = "http://localhost:3200";
const LOCALES: Locale[] = ["zh-Hans", "en"];

function join(code: string, role: string, opts: { cookie?: string; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  return new NextRequest(`${BASE}/api/session/join`, { method: "POST", headers, body: JSON.stringify({ code, role }) });
}

/** What the form reads from an answer: its status and the `error` field of its JSON body. */
async function seen(res: Response): Promise<{ status: number; error: unknown }> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return { status: res.status, error: body.error };
}

async function session(): Promise<DemoSessionRow> {
  return getMemoryStore().createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
}

async function device(s: SessionRow, role: MemberRole): Promise<string> {
  const m = await getMemoryStore().addMember(s.id, { role });
  return `rp_session=${s.id}; rp_member=${m.id}; rp_role=${role}`;
}

beforeEach(() => resetCrewAttempts());
afterEach(() => resetCrewAttempts());

/** Every refusal, from the real handlers, with what the page must say about it. */
async function refusals(): Promise<{ what: string; status: number; error: unknown; why: JoinFailure; zh: RegExp; en: RegExp }[]> {
  const s = await session();
  await device(s, "patient"); // his phone is in: no second phone can be him
  const her = await device(s, "family");
  const out: { what: string; status: number; error: unknown; why: JoinFailure; zh: RegExp; en: RegExp }[] = [];
  const add = async (what: string, res: Response | Promise<Response>, why: JoinFailure, zh: RegExp, en: RegExp) => out.push({ what, ...(await seen(await res)), why, zh, en });

  await add("a code no live session has", joinPOST(join("NOPE99", "family")), "code", /找不到这个加入码。.*场次结束以后/, /^No session has this code\. .*stops working when its session ends/);
  await add("a code too short to be one", joinPOST(join("AB", "family")), "code", /找不到这个加入码/, /No session has this code/);
  // a session whose time is over is not found by its code any more (lib/store/memory.ts getSessionByJoinCode)
  const over = await getMemoryStore().createSession({ ttl_hours: 1 / 3_600_000 }); // 1 ms
  await new Promise((r) => setTimeout(r, 5));
  await add("the code of a session that has ended", joinPOST(join(over.join_code, "family")), "code", /场次结束以后，码就不能用了/, /a code stops working when its session ends/);
  await add("a second phone as Mr Tan", joinPOST(join(s.join_code, "patient")), "patient_exists", /已经有陈先生的手机/, /already has Mr Tan's phone/);
  await add("backstage without the crew key", joinPOST(join(s.join_code, "backstage")), "crew_key_required", /拍摄组口令.*\/backstage\/crew/, /film crew's key.*\/backstage\/crew/);
  // one gate (C2 follow-up): a typed wrong key, and a client locked out for too many, are "not the crew" like no key
  await add("the director with a wrong key", joinPOST(join(s.join_code, "director", { headers: { [CREW_HEADER]: "letmein" } })), "crew_key_required", /拍摄组口令.*\/backstage\/crew/, /film crew's key.*\/backstage\/crew/);
  for (let i = 1; i < MAX_WRONG_KEYS; i++) await joinPOST(join(s.join_code, "director", { headers: { [CREW_HEADER]: `wrong-${i}` } }));
  await add("too many wrong keys from this client", joinPOST(join(s.join_code, "director", { headers: { [CREW_HEADER]: DEV_ONLY_CREW_KEY } })), "crew_key_required", /拍摄组口令.*\/backstage\/crew/, /film crew's key.*\/backstage\/crew/);
  await resetCrewAttempts();
  await add("a judge with the code", joinPOST(join(s.join_code, "judge")), "role_not_joinable", /评委的沙盒/, /judge's sandbox/);
  await add("her phone asking to be Mr Tan (the route)", joinPOST(join(s.join_code, "patient", { cookie: her })), "patient_only", /女儿 Wei Ling 的，只能以家属身份加入/, /already Wei Ling's.*family only/);
  const gate = await familyGate(join(s.join_code, "patient", { cookie: her }), memberDirectory(membersFrom(() => getMemoryStore())));
  expect(gate, "the gate answers her phone first").not.toBeNull();
  await add("her phone asking to be Mr Tan (the gate)", gate!, "patient_only", /只能以家属身份加入/, /family only/);
  await add("a device not in the session", memberRequired(), "member_required", /还不在这个场次里/, /not in this session yet/);
  await add("member rows that cannot be read", roleUnavailable(), "role_unavailable", /稍后再试/, /Try again in a moment/);
  return out;
}

describe("the join page says why a join was refused", () => {
  it("every refusal of the route and the gate, in his words and the crew's; none is the general message", async () => {
    const list = await refusals();
    // the codes are the handlers' own (a renamed code would fall back to the general message and fail here)
    expect(list.map((r) => r.error)).toEqual([
      "join_code_not_found",
      "invalid_body",
      "join_code_not_found",
      PATIENT_EXISTS,
      "crew_key_required",
      "crew_key_required",
      "crew_key_required",
      ROLE_NOT_JOINABLE,
      PATIENT_ONLY,
      PATIENT_ONLY,
      "member_required",
      "role_unavailable",
    ]);
    expect(list.map((r) => r.status)).toEqual([404, 400, 404, 403, 403, 403, 403, 403, 403, 403, 403, 503]);
    for (const r of list) {
      expect(joinFailure(r.status, r.error), r.what).toBe(r.why);
      const zh = joinErrorMessage("zh-Hans", r.status, r.error);
      const en = joinErrorMessage("en", r.status, r.error);
      expect(zh, r.what).toMatch(r.zh);
      expect(en, r.what).toMatch(r.en);
      expect(zh, r.what).not.toBe(t("zh-Hans", "join.failed"));
      expect(en, r.what).not.toBe(t("en", "join.failed"));
      // his page is Chinese: nothing English in it but names and the crew page's address
      expect(zh.replace(/Wei Ling|\/backstage\/crew/g, ""), r.what).not.toMatch(/[A-Za-z]{3,}/);
    }
  });

  it("each refusal reads differently, in both languages", async () => {
    const list = await refusals();
    for (const locale of LOCALES) {
      const byWhy = new Map<JoinFailure, string>();
      for (const r of list) byWhy.set(r.why, joinErrorMessage(locale, r.status, r.error));
      expect(new Set(byWhy.values()).size, locale).toBe(byWhy.size);
    }
  });

  it("the sign-in door's two answers keep their own words (a page that shows them says which it was), and the wait is the lockout's", () => {
    for (const locale of LOCALES) {
      const wrong = joinErrorMessage(locale, 403, "crew_key_wrong");
      const tooMany = joinErrorMessage(locale, 429, "crew_key_attempts");
      const need = joinErrorMessage(locale, 403, "crew_key_required");
      expect(new Set([wrong, tooMany, need, t(locale, "join.failed")]).size, locale).toBe(4);
    }
    expect(WRONG_KEY_WINDOW_MS / 60_000).toBe(10);
    expect(joinErrorMessage("en", 429, "crew_key_attempts")).toContain(`${WRONG_KEY_WINDOW_MS / 60_000} minutes`);
    expect(joinErrorMessage("zh-Hans", 429, "crew_key_attempts")).toContain(`${WRONG_KEY_WINDOW_MS / 60_000} 分钟`);
  });

  it("a network failure, a server error or an answer it does not know: the general message", () => {
    for (const locale of LOCALES) {
      for (const [status, error] of [
        [0, null],
        [500, undefined],
        [502, "upstream"],
        [403, "something_new"],
        [200, undefined], // 200 without `next`
      ] as const) {
        expect(joinFailure(status, error)).toBe("other");
        expect(joinErrorMessage(locale, status, error)).toBe(t(locale, "join.failed"));
      }
      // a 404 without a code is still "no session has this code"
      expect(joinErrorMessage(locale, 404, undefined)).toContain(t(locale, "join.notFound"));
    }
  });
});
