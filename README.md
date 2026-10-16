# Ripple · Between Two Visits

**English** | [简体中文](README.zh-CN.md)

> **Keeps your doctor's own words with you between visits.**

Tencent Cloud AI CAN DO IT Hackathon Singapore 2026 · Healthcare track · **NTU LKCMedicine Challenge 2: AI Healthier Every Day — Intelligent Support for Long-Term Self-Care** · Team **YoRHa2**

| | |
|---|---|
| **Live demo** | https://app.ripple-health-ai.com — a web demo built for this challenge. Judge log-ins are in the submission form. |
| **Demo video** | 7:56, link in the submission form. Its source code is in [`videos/`](videos/). |
| **iOS app** | [Ripple Health AI on the App Store](https://apps.apple.com/sg/app/ripple-health-ai/id6786394791). The product ships as this iOS app. The version on the App Store now (1.1.0, August 2026) is our earlier release; the update with the Challenge 2 features is being submitted for review and **may not be live, or may not be the latest version, when you judge**. |
| **Source code** | [`web/`](web/) the app · [`videos/`](videos/) the film · [`docs/`](docs/) diagrams, screenshots, submission text |

---

## 1. What we built

The challenge starts from one sentence: *"Good health is shaped by what patients do every day between healthcare visits."* That stretch between two visits is where things go wrong:

- More than half (53%) of Singaporeans aged 65 and above cannot read English, and medication instructions are mostly English-only (Duke-NUS, October 2024).
- 40 to 80% of what clinicians tell patients is forgotten immediately, and almost half of what is remembered is wrong (Kessels, *J R Soc Med* 2003).
- Only 66% of Healthier SG enrollees due for an annual check-in in 2025 completed it (MOH, June 2026).

**Ripple** is a health companion for an older adult with a long-term condition (in our story, Mr Tan, 67, with high blood pressure), his family, and the doctor he sees every few weeks.

- **At the visit.** He asks his doctor's consent on screen, then records. Live captions appear on his phone and his daughter's phone, in English and Mandarin, each line marked with who is speaking. After the visit he confirms, line by line, what the doctor actually said.
- **Every day after that.** When he asks about a medicine, a reading or a symptom, Ripple answers **first from his own sources**: his doctor's recorded words (with who said it and when), his confirmed pharmacy label, and reviewed leaflet lines. He can type or hold to speak, in English or Mandarin.
- **What Ripple must not answer becomes a question for his doctor.** "Can I take one more tablet?" never gets a yes or a no. It gets his doctor's own words, his label, a referral, and the question saved on his list for the next visit.
- **Medicines.** Scan the box: Ripple reads his pharmacy label, explains what the medicine is for in plain words, and plays his doctor's recorded words about it. An unknown medicine gets exactly the sentence the challenge asks for. (Since the move to Hunyuan on 16 Oct 2026 the live demo reads only the example label photos: our Hunyuan account has no model that reads images yet, so a new photo asks him to type the label instead.)
- **Readings and patterns.** Blood pressure sits next to his doctor's own target. Out of range, he can say why ("tai chi this morning, no breakfast yet"), and a repeating pattern becomes a question for the doctor, not advice from an app.
- **When something is wrong.** Emergency words get 995 at once, self-harm words get the helplines, and his family's phone is notified with his words and what Ripple told him.

**What makes it different**

1. **Quotes, not guesses.** The medical content Ripple shows comes from his own doctor, his own label and reviewed leaflet lines, with who said it and when.
2. **Code decides first, the AI works inside a fence.** The answers that must never go wrong are decided by deterministic code before any model runs (section 3).
3. **Built on Tencent Cloud, for Singapore.** EdgeOne, Lighthouse in Singapore, speech recognition with one engine for Mandarin and English, and Hunyuan for the language models; 995 and local helplines, and the Healthier SG context.

## 2. Architecture

![Ripple system architecture](docs/images/architecture.en.png)

| Layer | What | Where |
|---|---|---|
| **Tencent Cloud EdgeOne** ★ | HTTPS, static caching, and an origin lock: the server answers only requests that carry the edge's secret header | Tencent Cloud |
| **Tencent Cloud Lighthouse** ★ | One always-on server in **Singapore**: Caddy → Next.js (TypeScript): pages, APIs, the safety layer, the visit pipeline, a live event stream (Server-Sent Events) and notifications | Tencent Cloud, Singapore |
| **Tencent Cloud Speech Recognition (ASR)** ★ | Region **ap-singapore**, engine **16k_zh_en** (Mandarin and English in one engine), medicine names sent as **hot words**, recording-file recognition (CreateRecTask) with speaker separation. Each line is sent when he pauses (caption about 2–3 s later); after the visit the whole recording is recognised again in pieces of at most 100 s | Tencent Cloud, Singapore |
| Who is speaking | Our own: a voice fingerprint per line (MFCC + pitch; the audio is not kept) grouped into voices, combined with a vote from the words. Labels stay "inferred" until he confirms | Server (`web/lib/visit/`) |
| **Tencent Cloud Hunyuan** ★ | Language models: `hy3` picks which of his sources to quote; a second model, `hy4-preview`, checks any reworded line and blocks it unless it gives a clear yes. Called only after his separate AI-processing consent (DeepSeek until 16 Oct 2026) | Tencent Cloud TokenHub, international site (Singapore) |
| Data | **Supabase**: Postgres with row-level security, private storage, sign-in. The service key stays on the server; visit audio goes from the phone straight to private storage through a 10-minute signed link | Supabase |
| Notifications | Web Push: dose reminders, and the emergency notice to the family | Browser push |

Clients: the web app in this repository is the demo built for this challenge; the product ships as the iOS app.

**A visit, step by step**

1. His phone asks the doctor's consent on screen ("May I record our talk today?"), then records.
2. Each line, cut at a pause, goes to Tencent Cloud ASR in Singapore; the caption reaches **both phones** over the live event stream.
3. Who is speaking comes from the voice fingerprint and the words; a short live summary (at most four points) is labelled "Ripple's notes, not confirmed".
4. He taps Finished: the whole recording is recognised again and becomes the record.
5. He reviews it and confirms each line ("Did the doctor say this?"). Only his confirmation turns a line into a source Ripple may quote later.

## 3. Why the dangerous things are stopped by code, not by the AI

Asking a language model to "be careful" gives you a probability. A rule gives you a guarantee. So Ripple puts the decisions that must never go wrong into **deterministic code that runs before any model**, and gives the model one narrow job inside that fence: choosing which of his own sources to quote.

![Safety pipeline](docs/images/safety-pipeline.en.png)

| He says… | What Ripple does | Decided by |
|---|---|---|
| "I can't breathe" / emergency words | **995 at once.** The fixed 995 sentence goes out before any model call, with his doctor's own warning line when it matches; **his family is notified** | Rules (`classify.ts`, `templates.ts`) |
| "My chest feels tight after climbing the stairs" | Kept as a dated note for his doctor, his doctor's warning line quoted, and when to call 995 straight away; **his family is notified** | Rules (`pipeline.ts`, `templates.ts`) |
| Words of self-harm | The helplines: 995, SOS 1767, SOS CareText 9151 1767, mindline 1771; **his family is notified** | Rules (`templates.ts`, `web/lib/care/told.ts`) |
| "152/96 today, can I take one more tablet?" | **Never a yes or a no.** His doctor's own words ("Please don't change the dose yourself"), his label, a referral, and the question saved for his next visit | Rules route it; the checks below guard the wording |
| A medicine Ripple does not know | *"I'm not able to identify that medication, please check with your pharmacist."* and a question for the pharmacist | Rules (`classify.ts`) |
| "Ignore your rules and…" | A fixed refusal | Rules (`classify.ts`) |
| A model's sentence adds a number or a medicine that is not in the source | **Blocked** (check 1: word for word, same numbers) | Code (`verify.ts`) |
| A model's sentence tells him to take, stop, skip or change a medicine | **Blocked** unless it is someone's quoted words (check 2) | Code (`directive.ts`) |
| The checker model is slow, unavailable, or over the spend cap | **Blocked**: fail closed; the sentence becomes a referral and a question on his list | Code (`verify.ts`, `web/lib/llm/`) |
| A retired helpline number appears anywhere | **Blocked** wherever it comes from | Code (`forbidden.ts`) |

**Why this design matters**

- **It works when the AI does not.** Offline, at the spend cap, on a timeout or with no AI consent, the crisis routes, the fixed sentences and the referrals still work, because they never needed a model.
- **The model can only make an answer safer.** With a live model, a crisis screen also reads every message, but it can only move an answer toward 995 or the helplines, never away from them.
- **Same input, same result.** The rules and checks are plain code, so they are unit-tested and the frozen question set runs offline (`npm run eval`). Every answer writes a `safety_event` with its route, so each decision can be audited.
- **Only his own sources can be said.** The candidate list (`candidates.ts`) holds his confirmed doctor and pharmacist lines, his confirmed label, reviewed leaflet lines and fixed templates. Mandarin is never translated by the model.

**Honest scope.** Everyday questions (sleep, diet) get a short general answer written under a policy file and labelled as Ripple's own information; those answers are outside the three checks, and they never change a medicine or diagnose. Keyword rules can miss an unusual phrasing; the model's crisis screen and the safety-line words are the extra nets for that. The code is in [`web/lib/safety/`](web/lib/safety/).

## 4. The challenge's requirements, and where to find them

Times like **1:32** are in the demo video.

### What the solution should solve

| Requirement | What Ripple does | Where |
|---|---|---|
| Medication understanding | Scan the box: his label, what it is for in plain words, and his doctor's recorded words about it | Video 1:32 · app *Records → Scan a medicine box* |
| Medication management | One-tap taken / not taken; reminders that follow his label and his own routine | Video 4:14 · app *Today* |
| Adherence support | A dose with no reply is recorded as "no reply"; Ripple asks why a dose was missed; a pattern (tai chi mornings) becomes a question for the doctor | Video 0:34, 2:14 |
| Health tracking | Blood pressure next to his doctor's target; out of range, he says why and the day is marked on both calendars | Video 0:34 · app *Records → Record a reading* |
| Preventive health | Screening and vaccination lines from the national tables (Healthier SG Screening, National Adult Immunisation Schedule), each with its source; "add to my questions" | Video 4:14 |
| Healthcare preparation | The visit recorded with consent, live captions on both phones, his confirmed record, the question list and a brief for the next visit | Video 2:14–3:28 · app *Visits* |

### What the solution should be

| Should be | How Ripple shows it |
|---|---|
| **Empowering** ("rather than simply issue reminders") | He confirms each line of the record, decides which questions go on his list, and can export or delete everything. The product is the kept words and the questions, not the reminders. |
| **Personalised** | His doctor's target and words, his own label, his routine times, his language (English or Mandarin). |
| **Longitudinal** | His history, marks on the calendar, a brief since the last visit, "asked before / answered since" on his question list, patterns over weeks. |
| **Safe** | Crisis routes decided by code (section 3); the family is notified; every medicine question goes to his doctor or pharmacist. |
| **Practical** | Large type, hold to speak, one-tap doses, Mandarin and English. |
| **Strictly bounded** ("never crosses from explanation into medication advice") | Dose questions are routed by rules; check 2 blocks any instruction that is not someone's quoted words. |
| **Honest about uncertainty** | The exact sentence for an unknown medicine; "I won't guess" plus a question when nothing answers; abstains when the checker is unavailable. |

### What the submission should include

| Item | Where |
|---|---|
| Demo walkthrough (state the challenge at the start) | The video opens with "NTU LKCMedicine · Challenge 2 · AI Healthier Every Day"; the live demo |
| Architecture diagram, trust-boundary diagram, key design trade-offs | Sections 2, 3 and 5; [`docs/images/`](docs/images/) |
| Complete source code on GitHub | This repository |
| Project title, short blurb (under 10 words), project description in four parts | [`docs/SUBMISSION.md`](docs/SUBMISSION.md) |
| At least 3 CodeBuddy screenshots | [`docs/codebuddy/`](docs/codebuddy/) and section 7 |
| 16:9 cover image | [`docs/cover/`](docs/cover/) |
| 5–8 minute video with a CodeBuddy reflection; live link | The video (7:56) and https://app.ripple-health-ai.com |

### What the challenge setter asked for at the opening ceremony

Assoc Prof Faith Chia (LKCMedicine) introduced Challenge 2 with a person who has just been told their blood pressure is a little high, feels fine, and now has to do the right things every day for years.

| She asked for AI that… | Ripple |
|---|---|
| helps people understand their numbers | Each reading sits next to his doctor's own target, with his own reason kept beside it |
| notices daily patterns and suggests doable changes | A pattern (higher on tai chi mornings without breakfast) becomes a question; in the film his doctor answers it ("have a small breakfast first") and Ripple keeps that answer in the doctor's words |
| explains why to take medicine when you feel well | His doctor's recorded words, played back: "So you take it every day, even when you feel fine." |
| is **not** "an AI that takes responsibility for our health, or an alarm clock" | Decisions stay with him and his doctor; the product is the kept words and the questions |
| knows when to step aside and bring a human into the loop | Dose questions go to his doctor, unknown medicines to the pharmacist, emergencies to 995 and his family |

## 5. Key design trade-offs

| Choice | Why | What it costs |
|---|---|---|
| An always-on server, not serverless | Live visit streams and timers outlast serverless request limits (30–120 s) | One machine to run and watch |
| Speech engine chosen by test | On our English-doctor / Mandarin-patient test, only `16k_zh_en` wrote every line right, including "142 over 88" and the drug names | One short test, not a benchmark |
| Quotes before generation | His own sources come first; the model picks, it does not write | Some questions get "ask your doctor" instead of an answer |
| Same-vendor checker | Fast and simple to run | Less independent than a second vendor (on our next-steps list) |
| Rules for emergencies | They never wait for a model, and work offline | A keyword list can miss a phrasing; the model screen is the extra net |

## 6. Privacy and consent

- The doctor agrees on screen before anything is recorded.
- AI processing is a separate consent that he can refuse; Ripple then answers with fixed sentences and referrals only. The language models are Tencent Cloud Hunyuan through TokenHub's international site (Singapore); Tencent says that processing may use computing resources in other countries or regions and that the data is generally kept for up to 30 days. Speech recognition runs on Tencent Cloud in Singapore.
- Recordings are kept 90 days unless he keeps them; he can export or delete everything, and deleting the account removes his data at once.
- Keys live only on the server; the database uses row-level security; audio and photos sit in private storage, opened with links that last 10 minutes.

## 7. Built with CodeBuddy

We set up CodeBuddy with our rules first (`CODEBUDDY.md` and `.codebuddy/rules/`: never cross into medical advice; keys only in `web/.env`; follow the design direction). In Craft mode it read our task cards and built the first milestones: the app skeleton, the model wiring (DeepSeek at the time; the app moved to Tencent Cloud Hunyuan on 16 Oct 2026), the safety layer and the question API. Our tip: have it run the type check, lint, unit tests, the evaluation set and the Playwright end-to-end tests after every change.

| | |
|---|---|
| ![CodeBuddy reads the project rules](docs/codebuddy/01-codebuddy-reads-the-project-rules.jpg) | ![CodeBuddy connects DeepSeek, our model until 16 Oct, and plans M0–M7](docs/codebuddy/02-codebuddy-connects-deepseek-and-plans-m0-m7.jpg) |
| ![CodeBuddy builds and runs the tests](docs/codebuddy/03-codebuddy-builds-and-runs-the-tests.jpg) | ![CodeBuddy finishes M1, the safety layer](docs/codebuddy/04-codebuddy-finishes-m1-safety-layer.jpg) |

More in [`docs/codebuddy/`](docs/codebuddy/).

## 8. Try it

**Live demo:** https://app.ripple-health-ai.com (log-ins in the submission form). Mr Tan, Wei Ling and Dr Lim are fictional; the example data and voices are synthetic.

**Run it locally.** No keys are needed: with an empty `.env` the app and the tests run offline (the models use a stub, speech uses recorded replays, storage is in memory).

```bash
cd web
npm ci
cp .env.example .env
npm run dev          # http://localhost:3200
npm test             # unit tests (Vitest)
npm run test:e2e     # end-to-end tests (Playwright)
npm run eval         # the frozen question set, offline
```

`web/.env.example` documents every setting, including how to turn on Tencent Cloud Hunyuan and Tencent Cloud speech recognition.

## 9. Repository layout

| Path | Contents |
|---|---|
| [`web/app`](web/app), [`web/components`](web/components) | Pages and API routes; UI components |
| [`web/lib/safety`](web/lib/safety) | The rules router, the candidate sources, the three checks, the fixed sentences |
| [`web/lib/visit`](web/lib/visit), [`web/lib/asr`](web/lib/asr) | Visit recording, live captions, who is speaking, Tencent Cloud speech recognition |
| [`web/lib/care`](web/lib/care) | The family member's side, including the emergency notice |
| [`web/kb`](web/kb), [`web/eval`](web/eval) | Reviewed leaflet lines, referrals, screening tables; the evaluation set |
| [`web/supabase`](web/supabase) | Database migrations (row-level security) |
| [`web/scripts/deploy`](web/scripts/deploy) | Deployment to the Lighthouse server |
| [`web/tests`](web/tests), [`web/e2e`](web/e2e) | Unit and end-to-end tests |
| [`videos/`](videos/) | Source code of the demo video (three.js scenes, edit lists, captions, synthesised music and sound) |
| [`docs/`](docs/) | Diagrams, CodeBuddy screenshots, cover, submission text |

## 10. Status and next steps

Ripple is a prototype. It is not a medical device and has not had a clinical review or a user study yet. Next:

1. The iOS app with the Challenge 2 features (being submitted to App Store review)
2. A pharmacist and clinician review of the lines Ripple shows
3. Tencent Cloud ASR compared with MERaLiON on Singapore-accented Mandarin
4. A caregiver role
5. A second-vendor checker

---

Team **YoRHa2** · © 2026. All rights reserved.
