/**
 * GET /api/crew/filming-account/accounts — the director's list of filming accounts (C2 track J; real-app 5.4 step 3).
 * Crew only (404 not_found for anyone else, lib/crew/gate.ts). Only the accounts their owners marked; an ordinary account
 * is never listed.
 *   200 { accounts: [{ ref, name, username, filming, laidOut, date, time, day, offsetMs, trackingSince, scene, sceneTitle }] }
 * `ref` is the account's code (lib/crew/filming-account.ts filmingRef), never its id; `day` is the story day (the crew's
 * word, never on his phone).
 */
import { NextResponse, type NextRequest } from "next/server";
import { listFilmingAccounts } from "@/lib/crew/filming-account";
import { crewGate } from "@/lib/crew/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const gate = await crewGate(req);
  if (gate) return gate;
  return NextResponse.json({ accounts: await listFilmingAccounts() });
}
