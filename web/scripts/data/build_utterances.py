"""Build web/fixtures/visits/<visit>.utterances.json from docs/plan/visits-script.md.

These are what SPEECH_PROVIDER=mock returns: timestamped lines with speaker clusters, as if a
speech service had transcribed the visit. Timing is synthetic (reading speed), not measured.

Usage: python -I build_utterances.py docs/plan/visits-script.md web/fixtures/visits
"""
import json
import re
import sys
from pathlib import Path

script, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)

SECTIONS = {"## D0": "v1", "## D8": "v2", "## D12": "p1", "## D42": "v3"}
ROLE = {"Mr Tan": "patient", "Dr Lim": "doctor", "Auntie Mei": "dispenser", "Pharmacist Raj": "pharmacist", "Wei Ling": "family"}
LANG = {"English": "en", "Singlish": "en-SG", "Mandarin": "zh", "Mandarin + English": "zh-en"}


def seconds_for(text: str) -> float:
    cjk = len(re.findall(r"[一-鿿]", text))
    words = len(re.findall(r"[A-Za-z0-9']+", text))
    return max(1.2, cjk / 4.0 + words / 2.6)


visit, rows = None, {}
counter_mode = False
for line in script.read_text(encoding="utf-8").splitlines():
    if line.startswith("## "):
        visit = next((v for k, v in SECTIONS.items() if line.startswith(k)), None)
        counter_mode = False
        if visit:
            rows.setdefault(visit, [])
        continue
    if visit and line.startswith("**柜台"):
        counter_mode = True
        continue
    if not visit or not line.startswith("|"):
        continue
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    if cells[0] in ("说话人",) or set("".join(cells)) <= set("-: "):
        continue
    if counter_mode:
        speaker, lang, text, item = cells[0], "Mandarin", cells[1], cells[2] if len(cells) > 2 else ""
    else:
        if len(cells) < 4:
            continue
        speaker, lang, text, item = cells[0], cells[1], cells[2], cells[3]
    if speaker.startswith("—") or speaker == "—" or text.startswith("（"):
        continue
    required = None
    m = re.match(r"\*\*(R\d)\*\*\s*(.*)", text)
    if m:
        required, text = m.group(1), m.group(2)
    rows[visit].append({"speaker": speaker, "lang": lang, "text": text, "expected_item": item, "required_line": required})

summary = {}
for v, items in rows.items():
    t = 1500
    clusters = {}
    utts, answers = [], []
    for i, r in enumerate(items):
        uid = f"{v}-u{i+1:02d}"
        dur = int(seconds_for(r["text"]) * 1000)
        cluster = clusters.setdefault(r["speaker"], len(clusters))
        # What a speech service would return: no roles, no names, no expected items.
        utts.append({
            "id": uid,
            "t_start_ms": t,
            "t_end_ms": t + dur,
            "speaker_cluster": cluster,
            "lang": LANG.get(r["lang"], r["lang"]),
            "text": r["text"],
        })
        # Ground truth for tests only. The app must never read this file.
        answers.append({
            "id": uid,
            "true_role": ROLE.get(r["speaker"], "unknown"),
            "speaker_name": r["speaker"],
            "expected_item": r["expected_item"],
            "required_line": r["required_line"],
        })
        t += dur + 700
    mock = {"meta": {"visit": v, "source": "docs/plan/visits-script.md", "timing": "synthetic reading speed, not measured",
                     "use": "SPEECH_PROVIDER=mock returns exactly these fields"},
            "utterances": utts}
    truth = {"meta": {"visit": v, "use": "tests only; app code must not import this file"}, "answers": answers}
    (out_dir / f"{v}.utterances.json").write_text(json.dumps(mock, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / f"{v}.expected.json").write_text(json.dumps(truth, ensure_ascii=False, indent=2), encoding="utf-8")
    summary[v] = (len(utts), [a["required_line"] for a in answers if a["required_line"]], round(t / 1000))
print(summary)
