/**
 * Tencent Cloud Hunyuan, the app's model since 2026-10-16 (the owner: 「模型本身用混元。把 DeepSeek 直接去掉。」), served by
 * Tencent Cloud's TokenHub. The calls themselves go through lib/llm/openai.ts (TokenHub speaks the OpenAI Chat Completions
 * protocol); this file holds where they go, the key, and the model names. Server-only.
 *
 * Why TokenHub and not Tencent Cloud API 3.0 (hunyuan.tencentcloudapi.com, ChatCompletions 2023-09-01, signed with the
 * SecretId / SecretKey pair): the migration notice https://cloud.tencent.com/document/product/1729/131925 (2026-05-20)
 * took the old Hunyuan models offline on 22 June 2026 and the old platform on 30 September, with TokenHub as the
 * replacement; on 10-16, once the account's key had permission, that API answered every old model (hunyuan-turbos-latest,
 * hunyuan-t1-latest, hunyuan-lite ...) with code 2000, 「该模型已下线」.
 *
 * What the pages say (read 2026-10-16):
 *   - API usage, international site (https://www.tencentcloud.com/document/product/1300/78941, updated 2026-09-24): the
 *     key as `Authorization: Bearer <API KEY>`, and the sites with their "resource scheduling scope":
 *       Singapore       https://tokenhub-intl.tencentcloudmaas.com (backup .tech)   Global
 *       Guangzhou       https://tokenhub.tencentcloudmaas.com (backup .tech)        Chinese mainland
 *       Silicon Valley  https://tokenhub-us.tencentcloudmaas.com (backup .tech)     United States
 *     A key works only on the site it was made on. The China site's page (https://cloud.tencent.com/document/product/1823/130078)
 *     lists tokenhub(-intl).tencentmaas.com the same way; its model table has Hy3 (`hy3`) and Hy4 preview (`hy4-preview`),
 *     and GET /v1/models on this account lists both (the May migration notice's `hy3-preview` is in neither).
 *   - Data Processing and Security Protocol (https://www.tencentcloud.com/document/product/1300/78953, updated 2026-09-11):
 *     computing resources "from different countries/regions based on resource availability"; customer content kept
 *     "for up to 30 days" unless Zero Data Retention is switched on (offered for the Singapore, Frankfurt and Silicon Valley
 *     resource regions). The AI consent text says this (lib/privacy/consent-texts.ts).
 *   - Chat Completions fields (https://cloud.tencent.com/document/product/1823/135872, updated 2026-09-15): response_format
 *     json_object exists, but the app does not send it: measured on 10-16 with Ripple's own everyday answer (hy3, 12 calls
 *     each way), with json_object half the replies came back garbled (the JSON's own tail `","ask":"none"}` inside the
 *     answer, `</think:...>` and "(End.)" text in it) and without it 12 of 12 were clean JSON. So jsonMode is off: every
 *     prompt asks for JSON in words and lib/llm/json.ts parseModelJson reads it (a code fence stripped; anything else is
 *     no usable answer at the caller, the safe side). Also documented: thinking { type: enabled | disabled }, max_tokens,
 *     stream with usage on the last chunk, finish_reason stop | length | tool_calls | content_filter, errors as
 *     { error: { code, message, message_zh, type, request_id } } with a non-2xx status, and an error frame inside a stream
 *     that already sent 200 (openai.ts handles both)
 *   - deep thinking (https://cloud.tencent.com/document/product/1823/131208): hy3 and hy4-preview think by default; the
 *     documented switch is `thinking: { type: "disabled" }`. Measured on this account on 10-16: with thinking on, hy3 and
 *     hy4-preview spend the whole max_tokens reasoning (content empty, 10-20 s); `enable_thinking: false` changes nothing;
 *     `thinking: {type: "disabled"}` answers in about 1.3 s with no reasoning tokens. The app sends it disabled unless
 *     HUNYUAN_THINKING (CHECKER_THINKING for the checker) is "enabled"; the ask deadline is 8 s
 *   - image understanding (https://cloud.tencent.com/document/product/1823/136956, updated 2026-08-27): hy-vision-2.0-instruct,
 *     images as image_url parts with an https or data:<mime>;base64 URL; JPEG, PNG, WEBP. Not offered on this account
 *     (HUNYUAN_VISION_MODEL below)
 *   - error codes (https://cloud.tencent.com/document/product/1823/131595): 401 bad key, 403 no access to the model, 402
 *     arrears or free quota used up, 429 limits (Retry-After), 451 content safety, 400 unknown model or parameter, 5xx
 *   - prices: lib/llm/spend.ts (https://cloud.tencent.com/document/product/1823/130055)
 *
 * Settings: HUNYUAN_API_KEY (a TokenHub API key, made in the TokenHub console's API Key page; not the SecretId / SecretKey
 * pair), HUNYUAN_BASE_URL (default the international Singapore site; only TokenHub's own hosts are accepted, so a typing
 * mistake cannot send the key and his words somewhere else), HUNYUAN_MODEL or LLM_MODEL (default hy3), HUNYUAN_THINKING
 * (default disabled). The key is read on the server only and never logged.
 */

