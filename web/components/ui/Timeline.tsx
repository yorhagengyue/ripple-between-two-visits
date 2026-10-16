import type { ButtonHTMLAttributes, CSSProperties, MouseEventHandler, ReactNode } from "react";
import type { NavMotion } from "@/lib/ui/nav-motion";
import { cx, dataAttrs, filmingAttr, type DataAttrs, type UiBaseProps } from "@/lib/ui/props";
import type { NodeKind } from "@/lib/ui/tokens";
import { LOGO_PATHS } from "@/components/auth-ui/logo-paths";
import { UiLink } from "./UiLink";

/**
 * The timeline (the draft's `tl`): a day, an answer or a recording as one rule with a node per entry. The node is the
 * source: its shape says who the entry comes from, and the head line next to it says so in words (lib/ui/tokens.ts
 * NODE_KINDS has the legend). A node never stands alone: an entry always has a head line or a title.
 *
 *   <Timeline>
 *     <TimelineItem node="sch" time="6:30" who="散步" meta="8:30 早饭" />
 *     <TimelineItem node="now" time="8:45" title="早上的药，还没记。">
 *       <SubCard>
 *         <SubRow lead={<PlayCircle playing label="停" />} who="女儿的录音" meta="Wei Ling（示例）· 正在播放">…</SubRow>
 *         <SubRow title="Amlodipine 5 mg" who="药袋" meta="9月1日 配药" link={{ href, label: "看原文" }}>…</SubRow>
 *       </SubCard>
 *     </TimelineItem>
 *     <TimelineItem node="rip" say="好，9:15 再问你。" />
 *   </Timeline>
 *
 * Inside an entry, in the draft's order: the head line (time · who · where from), the title, Ripple's bubble or his own
 * words (`say`), then the children: <Said> (someone's words, serif), <SaidTranslation>, <LabelOriginal> (the dashed
 * frame), <SubCard>; then the grey `note`; then `actions`: <TlControls> (the play pill and square tags) and <Acts> (a
 * row of buttons). `frame` puts the entry in a white card, a dashed card or a card with the accent border; `dim` fades it.
 */
export function Timeline({
  children,
  open = false,
  joinPrev = false,
  joinNext = false,
  filming,
  className,
  style,
  testId,
}: UiBaseProps & {
  children: ReactNode;
  /** the rule runs on below the last node (more follows under the line: buttons, a box) */
  open?: boolean;
  /** this line goes on from the <Timeline> right above it: the rule comes in from the top edge */
  joinPrev?: boolean;
  /**
   * the line goes on in the <Timeline> right below it (which takes `joinPrev`): the rule runs to the bottom edge and the
   * last entry keeps the room an entry has under it, so the two read as one line
   */
  joinNext?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={cx("rpu rpu-tl", className)}
      data-rp="timeline"
      data-open={open ? "true" : undefined}
      data-join-prev={joinPrev ? "true" : undefined}
      data-join-next={joinNext ? "true" : undefined}
      data-testid={testId}
      {...filmingAttr(filming)}
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * Several entries of one line inside an element of their own (a question with its answer, one turn of a day): a real
 * block that a page can find, measure and scroll to, while the rule runs through it as if its entries stood in the
 * <Timeline> directly. Only as a direct child of <Timeline>, with <TimelineItem>s as its direct children; `as` names the
 * element. A caller's own data-* attributes (as props, or in `attrs`) land on it.
 */
export function TimelineGroup({
  children,
  as: Tag = "div",
  testId,
  attrs,
  className,
  style,
  ...rest
}: DataAttrs & {
  children: ReactNode;
  as?: "div" | "article" | "section" | "li";
  testId?: string;
  attrs?: Record<`data-${string}`, string | number | undefined>;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Tag className={cx("rpu-tl-group", className)} data-rp="tl-group" data-testid={testId} {...attrs} {...dataAttrs(rest)} style={style}>
      {children}
    </Tag>
  );
}

const TICK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon="check">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
const BANG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.6} strokeLinecap="round" aria-hidden="true" focusable="false" data-icon="bang">
    <path d="M12 5v9" />
    <path d="M12 19v.2" />
  </svg>
);

