/**
 * Model replay (docs/plan/spec.md section 7). Real requests and responses are recorded into
 * web/fixtures/cassettes/<sha256(provider+model+system+user)>.json with fields request, response, recorded_at;
 * replay mode reads the same key. When images are attached, a digest of them is appended to the hashed string
 * (otherwise two label photos with the same prompt would share a cassette).
 *
 * Recording only happens through withRecording(): LLM_RECORD=1 wraps every live client (lib/llm/index.ts), so a
 * real run (`npm run eval`, scripts/llm/*, a `next dev` started with the variable) leaves one cassette per distinct
 * request. The API key is never written: a cassette holds the prompt, the reply, the token counts and the cost.
 * Prompts here hold only the fictional demo persona's data. Server-only (node:fs).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { webRoot } from "./root";
import { LlmError, type ChatOpts, type ChatResult, type LlmClient } from "./types";

export interface Cassette {
  request: { provider: string; model: string; system: string; user: string; json?: boolean; images?: { mime: string; sha256: string }[] };
  response: { content: string; tokens: number; usage?: ChatResult["usage"]; usd?: number; latency_ms?: number; finish_reason?: string | null };
  recorded_at: string;
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function cassetteDir(env: Record<string, string | undefined> = process.env): string {
  return env.CASSETTE_DIR || path.join(webRoot(), "fixtures", "cassettes");
}

export function cassetteKey(provider: string, model: string, opts: Pick<ChatOpts, "system" | "user" | "images">): string {
  let material = provider + model + opts.system + opts.user;
  if (opts.images?.length) material += opts.images.map((i) => `${i.mime}:${sha256(i.base64)}`).join(",");
  return sha256(material);
}

export interface ReplayOptions {
  /** provider and model the cassettes were recorded with (REPLAY_PROVIDER / LLM_MODEL; see index.ts) */
  provider: string;
  model: string;
  dir?: string;
}

/** Answers only from cassettes; a missing cassette is an error (status 404), never a network call. */
export function createReplayClient(opts: ReplayOptions): LlmClient {
  const dir = opts.dir ?? cassetteDir();
  return {
    provider: `replay:${opts.provider}`,
    model: opts.model,
    async chat(chat: ChatOpts): Promise<ChatResult> {
      const key = cassetteKey(opts.provider, opts.model, chat);
      const file = path.join(dir, `${key}.json`);
      if (!existsSync(file)) throw new LlmError("cassette_missing", `no cassette ${key}.json for ${opts.provider}/${opts.model}`, 404);
      const cassette = JSON.parse(readFileSync(file, "utf8")) as Cassette;
      // streaming (ChatOpts.onDelta): a cassette holds the whole reply, so it goes out as one piece
      if (chat.onDelta && cassette.response.content) chat.onDelta(cassette.response.content);
      return {
        content: cassette.response.content,
        tokens: cassette.response.tokens,
        provider: `replay:${opts.provider}`,
        model: opts.model,
        cassette: `${key}.json`,
        attempts: 0,
        latencyMs: 0,
        ...(chat.onDelta ? { streamed: !!cassette.response.content } : {}),
      };
    },
  };
}

/** Wrap a real client so every successful call is also written as a cassette. */
export function withRecording(client: LlmClient, dir: string = cassetteDir()): LlmClient {
  return {
    provider: client.provider,
    model: client.model,
    async chat(chat: ChatOpts): Promise<ChatResult> {
      const res = await client.chat(chat);
      const key = cassetteKey(client.provider, client.model, chat);
      const cassette: Cassette = {
        request: {
          provider: client.provider,
          model: client.model,
          system: chat.system,
          user: chat.user,
          json: chat.json,
          images: chat.images?.map((i) => ({ mime: i.mime, sha256: sha256(i.base64) })),
        },
        response: {
          content: res.content,
          tokens: res.tokens,
          ...(res.usage ? { usage: res.usage } : {}),
          ...(res.usd !== undefined ? { usd: Math.round(res.usd * 1e6) / 1e6 } : {}),
          ...(res.latencyMs !== undefined ? { latency_ms: res.latencyMs } : {}),
          ...(res.finishReason !== undefined ? { finish_reason: res.finishReason } : {}),
        },
        recorded_at: new Date().toISOString(),
      };
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(cassette, null, 2) + "\n", "utf8");
      return res;
    },
  };
}
