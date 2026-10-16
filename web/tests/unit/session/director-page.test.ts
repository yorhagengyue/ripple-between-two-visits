/**
 * /director (app/director/page.tsx; 10-10): the members the page hands to its client component DirectorConsole are
 * lib/session/members.ts memberView rows (role, label, joined time). A member row's id is that device's rp_member cookie,
 * its credential, and any device on his side can open /director, so the page's props (the RSC data the browser gets)
 * carry no member id: not in the member list, not in the recent events next to it. Rendered as a server component with
 * the page session mocked, like tests/unit/family/f-page.test.ts.
 */
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { DirectorConsole } from "@/components/director/DirectorConsole";
import { LiveSessionProvider } from "@/components/live/LiveSession";
import { MEMBER_VIEW_FIELDS } from "@/lib/session/members";
import { createSessionWithMember, joinSession } from "@/lib/session/ops";
import { getMemoryStore } from "@/lib/store/memory";

const pageSession = vi.hoisted(() => ({ ctx: null as unknown }));
// the page is the crew's (lib/crew/gate.ts): this test renders it as the crew's browser
vi.mock("@/lib/crew/gate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crew/gate")>()),
  requireCrewPage: async () => undefined,
  isCrewPage: async () => true,
}));
vi.mock("@/lib/subject", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subject")>()),
  getDemoPageSubject: async () => pageSession.ctx,
}));
import { demoSubject, pageSubjectFor } from "@/lib/subject";
// imported after the mock is registered (vi.mock is hoisted above every import)
import DirectorPage from "@/app/director/page";

type El = ReactElement<Record<string, unknown>>;

/** The first element of `type` under `node`, looking through children and element-valued props. */
function findElement(node: unknown, type: unknown): El | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findElement(n, type);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as El;
  if (el.type === type) return el;
  if (!el.props || typeof el.props !== "object") return null;
  for (const value of Object.values(el.props)) {
    const hit = findElement(value, type);
    if (hit) return hit;
  }
  return null;
}

describe("/director: the page's props carry no member id", () => {
  it("the members are role, label and joined time only; no id of any device is in the console's props", async () => {
    const { session, member: director } = await createSessionWithMember(getMemoryStore(), { kind: "filming", role: "director", story_day: 42, story_time: "09:30" });
    const joined: { id: string }[] = [];
    for (const role of ["patient", "family", "backstage"] as const) {
      const out = await joinSession(getMemoryStore(), { code: session.join_code, role, device_label: `${role} phone` });
      joined.push(out!.member);
    }
    const ids = [director.id, ...joined.map((m) => m.id)];
    expect(await getMemoryStore().listMembers(session.id)).toHaveLength(4);

    pageSession.ctx = pageSubjectFor(demoSubject(getMemoryStore(), session), { role: "director", memberId: director.id, since: 0 });
    let page: El;
    try {
      page = (await DirectorPage()) as El;
    } finally {
      pageSession.ctx = null;
    }
    const consoleEl = findElement(page, DirectorConsole);
    expect(consoleEl, "DirectorConsole in the page").not.toBeNull();
    const members = consoleEl!.props.members as Record<string, unknown>[];
    expect(members).toHaveLength(4);
    for (const m of members) expect(Object.keys(m).sort()).toEqual([...MEMBER_VIEW_FIELDS].sort());
    expect(members.map((m) => m.role).sort()).toEqual(["backstage", "director", "family", "patient"]);
    // the console's whole props (members and the recent events, the three session.member_joined among them)
    const props = JSON.stringify(consoleEl!.props);
    expect((consoleEl!.props.initialEvents as { type: string }[]).filter((e) => e.type === "session.member_joined")).toHaveLength(3);
    for (const id of ids) expect(props, id).not.toContain(id);
    // and the provider next to it hands over the session row, never a member row
    const provider = findElement(page, LiveSessionProvider);
    for (const id of ids) expect(JSON.stringify(provider!.props.session), id).not.toContain(id);
  });
});
