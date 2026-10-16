/**
 * GET /api/push/key — this server's VAPID public key (C2 track I; lib/push/vapid.ts): a browser subscribes with it
 * (PushManager.subscribe({ applicationServerKey })). Public by nature; nothing else in the answer.
 *   200 { publicKey }    base64url, 65 bytes uncompressed
 *   503 push_unavailable  no keys here (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set and the developer tools off)
 * Not cached: a development process makes its own pair.
 */
import { NextResponse } from "next/server";
import { vapidConfig } from "@/lib/push/vapid";
import { jsonError } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const vapid = vapidConfig();
  if (!vapid) return jsonError(503, "push_unavailable");
  return NextResponse.json({ publicKey: vapid.publicKey }, { headers: { "Cache-Control": "no-store" } });
}
