# Intended use

Status: draft 1, 2026-10-16. Written for the guided safety harness (branch `c2/harness`). Not reviewed by a clinician. Not sent to any regulator. Nothing in this document is a ruling by HSA, MOH or anyone else.

Where this document points at a file, the file is the truth and this document follows it. The decision table is `web/kb/pathways.json`, the contract is `web/lib/safety/risk/types.ts`, and the evaluation is under `web/eval/harness/` run by `web/scripts/eval-harness.ts`. The numbers of the evaluation of 16 October 2026, with the runs they come from, are in `hazard-log.md` ("Evaluation used") and `red-lines.md`. They do not show the detection of self-harm statements to be complete: on fresh wording the live path gave the ladder to 23 of 24 cases and the no-model path to 12 of 24 (`hazard-log.md` H06, H03).

## Intended purpose

Ripple is a medication companion for an older adult with long-term conditions such as high blood pressure, and for the adult child who looks after him from a distance. It helps the older adult understand the medicines he has been prescribed, keep track of doses and blood-pressure readings, keep the words his doctor said at a visit, and save questions for his doctor or pharmacist. It tells the bound family member what he has agreed to share.

Ripple is not a clinician and does not stand in for one. It never gives clinical advice of its own. When a clinician, a pharmacy label or a reviewed leaflet has said something about the medicine, Ripple repeats those words with their source. When none of them has, Ripple says so and saves the question for the right person. When what he says may be an emergency, Ripple points him to 995 first. When what he says may be about hurting himself, Ripple points him to people (SOS 1767, SOS CareText 9151 1767, mindline 1771, and 995 when the danger is immediate) and, with the owner's decision of 2026-10-16, tells the family member bound to him.

The sentence that states the intended purpose, for use on the website and in the app, is:

> Ripple helps an older adult understand the medicines he has been prescribed and keep his own records, by repeating what his doctor, his pharmacy label and the reviewed leaflet have said. It does not diagnose, does not advise on doses or on starting or stopping a medicine, and sends urgent or worrying signs to 995, to helplines, to his family and to his own doctor and pharmacist.

Any claim on the website, in the app store text, in the demo video or in the pitch that goes beyond this sentence changes the intended use and must come back to this document first (see "Changes that move the classification" below).

## Users

The primary user is an older adult in Singapore (about 60 and over) who takes prescribed medicines for one or more long-term conditions, mainly high blood pressure in this release. He may be a native speaker of English, Mandarin, Malay, Tamil or a dialect, and may mix them (Singlish, Mandarin with English drug names). He may hear or see less well than a younger adult and may not be used to apps. He may live alone.

