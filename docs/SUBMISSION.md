# Submission text

**English** | [简体中文](SUBMISSION.zh-CN.md)

Challenge: **NTU LKCMedicine · Challenge 2 · AI Healthier Every Day** (Healthcare track) · Team **YoRHa2**

## Project title

Ripple · Between Two Visits

## Short blurb (under 10 words)

Keeps your doctor's own words with you between visits.

## Project description

### 1. Project overview: target scenarios, users and value proposition

Ripple is a health companion for older adults living with a long-term condition such as high blood pressure, and for the adult children who help them. It covers the weeks between two clinic visits, where most of the daily decisions happen.

- **At the visit**, he asks the doctor's consent on screen and records. The conversation becomes live captions on his phone and his daughter's phone, each line marked with who is speaking, plus a short live summary. After the visit he confirms, line by line, what the doctor actually said.
- **Every day after that**, when he asks about a medicine, a reading or a symptom, Ripple answers first from his own sources: his doctor's recorded words (with who said it and when), his confirmed medicine label and reviewed leaflet lines. What it must not answer, such as "can I take one more tablet?", becomes a question for his next visit, together with his doctor's own words.
- **When something may be serious**, a sign of an emergency gets 995 at once; words that may mean self-harm get the helplines and one direct question; when a fact is missing (is the pain still there? which medicine?), Ripple asks one scripted question with buttons before it answers; his daughter's phone gets the conversation.

Value: the doctor's instructions keep working at home, in his language; he owns the record; his family hears about the things that matter.

The live web app at app.ripple-health-ai.com is a demo built for this challenge. The product ships as an iOS app; the update with these features is being submitted to App Store review.

### 2. Real-world scenario insights: pain points, target audience, core problems solved

Where the pain points come from:

- More than half (53%) of Singaporeans aged 65 and above cannot read English, and medication instructions are mostly English-only (Duke-NUS, October 2024).
- 40 to 80% of medical information given by clinicians is forgotten immediately, and almost half of what is remembered is incorrect (Kessels, J R Soc Med 2003).
- Only 66% of Healthier SG enrollees due for an annual check-in in 2025 completed it (MOH, June 2026).
- At the opening ceremony, LKCMedicine described a person just told "your blood pressure is a little high" who must do the right things every day for years, and said the aim is not an AI that takes responsibility for our health, or an alarm clock.

Target audience: older adults in Singapore managing a chronic condition (many more comfortable in Mandarin than English), the adult children who support them, and the family doctors who see them every few weeks.

Core problems solved, shown in the film through Mr Tan, 67 (a fictional patient):

1. **Understanding medication**: scan the box; Ripple reads his pharmacy label and plays his doctor's own recorded words about that medicine.
2. **Remembering the visit**: the visit is recorded with consent, captioned live in English and Mandarin, and confirmed by him afterwards.
3. **Questions instead of guesses**: a reading outside his doctor's target, or a pattern (blood pressure higher on tai chi mornings without breakfast), becomes a question on his list for the next visit; the doctor answers it.
4. **Strictly bounded**: dose changes are never answered by Ripple; it shows the doctor's words and the label, and saves the question.
5. **Honest about uncertainty**: an unknown medicine gets the sentence the challenge asks for: "I'm not able to identify that medication, please check with your pharmacist."
6. **Safety**: emergencies are routed to 995 by rules that never wait for a model, and the family is told.

### 3. Comprehensive solution design: business and technical architecture, and how prompts drive the AI

**Business architecture.** Three roles: the elder (owner of his record; confirms what was said; decides what goes on his question list), the family member (follows visits live; is notified of emergencies), and the doctor (whose recorded words are the source Ripple quotes). The loop: visit, record and confirm, daily life with his own sources, questions saved, next visit with the questions ready.

**Technical architecture** (diagram: [`images/architecture.en.png`](images/architecture.en.png)).

- Web app and mobile app clients (the web app is the challenge demo; the product ships as an iOS app).
- A Next.js app (pages, APIs, the safety layer, a live event stream with Server-Sent Events) on a **Tencent Cloud Lighthouse** server in **Singapore**, behind **Tencent Cloud EdgeOne**.
- **Tencent Cloud Speech Recognition** (Singapore region): one engine for Mandarin and English, medicine names sent as hot words; captions arrive about 2 to 3 seconds after each line. Who is speaking is Ripple's guess (voice fingerprints plus a vote from the words) until he confirms.
- **Tencent Cloud Hunyuan** language models through TokenHub's international site: `hy3` reads each message with his last 10 turns for risk and picks what to quote, `hy4-preview` checks reworded lines. TokenHub limits each model to 60 requests a minute; over it the model is rate limited (HTTP 429) and the rules answer alone.
- **Tencent Cloud OCR** (Singapore): label photos read by two engines that check each other; he confirms every field.
- **Supabase**: Postgres with row-level security, private storage, sign-in.

