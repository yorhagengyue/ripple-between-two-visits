/**
 * The understanding half of the guided safety harness (risk/types.ts is the contract; this file only gathers the functions).
 * The engine calls them in this order for one answer:
 *
 *   const watch = await watchState(store, sessionId, nowMs);                       // his own recent safety records
 *   const input = { message, turns, meds, watch: watch.on, locale };
 *   const rules = rulesFrame(message, { meds, turns });                            // the floor, and the offline frame
 *   const screen = await screenRisk(input, llm, { signal, timeoutMs });            // one model call; frame null offline
 *   const checked = screen.frame ? checkEvidence(screen.frame, input) : null;      // the MODEL's frame only
 *   const frame = mergeFrames(rules, checked?.frame ?? null);                      // never below the rules
 *
 * checkEvidence runs on the model's frame before the merge, never on the rules' (whose baseline "no" / "none" carry no
 * quote by design). normalizeForRules / normalizedVariants are what the rules read; missingFor recomputes `missing`;
 * missedDoseQuote reads a missed dose, which the Frame has no field for yet.
 */
export { normalizeForRules, normalizedVariants } from "./normalize";
export { rulesFrame, missingFor, missedDoseQuote, MISSING_FACTS, type RulesContext } from "./rules-floor";
export { screenRisk, RISK_SCREEN_TIMEOUT_MS, SYSTEM_RISK_SCREEN, type ScreenResult } from "./screen";
export { checkEvidence, quoteChecks, type EvidenceMiss } from "./evidence";
export { mergeFrames } from "./merge";
export { watchState, CONFIRM_NO_ROW, WATCH_POSSIBLE_HOURS, WATCH_THOUGHTS_DAYS, type WatchState } from "./watch";
