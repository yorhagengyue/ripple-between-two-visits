/**
 * The real-recording demo (plan item 4, acceptance 4.3; lib/asr/real-demo.ts). PriMock57 mock consultations
 * (CC BY 4.0), the real Whisper service, the main model's checked labels, the safety layer; nothing is stored in any
 * session.
 *
 * The crew's only (lib/asr/real-demo-access.ts, lib/crew/gate.ts): without the crew's cookie or key every method
 * answers 404 not_found, as if the route did not exist (real-app 5.2), a wrong typed key included.
 *
 * GET /api/real — the dataset credit (manifest `credit`, en and zh), the five consultations (whether each is
 * on this machine), whether the Whisper service can be used now (configured / ready, never its address or token),
 * how items are extracted (rules, or rules + the main model), that this caller may run it, and the run in progress.
 *
 * POST /api/real { consultation } — starts a run, 202 { job_id }; poll GET /api/real/<job_id>. 400 bad id, 404 data_missing (run
 * scripts/data/fetch_primock57.mjs), 503 whisper_unavailable { reason } (not configured, not answering, loading,
 * stuck, token refused), 429 busy { job_id } while another run holds the GPU (the slot is taken atomically, before
 * the service is asked, so two requests at once never both start).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { demoAccess } from "@/lib/asr/real-demo-access";
import { CONSULTATION_ID, DEMO_CREDIT, DEMO_DATASET, demoConsultations, demoWhisperProblem, launchDemo, releaseDemo, reserveDemo, runningDemo } from "@/lib/asr/real-demo";
import { mainModel, mainProviderKind } from "@/lib/llm";
import { jsonError, parseBody } from "@/lib/session/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ consultation: z.string().regex(CONSULTATION_ID) }).strict();

function extractionMode(): { mode: "rules" | "rules+model"; provider: string; model: string | null } {
  const kind = mainProviderKind();
  return kind === "mock" ? { mode: "rules", provider: "mock", model: null } : { mode: "rules+model", provider: kind, model: mainModel() };
}

export async function GET(req: NextRequest): Promise<Response> {
  const access = await demoAccess(req);
  if (!access.ok) return access.res;
  // one /health probe per few seconds however often the page is opened (lib/asr/real-demo.ts PROBE_CACHE_MS)
  const problem = await demoWhisperProblem();
  const running = runningDemo();
  return NextResponse.json({
    credit: DEMO_CREDIT,
    dataset: DEMO_DATASET,
    consultations: demoConsultations(),
    whisper: { usable: problem === null, reason: problem },
    extraction: extractionMode(),
    access: { allowed: true, via: access.via },
    running: running ? { job_id: running.id, consultation: running.consultation, state: running.state } : null,
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const access = await demoAccess(req);
  if (!access.ok) return access.res;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.res;
  const id = parsed.data.consultation;
  const c = demoConsultations().find((x) => x.id === id);
  if (!c) return jsonError(400, "unknown_consultation", "not one of the five in fixtures/real/primock57.manifest.json");
  if (!c.available) return jsonError(404, "data_missing", "the recording is not on this machine: run node scripts/data/fetch_primock57.mjs in web/");
  // the slot is taken before anything is awaited: two requests at the same moment get one 202 and one 429
  const slot = reserveDemo(id, access.owner);
  if ("busy" in slot) return NextResponse.json({ error: "busy", job_id: slot.busy.id }, { status: 429, headers: { "Retry-After": "10" } });
  let problem: string | null;
  try {
    problem = await demoWhisperProblem({ fresh: true });
  } catch {
    problem = "unreachable";
  }
  if (problem) {
    releaseDemo(slot.job);
    return NextResponse.json({ error: "whisper_unavailable", reason: problem }, { status: 503 });
  }
  const job = launchDemo(slot.job);
  console.log(`[real-demo] ${id} started by ${access.via}`);
  return NextResponse.json({ job_id: job.id, state: job.state }, { status: 202 });
}
