/**
 * One tiny live call to the main model and to the checker: confirms the key, the model names, non-thinking mode
 * (reasoning tokens 0) and the usage fields the spend ledger prices. Prints names, token counts and US$ only.
 *
 *   LLM_PROVIDER=hunyuan CHECKER_PROVIDER=hunyuan \
 *     node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/llm/ping.ts
 *
 * It first says where each key comes from (scripts/llm/env-check.ts): web/.env, or a shell / user-environment value
 * that overrides it (names and same / differs only).
 */
import { createChecker, createMainLlm, getSpendLedger, llmStatus, type LlmClient } from "@/lib/llm";
import { keySourceLines } from "./env-check";

async function ping(label: string, client: LlmClient) {
  const t0 = Date.now();
  const res = await client.chat({
    system: 'You are a connectivity check. Answer with JSON only: {"ok": true}.',
    user: "Reply with the JSON object now.",
    json: true,
    temperature: 0,
    maxTokens: 20,
    purpose: "probe",
  });
  let ok = false;
  try {
    ok = (JSON.parse(res.content) as { ok?: unknown }).ok === true;
  } catch {
    ok = false;
  }
  console.log(
    `${label}: ${res.provider}/${res.model} json_ok=${ok} finish=${res.finishReason} ${Date.now() - t0} ms ` +
      `usage=${JSON.stringify(res.usage)} usd=${res.usd?.toFixed(6)}`,
  );
}

async function main() {
  console.log("config:", JSON.stringify(llmStatus()));
  for (const line of keySourceLines()) console.log(`key ${line}`);
  await ping("main", createMainLlm());
  const checker = createChecker();
  if (checker.client) await ping("checker", checker.client);
  else console.log("checker: none,", checker.reason);
  console.log("spend:", JSON.stringify(getSpendLedger().summary()));
}

main().catch((e) => {
  console.error("ping failed:", (e as Error).name, (e as { code?: string }).code ?? "", (e as Error).message);
  process.exit(1);
});
