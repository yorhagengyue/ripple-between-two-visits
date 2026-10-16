"use client";

/**
 * 「已经告诉爸爸了，等他在手机上确认是你。」 (the v3 draft's A3: the sentence, the two-line timeline 「刚刚 你接受了邀请。」 /
 * 「之后 爸爸在他的手机上确认是你。」, and 「退出登录」; the line under the sentence and the note at the bottom are the
 * ones written before the draft: his phone shows her name and account, and she sees nothing until he says it is
 * her). Until he confirms she sees nothing of his, so this
 * screen has no stream of his to listen to: it asks for her own links every two seconds and opens her home the moment
 * he says it is her (or says so when he says it is not).
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FamilyDock, FamilyHero, FamilyNote, FamilyScreen, FamilyTop, Timeline } from "@/components/family-ui";
import { hc } from "@/lib/care/her-copy";
import type { FamilyLinkView } from "@/lib/care/types";
import type { Locale } from "@/lib/i18n";
import { familyCopy } from "@/lib/ui/copy";
import { LogoutButton } from "./HerBits";

const POLL_MS = 2000;

export function WaitingForDad({ locale, linkId, dad, langHref }: { locale: Locale; linkId: string; dad: string; langHref: string }) {
  const router = useRouter();
  const [state, setState] = useState<FamilyLinkView["state"]>("accepted");

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/family/links", { cache: "no-store", credentials: "same-origin" });
        if (res.ok) {
          const body = (await res.json()) as { family: FamilyLinkView[] };
          const mine = body.family.find((l) => l.id === linkId);
          // no row any more: his account is gone and took the link with it; the page then says the connection ended
          if (!mine || mine.state !== "accepted") {
            if (mine) setState(mine.state);
            stop = true;
            router.refresh();
            return;
          }
        }
      } catch {
        // offline for a moment: ask again
      }
      if (!stop) timer = setTimeout(tick, POLL_MS);
    };
    let timer = setTimeout(tick, POLL_MS);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [linkId, router]);

  const copy = familyCopy(locale, dad);
  return (
    <FamilyScreen locale={locale}>
      <FamilyTop brand locale={locale} langHref={langHref} />
      <div className="rpf-col" data-testid="waiting" data-state={state}>
        <FamilyHero tone="quiet" title={copy.inviteWaitTitle} detail={copy.inviteWaitBody} />
        {/* the draft's two lines: what she did, and what is still to come on his phone */}
        <Timeline
          style={{ marginTop: 40 }}
          items={[
            { key: "accepted", kind: "accepted", when: hc(locale, "waitNow"), what: hc(locale, "waitAccepted"), node: "taken" },
            { key: "confirm", kind: "confirm", when: hc(locale, "waitLater"), what: hc(locale, "waitConfirm", { dad }), node: "waiting", state: "future" },
          ]}
        />
        <FamilyDock foot="b" style={{ gap: 14 }}>
          <FamilyNote>{hc(locale, "waitNote", { dad })}</FamilyNote>
          <LogoutButton locale={locale} />
        </FamilyDock>
      </div>
    </FamilyScreen>
  );
}
