/**
 * npm run preflight [-- --url https://preview.example]
 *
 * Walks docs/plan/web-app.md section 2 ("开工前要人先做的") item by item and says what works.
 * - Reads web/.env if it exists. Prints only whether a variable is set, never its value.
 * - A check whose keys are missing prints SKIP and the run continues (no keys = everything SKIPs and
 *   the app still runs on stub / mock / in-memory).
 * - TODO means the keys are there but the adapter that would use them is not built yet.
 * - Exit code 1 only when a check FAILs.
 *
 * Network: with no keys and no --url it makes no network calls at all. With LLM_PROVIDER=hunyuan (or openai) and
 * its key, and with CHECKER_PROVIDER=hunyuan, one GET /models at that provider per key (free: no tokens; TokenHub
 * answers it as OpenAI does; the key is never printed, see checkModels); with Supabase keys one REST call; with --url
 * (or PREVIEW_URL) it calls the deployed app: GET /, GET /api/health, a 30-second wait, one throwaway
 * sandbox session read back five times, one event over /api/events, a 4 MB upload. The session calls
 * carry the sandbox's own device cookies, as a phone's browser does (see checkSharedState).
 */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkerConfig, hunyuanSettings, mainModel, mainProviderKind, VENDORS, vendorKey } from "@/lib/llm";
import { MemoryStore } from "@/lib/store/memory";
import { buildSeedTables, loadTemplate } from "@/lib/story/seed";
import { TtsError } from "@/lib/tts";
import { createTrtcTts, trtcTtsConfig } from "@/lib/tts/trtc";
import { keySource, parseEnvFile } from "./llm/env-check";

type Status = "PASS" | "SKIP" | "TODO" | "FAIL";
interface Result {
  status: Status;
  name: string;
  detail: string;
}

const WEB = path.resolve(__dirname, "..");
const results: Result[] = [];

function record(status: Status, name: string, detail: string): void {
  results.push({ status, name, detail });
  console.log(`  ${status.padEnd(4)}  ${name.padEnd(36)} ${detail}`);
}