/**
 * Ripple's own mark, for a "rip" node (ux pass, 10-12): the upper part of the logo, without the word under it. The paths
 * are the owner's (components/auth-ui/logo-paths.ts): its first six are the mark, the rest spell the name.
 */
const RIPPLE_MARK = (
  <svg viewBox="161 70 296 296" fill="currentColor" aria-hidden="true" focusable="false" data-icon="ripple-mark">
    {LOGO_PATHS.slice(0, 6).map((p, i) => (
      <path key={i} d={p.d} />
    ))}
  </svg>
);
/** The node by itself (the legend, a source line). Decorative: the words next to it carry the meaning. */
export function NodeMark({ node, className, style }: { node: NodeKind; className?: string; style?: CSSProperties }) {
  return (
    <span className={cx("rpu-node", className)} data-node={node} aria-hidden="true" style={style}>
      {node === "ok" ? TICK : node === "sos" ? BANG : node === "rip" ? RIPPLE_MARK : null}
    </span>
  );
}

/** Times that are not "now": his routine, what comes next, what got no reply. */
const QUIET_TIME: readonly NodeKind[] = ["sch", "next", "miss"];

export interface TimelineItemProps extends UiBaseProps {
  node: NodeKind;
  /** "8:45", in front of the head line */
  time?: ReactNode;
  /** who or what: 「早饭」, 「Dr Lim 说过」, 「药袋」; a "rip" node says 「Ripple」 by itself when the entry has no title */
  who?: ReactNode;
  /** where it comes from, after 「 · 」: 「作息」, 「8月24日 看诊 · 录音 0:49」 */
  meta?: ReactNode;
  title?: ReactNode;
  /** "reading": a blood-pressure reading as the title (44); "big": a fact to confirm (32); "large": a question to him (28) */
  titleSize?: "reading" | "big" | "large";
  /** Ripple's fixed sentence (a tinted bubble on a "rip" node) or his own words (plain) */
  say?: ReactNode;
  /** the grey line under the words and cards */
  note?: ReactNode;
  /** what follows the note: <TlControls> (the play pill, tags) and <Acts> (a row of buttons) */
  actions?: ReactNode;
  frame?: "card" | "dash" | "hl";
  dim?: boolean;
  children?: ReactNode;
  testId?: string;
  /** the Today section this entry is (data-today-section) */
  section?: string;
  /** extra data-* attributes for the entry (test hooks) */
  attrs?: Record<`data-${string}`, string | number | undefined>;
  /** wraps the title (and note) so a test hook can sit on exactly those words */
  titleWrap?: (title: ReactNode) => ReactNode;
  /** data-rp for the head line, where an older screen's hook names it ("source-tag": who said it and when) */
  headRp?: string;
  /** a test hook on the head line (who and when), and extra data-* attributes for it */
  headTestId?: string;
  headAttrs?: Record<`data-${string}`, string | number | undefined>;
}

