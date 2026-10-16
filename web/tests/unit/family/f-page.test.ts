/**
 * /f itself (app/f/page.tsx; M6 privacy, B1 wrap-up 10-10), rendered as a server component with the page session
 * mocked, so no proxy is in front:
 *   - who the device is comes from its member row (lib/family/role.ts pageIdentity), not from rp_role: her phone with a
 *     forged rp_role=patient is still "family" for PatientFrame (no jump menu for her); a judge's sandbox opening /f
 *     is "judge" (it keeps the menu);
 *   - a device with no row in a session she has joined is sent to /join before anything is read;
 *   - the session row the page hands to its client side carries what /f uses only: never the join code.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ReactElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getMemoryStore } from "@/lib/store/memory";
import type { MemberRole, SessionRow } from "@/lib/store/types";

const pageSession = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/session/server", () => ({
  getPatientLocale: async () => "zh-Hans",
}));
vi.mock("@/lib/subject", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subject")>()),
  getPageSubject: async () => pageSession.ctx,
}));
import { demoSubject, pageSubjectFor } from "@/lib/subject";
// imported after the mock is registered (vi.mock is hoisted above every import)
import FamilyPage from "@/app/f/page";

const savedEnv = { ...process.env };
let blobDir: string;
beforeAll(() => {
  blobDir = mkdtempSync(path.join(tmpdir(), "ripple-f-page-"));
  process.env.BLOB_LOCAL_DIR = blobDir;
  delete process.env.BLOB_DRIVER;
});
afterAll(() => {
  process.env = savedEnv;
  rmSync(blobDir, { recursive: true, force: true });
});

type El = ReactElement<Record<string, unknown>>;

async function render(s: SessionRow, memberId: string | null, role: string | null): Promise<{ provider: El; frame: El }> {
  pageSession.ctx = pageSubjectFor(demoSubject(getMemoryStore(), s), { role, memberId, since: 0 });
  try {
    const provider = (await FamilyPage()) as El;
    return { provider, frame: provider.props.children as El };
  } finally {
    pageSession.ctx = null;
  }
}

async function redirected(s: SessionRow, memberId: string | null, role: string | null): Promise<string> {
  pageSession.ctx = pageSubjectFor(demoSubject(getMemoryStore(), s), { role, memberId, since: 0 });
  try {
    await FamilyPage();
    return "rendered";
  } catch (err) {
    const digest = String((err as { digest?: unknown }).digest ?? "");
    return digest.startsWith("NEXT_REDIRECT;") ? (digest.split(";")[2] ?? "") : `threw ${String(err)}`;
  } finally {
    pageSession.ctx = null;
  }
}

async function session(): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: 41, story_time: "20:15", ttl_hours: 1 });
}
const member = async (s: SessionRow, role: MemberRole) => (await getMemoryStore().addMember(s.id, { role })).id;

describe("/f: the member row decides, and the join code is not in the page", () => {
  it("her phone (even with rp_role=patient) is family for the frame; a judge's sandbox is judge; the row has no join code", async () => {
    const s = await session();
    const her = await member(s, "family");
    for (const cookieRole of ["family", "patient", "judge", null]) {
      const { provider, frame } = await render(s, her, cookieRole);
      expect(frame.props.variant).toBe("family");
      expect(frame.props.role, String(cookieRole)).toBe("family");
      const row = provider.props.session as Record<string, unknown>;
      expect(Object.keys(row).sort()).toEqual(["filming_mode", "id", "story_day", "story_time"]);
      expect(JSON.stringify(row)).not.toContain(s.join_code);
    }
    const judge = await member(s, "judge");
    expect((await render(s, judge, "family")).frame.props.role).toBe("judge");
  });

  it("in a session nobody joined as family the cookie still counts (the e2e harness's phones)", async () => {
    const s = await session();
    expect((await render(s, null, "family")).frame.props.role).toBe("family");
    expect((await render(s, null, null)).frame.props.role).toBeNull();
  });

  it("once she has joined, a device with no row in his session is sent to /join", async () => {
    const s = await session();
    await member(s, "family");
    for (const role of ["family", "patient", "judge", null]) expect(await redirected(s, null, role), String(role)).toBe("/join");
    expect(await redirected(s, "no-such-member", "family")).toBe("/join");
  });
});
