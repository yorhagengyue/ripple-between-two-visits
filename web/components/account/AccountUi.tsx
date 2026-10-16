"use client";

/**
 * The account screens' pieces (track A), on Mr Tan's side (components/ui, 适老的极简): the top line of a step (返回 and
 * where he is), a labelled field, a password field with 「显示密码」, one-of-several big choices, a consent text, an
 * error line, the recovery code and its printable card. Styles: account.css (.rpa-*, only --rp-* tokens).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icons";
import { UiLink } from "@/components/ui/UiLink";
import type { AccountCopy } from "@/lib/auth/copy";
import type { ReadAloudScreen } from "@/lib/auth/read-aloud-text";
import "./account.css";

/** The class names of account.css (global CSS with the .rpa- prefix: this app's pipeline has no CSS modules). */
const s = {
  top: "rpa-top",
  backButton: "rpa-back-button",
  topEnd: "rpa-top-end",
  stepLabel: "rpa-step-label",
  fieldNote: "rpa-field-note",
  textButton: "rpa-text-button",
  monoInput: "rpa-mono-input",
  error: "rpa-error",
  choices: "rpa-choices",
  choice: "rpa-choice",
  choiceMark: "rpa-choice-mark",
  choiceText: "rpa-choice-text",
  choiceTitle: "rpa-choice-title",
  choiceSub: "rpa-choice-sub",
  paragraphs: "rpa-paragraphs",
  link: "rpa-link",
  links: "rpa-links",
  assisted: "rpa-assisted",
  code: "rpa-code",
  card: "rpa-card",
  cardTitle: "rpa-card-title",
  cardRow: "rpa-card-row",
  cardCode: "rpa-card-code",
  device: "rpa-device",
  deviceTitle: "rpa-device-title",
  deviceStatus: "rpa-device-status",
  deviceAction: "rpa-device-action",
  noPrint: "rpa-no-print",
  read: "rpa-read",
  readNote: "rpa-read-note",
} as const;

/** The top line of a step: 「‹ 返回」 (a button, or a link), where he is (第 2 步，共 9 步), the other language. */
export function StepTop({
  backLabel,
  onBack,
  backHref,
  step,
}: {
  backLabel: string;
  onBack?: () => void;
  backHref?: string;
  /** 「第 2 步，共 9 步」 */
  step?: string;
  langHref?: string;
  langLabel?: string;
}) {
  return (
    <div className={`rpu ${s.top}`} data-rp="meta">
      {onBack ? (
        <button type="button" className={s.backButton} onClick={onBack} data-testid="step-back">
          <Icon name="back" />
          {backLabel}
        </button>
      ) : backHref ? (
        <UiLink href={backHref} className={s.backButton} data-testid="step-back">
          <Icon name="back" />
          {backLabel}
        </UiLink>
      ) : (
        <span />
      )}
      <span className={s.topEnd}>
        {step && <span className={s.stepLabel}>{step}</span>}
        {/* owner 10-15: no 「中 EN」 at the top right; the language is set in 「我」 / 「我的」 and English is the default until then (langHref / langLabel may still be passed) */}
      </span>
    </div>
  );
}

export interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  note?: string;
  error?: string | null;
  type?: "text" | "password" | "email";
  autoComplete?: string;
  inputMode?: "text" | "email" | "numeric";
  autoCapitalize?: "none" | "characters" | "words" | "sentences";
  mono?: boolean;
  testId?: string;
  autoFocus?: boolean;
  /** extra controls on the field's line (the 「显示密码」 button) */
  extra?: ReactNode;
  lang?: string;
}

