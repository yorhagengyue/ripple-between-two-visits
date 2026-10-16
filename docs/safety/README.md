# Safety governance for Ripple

Status: draft 1, 2026-10-16. These five documents describe how Ripple's guided safety harness is bounded, checked and watched. They are written for the owner, for a clinician who will review them, and for a regulator if one asks. None of them has been reviewed by a clinician. None has been sent to HSA or MOH. The evaluation figures in them were filled in on the same day from the runs of 16 October 2026, listed under "Evaluation used" in `hazard-log.md` and `red-lines.md`.

| Document | What it is for |
|---|---|
| [intended-use.md](intended-use.md) | The purpose, the users and the settings; what Ripple does and never does; the line-by-line mapping to AIHGle 2.0 Table 3, 5.5.3, 8.3.3(a); the features near the line; nine questions for the owner to put to HSA |
| [red-lines.md](red-lines.md) | The lines Ripple never crosses, each with where it is enforced in code and which tests would fail; the evaluation runs used, the evaluation slices and their results |
| [hazard-log.md](hazard-log.md) | 26 hazards in the DCB0129 style, with a 5x5 scale, controls, initial and provisional residual ratings, evidence, owner and status |
| [monitoring.md](monitoring.md) | After launch: the review queue, the sample, the metrics, reruns of the evaluation, the synthetic check of the 995 and helplines, incident review, and how to switch the AI off |
| [elder-test-protocol.md](elder-test-protocol.md) | A small test with older adults, or with nurses and pharmacists playing them: tasks, what to watch, consent, how to stop a session, what counts as a failure |

The synthetic check is `web/scripts/ops/crisis-lines-check.ts`.

## Where the code and the data are

| What | Where |
|---|---|
| The contract of the harness (frame, levels, ladder, follow-up, risk summary, table rows) | `web/lib/safety/risk/types.ts` |
| The decision table: every row with a level, fixed lines, a source and a review state | `web/kb/pathways.json` (built on `c2/harness`) |
| The engine: normalisation, risk screen, evidence check, merge, pathways, watch state | `web/lib/safety/risk/` (built on `c2/harness-e1` and `c2/harness`) |
| Fixed sentences and follow-up templates | `web/lib/safety/templates.ts` |
| The evaluation corpus and its runner | `web/eval/harness/` (the corpus, and the held-out file `heldout-1016.jsonl`) and `web/scripts/eval-harness.ts`, with the existing `web/eval/seed.jsonl` and `web/eval/thresholds.json`; the second-model measure is `web/scripts/eval-risk-shadow.ts` |
| The family notice | `web/lib/care/told.ts` |
| The rules floor and the three checks | `web/lib/safety/classify.ts`, `web/lib/safety/verify.ts`, `web/lib/safety/pipeline.ts` |
| Helpline and 995 sources | `web/kb/referrals.json` (rows B1, B4) |

## Terms

- Harness: the guided safety layer around every answer. A rules floor, a sensitive risk screen that reads the last ten turns, an evidence check, a decision table owned by code, scripted follow-up questions with buttons, a self-harm ladder, a watch state, and a degraded mode that runs with no model.
- Level: the medical level of an answer. 1 call 995 now; 2 today, his pharmacist or doctor, with the signs that mean 995; 3 kept for his doctor, with the signs that mean 995; 4 an ordinary answer from his sources.
- Ladder: the self-harm steps beside the levels. `none`; `possible` (ask him); `thoughts` (helplines, his family told, keep talking); `danger` (995 as well).
- Pathway: a short fixed series of at most three questions for one kind of concern (chest, breathing, reading_high, extra_dose, missed_dose, looks_different, side_effect, stop_change, self_harm_check).
- Watch state: a state derived from his own safety records. On for 7 days after thoughts or danger and for 72 hours after possible or distress; the distress part clears with a "no" to the confirm question. These durations are assumptions with no published evidence.
- Degraded mode: the pathways and rules running with no model, because he has not agreed to AI, the cap is reached, the model is down, or the AI has been switched off.

## How these documents stay true

- They point at the table and the engine by path and never copy the rows of the table. They do carry the numbers of the evaluation of 16 October 2026, each with its run, its mode and its commit, and the figures in `red-lines.md` are the one place the others point to. When a row, a prompt or a model changes, the evaluation is rerun (`monitoring.md`) and those numbers are replaced with the date of the new run.
- A number that depends on the first month of use is written `[to fill after the first month]`, and one that depends on the elder test `[to fill after the elder test]`. Other gaps that only a person can fill are written `[to fill: what]`. Where a run did not measure something, the text says "not measured yet". Searching a document for `[to fill` and for "not measured yet" lists what is not done.
- The evaluation slices these documents name are the `category/sub` fields of the corpus under `web/eval/harness/`, the ids of its scripts and cases, and unit test files under `web/tests/unit/`. The table in `red-lines.md` gives each slice its numbers.
- Section numbers of AIHGle 2.0 are as the research report and the October track notes cite them. They are to be checked against the PDF before anything goes to HSA. No copy of the PDF is kept in the repository.
- The ratings in the hazard log were made by the drafter. A clinician must confirm or change them.

## What only the owner and a clinician can do

1. Send the questions in `intended-use.md` to HSA, and record the answers. Until then, no document here claims a ruling.
2. Name a clinical reviewer, and have the reviewer sign the rows of `web/kb/pathways.json` and the hazard log.
3. Have a Mandarin-reading nurse or pharmacist review the Mandarin templates.
4. Decide the supported languages, the family-notice rules, and whether Zero Data Retention is switched on at the vendor.
5. Run the elder test and read its results.
6. Confirm the review times, the sample size and the targets in `monitoring.md` and `red-lines.md`.
7. Add the family notice and the possibility of a human review of flagged conversations to the privacy notice and the consent text.
8. Drill the AI-off switch once on a private instance.

## Change history

- 2026-10-16 draft 1.
- 2026-10-16 evaluation figures filled in from the runs of that day (corpus with no model, held-out with no model and live, the earlier live and timeout runs, the pre-harness baseline, the seed, the unit tests, the second-model measure). Placeholder suite names replaced with the corpus slices and test files that exist. The residual ratings of H03 and H19 raised; no rating lowered.

## Result files

The evaluation runs these documents cite (`fin-*.json`, `harness-*-7ac78f79.json`, `baseline-mock-a10dff0b-rescored.json`) are in [`web/eval/results/harness-1016/`](../../web/eval/results/harness-1016/). The research notes behind the design are in [`research/`](research/): the industry practice survey (Chinese) and the 28-message probe of the safety layer before the harness.
