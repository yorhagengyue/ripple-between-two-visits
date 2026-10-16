/**
 * His consent to AI processing (C2 architecture review, trust boundary: 「没同意 AI 处理时，不调 DeepSeek：问一句只走规则和固定模板，
 * 看诊事项只用规则抽，……医生原话不翻译」; real-app 2.10). Server-only.
 *
 *   account   the latest ai_processing decision he made (consent records are append-only, oldest first): "granted" lets
 *             the main model and the checker see his question and the candidate lines; "declined", "withdrawn" or no
 *             record at all means rules and fixed templates only, and no translation
 *   demo      a judge sandbox or the crew's filming session holds the synthetic story only: allowed, as before
 *
 * Read through the subject's own store: for an account the scope's owner is the signed-in person (self mode), so the
 * scoped store's user rule holds. Her view (family mode) never asks: she cannot ask in his name.
 */
import type { SessionRow, Store } from "@/lib/store/types";

export async function aiConsent(store: Store, scope: Pick<SessionRow, "kind" | "owner_user_id">): Promise<boolean> {
  if (scope.kind !== "account") return true;
  const userId = scope.owner_user_id;
  if (!userId) return false;
  const records = await store.listConsentRecords(userId, { kind: "ai_processing" });
  return records.at(-1)?.decision === "granted";
}