/** A labelled 56px field (the elder side's .rpu-field), its note and error read out with it. */
export function Field({ label, value, onChange, placeholder, note, error, type = "text", autoComplete, inputMode, autoCapitalize, mono, testId, autoFocus, extra, lang }: FieldProps) {
  const id = useId();
  const described = [note ? `${id}-note` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="rpu rpu-field">
      <label className="rpu-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`rpu-field-input${mono ? ` ${s.monoInput}` : ""}`}
        data-rp-role="body"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        data-testid={testId}
        autoFocus={autoFocus}
        lang={lang}
      />
      {extra}
      {note && (
        <p id={`${id}-note`} className={s.fieldNote}>
          {note}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={s.error} role="alert" data-testid={testId ? `${testId}-error` : undefined}>
          {error}
        </p>
      )}
    </div>
  );
}

/** A password field with a worded 「显示密码 / 隐藏密码」 button (no eye icon on its own). */
export function PasswordField(props: Omit<FieldProps, "type" | "extra" | "mono"> & { copy: AccountCopy; newPassword?: boolean }) {
  const [shown, setShown] = useState(false);
  const { copy, newPassword, ...rest } = props;
  return (
    <Field
      {...rest}
      type={shown ? "text" : "password"}
      autoComplete={newPassword ? "new-password" : "current-password"}
      autoCapitalize="none"
      extra={
        <button type="button" className={s.textButton} onClick={() => setShown(!shown)} aria-pressed={shown} data-testid={rest.testId ? `${rest.testId}-show` : undefined}>
          {shown ? copy.hidePassword : copy.showPassword}
        </button>
      }
    />
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  title: ReactNode;
  sub?: ReactNode;
  lang?: string;
}

/** One of a few big choices (a radio group): tapping picks one, 「下一步」 goes on. Picked: accent border and a tick. */
export function ChoiceList<T extends string>({ label, options, value, onChange, testId }: { label: string; options: ChoiceOption<T>[]; value: T | null; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className={`rpu ${s.choices}`} role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={s.choice}
          onClick={() => onChange(o.value)}
          data-choice={o.value}
          lang={o.lang}
        >
          <span className={s.choiceMark} aria-hidden="true">
            {value === o.value && <Icon name="check" stroke={3} />}
          </span>
          <span className={s.choiceText}>
            <span className={s.choiceTitle}>{o.title}</span>
            {o.sub && <span className={s.choiceSub}>{o.sub}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** A consent text as published: paragraphs, and list items for the ones starting with 「· 」. */
export function Paragraphs({ paragraphs, testId }: { paragraphs: readonly string[]; testId?: string }) {
  return (
    <div className={`rpu ${s.paragraphs}`} data-testid={testId}>
      {paragraphs.map((p, i) => (
        <p key={i} data-item={p.startsWith("· ") ? "true" : undefined} data-rp-role="body">
          {p}
        </p>
      ))}
    </div>
  );
}

export function ErrorText({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className={`rpu ${s.error}`} role="alert" data-testid={testId}>
      {children}
    </p>
  );
}

/** A note for when a family member is tapping: these consents are his to give. */
export function AssistedNote({ children }: { children: ReactNode }) {
  return (
    <p className={`rpu ${s.assisted}`} data-testid="assisted-note">
      {children}
    </p>
  );
}

/** The recovery code, big, monospace, selectable in one tap; read out one group at a time. */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <p className={`rpu ${s.code}`} data-testid="recovery-code" aria-label={`${label}: ${code.split("").join(" ")}`}>
      {code}
    </p>
  );
}

/** The card he prints (or photographs): app, account, code and how to use it. */
export function RecoveryCard({ copy, login, code }: { copy: AccountCopy; login: string; code: string }) {
  return (
    <section className={`rpu ${s.card}`} data-testid="recovery-card" aria-label={copy.cardTitle}>
      <p className={s.cardTitle}>{copy.cardTitle}</p>
      <p className={s.cardRow}>
        <strong>{copy.cardAccount}</strong>
        {login}
      </p>
      <p className={s.cardRow}>
        <strong>{copy.cardCode}</strong>
        <span className={s.cardCode}>{code}</span>
      </p>
      <p className={s.cardRow}>{copy.cardUse}</p>
    </section>
  );
}

/** Links under a step (已经有账号？登录 · 忘记密码？). `newTab`: opens beside the steps, so nothing typed is lost. */
export function StepLinks({ links }: { links: { href: string; label: string; testId?: string; newTab?: boolean }[] }) {
  return (
    <nav className={`rpu ${s.links}`}>
      {links.map((l) =>
        l.newTab ? (
          <a key={l.href} href={l.href} className={s.link} data-testid={l.testId} target="_blank" rel="noopener">
            {l.label}
          </a>
        ) : (
          <UiLink key={l.href} href={l.href} className={s.link} data-testid={l.testId}>
            {l.label}
          </UiLink>
        ),
      )}
    </nav>
  );
}

/** Keep the page's language for the next pages (the rp_lang cookie), e.g. after the language chip asked for ?lang=. */
export function RememberLanguage({ locale }: { locale: string }) {
  useEffect(() => {
    document.cookie = `rp_lang=${encodeURIComponent(locale)}; path=/; max-age=${365 * 24 * 3600}; samesite=lax`;
  }, [locale]);
  return null;
}

/**
 * 「读给我听」 (real-app 2.0: the consent pages and the recovery-code pages). Drawn only when the server says there is a
 * real voice (`available`: the page passes lib/auth/read-aloud.ts accountReadAloudAvailable(); with the mock voice
 * nothing is rendered at all). It asks POST /api/auth/read-aloud for this screen's sentences, part after part: the
 * request names the screen, the language and a part number, never any text. One sound at a time: tapping again stops,
 * and leaving the screen stops.
 */
export function ReadAloud({ screen, locale, copy, available }: { screen: ReadAloudScreen; locale: "zh-Hans" | "en"; copy: AccountCopy; available: boolean }) {
  const [state, setState] = useState<"idle" | "playing" | "failed">("idle");
  const run = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    run.current++;
    audio.current?.pause();
    audio.current = null;
  };
  // leaving the screen (or a new screen under the same button) stops the voice
  useEffect(() => stop, [screen, locale]);
  if (!available) return null;

  async function play() {
    const mine = ++run.current;
    setState("playing");
    try {
      for (let part = 0, parts = 1; part < parts; part++) {
        const res = await fetch("/api/auth/read-aloud", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ screen, locale, part }),
          credentials: "same-origin",
          cache: "no-store",
        });
        if (mine !== run.current) return;
        if (!res.ok) throw new Error("refused");
        parts = Number(res.headers.get("x-ripple-tts-parts") ?? "1") || 1;
        const url = URL.createObjectURL(await res.blob());
        if (mine !== run.current) return URL.revokeObjectURL(url);
        const el = new Audio(url);
        audio.current = el;
        await new Promise<void>((resolve, reject) => {
          el.onended = () => resolve();
          el.onpause = () => resolve();
          el.onerror = () => reject(new Error("audio"));
          el.play().catch(reject);
        });
        URL.revokeObjectURL(url);
        if (mine !== run.current) return;
      }
      setState("idle");
    } catch {
      if (mine === run.current) setState("failed");
    }
  }

  return (
    <div className={`rpu ${s.noPrint}`} data-rp="read-aloud">
      <button
        type="button"
        className={s.read}
        aria-pressed={state === "playing"}
        data-testid="read-aloud"
        data-screen={screen}
        data-state={state}
        onClick={() => {
          if (state === "playing") {
            stop();
            setState("idle");
          } else void play();
        }}
      >
        <Icon name="sound" />
        {state === "playing" ? copy.readAloudStop : copy.readAloud}
      </button>
      {state === "failed" && (
        <p className={s.readNote} role="status" data-testid="read-aloud-failed">
          {copy.readAloudFailed}
        </p>
      )}
    </div>
  );
}

/** Hidden when printing (everything but the card). */
export const noPrint = s.noPrint;
export const accountStyles = s;