function isSet(name: string): boolean {
  return (process.env[name] ?? "").trim() !== "";
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function missing(names: string[]): string[] {
  return names.filter((n) => !isSet(n));
}

async function timed<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

function argUrl(): string | null {
  const argv = process.argv.slice(2);
  const i = argv.findIndex((a) => a === "--url" || a.startsWith("--url="));
  if (i >= 0) return argv[i].includes("=") ? argv[i].split("=")[1] : (argv[i + 1] ?? null);
  return env("PREVIEW_URL") || null;
}

// ------------------------------------------------------------------ local data (no keys needed)

async function checkLocal(): Promise<void> {
  console.log("\nLocal data and in-memory mode");
  try {
    const seed = loadTemplate();
    const t = buildSeedTables("preflight", new Date().toISOString());
    record(
      "PASS",
      "timeline.seed.json",
      `D0 ${seed.meta.d0}; ${t.visits.length} visits, ${t.dose_logs.length} doses, ${t.bp_readings.length} readings, ${t.questions.length} questions`,
    );
  } catch (err) {
    record("FAIL", "timeline.seed.json", (err as Error).message);
  }

  try {
    const store = new MemoryStore();
    const s = await store.createSession();
    const before = await store.listDoses(s.id);
    await store.logDose(s.id, { medication_id: "med-amlodipine", day: 29, slot: "morning", state: "missed" });
    await store.resetSession(s.id);
    const after = await store.listDoses(s.id);
    const same = JSON.stringify(before.map((d) => [d.day, d.state])) === JSON.stringify(after.map((d) => [d.day, d.state]));
    record(same ? "PASS" : "FAIL", "in-memory store (STORE=memory)", same ? "create, write, reset restore the seed" : "reset did not restore the seed");
  } catch (err) {
    record("FAIL", "in-memory store (STORE=memory)", (err as Error).message);
  }

  const kbFiles = ["drugs.json", "referrals.json", "screening.json", "sources.json", "glossary.json", "patient_text.json"];
  const kbBad = kbFiles.filter((f) => {
    try {
      JSON.parse(readFileSync(path.join(WEB, "kb", f), "utf8"));
      return false;
    } catch {
      return true;
    }
  });
  record(kbBad.length ? "FAIL" : "PASS", "knowledge base files (web/kb)", kbBad.length ? `unreadable: ${kbBad.join(", ")}` : `${kbFiles.length} JSON files parse`);

  const visitsDir = path.join(WEB, "fixtures", "visits");
  const utterances = existsSync(visitsDir) ? readdirSync(visitsDir).filter((f) => f.endsWith(".utterances.json")) : [];
  const clipsDir = path.join(visitsDir, "clips");
  const clips = existsSync(clipsDir) ? readdirSync(clipsDir).filter((f) => f.endsWith(".wav")) : [];
  record(
    utterances.length ? "PASS" : "FAIL",
    "visit replays (SPEECH_PROVIDER=mock)",
    `${utterances.length} utterance files, ${clips.length} stand-in clips`,
  );

  const labelsDir = path.join(WEB, "fixtures", "labels");
  const labels = existsSync(labelsDir) ? readdirSync(labelsDir).filter((f) => f.endsWith(".png")) : [];
  record(labels.length ? "PASS" : "FAIL", "label photos (fixtures/labels)", `${labels.length} synthetic photos`);

  try {
    const lines = readFileSync(path.join(WEB, "eval", "seed.jsonl"), "utf8").split("\n").filter((l) => l.trim());
    lines.forEach((l) => JSON.parse(l));
    const thresholds = JSON.parse(readFileSync(path.join(WEB, "eval", "thresholds.json"), "utf8")) as { status?: string };
    record("PASS", "eval seed and thresholds", `${lines.length} seed questions; thresholds: ${thresholds.status ?? "no status"}`);
  } catch (err) {
    record("FAIL", "eval seed and thresholds", (err as Error).message);
  }
}

// ------------------------------------------------------------------ section 2 items that need keys

async function checkSpeech(): Promise<void> {
  console.log("\nTencent speech (TRTC only; items 2-4)");
  const asr = missing(["TRTC_SDK_APP_ID", "TRTC_SDK_SECRET_KEY"]);
  const speechProvider = env("SPEECH_PROVIDER") || "mock";
  if (asr.length) record("SKIP", "TRTC speech recognition", `${asr.join(", ")} not set; SPEECH_PROVIDER=${speechProvider}`);
  else record("TODO", "TRTC speech recognition", "keys set; the trtc SpeechProvider (lib/asr, M2) is not built yet, so no 10 s sample is sent");

  // C2 track T: read-aloud signs with a cloud API key pair (TENCENT_SECRET_ID / TENCENT_SECRET_KEY) and the application
  // id, not with TRTC_SDK_SECRET_KEY (lib/tts/trtc.ts). Chosen and complete: one short Mandarin sentence is really
  // synthesised (a paid request; web-app.md section 2 「TTS 能合成一句华语」). Preflight cannot hear it: scripts/tts/say.ts
  // writes the audio to a file for a person to listen to.
  const ttsProvider = env("TTS_PROVIDER") || "mock";
  if (ttsProvider !== "trtc") record("SKIP", "TRTC text to speech", `TTS_PROVIDER=${ttsProvider} (a placeholder tone per character, not a voice)`);
  else {
    const cfg = trtcTtsConfig(process.env);
    if (!cfg.ok) record("FAIL", "TRTC text to speech", `TTS_PROVIDER=trtc cannot speak: ${cfg.problems.join("; ")}`);
    else {
      try {
        const audio = await createTrtcTts(process.env).synthesize({ text: "你好，这是朗读的预检。", lang: "zh-Hans" });
        record("PASS", "TRTC text to speech", `one Mandarin sentence came back: ${(audio.durationMs / 1000).toFixed(1)} s of ${audio.mime}, ${audio.audio.byteLength} bytes (not listened to: scripts/tts/say.ts)`);
      } catch (err) {
        record("FAIL", "TRTC text to speech", err instanceof TtsError ? `${err.code}: ${err.message}` : (err as Error).name);
      }
    }
  }

  if (isSet("ADP_APP_KEY")) record("TODO", "ADP knowledge base (optional)", "ADP_APP_KEY set; ADP retrieval is not wired");
  else record("SKIP", "ADP knowledge base (optional)", "ADP_APP_KEY not set");
}

/** One provider's model list, as GET <base>/models answered it: the status and the model ids (nothing else is kept). */
interface ModelList {
  /** null: no answer (network error, timeout) */
  status: number | null;
  ids: string[];
  error?: string;
}

/** The answers by base URL and key, so the main model and the checker sharing one key cost one call. */
const modelLists = new Map<string, Promise<ModelList>>();

/**
 * GET <base>/models with the key as a Bearer token (OpenAI-compatible; TokenHub and OpenAI both answer it). Free: no
 * tokens, nothing spent, so it bypasses the spend ledger. Only the status and the ids are read: an error answer's
 * body is never read or printed (it can echo part of the key), and the key never appears in what is returned.
 */
function listModels(baseUrl: string, apiKey: string): Promise<ModelList> {
  const cacheKey = `${baseUrl}\n${createHash("sha256").update(apiKey, "utf8").digest("hex")}`;
  const known = modelLists.get(cacheKey);
  if (known) return known;
  const run = (async (): Promise<ModelList> => {
    try {
      const res = await timed(15_000, (signal) =>
        fetch(`${baseUrl.replace(/\/+$/, "")}/models`, { signal, headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }),
      );
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { status: res.status, ids: [] };
      }
      const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
      const rows = Array.isArray(body?.data) ? (body.data as { id?: unknown }[]) : [];
      return { status: res.status, ids: rows.map((m) => m?.id).filter((id): id is string => typeof id === "string") };
    } catch (err) {
      const e = err as Error;
      const why = e.name === "AbortError" ? "no answer within 15 s" : (e.message || e.name).split(apiKey).join("***");
      return { status: null, ids: [], error: why };
    }
  })();
  modelLists.set(cacheKey, run);
  return run;
}

