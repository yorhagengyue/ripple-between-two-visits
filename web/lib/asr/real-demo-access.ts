/**
 * Who may use the real-recording demo (lib/asr/real-demo.ts): the film crew only (real-app 5.2: the crew key as the
 * rp_crew cookie from /backstage/crew, or the x-ripple-crew-key header; lib/crew/gate.ts). A run holds the GPU for about
 * a minute and may spend on the main model. A filming-mode session no longer opens it by itself (the crew is the one
 * door). To anyone who is not the crew the routes answer 404, as if they did not exist (no credential, a stale cookie
 * and a wrong typed key alike). Server-only.
 */
import type { NextRequest, NextResponse } from "next/server";
import { crewGate } from "@/lib/crew/gate";
import { clientId } from "@/lib/session/crew-key";

export type DemoAccess = { ok: true; via: "crew"; owner: string } | { ok: false; res: NextResponse };

export async function demoAccess(req: NextRequest): Promise<DemoAccess> {
  const gate = await crewGate(req);
  if (gate) return { ok: false, res: gate };
  return { ok: true, via: "crew", owner: `crew:${clientId(req.headers)}` };
}
