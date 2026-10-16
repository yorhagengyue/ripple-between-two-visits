"""Generate web/fixtures/timeline.seed.json for the Mr Tan demo story (docs/plan/visits-script.md)."""
import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

out = Path(sys.argv[1])
rng = random.Random(20260824)  # deterministic

D0 = date(2026, 8, 24)
def d(n):
    return (D0 + timedelta(days=n)).isoformat()

TAI_CHI = {1, 3}  # Tue, Thu (Monday=0)

persona = {
    "id": "mr-tan",
    "display_name": "Mr Tan",
    "chinese_name": "陈先生",
    "age": 67,
    "home": "Toa Payoh",
    "languages": ["zh-Hans", "en-SG"],
    "ui_language": "zh-Hans",
    "large_text": True,
    "routine": [
        {"label": "Morning walk in the park", "label_zh": "公园散步", "days": "daily", "time": "06:30"},
        {"label": "Tai chi", "label_zh": "打太极", "days": ["Tue", "Thu"], "time": "07:30"},
        {"label": "Breakfast", "label_zh": "早饭", "days": "daily", "time": "08:30"},
    ],
    "healthier_sg_clinic": "Blossom Family Clinic (fictional)",
}
family = [{"id": "wei-ling", "display_name": "Wei Ling", "relation": "daughter", "age": 39}]

grants = {
    "wei-ling": {
        "dose_summary": True,
        "bp_summary": True,
        "questions_count": True,
        "no_reply_alert": True,
        "visit_transcripts": False,
        "notes": False,
    }
}

visits = [
    {"id": "v1", "day": 0, "date": d(0), "kind": "healthier_sg_check_in", "place": "Blossom Family Clinic (fictional)", "script_section": "D0", "audio_fixture": "visit_A.wav"},
    {"id": "v2", "day": 8, "date": d(8), "kind": "follow_up", "place": "Blossom Family Clinic (fictional)", "script_section": "D8", "audio_fixture": "visit_B.wav"},
    {"id": "p1", "day": 12, "date": d(12), "kind": "pharmacy", "place": "Neighbourhood pharmacy (fictional)", "script_section": "D12", "audio_fixture": "pharmacy_C.wav"},
    {"id": "v3", "day": 42, "date": d(42), "kind": "follow_up", "place": "Blossom Family Clinic (fictional)", "script_section": "D42", "audio_fixture": "visit_D.wav"},
]

doctor_lines = [
    {"id": "R1", "visit": "v1", "speaker": "doctor", "text": "At home, we want it below 135 over 85.", "kind": "target", "slots": {"systolic": 135, "diastolic": 85}},
    {"id": "R2", "visit": "v1", "speaker": "doctor", "text": "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.", "kind": "threshold", "slots": {"systolic": 180}},
    {"id": "R3", "visit": "v2", "speaker": "doctor", "text": "This tablet works quietly. You won't feel it, and you don't feel the high pressure either, but over the years high pressure damages the heart, the brain and the kidneys. So you take it every day, even when you feel fine.", "kind": "purpose"},
    {"id": "R4", "visit": "v2", "speaker": "doctor", "text": "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.", "kind": "instruction"},
]

medications = [
    {"id": "med-amlodipine", "drug_id": "amlodipine", "origin": "prescription", "prescribed_visit": "v2", "start_day": 9,
     "label": {"text": "AMLODIPINE 5MG TABLET\nTake ONE tablet every MORNING", "drug": "amlodipine", "strength": "5 mg", "directions": "Take ONE tablet every MORNING", "dispensed": d(8), "clinic": "Blossom Family Clinic (fictional)", "photo_fixture": "labels/amlodipine.png"},
     "status": "label_confirmed"},
    {"id": "med-ibuprofen", "drug_id": "ibuprofen", "origin": "self_bought", "label": {"text": "Ibuprofen 200 mg tablets", "drug": "ibuprofen", "strength": "200 mg", "photo_fixture": "labels/ibuprofen.png"},
     "status": "label_confirmed", "note": "bought for knee pain"},
    # start_day 8: the relative's box first shows up at the D8 counter (visits-script D8), so /p/meds lists it from D8
    {"id": "med-relative-box", "drug_id": None, "origin": "relative", "start_day": 8, "label": {"text": "(Chinese-only label)", "photo_fixture": "labels/relative_box.png"},
     "status": "unidentified", "pharmacist_answer": {"visit": "p1", "text": "The label is only in Chinese and I can't confirm what's inside. Please don't take it for now. Bring it to your doctor at your next visit."}},
    {"id": "med-losartan", "drug_id": "losartan", "origin": "prescription", "prescribed_visit": "v3", "start_day": 43,
     "label": None, "status": "awaiting_label"},
]

# --- BP readings ------------------------------------------------------------
bp = []
def reading(day, slot, sys_mean, dia_mean, spread=6):
    s = int(round(rng.gauss(sys_mean, spread)))
    di = int(round(rng.gauss(dia_mean, spread * 0.6)))
    return {"day": day, "date": d(day), "slot": slot, "systolic": s, "diastolic": di}

for day in range(1, 8):
    for slot in ("morning", "evening"):
        if day == 3 and slot == "evening":
            bp.append({"day": day, "date": d(day), "slot": slot, "state": "unconfirmed"})
            continue
        bp.append(reading(day, slot, 146, 92))

# after D8: twice a week (Mon, Fri mornings) until D41
for day in range(9, 42):
    wd = (D0 + timedelta(days=day)).weekday()
    if wd in (0, 4):
        bp.append(reading(day, "morning", 139, 85, 5))