/** PASS when the provider lists `model` for this key; FAIL when the key is refused, the model is not listed, or no answer. */
async function checkListed(name: string, baseUrl: string, apiKey: string, model: string, keyNote: string): Promise<void> {
  const list = await listModels(baseUrl, apiKey);
  const call = `GET ${new URL(baseUrl).host}/models`;
  if (list.status === null) record("FAIL", name, `${call}: ${list.error}; ${keyNote}`);
  else if (list.status === 401 || list.status === 403) record("FAIL", name, `${call} → HTTP ${list.status}: the key was refused; ${keyNote}`);
  else if (list.status !== 200) record("FAIL", name, `${call} → HTTP ${list.status}; ${keyNote}`);
  else if (list.ids.includes(model)) record("PASS", name, `${model} is listed (${call} → 200); ${keyNote}`);
  else {
    const some = list.ids.length ? `: ${list.ids.slice(0, 8).join(", ")}${list.ids.length > 8 ? ", …" : ""}` : "";
    record("FAIL", name, `the key works (${call} → 200) but ${model} is not among the ${list.ids.length} models it lists${some}; ${keyNote}`);
  }
}

/**
 * Where a key variable's value comes from (scripts/llm/env-check.ts keySource: names and same / differs only, never a
 * value): web/.env, or the environment (a deployment's settings, or a shell / Windows user variable). `differs`: the
 * environment holds another value under the same name, and it wins over web/.env (process.loadEnvFile and Next both
 * leave a variable that is already set alone), which is how a stale user-environment key once replaced the project's.
 */
function keyNote(name: string, fileValues: Record<string, string>): { text: string; differs: boolean } {
  const source = keySource(name, process.env, fileValues);
  return { text: `key ${name} (${source})`, differs: source === "environment, DIFFERS from web/.env" };
}

/**
 * Items 12-13: the model and the checker this machine's configuration uses, read the way the app reads it (lib/llm
 * mainProviderKind, mainModel, checkerConfig and its key order: HUNYUAN_API_KEY at HUNYUAN_BASE_URL (TokenHub); the
 * checker's CHECKER_API_KEY, else the Hunyuan key), each checked with one free GET /models at its provider: PASS when
 * the key is accepted and the configured model is listed. SKIP: the offline mock, the cassette replay, or a key that is
 * not set (the app then runs without that model). FAIL: a refused key, a model the key cannot use, no answer, a key
 * whose environment value differs from web/.env's (not called), or a checker the app would refuse to use.
 */
