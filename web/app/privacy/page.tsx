/**
 * /privacy — 隐私说明 / Privacy notice (docs/plan/real-app.md 3.11 告知; the elder brief 15.5; journey 15; C2 track H;
 * laid out with the timeline draft's pieces, its 15-6). A plain page anyone can read, signed in or not (the sign-up
 * screens open it in a new tab): what Ripple keeps and why, where it is (the database in Tokyo, the server in Singapore,
 * AI answers processed by DeepSeek in China and only with his consent), how long each kind is kept, who can see it, how
 * to export and delete, and who answers for it (track A's DATA_PROTECTION_OFFICER, a placeholder until the owner names
 * one). Fixed words, never a model's (lib/privacy/notice.ts; nothing is reworded here), consistent with the sign-up
 * texts in lib/privacy/consent-texts.ts. 华语 by default; ?lang=en, or the rp_lang cookie, for English.
 *
 * The layout: the header (the way back to Ripple, the title, when it was last updated, the other language), then each
 * section under its ruled title: a pair of term and meaning is a row of a white card (the draft's `list`), a list of
 * sentences hangs under its dots, a paragraph is a paragraph.
 *
 * At the end it publishes the consent texts themselves, as the screens show them and as the consent records point at
 * them (real-app 3.11 「同意文字的定稿……版本加文字」): every kind's text in force, through lib/privacy/consents.ts (track A's
 * sign-up texts, track F's card for the doctor, keeping a recording for good, track D's family texts, the family
 * password help), each in a plain box with its version and the sha256 of exactly those words.
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ConsentText, P } from "@/components/me/parts";
import { Box, Chevron, Icon, ListCard, ListItem, SectionTitle, UiLink } from "@/components/ui";
import { DATA_PROTECTION_OFFICER, type ConsentText as PublishedText } from "@/lib/privacy/consent-texts";
import { currentConsent } from "@/lib/privacy/consents";
import { NOTICE_VERSION, privacyNotice, type NoticeLocale } from "@/lib/privacy/notice";
import type { ConsentKind } from "@/lib/store/types";
import "./privacy.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "隐私说明 · Privacy · Ripple" };

/** The order the page shows the consent kinds in: signing up, a visit, family. */
const CONSENT_ORDER: readonly ConsentKind[] = ["terms_privacy", "ai_processing", "example_data", "visit_recording", "retention_keep_forever", "family_accept", "family_share", "family_reset_helper"];

/** The consent texts he or she agrees to, as published now, in this page's language (the doctor's card exists in English only). */
function publishedConsents(locale: NoticeLocale): PublishedText[] {
  return CONSENT_ORDER.map((kind) => currentConsent(kind, locale));
}

async function noticeLocale(lang: string | string[] | undefined): Promise<NoticeLocale> {
  if (lang === "en" || lang === "zh-Hans") return lang;
  const jar = await cookies();
  return jar.get("rp_lang")?.value === "en" ? "en" : "zh-Hans";
}

export default async function PrivacyPage({ searchParams }: PageProps<"/privacy">) {
  const locale = await noticeLocale((await searchParams).lang);
  const n = privacyNotice(locale);
  const other = locale === "en" ? "zh-Hans" : "en";
  return (
    // The foundation's screen (components/ui Screen: the same two elements and attributes), written out here because
    // this public page's root carries its own: the notice's language and version for the tests, and data-rp-phone, by
    // which the desktop layout (app/desktop.css) keeps a page in the phone's column on a wide window.
    <main className="rpu rpu-screen rpm-screen rpm-privacy" lang={locale} data-rp="screen" data-rp-side="elder" data-rp-phone="" data-fill="viewport" data-testid="page-privacy" data-locale={locale} data-version={NOTICE_VERSION}>
      <div className="rpu-page">
        {/* the header's parts (components/ui PageHeader), with this public page's own two links */}
        <div className="rpu rpu-meta" data-rp="meta">
          <UiLink href="/" className="rpu-back" data-rp="back" data-testid="privacy-home">
            <Icon name="back" stroke={2.8} />
            {/* the notice writes its own 「‹」; the header draws that mark itself */}
            {n.home.replace(/^‹\s*/, "")}
          </UiLink>
          <div className="rpu-meta-row">
            <div className="rpu-meta-text">
              <h1 className="rpu-meta-title" data-rp="page-title">
                {n.title}
              </h1>
              <span className="rpu-meta-story" data-rp="meta-story">
                {n.updated}
              </span>
            </div>
            <span className="rpu-meta-end">
              <UiLink className="rpu-chip-btn" data-kind="lang" href={`/privacy?lang=${other}`} lang={other} data-testid="privacy-lang">
                {n.otherLanguage}
              </UiLink>
            </span>
          </div>
        </div>
        <div className="rpu-stack">
          <P size="large">{n.intro}</P>
          {n.sections.map((s) => (
            <section key={s.id} data-section={s.id} className="rpu-stack">
              <SectionTitle>{s.heading}</SectionTitle>
              {s.terms && (
                <ListCard>
                  {s.terms.map(([term, meaning]) => (
                    <ListItem key={term} title={term} sub={meaning} />
                  ))}
                </ListCard>
              )}
              {s.items && (
                <ul className="rpm-items">
                  {s.items.map((i) => (
                    <li key={i} data-rp-role="body">
                      {i}
                    </li>
                  ))}
                </ul>
              )}
              {s.paragraphs?.map((p) => <P key={p}>{p}</P>)}
            </section>
          ))}
          <section data-section="officer" className="rpu-stack">
            <SectionTitle>{n.officerHeading}</SectionTitle>
            <P>
              {n.officerLine}{" "}
              <b className="rpm-officer" data-testid="privacy-officer">
                {DATA_PROTECTION_OFFICER[locale]}
              </b>
            </P>
          </section>
          <section data-section="consents" data-testid="privacy-consents" className="rpu-stack">
            <SectionTitle>{n.consentsHeading}</SectionTitle>
            <P>{n.consentsIntro}</P>
            {publishedConsents(locale).map((t) => (
              <article key={`${t.kind}-${t.version}`} data-consent={t.kind} data-version={t.version} data-sha256={t.sha256} lang={t.locale}>
                <Box variant="line" title={<span lang={t.title ? t.locale : locale}>{t.title || n.visitCardTitle}</span>}>
                  <span className="rpm-version" lang={locale}>
                    {n.versionLine(t.version)}
                  </span>
                  <ConsentText paragraphs={t.paragraphs} />
                  <details className="rpm-details" lang={locale}>
                    <summary>
                      {n.hashLabel}
                      <Chevron />
                    </summary>
                    <code className="rpm-hash">{t.sha256}</code>
                  </details>
                </Box>
              </article>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
