"use client";

/**
 * 拍药袋 (task M3 item 2): where the medicine is from -> photo (camera, or a sample photo) -> straight to Storage
 * through a signed link -> /api/labels/read -> he checks every line against the label -> /api/meds recognises
 * the medicine and writes the list. One screen per step, big buttons.
 *
 * What is shown back is only: the fields the server read (printed text), the fixed sentence and questions that
 * lib/safety and the server return. Nothing clinical is written here.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLiveSession } from "@/components/live/LiveSession";
import type { Locale } from "@/lib/i18n";
import { chipDetailText, chipFromSentence, chipKindText, sentenceShown } from "@/lib/meds/chips";
import { formatDate, mt, type MedsKey } from "@/lib/meds/i18n";
import { SAMPLE_LABELS, type SampleLabel } from "@/lib/meds/samples";
import { CONFIRM_FIELDS, MED_ORIGINS, type ConfirmField, type LabelReadResponse, type MedOrigin } from "@/lib/meds/types";
import type { ConfirmResult } from "@/lib/meds/write";
import { ApiError, postJson } from "@/lib/session/client";
import { cx } from "./classes";
import { StatusPill } from "./StatusPill";

type Step = "origin" | "photo" | "working" | "check" | "done" | "error";

interface UploadLink {
  path: string;
  url: string;
  method: string;
  headers: Record<string, string>;
}

export function AddLabelFlow({
  locale,
  medId,
  medName,
  medOrigin,
}: {
  locale: Locale;
  /** photographing the label of this medicine (from its card) */
  medId: string | null;
  medName: string | null;
  medOrigin: MedOrigin | null;
}) {
  const { session } = useLiveSession();
  const [step, setStep] = useState<Step>(medId ? "photo" : "origin");
  const [origin, setOrigin] = useState<MedOrigin | null>(medOrigin);
  const [progress, setProgress] = useState<"uploading" | "reading">("uploading");
  const [preview, setPreview] = useState<string | null>(null);
  const [read, setRead] = useState<LabelReadResponse | null>(null);
  const [ticked, setTicked] = useState<ConfirmField[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [error, setError] = useState<MedsKey | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const fields = read ? CONFIRM_FIELDS.filter((f) => read.fields[f] !== null && read.fields[f] !== "") : [];
  const allTicked = fields.length > 0 && fields.every((f) => ticked.includes(f));

  function fail(key: MedsKey) {
    setError(key);
    setStep("error");
  }

  async function sendPhoto(blob: Blob) {
    setStep("working");
    setProgress("uploading");
    setPreview(URL.createObjectURL(blob));
    try {
      const link = await postJson<UploadLink>("/api/upload-url", session.id, { kind: "label", content_type: blob.type || "image/jpeg" });
      const put = await fetch(link.url, { method: link.method, headers: link.headers, body: blob });
      if (!put.ok) return fail(put.status === 415 ? "add.unreadable" : "add.failed");
      setProgress("reading");
      const out = await postJson<LabelReadResponse>("/api/labels/read", session.id, { path: link.path });
      setRead(out);
      setTicked([]);
      setStep("check");
    } catch (e) {
      fail(e instanceof ApiError && (e.status === 415 || e.status === 422) ? "add.unreadable" : "add.failed");
    }
  }

  async function sendSample(name: SampleLabel) {
    const res = await fetch(`/api/labels/sample?name=${name}`).catch(() => null);
    if (!res?.ok) return fail("add.failed");
    await sendPhoto(await res.blob());
  }

  async function save() {
    if (!read || !allTicked || saving) return;
    setSaving(true);
    try {
      const out = await postJson<ConfirmResult>("/api/meds", session.id, {
        read_token: read.read_token,
        confirmed: ticked,
        ...(medId ? { med_id: medId } : { origin: origin ?? "prescription" }),
        locale,
      });
      setResult(out);
      setStep("done");
    } catch (e) {
      fail(e instanceof ApiError && e.status === 409 ? "add.mismatch" : "add.failed");
    } finally {
      setSaving(false);
    }
  }

  function restart() {
    setRead(null);
    setResult(null);
    setTicked([]);
    setError(null);
    setPreview(null);
    setStep(medId ? "photo" : "origin");
  }

  const fieldValue = (f: ConfirmField): string => {
    const v = read?.fields[f] ?? "";
    return f === "dispensed" ? formatDate(locale, v) : v;
  };

  return (
    <div className="flex flex-col gap-4" data-testid="add-flow" data-step={step}>
      {medName ? <p className="text-ink-2">{mt(locale, "add.forMed", { name: medName })}</p> : null}

      {step === "origin" ? (
        <section className="flex flex-col gap-3" data-testid="add-origin">
          <h2 className="text-[22px] font-bold">{mt(locale, "add.originQ")}</h2>
          {MED_ORIGINS.map((o) => (
            <button
              key={o}
              type="button"
              className={`rp-btn ${origin === o ? "rp-btn-accent" : "rp-btn-ghost"} ${cx.bigButton}`}
              aria-pressed={origin === o}
              data-testid={`add-origin-${o}`}
              onClick={() => {
                setOrigin(o);
                setStep("photo");
              }}
            >
              {mt(locale, `origin.${o}`)}
            </button>
          ))}
        </section>
      ) : null}

      {step === "photo" ? (
        <section className="flex flex-col gap-3" data-testid="add-photo">
          <h2 className="text-[22px] font-bold">{mt(locale, "add.photoQ")}</h2>
          {!medId && origin ? (
            <p className="text-ink-2" data-testid="add-origin-chosen">
              {mt(locale, `origin.${origin}`)}
            </p>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            capture="environment"
            hidden
            data-testid="add-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void sendPhoto(file);
            }}
          />
          <button type="button" className={`rp-btn rp-btn-accent ${cx.bigButton}`} data-testid="add-take-photo" onClick={() => fileRef.current?.click()}>
            {mt(locale, "add.takePhoto")}
          </button>
          <p className="mt-2 text-ink-2">{mt(locale, "add.samples")}</p>
          {SAMPLE_LABELS.map((name) => (
            <button key={name} type="button" className={`rp-btn rp-btn-ghost ${cx.bigButton}`} data-testid={`add-sample-${name}`} onClick={() => void sendSample(name)}>
              {mt(locale, `add.sample.${name}`)}
            </button>
          ))}
        </section>
      ) : null}

      {step === "working" ? (
        <section className="flex flex-col gap-3" data-testid="add-working" aria-live="polite">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL of his own photo */}
          {preview ? <img src={preview} alt="" className={cx.photo} /> : null}
          <p className="font-semibold">{mt(locale, progress === "uploading" ? "add.uploading" : "add.reading")}</p>
        </section>
      ) : null}

      {step === "check" && read ? (
        <section className="flex flex-col gap-3" data-testid="add-check">
          <h2 className="text-[22px] font-bold">{mt(locale, "add.checkQ")}</h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL of his own photo */}
          {preview ? <img src={preview} alt="" className={cx.photo} /> : null}
          <p className="text-ink-2">{mt(locale, "add.checkHint")}</p>
          <div className="rp-card p-0" data-testid="add-fields">
            {fields.map((f) => {
              const on = ticked.includes(f);
              return (
                <div key={f} className={cx.field} data-testid={`add-field-${f}`}>
                  <div className="min-w-0">
                    <div className={cx.fieldName}>{mt(locale, `add.field.${f}`)}</div>
                    <div className={cx.fieldValue} data-testid={`add-value-${f}`}>
                      {fieldValue(f)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`rp-btn rp-btn-ghost ${cx.right}`}
                    aria-pressed={on}
                    data-testid={`add-right-${f}`}
                    onClick={() => setTicked((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))}
                  >
                    {on ? mt(locale, "add.isRight") : mt(locale, "add.right")}
                  </button>
                </div>
              );
            })}
          </div>
          <button type="button" className={`rp-btn rp-btn-accent ${cx.bigButton}`} disabled={!allTicked || saving} data-testid="add-save" onClick={() => void save()}>
            {saving ? mt(locale, "add.saving") : mt(locale, "add.save")}
          </button>
          <button type="button" className={`rp-btn rp-btn-ghost ${cx.bigButton}`} data-testid="add-retake" onClick={restart}>
            {mt(locale, "add.retake")}
          </button>
        </section>
      ) : null}

      {step === "done" && result ? (
        <section className="flex flex-col gap-3" data-testid="add-result" data-outcome={result.outcome} data-med={result.med.id}>
          <div className="rp-card flex items-center justify-between gap-3">
            <div>
              <div className="font-bold">{mt(locale, "add.done")}</div>
              <div data-testid="add-result-name">{result.name}</div>
            </div>
            <StatusPill status={result.med.status} locale={locale} />
          </div>
          {result.answer?.sentences.map((s, i) => {
            const chip = chipFromSentence(s);
            const detail = chipDetailText(locale, chip);
            return (
              <div key={i} className="rp-card" data-testid="add-answer-sentence" data-chip={chip.kind}>
                <div className="rp-tag">● {chipKindText(locale, chip)}</div>
                <p className={`${cx.lineText} mt-1.5`}>{sentenceShown(s, locale)}</p>
                {detail ? <div className="rp-src">{detail}</div> : null}
              </div>
            );
          })}
          {result.questions.length > 0 ? (
            <div className="rp-qlist" data-testid="add-questions">
              <div className="rp-q">
                <span className="rp-tag">● {mt(locale, "add.questionAdded")}</span>
              </div>
              {result.questions.map((q) => (
                <div key={q.id} className="rp-q" data-testid="add-question">
                  <p className="rp-qt">{q.text}</p>
                </div>
              ))}
            </div>
          ) : null}
          <Link href={`/p/meds/${encodeURIComponent(result.med.id)}`} className={`rp-btn rp-btn-accent ${cx.bigButton}`} data-testid="add-open-card">
            {mt(locale, "add.openCard")}
          </Link>
          <button type="button" className={`rp-btn rp-btn-ghost ${cx.bigButton}`} data-testid="add-another" onClick={restart}>
            {mt(locale, "add.another")}
          </button>
        </section>
      ) : null}

      {step === "error" ? (
        <section className="flex flex-col gap-3" data-testid="add-error">
          <p className="font-semibold" role="alert">
            {mt(locale, error ?? "add.failed")}
          </p>
          <button type="button" className={`rp-btn rp-btn-accent ${cx.bigButton}`} onClick={restart}>
            {mt(locale, "add.retake")}
          </button>
        </section>
      ) : null}
    </div>
  );
}