async function checkModels(): Promise<void> {
  console.log("\nModels (items 12-13)");
  const envFile = path.join(WEB, ".env");
  const fileValues = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, "utf8")) : {};

  const raw = env("LLM_PROVIDER").toLowerCase() || "unset";
  const kind = mainProviderKind(process.env);
  const model = mainModel(process.env);
  const mainName = `main model (${kind})`;
  const hunyuan = hunyuanSettings(process.env);
  if (kind === "mock") {
    const missingKey = raw === "hunyuan" ? (hunyuan.problem === "bad_base_url" ? "a TokenHub HUNYUAN_BASE_URL" : "HUNYUAN_API_KEY") : raw === "openai" ? "OPENAI_API_KEY" : null;
    record("SKIP", mainName, missingKey ? `LLM_PROVIDER=${raw} but ${missingKey} is not set: the app falls back to the offline mock` : `LLM_PROVIDER=${raw}: the offline mock, no model call`);
  } else if (kind === "replay") {
    record("SKIP", mainName, `LLM_PROVIDER=replay: answers from cassettes recorded with ${env("REPLAY_PROVIDER") || "openai"} (${model}), no model call`);
  } else if (kind === "hunyuan") {
    const key = vendorKey(VENDORS.hunyuan, process.env);
    const note = key ? keyNote(key.name, fileValues) : null;
    if (!key || !note) record("SKIP", mainName, "HUNYUAN_API_KEY not set");
    else if (note.differs) record("FAIL", mainName, `${note.text}: the environment's value is used instead of web/.env's; unset it in this shell or the Windows user environment (not called)`);
    else await checkListed(mainName, hunyuan.baseUrl, key.value, model, `${note.text}; TokenHub's ${hunyuan.site} site`);
  } else {
    const note = keyNote("OPENAI_API_KEY", fileValues);
    if (note.differs) record("FAIL", mainName, `${note.text}: the environment's value is used instead of web/.env's (not called)`);
    else await checkListed(mainName, VENDORS.openai.baseUrl, env("OPENAI_API_KEY"), model, note.text);
  }

  const checker = checkerConfig(process.env);
  const provider = env("CHECKER_PROVIDER").toLowerCase();
  const checkerName = `layer-3 checker (${provider || "none"})`;
  if (checker.mock) record("SKIP", checkerName, "CHECKER_PROVIDER=mock: the offline stand-in, no model call");
  else if (checker.replay) record("SKIP", checkerName, `CHECKER_PROVIDER=replay: answers from cassettes recorded with ${checker.replay.provider} (${checker.replay.model}), no model call`);
  else if (!checker.config) {
    const reason = checker.reason ?? "no checker";
    // a variable that is not set: SKIP, as everywhere here; a checker the app refuses (the main model itself, a vendor
    // that may not check its own model, an unknown name) leaves it without one although one was asked for: FAIL
    record(/not set$/.test(reason) ? "SKIP" : "FAIL", checkerName, `${reason}; without a checker the app blocks every borderline sentence (fail closed)`);
  } else if (checker.config.vendor !== "tencent" && checker.config.vendor !== "openai") {
    record("TODO", checkerName, `${checker.config.model} at ${checker.config.vendor}: preflight lists models for Hunyuan (TokenHub) and OpenAI keys only`);
  } else {
    const keyName = env("CHECKER_API_KEY") ? "CHECKER_API_KEY" : (vendorKey(VENDORS[checker.config.vendor], process.env)?.name ?? "CHECKER_API_KEY");
    const note = keyNote(keyName, fileValues);
    // next to a live main model: the same vendor or another one
    const live = kind === "hunyuan" || kind === "openai";
    const independence = !live ? "" : checker.independence === "same_vendor" ? "; same vendor as the main model, a different model" : "; another vendor than the main model";
    if (note.differs) record("FAIL", checkerName, `${note.text}: the environment's value is used instead of web/.env's (not called)`);
    else await checkListed(checkerName, checker.config.baseUrl, checker.config.apiKey, checker.config.model, `${note.text}${independence}`);
  }
}

/** A 16 kHz mono 16-bit PCM WAV of `samples` silent samples (the audio bucket checks the header bytes). */
function tinyWav(samples = 160): Uint8Array {
  const dataLen = samples * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16_000, 24);
  buf.writeUInt32LE(32_000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  return new Uint8Array(buf);
}

