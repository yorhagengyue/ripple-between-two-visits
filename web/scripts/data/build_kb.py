"""Convert Zicheng's v1.1 Singapore drug/referral/screening research into web/kb/*.json.

Usage: python -I build_kb.py <drugs.json> <sources.md> <out_dir>
"""
import json
import re
import sys
from pathlib import Path

drugs_src, md_src, out_dir = map(Path, sys.argv[1:4])
out_dir.mkdir(parents=True, exist_ok=True)

ALIASES = {
    "amlodipine": ["amlodipine besylate", "amlodipine besilate", "norvasc", "氨氯地平"],
    "losartan": ["losartan potassium", "cozaar", "氯沙坦"],
    "metformin": ["metformin hydrochloride", "glucophage", "二甲双胍"],
    "atorvastatin": ["atorvastatin calcium", "lipitor", "阿托伐他汀"],
    "aspirin": ["low-dose aspirin", "acetylsalicylic acid", "cardiprin", "阿司匹林"],
    "paracetamol": ["acetaminophen", "panadol", "扑热息痛", "对乙酰氨基酚"],
    "ibuprofen": ["nurofen", "brufen", "布洛芬"],
}


def slug(name: str) -> str:
    n = name.lower()
    for k in ALIASES:
        if n.startswith(k) or k in n:
            return k
    return re.sub(r"[^a-z0-9]+", "-", n).strip("-")


# ---- drugs ---------------------------------------------------------------
raw = json.loads(drugs_src.read_text(encoding="utf-8"))
drugs, sources = [], {}
FIELDS = ["indication", "how_to_take", "missed_dose", "stop_or_see_doctor", "overdose"]
for d in raw:
    did = slug(d["drug"])
    src_id = f"hh-{did}"
    sources[src_id] = {
        "id": src_id,
        "title": f"HealthHub medication leaflet: {d['drug']}",
        "url": d["url"],
        "page_date": d.get("page_date"),
        "contributor": d.get("contributor"),
        "license": "L4",
        "license_note": "Singapore government content: our own paraphrase with citation only; never copy sentences.",
    }
    entry = {
        "id": did,
        "display_name": d["drug"],
        "aliases": ALIASES.get(did, []),
        "source_id": src_id,
        "fields": {},
        "other_points": [],
        "differences_vs_us_label": d.get("differences_vs_us_label", []),
    }
    for f in FIELDS:
        entry["fields"][f] = {
            "en": d.get(f, ""),
            "zh": "",
            "zh_status": "needs_translation",
            "source_id": src_id,
        }
    for i, p in enumerate(d.get("other_points", [])):
        entry["other_points"].append({
            "key": f"{did}-op{i+1}",
            "topic": p["topic"],
            "en": p["text"],
            "zh": "",
            "zh_status": "needs_translation",
            "source_id": src_id,
        })
    drugs.append(entry)

# ---- referral & screening tables from the markdown ------------------------
md = md_src.read_text(encoding="utf-8").splitlines()


def tables_under(prefixes):
    """Yield (section, header, rows) for markdown tables under ### headings starting with prefixes."""
    section = None
    header = None
    rows = []
    out = []
    for line in md:
        if line.startswith("## ") and not line.startswith("### "):
            if section and header:
                out.append((section, header, rows))
            section, header, rows = None, None, []
            continue
        if line.startswith("### "):
            if section and header:
                out.append((section, header, rows))
            title = line[4:].strip()
            section = title if any(title.startswith(p) for p in prefixes) else None
            header, rows = None, []
            continue
        if section and line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if header is None:
                header = cells
            elif set("".join(cells)) <= set("-: "):
                continue
            else:
                rows.append(cells)
    if section and header:
        out.append((section, header, rows))
    return out


def to_records(tables, kind):
    recs = []
    for section, header, rows in tables:
        code = section.split()[0].replace("　", "")
        code = re.match(r"[A-Z]\d+", section).group(0) if re.match(r"[A-Z]\d+", section) else code
        for i, cells in enumerate(rows):
            rec = {"id": f"{code}-{i+1:02d}", "section": section, "kind": kind}
            for h, c in zip(header, cells):
                key = re.sub(r"[^a-z0-9]+", "_", h.lower()).strip("_") or "note_zh"
                rec[key] = c
            recs.append(rec)
    return recs


referrals = to_records(tables_under(["B1", "B2", "B3", "B4", "B5"]), "referral")
screening = to_records(tables_under(["C1", "C2"]), "screening")

meta = {
    "generated_from": [drugs_src.name, md_src.name],
    "author_of_research": "Zicheng (v1.1, 2026-10-01)",
    "rules": [
        "Patient-facing text is our paraphrase with a citation; never copy HealthHub/HPB/MOH sentences.",
        "US label text is reference only and never shown to the patient.",
        "Numbers marked do-not-display in the B4 notes must never appear in output.",
        "zh fields must be human-reviewed before zh_status becomes 'reviewed'.",
    ],
}

(out_dir / "drugs.json").write_text(json.dumps({"meta": meta, "drugs": drugs}, ensure_ascii=False, indent=2), encoding="utf-8")
(out_dir / "sources.json").write_text(json.dumps({"meta": meta, "sources": sources}, ensure_ascii=False, indent=2), encoding="utf-8")
(out_dir / "referrals.json").write_text(json.dumps({"meta": meta, "referrals": referrals}, ensure_ascii=False, indent=2), encoding="utf-8")
(out_dir / "screening.json").write_text(json.dumps({"meta": meta, "screening": screening}, ensure_ascii=False, indent=2), encoding="utf-8")

print("drugs", len(drugs), [d["id"] for d in drugs])
print("referrals", len(referrals), sorted({r["id"].split("-")[0] for r in referrals}))
print("screening", len(screening), sorted({r["id"].split("-")[0] for r in screening}))
print("referral keys", sorted({k for r in referrals for k in r}))