The secondary user is an adult child, or another family member, who is bound to him by his consent. She sees only what his sharing switches allow, with one exception: she is told when he gets a 995 or self-harm answer to his own words (`web/lib/care/told.ts`, the owner's decision of 2026-10-16). See `hazard-log.md` H11.

Not intended users: a clinician as a decision-maker, a child, a person asking about someone else's medicines as if they were his own, a person in an emergency who has no other way to call for help. Ripple is not designed to be the thing a person uses in an emergency. It is designed to send him to 995 if he asks it in one.

## Settings of use

- At home, between visits, on his own phone or a family member's phone, and on a computer browser. The deployment is a single always-on server on Tencent Cloud (Lighthouse, Singapore) behind EdgeOne, with speech recognition in `ap-singapore` and Tencent Cloud Hunyuan models reached through TokenHub's international Singapore site. TokenHub's own pages say processing may use computing resources in other countries or regions, and keep customer content for up to 30 days unless Zero Data Retention is switched on (`web/lib/llm/hunyuan.ts` quotes the pages). The privacy notice and the AI-processing consent say that data leaves Singapore (`web/lib/privacy/notice.ts`).
- In the clinic, at a visit he chooses to record. Ripple transcribes the recording, keeps the doctor's words and attaches them to his medicines. A person in the room may be asked by him to speak.
- In the competition demo, with a synthetic person (Mr Tan) and no real health data. The demo sandbox is not a clinical setting and holds nothing real.
- Not in a hospital, not as a device connected to a clinical system, not for any person who has not agreed to use it.

## What Ripple does

1. Explains a medicine he takes by quoting his pharmacy label, his doctor's recorded words and the reviewed leaflet restatements (`web/kb/patient_text.json`), each with its source, word for word. A short plain-language gloss of those quotes may follow, written by a model, tied to the quotes and checked (`web/lib/safety/gloss.ts`).
2. Keeps his records: doses taken or not taken, blood-pressure readings against the number his doctor gave, the doctor's warning line, questions to ask.
3. Saves a question for his doctor or his pharmacist when no source answers it.
4. Transcribes and, where he asks, translates what the doctor said at a visit, keeping the original words.
5. Reminds him of doses and tells the bound family member what his switches allow.
6. Sends a red-flag symptom, a reading above his doctor's own number, an overdose, or a sign of self-harm to 995, to helplines or to his clinician, with fixed sentences (`web/lib/safety/templates.ts`).
7. After the harness is released: asks at most three fixed follow-up questions with buttons when the decision table needs a fact he has not said, always showing 995 and the helplines first when they may apply (`web/lib/safety/risk/types.ts`, `FollowUp`).
8. After the harness is released: keeps a watch state for a number of days after signs of low mood or thoughts of self-harm, during which any question about how much of a medicine is too much goes up the self-harm ladder instead of to his doctor's question list.

## What Ripple never does

The full list, with where each line is enforced in code and how it is tested, is `red-lines.md`. In short, Ripple never gives a dose, never diagnoses, never tells him to start, stop, skip, double or change a medicine, never judges a reading as normal or dangerous in its own words, never gives an amount in answer to a question about what would kill, never makes 995 wait for a model, never puts a question ahead of 995 or a helpline, and never claims a source says something it does not.

## Mapping to AIHGle 2.0

The Artificial Intelligence in Healthcare Guidelines 2.0 (MOH and HSA, March 2026) is a good-practice guideline. Whether a product is a medical device is decided from its intended purpose under HSA's own guidance (GL-04), not by AIHGle. AIHGle Table 3 gives examples on each side of the line, and the examples are the nearest published statement of where Ripple stands.

Verification status of the quotations in this section:

- Quoted verbatim in the repository (`web/lib/how/stack.ts`, from a local PDF extract in October 2026): the three Table 3 strings marked "verbatim".
- Quoted verbatim in `docs/analysis/ntu-track-deep-read.md` and the October 2026 track notes, extracted from the PDF: the Direct-to-Consumer sentence in section 8.3, the 6.9.6 phrase "limitations, and escalation protocols", and the mental health chatbot example in 8.2.
- Taken from the research report `docs/safety/research/industry-practice.zh-CN.md` only, not re-checked against the PDF: the consumer row of Table 3 ("detects signs and notifies the user"), and the section numbers 5.5.3, 6.6.2, 6.7.1 and 8.3.3(a). The two sources number some sections differently (the track notes cite 5.7.2 and 8.3, the report cites 5.5.3 and 8.3.3). Check every section number against the PDF before this document goes to HSA. No PDF is on this computer now.

### Table 3 rows

| Table 3 row | Ripple feature | Side | Why, and what keeps it there |
|---|---|---|---|
| Non-device: "Software that uses for real-time transcription of speech to text during medical consultation and/or language translation. The software does not provide medical diagnosis or treatment recommendation." (verbatim in the track notes) | Transcription of a recorded visit (Tencent speech recognition), translation of the doctor's line (`web/lib/translate`) | Non-device side | Ripple transcribes and translates what was said and keeps the original. It adds no diagnosis or recommendation. A checked translation is shown under the original words and labelled as a translation. The same software that adds a diagnosis or treatment recommendation would be on the device side, so the visit summary must stay free of both. |
| Non-device: "LLMs that explain side effects of medication prescribed to patients... The software does not provide medical diagnosis or treatment recommendation" (verbatim) | The explain route: quotes of the label, the doctor and the leaflet; the model's short gloss | Non-device side | Every sentence a patient sees passes three checks (`web/lib/safety/verify.ts`): the source and slots, directives and judgement words, and a checker model. The gloss is tied to quotes and absent when any guard fails. |
| Device: "recommendations for medication combinations and dosage adjustments" (verbatim) | Questions such as taking one more tablet, stopping, combining | Ripple stays on the other side by refusing | `refuse_route` relays the doctor's "don't change the dose" line and the label directions and saves the question for the doctor or pharmacist (`web/lib/safety/classify.ts`, `pipeline.ts`). Red lines RL-01 to RL-03. |
| Device: "LLMs that use patient data to provide clinical recommendations to clinicians" (verbatim) | The list of his questions, readings and doses that he can show his doctor | Near the line, on the non-device side | The list holds his own words, his own readings and his doses. Ripple makes no recommendation to the clinician. If a future feature summarises a trend and suggests what the clinician should do, it moves to this row. |
| Non-device: conversational chatbots giving general lifestyle recommendations (track notes, paraphrased) | Ripple's own everyday answer (`web/lib/safety/general.ts`) | Non-device side, with limits | Allowed only inside the owner's policy file (`web/lib/safety/policy`), never on a crisis route, never with a dose or a medicine instruction. |
| Consumer row, from the report only: a wearable that uses AI to detect signs of sleep apnoea and notifies the user is a device | The risk screen that reads his messages for signs of self-harm or an emergency; the watch state; the family notice | Near the line. Ripple's position is argued below, not settled | See "Features near the line" and question 3 to HSA. |

### Section 5.5.3, features can change the classification

The report cites 5.5.3 for the point that adding a feature can move a product from non-device to device. Ripple's answer is a change gate. Before any change is merged that does one of the following, this document and `hazard-log.md` are re-read and the result is written in the pull request:

- It makes Ripple output a number to take, a change to a regimen, a ranking of medicines, or a judgement of a reading in Ripple's own words.
- It lets a model decide a level (urgency) instead of the decision table.
- It derives a health state of the person that is kept and used later (as the watch state does), or sends it to someone.
- It gives a clinician a recommendation.
- It adds a medicine data source, or a new kind of person (a child, a patient with a dependant) to the intended users.
- It adds a claim to the app, the site or the pitch about detecting, monitoring, preventing or managing a condition.

### Section 8.3.3(a), outputs must not need clinical expertise to interpret

The text in the track notes (verbatim): "DTC applications should not generate outputs requiring clinical expertise to interpret safely, even when accompanied by disclaimers about not providing medical advice." Ripple's design answers it in four ways, and has one known weak point.

- The outputs are quotations of his own doctor, his own label and a reviewed restatement of a leaflet, in short sentences. The leaflet restatements are written for an older reader (`web/kb/patient_text.json`).
- The answer to a worrying sign is a fixed sentence with an action (call 995, ask your pharmacist today), not an explanation that needs interpreting.
- The follow-up questions are one fact at a time, with large buttons and a "not sure" button that is treated as the dangerous side.
- The weak point is a verbatim quotation from a doctor or a leaflet that an older adult cannot understand. Quoting it word for word is the safe choice for the source and a risk for comprehension. The elder test in `elder-test-protocol.md` measures comprehension of the quotations and of the follow-up questions, and the hazard log carries it as H21. Until that test has run, this section is not satisfied, only argued.

### 6.9.6, telling the user it is an AI and what the limits are

The track notes record that the guideline asks that the patient is clearly told he is talking to an AI, with its limitations and escalation protocols. The sign-up AI-processing consent, the "how it works" page and the fixed no-AI sentence (`web/lib/safety/no-ai.ts`) say it. The escalation protocol is 995, the three helplines, his own clinician and his family member. The wording of this notice has not been reviewed by anyone outside the project.

## Features near the line

These features are on the non-device side by design but are the ones a regulator could read differently. They are the reason for the questions below.

1. **Symptom follow-up questions.** Ripple asks, for example, whether chest pain is still happening and for how long, and the answer decides between "call 995 now", "ask your pharmacist or doctor today" and "kept for your doctor". The answer is a referral, never a treatment, and the decision table is fixed code with a published source on every row. It is still a form of triage. The table's rows are `pending_clinician` until a clinician signs them.
2. **The risk screen.** A model reads his message and the last ten turns and fills a frame of facts, each quoting his own words. It detects signs (of an emergency, of thoughts of self-harm) and the code then acts. This is the nearest thing to the consumer row about detecting signs and notifying.
3. **The watch state.** After signs of low mood or thoughts of self-harm, Ripple treats him differently for a number of days. It derives a state about his mental health from his own messages and keeps it. The durations are an assumption without published evidence (`hazard-log.md` H10).
4. **The family notice.** Ripple tells a third party that he received a 995 or self-harm answer, with his words and what Ripple showed him. It does this whatever his sharing switches say. This is a disclosure of sensitive information to another person by the product itself, and the owner decided it knowingly (H11).
5. **"Kept for your doctor".** A recorded sign marked for the doctor with the date and time (`web/lib/daily/signals.ts`) is a form of symptom monitoring. It records and repeats; it does not interpret.
6. **Readings against his doctor's number.** Ripple compares a reading with the number his doctor said at a visit and quotes the doctor's line. It does not set the number.

## Questions to put to HSA

For the owner to send. None of them has an answer yet. The list is short on purpose. Each is a question about classification or expectation; none of them assumes an answer.

1. On the intended-purpose sentence above, does HSA regard Ripple as a medical device under GL-04? If a different wording of the sentence would change the answer, which wording?
2. The follow-up questions lead from a symptom to "call 995 now", "ask your pharmacist today" or "kept for your doctor". Does HSA treat a scripted referral of this kind as triage that is "medical diagnosis or treatment recommendation" in the sense of Table 3, or as navigation to professional care? Does it matter that every row cites a public source and has a clinician's sign-off?
3. Table 3's consumer row lists a wearable that uses AI to detect signs and notifies the user as a device. Ripple's risk screen detects signs of an emergency or of self-harm in what a user types, and the product then shows him helplines and tells a family member. Is this the same kind of function? Does notifying a third party, rather than the user, change the answer?
4. A model fills the facts and fixed code decides the level from a table of cited rows. Does the use of a model for that step count as adaptive or AI logic for the purposes of the clinical decision support position (the report's second-hand source on GL-07-R2 says software that relies solely on established clinical guidelines and has no adaptive logic or AI is not a device; we have not read HSA's text)?
5. AIHGle 8.3.3(a) asks that outputs do not need clinical expertise to interpret, even with disclaimers. Is a word-for-word quotation of the prescriber's recorded words or of a regulator-approved leaflet, with a short plain-language gloss written by a model and checked against the quotation, acceptable? What evidence of comprehension would HSA expect?
6. What does HSA expect as the "escalation protocol" and the "limitations" notice for a consumer application with no clinician on call: 995, three helplines, his own clinician and a family member?
7. What does HSA or MOH expect after launch for a product on the non-device side: incident reporting, a feedback loop with response times, the ability to switch the AI off (AIHGle 6.7.1 and 6.6.2 as cited in the report), and any reporting of a missed emergency?
8. Which body should the owner ask about health data processed by a model service that may use computing resources in other countries or regions (PDPC, MOH, HSA)? Does the answer depend on whether the product is a device?
9. MOH's parliamentary reply of 27 February 2026 says chatbots should not replace professionals and points to mindline 1771. Does MOH or HSA have a separate expectation for a medication companion that must respond to self-harm statements, beyond showing helplines?

## Review and maintenance

- Owner: Gengyue (the owner), until a clinical safety officer is named.
- This document is re-read at every release that touches `web/lib/safety`, `web/kb/pathways.json`, `web/lib/care/told.ts`, the consent text or the marketing claims, and at least every three months.
- Clinician review: [to fill: name, registration, date]. Until it is filled this document and the decision table are marked as not clinically reviewed.
- Related documents: `red-lines.md`, `hazard-log.md`, `monitoring.md`, `elder-test-protocol.md`.