/**
 * Supabase (STORE=supabase, BLOB_DRIVER=supabase). With SUPABASE_URL + SUPABASE_SERVICE_KEY:
 *   - REST root answers;
 *   - every file in web/supabase/migrations is recorded in schema_migrations (node scripts/db/migrate.mjs);
 *   - RLS: with SUPABASE_DB_URL, scripts/db/inspect.mjs --rls (relrowsecurity on every table, no policies,
 *     nothing granted to anon / authenticated); with SUPABASE_ANON_KEY, the publishable key is refused;
 *   - the store adapter round trip: create a throwaway session (1 h ttl), read it, tick a dose, store one bus
 *     event, reset, delete; nothing is left behind;
 *   - storage: both buckets private, one tiny WAV written, read and removed under preflight-<uuid>/.
 * Nothing prints a key, a URL or a row.
 */
async function checkSupabase(): Promise<void> {
  console.log(`\nSupabase (items 10-11; STORE=${env("STORE") || "memory"})`);
  const need = missing(["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]);
  if (need.length) {
    record("SKIP", "Supabase database", `${need.join(", ")} not set; using STORE=memory + SSE`);
    record("SKIP", "Supabase storage upload", "no Supabase keys");
    return;
  }
  const url = env("SUPABASE_URL").replace(/\/+$/, "");
  const key = env("SUPABASE_SERVICE_KEY");
  const serverHeaders = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const res = await timed(15_000, (signal) => fetch(`${url}/rest/v1/`, { signal, headers: serverHeaders }));
    record(res.ok ? "PASS" : "FAIL", "Supabase database", `REST root: HTTP ${res.status}`);
  } catch (err) {
    record("FAIL", "Supabase database", (err as Error).message);
  }

  // migrations
  let migrated = false;
  try {
    const files = readdirSync(path.join(WEB, "supabase", "migrations")).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
    const res = await timed(15_000, (signal) => fetch(`${url}/rest/v1/schema_migrations?select=filename`, { signal, headers: serverHeaders }));
    if (!res.ok) {
      record("FAIL", "Supabase schema (migrations)", `HTTP ${res.status}: not migrated? run node scripts/db/migrate.mjs`);
    } else {
      const applied = new Set(((await res.json()) as { filename: string }[]).map((r) => r.filename));
      const pending = files.filter((f) => !applied.has(f));
      migrated = pending.length === 0;
      record(migrated ? "PASS" : "FAIL", "Supabase schema (migrations)", migrated ? `${files.length} of ${files.length} applied` : `pending: ${pending.join(", ")} (node scripts/db/migrate.mjs)`);
    }
  } catch (err) {
    record("FAIL", "Supabase schema (migrations)", (err as Error).message);
  }

  // RLS: the catalog proof needs the database connection; the publishable key must be refused either way
  if (isSet("SUPABASE_DB_URL")) {
    const out = spawnSync(process.execPath, [path.join(WEB, "scripts", "db", "inspect.mjs"), "--rls"], { cwd: WEB, encoding: "utf8", windowsHide: true });
    const summary = (out.stdout ?? "").split("\n").find((l) => /tables, .* with RLS enabled/.test(l))?.trim() ?? "no summary";
    record(out.status === 0 ? "PASS" : "FAIL", "Supabase RLS on every table", out.status === 0 ? summary : `${summary}; run node scripts/db/inspect.mjs --rls`);
  } else {
    record("SKIP", "Supabase RLS on every table", "SUPABASE_DB_URL not set (node scripts/db/inspect.mjs --rls needs it)");
  }
  if (isSet("SUPABASE_ANON_KEY")) {
    try {
      const anon = env("SUPABASE_ANON_KEY");
      const res = await timed(15_000, (signal) =>
        fetch(`${url}/rest/v1/session?select=id&limit=1`, { signal, headers: { apikey: anon, Authorization: `Bearer ${anon}` } }),
      );
      const rows = res.ok ? ((await res.json()) as unknown[]) : [];
      const refused = res.status === 401 || res.status === 403;
      record(refused || (res.ok && rows.length === 0) ? "PASS" : "FAIL", "publishable key cannot read tables", `GET /rest/v1/session with the publishable key: HTTP ${res.status}`);
    } catch (err) {
      record("FAIL", "publishable key cannot read tables", (err as Error).message);
    }
  } else {
    record("SKIP", "publishable key cannot read tables", "SUPABASE_ANON_KEY not set");
  }

  // store adapter round trip
  if (!migrated) {
    record("SKIP", "Supabase store round trip", "schema not migrated");
  } else {
    const { createSupabaseStore, createSupabaseBusLog } = await import("@/lib/store/supabase");
    const store = createSupabaseStore({ url, serviceKey: key });
    let sessionId: string | null = null;
    const t0 = Date.now();
    try {
      const s = await store.createSession({ ttl_hours: 1 });
      sessionId = s.id;
      const back = await store.getSessionByJoinCode(s.join_code);
      await store.logDose(s.id, { medication_id: "med-amlodipine", day: 29, slot: "morning", state: "missed" });
      const busLog = createSupabaseBusLog({ url, serviceKey: key });
      const id = await busLog.append({ type: "dose.logged", session_id: s.id, at: new Date().toISOString(), say: "preflight", data: null });
      const events = await busLog.after(s.id, 0, 10);
      await store.resetSession(s.id);
      const after = await store.listDoses(s.id, { fromDay: 29, toDay: 29 });
      const ok =
        back?.id === s.id &&
        (await store.listMeds(s.id)).length > 0 &&
        id === 1 &&
        events.length === 1 &&
        after.find((d) => d.medication_id === "med-amlodipine")?.state === "taken";
      await store.deleteSession(s.id);
      sessionId = null;
      const gone = (await store.getSession(s.id)) === null;
      record(ok && gone ? "PASS" : "FAIL", "Supabase store round trip", `create, read, dose, bus event, reset, delete in ${Date.now() - t0} ms${gone ? "" : "; session not deleted"}`);
    } catch (err) {
      record("FAIL", "Supabase store round trip", (err as Error).message);
    } finally {
      if (sessionId) await store.deleteSession(sessionId).catch(() => {});
    }
  }

  // storage
  try {
    const { createSupabaseBlobStore } = await import("@/lib/blob");
    const blobs = createSupabaseBlobStore({ url, serviceKey: key });
    const [audioPublic, labelsPublic] = await Promise.all([blobs.bucketIsPublic("audio"), blobs.bucketIsPublic("labels")]);
    if (audioPublic === null || labelsPublic === null) {
      record("FAIL", "Supabase storage upload", "bucket missing: run npx tsx scripts/setup-storage.ts");
    } else {
      const prefix = `preflight-${randomUUID()}`;
      const wav = tinyWav();
      await blobs.putObject("audio", `${prefix}/check.wav`, wav, "audio/wav");
      const got = await blobs.getObject("audio", `${prefix}/check.wav`);
      const removed = await blobs.removePrefix("audio", prefix);
      const same = got !== null && got.bytes.length === wav.length;
      const ok = !audioPublic && !labelsPublic && same && removed === 1;
      record(ok ? "PASS" : "FAIL", "Supabase storage upload", `buckets ${audioPublic || labelsPublic ? "NOT private" : "private"}; WAV write/read/remove ${same && removed === 1 ? "ok" : "failed"}`);
    }
  } catch (err) {
    record("FAIL", "Supabase storage upload", (err as Error).message);
  }
}

async function checkDeploy(): Promise<void> {
  console.log("\nDeployed preview (items 6-9, 15)");
  const base = argUrl();
  if (!base) {
    record("SKIP", "preview link answers 200", "no --url and no PREVIEW_URL");
    record("SKIP", "30-second request", "no preview URL");
    record("SKIP", "session survives across requests", "no preview URL");
    record("SKIP", "events reach a phone within 1 s", "no preview URL");
    record("SKIP", "4 MB upload", "no preview URL");
    return;
  }
  const root = base.replace(/\/+$/, "");
  try {
    const res = await timed(30_000, (signal) => fetch(`${root}/`, { signal, redirect: "manual" }));
    record(res.status === 200 ? "PASS" : "FAIL", "preview link answers 200", `GET / → ${res.status}`);
    const health = await timed(15_000, (signal) => fetch(`${root}/api/health`, { signal }));
    record(health.ok ? "PASS" : "FAIL", "health endpoint", `GET /api/health → ${health.status}`);
  } catch (err) {
    record("FAIL", "preview link answers 200", (err as Error).message);
  }
  try {
    const started = Date.now();
    const res = await timed(45_000, (signal) => fetch(`${root}/api/preflight/wait?ms=30000`, { signal }));
    const elapsed = (Date.now() - started) / 1000;
    const secs = elapsed.toFixed(1);
    // The route sleeps 30 s before answering; an earlier answer means something else replied (a cache, an edge error page).
    const waited = elapsed >= 29.5;
    record(
      res.ok && waited ? "PASS" : "FAIL",
      "30-second request",
      `HTTP ${res.status} after ${secs} s${res.ok && !waited ? " (answered before the 30 s wait finished)" : ""}`,
    );
  } catch (err) {
    record("FAIL", "30-second request", (err as Error).name === "AbortError" ? "no answer within 45 s" : (err as Error).message);
  }
  await checkSharedState(root);
  try {
    const body = new Uint8Array(4 * 1024 * 1024);
    const res = await timed(60_000, (signal) =>
      fetch(`${root}/api/preflight/upload`, {
        method: "POST",
        signal,
        // C2 track L: a script names the site it acts on, as a browser's Origin does (lib/guard/request.ts)
        headers: { "Content-Type": "application/octet-stream", Origin: new URL(root).origin },
        body,
      }),
    );
    const data = (await res.json().catch(() => ({}))) as { bytes?: number };
    const ok = res.ok && data.bytes === body.byteLength;
    record(ok ? "PASS" : "FAIL", "4 MB upload", `HTTP ${res.status}, server read ${data.bytes ?? "?"} bytes`);
  } catch (err) {
    record("FAIL", "4 MB upload", (err as Error).message);
  }
}

/** The cookies a response set, as the Cookie header a browser sends back: name=value pairs, attributes dropped. */
function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";", 1)[0].trim())
    .filter((pair) => pair.includes("="))
    .join("; ");
}

