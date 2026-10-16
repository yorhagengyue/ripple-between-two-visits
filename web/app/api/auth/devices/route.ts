/**
 * GET /api/auth/devices (signed in) -> 200 { devices: DeviceView[] }: the devices he signed in on, this one first, each
 * with whether a sign-in is still open there. No device id or hash leaves the server, only an opaque `ref` the sign-out
 * call names (POST /api/auth/devices/sign-out). 401 not_signed_in.
 */
import type { NextRequest } from "next/server";
import { accountRoute, json, requestFacts } from "@/lib/auth/http";
import { listDevices } from "@/lib/auth/service";
import { accountDeps, currentUser } from "@/lib/subject/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = accountRoute(async (req: NextRequest): Promise<Response> => {
  const me = await currentUser(req);
  if (!me) return json({ error: "not_signed_in" }, 401);
  return json({ devices: await listDevices(accountDeps(), me, requestFacts(req)) });
});
