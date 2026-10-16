/**
 * GET /api/me/export/recording?visit=<visit id>[&part=<n>] — his own visit recording, to listen to (C2 track H;
 * docs/plan/real-app.md 3.9 「浏览器只拿服务端签的 10 分钟链接；签之前检查路径属于这个主体」).
 *
 * C2 track R: a long recording is several files (lib/visit/recording.ts). Without `part` this is the first one, as
 * before; `part=1`, `part=2` ... are the following ones, and the player goes through them one after another
 * (components/ui ListenBar `more`). A part the recording does not have is 404 like any other missing recording.
 *
 *   302  Location: a link to the recording signed for 10 minutes, made for this request
 *   401  not_signed_in
 *   404  no_recording   no such visit of his, no recording of his own for it (a stand-in clip is not his recording), or
 *                       the file is gone (deleted after its 90 days)
 *
 * His pages put this address in the player instead of a signed link, so a page left open for an hour still plays: every
 * play asks here and gets a fresh short link. Signed in as himself only; the path is his visit's own recording under his
 * storage prefix (lib/privacy/retention.ts ownedAudio), never a path the browser sent.
 */
import type { NextRequest } from "next/server";
import { json } from "@/lib/auth/http";
import { getBlobStore, READ_LINK_SECONDS } from "@/lib/blob";
import { errorCode, log } from "@/lib/log";
import { ownedAudio } from "@/lib/privacy/retention";
import { requireUser } from "@/lib/subject";
import { realNowMs } from "@/lib/time/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/me/export/recording";

export async function GET(req: NextRequest): Promise<Response> {
  const t0 = realNowMs();
  const found = await requireUser(req);
  if (!found.ok) return found.res;
  const { user, scope, store } = found;
  const visitId = req.nextUrl.searchParams.get("visit")?.trim() ?? "";
  const none = () => json({ error: "no_recording" }, 404);
  if (!scope || !visitId) return none();
  try {
    const partRaw = req.nextUrl.searchParams.get("part");
    const part = partRaw === null ? 0 : /^\d{1,3}$/.test(partRaw) ? Number(partRaw) : -1;
    if (part < 0) return none();
    const visit = await store.getVisit(scope.id, visitId);
    const recording = visit ? (ownedAudio(scope, visit, []).files[part] ?? null) : null;
    if (!recording) return none();
    let link: string;
    try {
      link = await getBlobStore().signedReadUrl("audio", recording, READ_LINK_SECONDS);
    } catch (err) {
      const e = err as { name?: unknown; code?: unknown } | null;
      if (e && e.name === "BlobError" && e.code === "not_found") return none();
      throw err;
    }
    // the local driver's links are paths on this site; Supabase Storage's are absolute
    const location = link.startsWith("/") ? new URL(link, req.nextUrl.origin).toString() : link;
    log("info", "me.recording", { route: ROUTE, method: "GET", status: 302, ms: realNowMs() - t0, user: user.userId });
    return new Response(null, { status: 302, headers: { location, "cache-control": "private, no-store" } });
  } catch (err) {
    log("error", "me.recording", { route: ROUTE, method: "GET", status: 500, ms: realNowMs() - t0, code: errorCode(err), user: user.userId });
    return json({ error: "recording_failed" }, 500);
  }
}