/**
 * The in-memory store and the SSE bus live in one server process (STORE=memory). On a serverless host
 * with several instances, a session created by one request is missing on the next, and an event
 * published on one instance never reaches a stream held by another. Both checks make one throwaway
 * sandbox session on the preview (it expires after 48 h).
 *
 * Every call about that session sends back the cookies POST /api/session set (rp_session, rp_member,
 * rp_role: the sandbox's own device, a judge's row), the way the judge's browser does. A call that
 * presents no device at all is refused (403 member_required, lib/family/gate.ts) except a few routes
 * that read nothing of his (ANONYMOUS_API), and the event stream and the clock are not among them.
 */
async function checkSharedState(root: string): Promise<void> {
  let sessionId: string;
  let cookie: string;
  try {
    const res = await timed(15_000, (signal) =>
      fetch(`${root}/api/session`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Origin: new URL(root).origin }, // C2 track L: see the upload check
        body: JSON.stringify({ kind: "sandbox", device_label: "preflight" }),
      }),
    );
    const data = (await res.json().catch(() => ({}))) as { session?: { id?: string } };
    if (res.status !== 201 || !data.session?.id) {
      record("FAIL", "session survives across requests", `POST /api/session → ${res.status}`);
      record("SKIP", "events reach a phone within 1 s", "no session");
      return;
    }
    sessionId = data.session.id;
    cookie = cookiesFrom(res);
  } catch (err) {
    record("FAIL", "session survives across requests", (err as Error).message);
    record("SKIP", "events reach a phone within 1 s", "no session");
    return;
  }
  const device: Record<string, string> = cookie ? { cookie } : {};

  let found = 0;
  const reads = 5;
  for (let i = 0; i < reads; i++) {
    try {
      const res = await timed(15_000, (signal) => fetch(`${root}/api/session?session=${sessionId}`, { signal, headers: device }));
      if (res.status === 200) found++;
    } catch {
      // counted as a miss
    }
  }
  record(
    found === reads ? "PASS" : "FAIL",
    "session survives across requests",
    found === reads
      ? `${found}/${reads} reads found the new session`
      : `${found}/${reads} reads found it: instances do not share memory; this host needs STORE=supabase`,
  );

  // Open the event stream like a phone does, move the clock like the director does, time the event.
  if (!cookie) {
    record("FAIL", "events reach a phone within 1 s", "POST /api/session set no device cookie (rp_session, rp_member, rp_role); without one the stream is refused");
    return;
  }
  const ctrl = new AbortController();
  const overall = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const stream = await fetch(`${root}/api/events?session=${sessionId}`, {
      signal: ctrl.signal,
      headers: { Accept: "text/event-stream", ...device },
    });
    if (stream.status !== 200 || !stream.body) {
      record("FAIL", "events reach a phone within 1 s", `GET /api/events → ${stream.status}`);
      return;
    }
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const readUntil = async (match: (text: string) => boolean, ms: number): Promise<boolean> => {
      const deadline = Date.now() + ms;
      while (!match(buffer)) {
        const left = deadline - Date.now();
        if (left <= 0) return false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const chunk = await Promise.race([
          reader.read(),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), left);
          }),
        ]);
        clearTimeout(timer);
        if (chunk === null) return false;
        if (chunk.done) return match(buffer);
        buffer += decoder.decode(chunk.value, { stream: true });
      }
      return true;
    };
    if (!(await readUntil((b) => b.includes(": connected"), 10_000))) {
      record("FAIL", "events reach a phone within 1 s", "the stream sent nothing within 10 s (buffered by the host?)");
      return;
    }
    const sent = Date.now();
    const move = await timed(15_000, (signal) =>
      fetch(`${root}/api/clock?session=${sessionId}`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Origin: new URL(root).origin, ...device }, // C2 track L: see the upload check
        body: JSON.stringify({ day: 30 }),
      }),
    );
    if (!move.ok) {
      record("FAIL", "events reach a phone within 1 s", `POST /api/clock → ${move.status}`);
      return;
    }
    const arrived = await readUntil((b) => b.includes('"type":"clock.changed"'), 5_000);
    const ms = Date.now() - sent;
    if (!arrived) record("FAIL", "events reach a phone within 1 s", "clock.changed did not arrive within 5 s (another instance, or a buffering proxy)");
    else record(ms <= 1000 ? "PASS" : "FAIL", "events reach a phone within 1 s", `clock.changed arrived ${ms} ms after the director's request was sent`);
  } catch (err) {
    record("FAIL", "events reach a phone within 1 s", (err as Error).name === "AbortError" ? "timed out" : (err as Error).message);
  } finally {
    clearTimeout(overall);
    ctrl.abort();
  }
}