# hero evening reading on D29
bp.append({"day": 29, "date": d(29), "slot": "evening", "systolic": 150, "diastolic": 95, "note": "hero moment"})

# --- dose log -----------------------------------------------------------------
MISSED = {15, 17, 24, 36}  # Tue 8 Sep, Thu 10 Sep, Thu 17 Sep, Tue 29 Sep
dose_log = []
for day in range(9, 42):
    wd = (D0 + timedelta(days=day)).weekday()
    if day in MISSED:
        assert wd in TAI_CHI, (day, wd)
        dose_log.append({"day": day, "date": d(day), "med": "med-amlodipine", "slot": "morning", "state": "missed",
                         "reason": "tai_chi_morning", "reason_text_zh": "打太极，忘了"})
    else:
        dose_log.append({"day": day, "date": d(day), "med": "med-amlodipine", "slot": "morning", "state": "taken"})
assert sum(1 for x in dose_log if x["state"] == "taken") == 29 and len(dose_log) == 33

notes = [
    {"day": 37, "date": d(37), "text_zh": "今天在大巴窑中心走了一圈，脚踝有点肿。", "source": "voice_note"},
    {"day": 20, "date": d(20), "text_zh": "我今天好累。", "source": "typed", "app_reply": "logged; asked whether today's tablet was taken"},
]

questions = [
    {"id": "q-machine", "asked_at_visit": "v1", "for": "doctor", "origin": "before_you_go", "text_zh": "家里那个机器是绑手腕的，可以用吗？", "status": "answered", "answer": {"visit": "v1", "speaker": "doctor", "text": "手腕的不太准。买一个绑手臂的，upper arm 的。"}},
    {"id": "q-knee-1", "asked_at_visit": "v2", "for": "doctor", "origin": "own", "text_zh": "膝盖痛吃药房买的止痛药，可以一起吃吗？", "status": "answered", "answer": {"visit": "v2", "speaker": "doctor", "text": "Which one? Bring it next time and show me. For now, try not to take it every day."}},
    # created_day 8: raised when the box first shows up at the D8 counter, answered at the D12 pharmacy
    {"id": "q-relative-box", "for": "pharmacist", "origin": "unidentified_medicine", "created_day": 8, "text_zh": "亲戚带来的那盒药是什么？可以一起吃吗？", "status": "answered", "answer": {"visit": "p1", "speaker": "pharmacist", "text": "The label is only in Chinese and I can't confirm what's inside. Please don't take it for now. Bring it to your doctor at your next visit."}},
    # answered at the D42 visit (visits-script D42, Gengyue 10-10): Dr Lim's first line after he asks it, word for word,
    # one transcript line like every other answer here (v3-u19; the visit's review stores the same line). Story-day
    # gating keeps it waiting before that visit: the D29 hero reuses it, the D41 brief lists it.
    {"id": "q-extra-tablet", "for": "doctor", "origin": "refused_question", "created_day": 29, "text_zh": "读数高的时候（例如 150/95）可以多吃一粒吗？", "status": "answered",
     "answer": {"visit": "v3", "speaker": "doctor", "text": "No, please don't take an extra tablet on your own. One high reading doesn't mean the dose is wrong; I look at all your readings together, and that's why we're adding losartan today."}},
    {"id": "q-tai-chi", "for": "doctor", "origin": "pattern", "created_day": 25, "text_zh": "打太极的早上我常常忘记吃，可以打完太极回来再吃吗？", "status": "open", "evidence": "4 missed mornings, all on tai chi days"},
    {"id": "q-knee-2", "for": "doctor", "origin": "own", "created_day": 30, "text_zh": "膝盖止痛药还可以吃吗？", "status": "open"},
]

reminder_clips = [{"id": "clip-wei-ling-1", "by": "wei-ling", "text_zh": "爸，早餐吃了吗？药记得吃哦。", "audio_fixture": "reminders/wei_ling.wav", "plays_at": "after_breakfast"}]

seed = {
    "meta": {
        "story": "docs/plan/visits-script.md",
        "d0": D0.isoformat(),
        "judge_landing_day": 29,
        "note": "Synthetic persona. All names, clinics and numbers are fictional and pending clinician review.",
    },
    "persona": persona,
    "family": family,
    "family_grants": grants,
    "visits": visits,
    "required_doctor_lines": doctor_lines,
    "medications": medications,
    "bp_readings": bp,
    "dose_log": dose_log,
    "notes": notes,
    "questions": questions,
    "reminder_clips": reminder_clips,
}

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(seed, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")  # LF on Windows too, like the checked-in seed

home_week = [x for x in bp if 1 <= x["day"] <= 7 and "systolic" in x]
after = [x for x in bp if 9 <= x["day"] <= 41 and "systolic" in x]
avg = lambda xs, k: round(sum(x[k] for x in xs) / len(xs))
print("home week n", len(home_week), "avg", avg(home_week, "systolic"), "/", avg(home_week, "diastolic"),
      "above 135/85:", sum(1 for x in home_week if x["systolic"] >= 135 or x["diastolic"] >= 85),
      "max sys", max(x["systolic"] for x in home_week))
print("after D8 n", len(after), "avg", avg(after, "systolic"), "/", avg(after, "diastolic"),
      "above 135/85:", sum(1 for x in after if x["systolic"] >= 135 or x["diastolic"] >= 85))
print("dose taken", sum(1 for x in dose_log if x["state"] == "taken"), "of", len(dose_log))
