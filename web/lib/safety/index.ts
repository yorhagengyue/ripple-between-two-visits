/**
 * Safety layer entry point (server-only). Everything a patient can read about a medicine goes through ask()
 * or verifySentences(); see pipeline.ts for the flow and verify.ts for the three checks.
 */
export * from "./types";
export { ask, type AskInput, type AskDeps } from "./pipeline";
export { classifyRules, classifyWithModel, targetDrugs, unknownDrugName, type Classification, type ClassifyContext } from "./classify";
export { buildCandidates, medsOnDay, referralCandidate, templateCandidate, type CandidateSet } from "./candidates";
export { layer1, layer2, layer3, originOf, verifySentences, type VerifyContext } from "./verify";
export { extractSlots, missingSlots, type Slots } from "./slots";
export { directiveHits, isDirective } from "./directive";
export { TEMPLATES, ALL_TEMPLATES, UNKNOWN_MED_SENTENCE, selfHarmTemplateIds, type TemplateId } from "./templates";
export { findForbiddenNumbers, forbiddenNumbers } from "./forbidden";
export { renderLines, renderText, allOutputText, citesSource, sentenceText } from "./render";
export { CostGuard, CostLimitError, costLimits, getCostGuard, StoreCostGuard, storeCostGuard, type AskGuard } from "./cost-guard";
export { zhFromSlots } from "./zh";
