"use client";

/**
 * His family screens' interactive parts (C2 track D; the elder brief 16-20; laid out as the timeline draft's 16-20 by
 * the front-end line fe-fam, with components/ui and components/his-family):
 *   CareLive      his /p/family re-reads itself when a link changes (she accepted, left; his other phone confirmed)
 *   ConfirmHer    「不是」 / 「是她」 side by side for a link she accepted (real-app 2.20 step 3; the draft's 18-1)
 *   InviteMaker   who she is (the draft's 17-1 with the three things the back end asks), then the one-time link: the
 *                 link in a box, 「发给她」, 「复制」, the QR code and 「现在到哪一步了」 (17-2). Once she has accepted, the
 *                 link is used up: the screen keeps only the steps and the way to 「是她吗？」. With five invitations
 *                 already waiting it says so and lists them instead of a form that cannot succeed.
 *   LinkSwitches  the six switches for one link in one card (16-1), each changed at once (her screen follows within a
 *                 second)
 *   StopSharing   「停止分享给 Wei Ling」 on its own screen (20-1): one tap, at once, for good (he can invite again; no
 *                 undo by the elder brief), then back to her page, which says it has stopped (20-2)
 *   CancelInvite  「取消这个邀请」 while nobody has accepted it
 * A tap that did not work says so in the red-bordered box (components/his-family Failed) and changes nothing.
 */
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { useLiveEvent } from "@/components/live/LiveSession";
import { Failed, InviteSteps, isStepState, Lead } from "@/components/his-family/pieces";
import { ActionDock, BodyText, Box, Button, ButtonRow, FamilySwitchRow, Field, ListCard, ListItem, Option, OptionList, PrimaryButton, SecondaryButton, SectionTitle, ToggleList } from "@/components/ui";
import { dayWords, linkStateWords, relationWord, RELATIONS, switchSees, switchTitle } from "@/lib/care/copy";
import { pc } from "@/lib/care/his-copy";
// line bind (only add): the line that introduces the invitation when the direct way stands above it
import { bc } from "@/lib/care/bind-copy";
import { dateIn } from "@/lib/care/time";
import type { LinkState } from "@/lib/care/types";
import { NO_GRANTS } from "@/lib/family/types";
import type { Locale } from "@/lib/i18n";
import type { FamilyGrantItems } from "@/lib/store/types";
// C2 track I (real-app 2.19 step 3): 「发给她」 through the phone's share sheet, 「复制」, and the link as a QR code
import { InviteActions, InviteQr } from "./InviteShare";

const CARE_EVENTS = ["care_link.invited", "care_link.accepted", "care_link.confirmed", "care_link.declined", "care_link.revoked", "care_link.left", "family_grant.changed"] as const;

export function CareLive() {
  const router = useRouter();
  useLiveEvent(() => router.refresh(), CARE_EVENTS);
  return null;
}

async function post(path: string, body: unknown, method = "POST"): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(body ?? {}), credentials: "same-origin", cache: "no-store" });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

export function ConfirmHer({ linkId, locale }: { linkId: string; locale: Locale }) {
  const router = useRouter();
  const [pending, setPending] = useState<"yes" | "no" | null>(null);
  const [failed, setFailed] = useState(false);
  const answer = async (yes: boolean) => {
    setPending(yes ? "yes" : "no");
    setFailed(false);
    const r = await post(`/api/family/links/${encodeURIComponent(linkId)}/confirm`, { yes });
    setPending(null);
    if (!r.ok) return setFailed(true);
    router.push(yes ? `/p/family/${encodeURIComponent(linkId)}` : "/p/family");
    router.refresh();
  };
  return (
    <ActionDock>
      {failed && <Failed>{pc(locale, "failed")}</Failed>}
      <ButtonRow cols={2}>
        <SecondaryButton onClick={() => void answer(false)} pending={pending === "no"} disabled={pending !== null} data-testid="confirm-no">
          {pc(locale, "no")}
        </SecondaryButton>
        <PrimaryButton onClick={() => void answer(true)} pending={pending === "yes"} disabled={pending !== null} data-testid="confirm-yes">
          {pc(locale, "yes")}
        </PrimaryButton>
      </ButtonRow>
    </ActionDock>
  );
}

type Relation = (typeof RELATIONS)[number];

/** One of his links as the invitation screen needs it (the page reads them again on every change: CareLive). */
export interface InviteLinkInfo {
  id: string;
  state: LinkState;
  /** 「女儿 Wei Ling」 */
  who: string;
  /** ISO: when the invitation was made, and when it stops working (an invitation still open) */
  invitedAt: string | null;
  expiresAt: string | null;
}