type Env = Record<string, string | undefined>;

/** The main model: Hy3, in the current model table, price page and Hunyuan guide (2026-10-13). */
export const HUNYUAN_MAIN_MODEL = "hy3";
/** The layer-3 checker: the other Hunyuan chat model TokenHub lists, so the main model never checks itself. */
export const HUNYUAN_CHECKER_MODEL = "hy4-preview";
/**
 * Label photos: no Hunyuan model reads images on this account (10-16). The image-understanding page's model,
 * hy-vision-2.0-instruct, answers 400004 (model not found) and is not in GET /v1/models; hy4-preview says it cannot see an
 * image; hy3 answers as if it had seen one ("Blue." for a white square), which would invent a label. So with Hunyuan there
 * is no model reader unless LLM_VISION_MODEL names one, and lib/vision keeps its offline path (the sample photos' recorded
 * readings; any other photo is unreadable and he types the label's words).
 */
export const HUNYUAN_VISION_MODEL: string | null = null;
/** The page's image model, for the probe (not offered on this account on 10-16). */
export const HUNYUAN_VISION_CANDIDATE = "hy-vision-2.0-instruct";

/**
 * The Singapore site of the international TokenHub (the owner's account is on Tencent Cloud's international site; the
 * China-site address tokenhub.tencentmaas.com refuses its key with 401). Resource scheduling: global.
 */
export const HUNYUAN_DEFAULT_BASE_URL = "https://tokenhub-intl.tencentcloudmaas.com/v1";
export const HUNYUAN_KEY_ENV = "HUNYUAN_API_KEY";

/** TokenHub's own hosts: the international sites (Singapore, Guangzhou, Silicon Valley) and the China site's, with backups. */
const TOKENHUB_HOST = /^tokenhub(-intl|-us)?\.(tencentcloudmaas\.(com|tech)|tencentmaas\.(com|cn))$/;

export type HunyuanProblem = "no_key" | "bad_base_url";

export interface HunyuanSettings {
  baseUrl: string;
  /** from the host: "singapore" (resource scheduling: global), "guangzhou" (mainland China), "siliconvalley" (United States) */
  site: "singapore" | "guangzhou" | "siliconvalley" | null;
  apiKey: string | null;
  /** why calls cannot be made (null = ready); names a setting's problem, never a value */
  problem: HunyuanProblem | null;
}

/** An https TokenHub URL, without a trailing slash; null for anything else. */
export function tokenhubBaseUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || !TOKENHUB_HOST.test(u.hostname) || u.username || u.password || u.port) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function hunyuanSettings(env: Env = process.env): HunyuanSettings {
  const rawBase = (env.HUNYUAN_BASE_URL ?? "").trim() || HUNYUAN_DEFAULT_BASE_URL;
  const baseUrl = tokenhubBaseUrl(rawBase);
  const apiKey = (env[HUNYUAN_KEY_ENV] ?? "").trim() || null;
  const host = baseUrl ? new URL(baseUrl).hostname : "";
  const site = !baseUrl ? null : host.startsWith("tokenhub-intl.") ? "singapore" : host.startsWith("tokenhub-us.") ? "siliconvalley" : "guangzhou";
  const problem: HunyuanProblem | null = !apiKey ? "no_key" : !baseUrl ? "bad_base_url" : null;
  return { baseUrl: baseUrl ?? rawBase, site, apiKey, problem };
}