// ------------------------------------------------------------------ main

const ENV_NAMES = [
  "LLM_PROVIDER",
  "HUNYUAN_API_KEY",
  "HUNYUAN_BASE_URL",
  "HUNYUAN_MODEL",
  "OPENAI_API_KEY",
  "LLM_MODEL",
  "CHECKER_PROVIDER",
  "CHECKER_API_KEY",
  "CHECKER_MODEL",
  "SPEECH_PROVIDER",
  "TTS_PROVIDER",
  "TRTC_SDK_APP_ID",
  "TRTC_SDK_SECRET_KEY",
  "TENCENT_SECRET_ID",
  "TENCENT_SECRET_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_DB_URL",
  "ADP_APP_KEY",
  "STORE",
  "PREVIEW_URL",
];

async function main(): Promise<void> {
  const envFile = path.join(WEB, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  console.log("Ripple preflight (docs/plan/web-app.md section 2)");
  console.log(`web/.env: ${existsSync(envFile) ? "found" : "not found (defaults: stub model, mock speech, in-memory store)"}`);
  console.log(`Variables: ${ENV_NAMES.map((n) => `${n}=${isSet(n) ? "set" : "unset"}`).join("  ")}`);

  await checkLocal();
  await checkSpeech();
  await checkModels();
  await checkSupabase();
  await checkDeploy();

  const count = (s: Status) => results.filter((r) => r.status === s).length;
  console.log(`\nSummary: ${count("PASS")} PASS, ${count("SKIP")} SKIP, ${count("TODO")} TODO, ${count("FAIL")} FAIL`);
  if (count("FAIL") > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("preflight crashed:", err);
  process.exitCode = 1;
});