export function InviteMaker({
  locale,
  defaultName,
  links = [],
  full = false,
  tz = "Asia/Singapore",
  direct,
}: {
  locale: Locale;
  defaultName?: string;
  /** his links as they stand now: the screen of a link just made follows its state */
  links?: readonly InviteLinkInfo[];
  /** as many invitations are waiting as there may be: no new one can be made */
  full?: boolean;
  /** his time zone, for the dates in 「现在到哪一步了」 */
  tz?: string;
  /**
   * Line bind: the direct way (components/his-family/BindFamily: he types her account), drawn above the invitation
   * while no link has been made on this screen. With it the invitation is the second way: introduced by 「她还没有账号？
   * 发一个邀请链接给她。」, its opening sentence in the grey body size, its button outlined (one solid button a screen).
   */
  direct?: ReactNode;
}) {
  const zh = locale === "zh-Hans";
  const ids = useId();
  const [name, setName] = useState(defaultName ?? "");
  const [relation, setRelation] = useState<Relation | null>("daughter");
  const [calls, setCalls] = useState(zh ? "爸爸" : "Dad");
  const [pending, setPending] = useState(false);
  const [nameMissing, setNameMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ url: string; id: string; invitedAt: string | null; expiresAt: string | null; name: string } | null>(null);
  const day = (iso: string | null | undefined) => (iso ? dayWords(dateIn(iso, tz), locale) : null);

  if (made) {
    const mine = links.find((l) => l.id === made.id);
    const state: LinkState = mine?.state ?? "invited";
    const text = pc(locale, "waText", { calls: calls || (zh ? "爸爸" : "Dad"), url: made.url });
    return (
      <div className="rph-fill" data-testid="invite-made" data-url={made.url} data-link={made.id} data-state={state}>
        <div className="rpu-stack">
          {state === "invited" && (
            <>
              <Lead>{pc(locale, "made")}</Lead>
              <BodyText variant="lede">{pc(locale, "madeBody")}</BodyText>
              <Box title={pc(locale, "linkBoxTitle")}>
                <span className="rph-url" data-testid="invite-link">
                  {made.url}
                </span>
              </Box>
              {/* C2 track I: 「发给她」 (the share sheet; WhatsApp where there is none) and 「复制」, then the link as a QR code */}
              <div className="rpu-btns">
                <InviteActions url={made.url} text={text} locale={locale} />
              </div>
              <InviteQr url={made.url} locale={locale} />
            </>
          )}
          {isStepState(state) ? (
            <>
              <BodyText variant="strong">{pc(locale, "stepsTitle")}</BodyText>
              <InviteSteps locale={locale} state={state} sent={day(mine?.invitedAt ?? made.invitedAt)} until={day(mine?.expiresAt ?? made.expiresAt)} />
            </>
          ) : (
            <Box variant="grey" title={linkStateWords(state, locale)} />
          )}
        </div>
        <ActionDock>
          {state === "accepted" && (
            <PrimaryButton href="/p/family" data-testid="invite-to-confirm">
              {pc(locale, "toConfirm")}
            </PrimaryButton>
          )}
          {state === "active" && (
            <PrimaryButton href={`/p/family/${encodeURIComponent(made.id)}`} data-testid="invite-to-switches">
              {pc(locale, "toSwitches", { name: made.name })}
            </PrimaryButton>
          )}
          <SecondaryButton href="/p/family" data-testid="invite-back">
            {pc(locale, "backToFamily")}
          </SecondaryButton>
        </ActionDock>
      </div>
    );
  }

  if (full) {
    const open = links.filter((l) => l.state === "invited");
    return (
      <>
      {direct}
      <div className="rph-fill" data-testid="invite-full">
        <div className="rpu-stack">
          <Box variant="acc" title={pc(locale, "tooMany")} />
          {open.length > 0 && (
            <ListCard heading={pc(locale, "openInvites")}>
              {open.map((l) => {
                const until = day(l.expiresAt);
                return <ListItem key={l.id} mark="miss" title={l.who} sub={until ? pc(locale, "stepUntil", { date: until }) : undefined} chevron href={`/p/family/${encodeURIComponent(l.id)}`} />;
              })}
            </ListCard>
          )}
        </div>
        <ActionDock>
          <SecondaryButton href="/p/family" data-testid="invite-back">
            {pc(locale, "backToFamily")}
          </SecondaryButton>
        </ActionDock>
      </div>
      </>
    );
  }

  // line bind: with the direct way above it, the invitation's own button is the outlined one
  const MakeButton = direct ? SecondaryButton : PrimaryButton;
  return (
    <>
    {direct}
    <form
      className="rph-fill"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) {
          setError(null);
          return setNameMissing(true);
        }
        setPending(true);
        setNameMissing(false);
        setError(null);
        const r = await post("/api/family/invites", { family_label: name.trim(), relation: relation ?? undefined, patient_label: calls.trim() || undefined });
        setPending(false);
        if (!r.ok) return setError(r.data.error === "too_many_invites" ? pc(locale, "tooMany") : pc(locale, "errorInvite"));
        const path = String(r.data.path ?? "");
        const link = r.data.link as { id?: string; invitedAt?: string | null; expiresAt?: string | null } | undefined;
        setMade({ url: `${window.location.origin}${path}`, id: link?.id ?? "", invitedAt: link?.invitedAt ?? null, expiresAt: link?.expiresAt ?? null, name: name.trim() });
      }}
      data-testid="invite-form"
    >
      <div className="rpu-stack">
        {direct ? (
          <>
            <BodyText variant="strong">
              <span data-testid="invite-second">{bc(locale, "hisInvite")}</span>
            </BodyText>
            <BodyText variant="lede">{pc(locale, "inviteLead")}</BodyText>
          </>
        ) : (
          <Lead>{pc(locale, "inviteLead")}</Lead>
        )}
        <BodyText variant="lede">{pc(locale, "inviteNote")}</BodyText>
        <SectionTitle>{pc(locale, "whoTitle")}</SectionTitle>
        <Field
          id={`${ids}-name`}
          label={pc(locale, "whoName")}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameMissing) setNameMissing(false);
          }}
          error={nameMissing ? pc(locale, "whoNameNeeded") : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-testid="invite-name"
        />
        <div className="rph-group">
          <p className="rpu rpu-f-label" id={`${ids}-rel`}>
            {pc(locale, "whoRelation")}
          </p>
          <OptionList label={pc(locale, "whoRelation")} testId="invite-relation">
            {RELATIONS.map((r) => (
              <Option key={r} title={relationWord(r, locale)} checked={relation === r} onClick={() => setRelation(r)} attrs={{ "data-choice": r }} />
            ))}
          </OptionList>
        </div>
        <Field id={`${ids}-calls`} label={pc(locale, "whoCalls")} value={calls} onChange={(e) => setCalls(e.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false} data-testid="invite-calls" />
        {error && <Failed testId="invite-error">{error}</Failed>}
      </div>
      <ActionDock>
        <MakeButton type="submit" pending={pending} data-testid="invite-make">
          {pc(locale, "make")}
        </MakeButton>
      </ActionDock>
    </form>
    </>
  );
}