export function TimelineItem({
  node,
  time,
  who,
  meta,
  title,
  titleSize,
  say,
  note,
  actions,
  frame,
  dim,
  children,
  testId,
  section,
  attrs,
  titleWrap,
  headRp,
  headTestId,
  headAttrs,
  filming,
  className,
  style,
}: TimelineItemProps) {
  const name = who ?? (node === "rip" && !title ? "Ripple" : null);
  const hasHead = time != null || name != null || meta != null;
  const heading = title != null ? (
    <p className="rpu-tl-title" data-size={titleSize}>
      {title}
    </p>
  ) : null;
  return (
    <div className={cx("rpu-tl-item", className)} data-rp="tl-item" data-node={node} data-testid={testId} data-today-section={section} {...attrs} {...filmingAttr(filming)} style={style}>
      <div className="rpu-tl-rail">
        <NodeMark node={node} />
      </div>
      <div className="rpu-tl-main">
        <div className="rpu-tl-body" data-frame={frame} data-dim={dim ? "true" : undefined}>
          {hasHead && (
            <p className="rpu-tl-head" data-rp={headRp} data-testid={headTestId} {...headAttrs}>
              {time != null && (
                <span className="rpu-tl-time" data-quiet={QUIET_TIME.includes(node) ? "true" : undefined}>
                  {time}
                </span>
              )}
              {name != null && (
                <span className="rpu-tl-who" data-node={node}>
                  {name}
                </span>
              )}
              {meta != null && (
                <span>
                  {time != null || name != null ? " · " : ""}
                  {meta}
                </span>
              )}
            </p>
          )}
          {heading && (titleWrap ? titleWrap(heading) : heading)}
          {say != null && <Bubble node={node}>{say}</Bubble>}
          {children}
          {note != null && <TlNote>{note}</TlNote>}
          {actions}
        </div>
      </div>
    </div>
  );
}

/** Ripple's fixed sentence in its tinted bubble (node "rip"), or his own words, plain (any other node). Sans. */
export function Bubble({ node = "rip", children, lang, testId }: { node?: NodeKind; children: ReactNode; lang?: string; testId?: string }) {
  return (
    <p className="rpu-bubble" data-rp="bubble" data-node={node === "rip" ? "rip" : undefined} data-rp-role="say" lang={lang} data-testid={testId}>
      {children}
    </p>
  );
}

/**
 * HIS OWN words, as he said or typed them, where there is no line to hang them on (a card, a box, the page the doctor
 * reads): his mark, the solid round node, then who and when in the head line, then the words in the plain face. Never
 * the serif: that is for someone else's words (<Said>, which refuses his). It keeps a line's measures, so it stands
 * flush with a <Timeline> above or below it; on a line itself write <TimelineItem node="me" say={…}>, which draws the
 * same.
 *
 *   <OwnWords who="你问" meta="9月22日">今天 150/95，我能不能多吃一粒？</OwnWords>
 */
export function OwnWords({
  children,
  who,
  meta,
  lang,
  size,
  testId,
  attrs,
  filming,
  className,
  style,
  ...rest
}: UiBaseProps &
  DataAttrs & {
    children: ReactNode;
    /** 「你问」, 「你说」 */
    who?: ReactNode;
    /** when or where, after 「 · 」 */
    meta?: ReactNode;
    /** the language of his words, when it is not the screen's */
    lang?: string;
    /** "sub": the smaller size of a card's row (22) */
    size?: "sub";
    testId?: string;
    attrs?: Record<`data-${string}`, string | number | undefined>;
  }) {
  return (
    <div className={cx("rpu rpu-own", className)} data-rp="own-words" data-size={size} data-testid={testId} {...attrs} {...dataAttrs(rest)} {...filmingAttr(filming)} style={style}>
      <NodeMark node="me" />
      <div className="rpu-own-main">
        {(who != null || meta != null) && (
          <p className="rpu-tl-head">
            {who != null && (
              <span className="rpu-tl-who" data-node="me">
                {who}
              </span>
            )}
            {meta != null && (
              <span>
                {who != null ? " · " : ""}
                {meta}
              </span>
            )}
          </p>
        )}
        <p className="rpu-bubble" data-rp="bubble" data-rp-role="say" lang={lang}>
          {children}
        </p>
      </div>
    </div>
  );
}

/** The grey 18px line of an entry: a detail, a reason, how to use what is above. */
export function TlNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="rpu-tl-note" data-testid={testId}>
      {children}
    </p>
  );
}

/**
 * The Chinese under English words (serif 22, with a rule on the left) and the 18px line that says which one counts.
 * Two paragraphs side by side in the entry they stand in; with `testId` (or `attrs`) they get an element of their own
 * that carries the hook and keeps an entry's rhythm (8px between the two, no margins of their own).
 */
