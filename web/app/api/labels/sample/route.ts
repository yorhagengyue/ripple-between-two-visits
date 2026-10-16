/**
 * GET /api/labels/sample?name=amlodipine|ibuprofen|relative_box — one of the synthetic label photos in
 * web/fixtures/labels, for a judge or a demo without a real label at hand. The browser then uploads these bytes
 * through the same signed link as a camera photo, so the sample takes exactly the real path.
 * C2: a blank account gets 403 example_only (the samples are Mr Tan's, for the demo and the example account only; C2
 * track J: and for a filming account when the film crew asks).
 * name=losartan (real-app 4.6: the label of the medicine the example's sample visit prescribes) is for those accounts
 * only; the demo keeps its three samples (404 unknown_sample there).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { ACCOUNT_SAMPLE_LABELS, SAMPLE_LABELS } from "@/lib/meds/samples";
import { isCrew } from "@/lib/crew/gate";
import { isAccount, samplesAllowed } from "@/lib/store/scope";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  // C2 (real-app 6.9): the sample photos are for the demo and the example account; his own blank account photographs
  // his own labels (403 example_only). A request without any session is the judges' landing warming up: allowed.
  // C2 track J (filming): a filming account may use them too when the request is the film crew's (lib/crew/gate.ts)
  const found = await requireSubject(req);
  if (found.ok && isAccount(found.session) && !samplesAllowed(found.session, await isCrew(req))) return Response.json({ error: "example_only" }, { status: 403 });
  const name = req.nextUrl.searchParams.get("name") ?? "";
  // an account that may use samples also has the example's own one (losartan); the demo's list is unchanged
  const offered: readonly string[] = found.ok && isAccount(found.session) ? ACCOUNT_SAMPLE_LABELS : SAMPLE_LABELS;
  if (!offered.includes(name)) return Response.json({ error: "unknown_sample" }, { status: 404 });
  const bytes = await readFile(path.join(process.cwd(), "fixtures", "labels", `${name}.png`));
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" } });
}