const KEYS = Object.keys(NO_GRANTS) as (keyof FamilyGrantItems)[];

export function LinkSwitches({
  linkId,
  locale,
  initial,
  name,
  lead,
}: {
  linkId: string;
  locale: Locale;
  initial: FamilyGrantItems;
  /** her name: with it, a line over the switches says how many are on right now (ux pass 10-12, round 4) */
  name?: string;
  /** the page's sentence about the switches, drawn between that line and the switches */
  lead?: ReactNode;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [pending, setPending] = useState<keyof FamilyGrantItems | null>(null);
  const [failed, setFailed] = useState(false);
  const change = async (k: keyof FamilyGrantItems, next: boolean) => {
    setPending(k);
    setFailed(false);
    setItems((prev) => ({ ...prev, [k]: next }));
    const r = await post(`/api/family/links/${encodeURIComponent(linkId)}/grants`, { items: { [k]: next } });
    setPending(null);
    if (!r.ok) {
      setItems((prev) => ({ ...prev, [k]: !next }));
      setFailed(true);
      return;
    }
    router.refresh();
  };
  return (
    <div className="rpu-stack" data-testid="link-switches">
      {/* always there, the first line of the screen: how many switches are on; it follows each tap at once */}
      {name ? (
        <div role="status" data-testid="link-sees-now" data-count={KEYS.filter((k) => items[k]).length}>
          <Lead>{pc(locale, "seesNow", { name, n: KEYS.filter((k) => items[k]).length })}</Lead>
        </div>
      ) : null}
      {lead}
      <ToggleList>
        {KEYS.map((k) => (
          <FamilySwitchRow key={k} name={k} title={switchTitle(k, locale)} description={switchSees(k, locale)} locale={locale} on={items[k]} pending={pending === k} onChange={(v) => void change(k, v)} />
        ))}
      </ToggleList>
      {failed && <Failed>{pc(locale, "failed")}</Failed>}
    </div>
  );
}

export function StopSharing({
  linkId,
  locale,
  name,
  after,
}: {
  linkId: string;
  locale: Locale;
  name: string;
  /** where he is taken once it has stopped (her page, which then says so); without it the screen re-reads itself */
  after?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      {failed && <Failed>{pc(locale, "failed")}</Failed>}
      <Button
        variant="danger-solid"
        pending={pending}
        data-testid="stop-sharing"
        onClick={async () => {
          setPending(true);
          setFailed(false);
          (window as unknown as { __rpStopAt?: number }).__rpStopAt = Date.now();
          const r = await post(`/api/family/links/${encodeURIComponent(linkId)}/revoke`, {});
          if (!r.ok) {
            setPending(false);
            return setFailed(true);
          }
          if (after) router.replace(after);
          else setPending(false);
          router.refresh();
        }}
      >
        {pc(locale, "stop", { name })}
      </Button>
    </>
  );
}

export function CancelInvite({ linkId, locale }: { linkId: string; locale: Locale }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      {failed && <Failed>{pc(locale, "failed")}</Failed>}
      <SecondaryButton
        pending={pending}
        data-testid="cancel-invite"
        onClick={async () => {
          setPending(true);
          setFailed(false);
          const r = await post(`/api/family/invites/${encodeURIComponent(linkId)}`, {}, "DELETE");
          setPending(false);
          if (!r.ok) return setFailed(true);
          router.push("/p/family");
          router.refresh();
        }}
      >
        {pc(locale, "cancel")}
      </SecondaryButton>
    </>
  );
}