**How prompts drive the AI generation (the trust boundary): the model reads, code decides, Ripple asks** (diagram: [`images/safety-pipeline.en.png`](images/safety-pipeline.en.png)).

**The risk screen prompt reads, it does not decide.** Hunyuan `hy3` reads his message with his last 10 turns and fills a fixed form (who, what, which medicine, how much, when, symptoms still happening now, thoughts of dying, a plan, the means, how soon, a lethal-amount question, what is missing), quoting his words for every field; the prompt is sensitive on purpose. Code checks the quotes asymmetrically (a field that lowers risk needs his exact words), merges the form with the rules' floor (the higher risk wins), and a decision table with a source on every row (61 rows, pending a clinician's signature) decides: 995 now, today, kept for the doctor, or an ordinary answer, plus a self-harm ladder (possible → a direct question; thoughts → helplines and family; danger → 995). When a fact is missing, one scripted question with buttons is asked; "not sure" counts as the dangerous side. On wording nobody tuned on, rules alone caught 12 of 24 self-harm signals; with the model reading the conversation, 23 of 24.

1. **Rules first.** Emergency, self-harm, dose-change, unknown-medicine and injection attempts are routed by code before any model call, with fixed 995 and helpline text. The risk screen can only move an answer toward 995, never away.
2. **Grounded selection, not free writing, for medicines.** The prompt gives the model only his own sources (doctor and pharmacist lines from his recordings, his confirmed label, reviewed leaflet lines, fixed templates) and asks it to choose which to quote.
3. **Three checks on every quoted or reworded line**: every number and medicine must be in the source; instructions appear only as someone's own words; a second model checks reworded lines, and anything but a clear yes is blocked and becomes a referral plus a question on his list.
4. **Everyday questions** (sleep, diet) get a short general answer written under a policy file and labelled as Ripple's own information. It never tells him to change a medicine, never diagnoses, never judges or reassures.
5. **Visit prompts** label who probably spoke and write at most four live summary points, labelled "Ripple's notes, not confirmed"; only his confirmation makes a line part of the record.

**Key design trade-offs.** An always-on server instead of serverless (live streams outlast serverless request limits); the speech engine chosen by test (only one passed our English-Mandarin test; one short test, not a benchmark); quotes before generation; a same-vendor checker (less independent than a second vendor, which is on our next-steps list); emergencies never wait for a model.

**Privacy and consent.** The doctor agrees on screen before anything is recorded; AI processing (Tencent Cloud Hunyuan; Tencent says it may use computing resources in other countries or regions) is a separate consent that he can refuse; label photos are read by Tencent Cloud OCR in Singapore and only the fields he confirms are kept; recordings are kept 90 days unless he keeps them; he can export or delete everything.

### 4. Business value: impact

- **Who it serves**: over 1.4 million residents enrolled in Healthier SG (May 2026), each with one family doctor and a yearly plan, and the older patients among them who cannot read English labels.
- **Defined impact we design for** (not yet measured in a user study): fewer forgotten instructions, because the doctor's own words are kept and played back; more medicine questions answered by the doctor or pharmacist instead of guessed at home; visits that start with the patient's questions ready; family members told about emergencies at once.
- **Who pays**: often the adult child installs it for a parent, while the elder keeps control of his own record.
- **Regulatory fit**: Singapore's AIHGle 2.0 (MOH and HSA) lists software that transcribes and explains without diagnosis or treatment recommendation as a non-device example, and dose recommendations as a device. Ripple stays on the first side by design (guidance, not a ruling on our app).
- **Next steps**: the iOS app (being submitted to App Store review), pharmacist and clinician review of the lines, comparing Tencent ASR with MERaLiON on Singapore-accented Mandarin, a caregiver role, and a second-vendor checker.

## Links

- Live demo: https://app.ripple-health-ai.com (a web demo built for this challenge)
- iOS app: https://apps.apple.com/sg/app/ripple-health-ai/id6786394791 (the Challenge 2 update may not be live yet)
- Source code: https://github.com/yorhagengyue/ripple-between-two-visits
- CodeBuddy screenshots: [`codebuddy/`](codebuddy/)
- Cover image: [`cover/`](cover/)