export function SaidTranslation({
  children,
  note,
  lang = "zh-Hans",
  testId,
  attrs,
}: {
  children: ReactNode;
  note: ReactNode;
  lang?: string;
  testId?: string;
  attrs?: Record<`data-${string}`, string | number | undefined>;
}) {
  const pair = (
    <>
      <p className="rpu-said-zh" data-rp="said-translation" lang={lang}>
        {children}
      </p>
      <p className="rpu-said-note">{note}</p>
    </>
  );
  if (testId === undefined && attrs === undefined) return pair;
  return (
    <div className="rpu rpu-said-pair" data-testid={testId} {...attrs}>
      {pair}
    </div>
  );
}

/** A row under an entry's words: the play pill and the square tags. `testId` and `attrs` put a hook on the row. */
export function TlControls({ children, testId, attrs }: { children: ReactNode; testId?: string; attrs?: Record<`data-${string}`, string | number | undefined> }) {
  return (
    <div className="rpu-tl-ctl" data-testid={testId} {...attrs}>
      {children}
    </div>
  );
}

const TRIANGLE = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" data-icon="play">
    <path d="M7 3.5v17L21 12z" />
  </svg>
);
const BARS = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" data-icon="pause">
    <rect x="5.5" y="4" width="4.5" height="16" rx="1" />
    <rect x="14" y="4" width="4.5" height="16" rx="1" />
  </svg>
);

/** The triangle (it can play) or the two bars (it is playing), filled. */
export function PlayGlyph({ playing = false }: { playing?: boolean }) {
  return playing ? BARS : TRIANGLE;
}

/**
 * The play pill: outlined with a triangle when it can play, filled with two bars while it plays. As a link (`href`)
 * it opens the source instead (「看原文」, 「打开出处」).
 */
export function PlayPill({
  children,
  playing = false,
  href,
  onClick,
  disabled,
  time,
  testId,
  attrs,
  className,
}: {
  children: ReactNode;
  playing?: boolean;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  /** the elapsed or whole time, after the words */
  time?: ReactNode;
  testId?: string;
  /** extra data-* attributes for the pill itself (a screen's own hooks: what it plays, whether it is playing) */
  attrs?: Record<`data-${string}`, string | number | undefined>;
  className?: string;
}) {
  const inner = (
    <>
      {playing ? BARS : TRIANGLE}
      <span>{children}</span>
      {time != null && <span className="rpu-src-time">{time}</span>}
    </>
  );
  if (href !== undefined && !disabled) {
    return (
      <UiLink href={href} className={cx("rpu-src", className)} data-rp="play-pill" data-testid={testId} {...attrs}>
        {inner}
      </UiLink>
    );
  }
  return (
    <button type="button" className={cx("rpu-src", className)} data-rp="play-pill" aria-pressed={playing} onClick={onClick} disabled={disabled} data-testid={testId} {...attrs}>
      {inner}
    </button>
  );
}

/** The round play button of a card: 48px, outlined with a triangle, filled with two bars while it plays. */
export function PlayCircle({
  playing = false,
  label,
  onClick,
  disabled,
  testId,
}: {
  playing?: boolean;
  /** what the button does, in words (it has no words of its own; the line next to it says whose recording it is) */
  label: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button type="button" className="rpu-playc" data-rp="play-circle" aria-pressed={playing} aria-label={label} onClick={onClick} disabled={disabled} data-testid={testId}>
      {playing ? BARS : TRIANGLE}
    </button>
  );
}

/** A card of smaller entries hanging from one node (her recording, the medicine's label), a line between them. */
export function SubCard({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="rpu-sub" data-rp="sub-card" data-testid={testId}>
      {children}
    </div>
  );
}

