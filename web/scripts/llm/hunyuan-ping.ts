/**
 * Probe Tencent Cloud Hunyuan on TokenHub (OpenAI-compatible; lib/llm/hunyuan.ts): the models the key can use (GET /models,
 * free), then one tiny chat call per Hunyuan chat model with thinking off, JSON asked for in words, and image calls to the vision
 * model. Prints only the HTTP status, the vendor's error code and type (never its message), the model's reply (a few
 * words), the token counts and the time. The key is read by name (HUNYUAN_API_KEY) and never printed.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/llm/hunyuan-ping.ts            (raw probe)
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/llm/hunyuan-ping.ts --app      (also through the app's own
 *        clients: main, main streamed, checker, vision, as LLM_PROVIDER=hunyuan CHECKER_PROVIDER=hunyuan run them)
 *   ... --other-site    also try the other TokenHub site (a key works only on the site it was made on)
 *
 * Base URL: HUNYUAN_BASE_URL, default the international Singapore site. Each chat call is a few tokens (a fraction of a cent).
 */
import { HUNYUAN_DEFAULT_BASE_URL, HUNYUAN_VISION_CANDIDATE, tokenhubBaseUrl } from "@/lib/llm/hunyuan";

/** The international sites (Singapore first: this account's), then the China site's Guangzhou address. */
const SITES = ["https://tokenhub-intl.tencentcloudmaas.com/v1", "https://tokenhub.tencentcloudmaas.com/v1", "https://tokenhub.tencentmaas.com/v1"];
/** hy3 and hy4-preview are in TokenHub's current table; hy3-preview is the May migration notice's name. */
const CHAT_MODELS = ["hy3", "hy4-preview", "hy3-preview"];
/** The image-understanding page's model, and hy3 / hy4-preview with an image (to see whether they read it at all). */
const VISION_MODELS = [HUNYUAN_VISION_CANDIDATE, "hy3", "hy4-preview"];

/** 1x1 white PNG: enough to see whether a model takes image input at all. */
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

const short = (s: string, n = 70) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

/** The vendor's error code and type only (its message can echo the request). */
function errorOf(body: unknown): string {
  const e = (body as { error?: { code?: unknown; type?: unknown } } | null)?.error;
  if (!e) return "";
  const clean = (v: unknown) => String(v ?? "").replace(/[^\w.:-]/g, "").slice(0, 60);
  return `error=${clean(e.code)}${e.type ? ` type=${clean(e.type)}` : ""}`;
}

async function call(base: string, key: string, path: string, body?: unknown): Promise<{ status: number | string; json: unknown; ms: number }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, ms: Date.now() - t0 };
  } catch (e) {
    return { status: (e as Error).name === "TimeoutError" ? "timeout" : "unreachable", json: null, ms: Date.now() - t0 };
  }
}

type Completion = { choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[]; usage?: Record<string, unknown> };

async function chat(base: string, key: string, label: string, body: Record<string, unknown>) {
  const r = await call(base, key, "/chat/completions", body);
  const c = r.json as Completion | null;
  const choice = c?.choices?.[0];
  const reply = choice ? `reply=${JSON.stringify(short(choice.message?.content ?? ""))} finish=${choice.finish_reason} reasoning=${choice.message?.reasoning_content ? "yes" : "no"} usage=${JSON.stringify(c?.usage ?? null)}` : errorOf(r.json) || "no answer body";
  console.log(`${label.padEnd(40)} status=${r.status} ${reply} ${r.ms} ms`);
  return r.status === 200 && !!choice;
}

async function probeSite(base: string, key: string) {
  console.log(`site ${new URL(base).hostname}`);
  const list = await call(base, key, "/models");
  const data = (list.json as { data?: { id?: string; status?: string }[] } | null)?.data ?? [];
  const hy = data.filter((m) => /^(hy|hunyuan)/i.test(String(m.id ?? ""))).map((m) => `${m.id}${m.status ? `(${m.status})` : ""}`);
  console.log(`  GET /models status=${list.status} ${errorOf(list.json)} models=${data.length} hunyuan: ${hy.join(", ") || "none"} ${list.ms} ms`);
  for (const model of CHAT_MODELS) {
    await chat(base, key, `  ${model}`, {
      model,
      messages: [
        { role: "system", content: 'You are a connectivity check. Answer with JSON only: {"ok": true}.' },
        { role: "user", content: "Reply with the JSON object now." },
      ],
      temperature: 0,
      max_tokens: 20,
      // no response_format: the app does not send it (lib/llm/hunyuan.ts: it garbled hy3's replies on 10-16)
      thinking: { type: "disabled" },
      stream: false,
    });
  }
  for (const model of VISION_MODELS) {
    await chat(base, key, `  ${model} (image)`, {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What colour is this image? One word." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG}` } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 20,
      stream: false,
    });
  }
}

async function viaApp() {
  process.env.LLM_PROVIDER = "hunyuan";
  process.env.CHECKER_PROVIDER = process.env.CHECKER_PROVIDER || "hunyuan";
  const { createChecker, createMainLlm, createVisionLlm, llmStatus } = await import("@/lib/llm");
  console.log("app config:", JSON.stringify(llmStatus()));
  type Client = { chat: (o: never) => Promise<{ content: string; usage?: unknown; usd?: number; finishReason?: string | null; latencyMs?: number; streamed?: boolean }> };
  const ping = async (label: string, client: Client | null, opts: Record<string, unknown>) => {
    if (!client) return console.log(`${label}: none`);
    try {
      const r = await client.chat(opts as never);
      console.log(`${label}: reply=${JSON.stringify(short(r.content))} finish=${r.finishReason} streamed=${r.streamed ?? "-"} ${r.latencyMs} ms usage=${JSON.stringify(r.usage)} usd=${r.usd?.toFixed(6)}`);
    } catch (e) {
      console.log(`${label}: failed ${(e as { code?: string }).code ?? ""} ${(e as Error).message}`);
    }
  };
  const json = { system: 'You are a connectivity check. Answer with JSON only: {"ok": true}.', user: "Reply with the JSON object now.", json: true, temperature: 0, maxTokens: 20, purpose: "probe" };
  await ping("app main", createMainLlm(), json);
  await ping("app main streamed", createMainLlm(), { ...json, onDelta: () => {} });
  await ping("app checker", createChecker().client, json);
  await ping("app vision (the mock when no Hunyuan model reads images)", createVisionLlm(), { system: "Transcribe.", user: "What colour is this image? One word.", temperature: 0, maxTokens: 20, purpose: "probe", images: [{ mime: "image/png", base64: TINY_PNG }] });
}

async function main() {
  const key = (process.env.HUNYUAN_API_KEY ?? "").trim();
  if (!key) {
    console.log("HUNYUAN_API_KEY is not set (a TokenHub API key: TokenHub console, API Key 管理)");
    process.exit(2);
  }
  const raw = (process.env.HUNYUAN_BASE_URL ?? "").trim() || HUNYUAN_DEFAULT_BASE_URL;
  const base = tokenhubBaseUrl(raw);
  if (!base) {
    console.log("HUNYUAN_BASE_URL is not a TokenHub address; not sending the key");
    process.exit(2);
  }
  console.log("key HUNYUAN_API_KEY (value not printed)");
  await probeSite(base, key);
  if (process.argv.includes("--other-site")) for (const other of SITES.filter((s) => s !== base)) await probeSite(other, key);
  if (process.argv.includes("--app")) await viaApp();
}

main().catch((e) => {
  console.error("probe failed:", (e as Error).name, (e as { code?: string }).code ?? "");
  process.exit(1);
});