export function SubRow({
  lead,
  title,
  who,
  meta,
  link,
  children,
  testId,
  attrs,
}: {
  /** what stands on the left: <PlayCircle> */
  lead?: ReactNode;
  /** a medicine's name (26) */
  title?: ReactNode;
  who?: ReactNode;
  meta?: ReactNode;
  /** 「看原文 ›」 at the end of the source line */
  link?: { href: string; label: ReactNode; testId?: string };
  children?: ReactNode;
  testId?: string;
  attrs?: Record<`data-${string}`, string | number | undefined>;
}) {
  return (
    <div className="rpu-sub-row" data-rp="sub-row" data-testid={testId} {...attrs}>
      {lead}
      <div className="rpu-sub-main">
        {title != null && (
          <p className="rpu-sub-title" translate="no">
            {title}
          </p>
        )}
        {(who != null || meta != null || link) && (
          <p className="rpu-sub-head">
            {who != null && <b>{who}</b>}
            {meta != null && (
              <span>
                {who != null ? " · " : ""}
                {meta}
              </span>
            )}
            {link && (
              <>
                {who != null || meta != null ? " · " : ""}
                <UiLink href={link.href} nav="forward" className="rpu-inline-link" data-rp="inline-link" data-testid={link.testId}>
                  {link.label}
                  <Chevron />
                </UiLink>
              </>
            )}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

/** 「›」 as a mark, not a letter: it scales with the words and is left out of what is read aloud. */
export function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon="chevron">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/**
 * A row of buttons inside an entry (56 high): as many columns as buttons, three at most, unless `cols` says. A caller's
 * own data-* attributes (as props, or in `attrs`) land on the row; a `data-rp` of the caller's names the row in place
 * of the foundation's "acts".
 */
export function Acts({
  children,
  cols,
  testId,
  attrs,
  className,
  style,
  ...rest
}: DataAttrs & { children: ReactNode; cols?: number; testId?: string; attrs?: Record<`data-${string}`, string | number | undefined>; className?: string; style?: CSSProperties }) {
  const n = cols ?? Math.min(Math.max(countChildren(children), 1), 3);
  return (
    <div className={cx("rpu-acts", className)} data-rp="acts" data-testid={testId} {...attrs} {...dataAttrs(rest)} style={{ ...style, ["--rpu-cols" as string]: n }}>
      {children}
    </div>
  );
}

function countChildren(children: ReactNode): number {
  if (Array.isArray(children)) return children.filter((c) => c !== null && c !== undefined && c !== false).length;
  return children === null || children === undefined || children === false ? 0 : 1;
}

type ActVariant = "secondary" | "primary" | "outline" | "danger" | "on";

type ActButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { children: ReactNode; variant?: ActVariant; href?: undefined; pending?: boolean };
type ActLinkProps = DataAttrs & { children: ReactNode; variant?: ActVariant; href: string; "aria-label"?: string; className?: string; /** how the screen moves (lib/ui/nav-motion.ts) */ nav?: NavMotion };

/**
 * One button of a row of actions: 「吃了」 (primary), 「还没吃」, 「改」, 「加进问题单」 (outline). A link with `href`.
 * Either way a caller's own data-* attributes land on it (`data-testid`, `data-action`), and a `data-rp` of the
 * caller's is kept (it names the button in a page's tests; the look comes from `variant`).
 */
export function Act(props: ActButtonProps | ActLinkProps) {
  const own = dataAttrs(props);
  if (props.href !== undefined) {
    const { href, nav, children, variant = "secondary", className } = props;
    return (
      <UiLink href={href} nav={nav} className={cx("rpu-act", className)} data-rp="act" {...own} data-variant={variant} aria-label={props["aria-label"]}>
        {children}
      </UiLink>
    );
  }
  const { children, variant = "secondary", pending, disabled, type, className, ...rest } = props;
  return (
    <button {...rest} type={type ?? "button"} className={cx("rpu-act", className)} data-rp="act" {...own} data-variant={variant} disabled={disabled || pending} aria-busy={pending ? true : undefined}>
      {children}
    </button>
  );
}
