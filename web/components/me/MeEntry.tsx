import type { ReactNode } from "react";
import type { IconName } from "@/components/ui/icons";
import { ListMark } from "@/components/ui/List";
import { Tag } from "@/components/ui/Tag";
import { Chevron } from "@/components/ui/Timeline";
import { UiLink } from "@/components/ui/UiLink";
import { cx } from "@/lib/ui/props";
import "./me.css";

/**
 * One row of 「我」, as the timeline draft's `list` draws it (我-1, 21-1): what it is (22px), one grey line of where
 * things stand or what is behind it (18px), a short state on the right (「华语」, 「开着」, 「2 台」) and a chevron. The whole
 * row is one link, at least 68px tall; it goes inside a <MeGroup> (the white card). No icon: the draft's rows have none
 * (`icon` is still accepted, so every track's entry keeps compiling). The filming-account row carries the accent
 * square in front (`crew`); `tone="danger"` writes the name in red (「删除账号」). `pending` adds a 「待建」 tag (stubs).
 */
export function MeEntry({
  href,
  title,
  status,
  right,
  tone,
  pending,
  crew = false,
  entry,
  className,
}: {
  href: string;
  /** not drawn any more (the draft's rows have no icons); kept so the callers need not change */
  icon?: IconName;
  title: ReactNode;
  /** the grey line under the name: 「Wei Ling 能看到 4 项」, 「要先输入现在的密码」 */
  status?: ReactNode;
  /** a short state on the right: 「华语」, 「开着」 */
  right?: ReactNode;
  /** "danger": the name in red (deleting) */
  tone?: "danger";
  /** stubs: the track that builds it, shown as a tag */
  pending?: ReactNode;
  /** the filming-account entry, only on a crew member's own account */
  crew?: boolean;
  /** "profile", "family" ... for tests */
  entry: string;
  className?: string;
}) {
  return (
    <UiLink href={href} nav="forward" className={cx("rpu-li rpm-row", className)} data-rp="me-entry" data-entry={entry} data-crew={crew ? "true" : undefined} data-tone={tone}>
      {crew && <ListMark kind="sq" />}
      <span className="rpu-li-main">
        <span className="rpu-li-t">{title}</span>
        {status != null && status !== "" && <span className="rpu-li-s">{status}</span>}
        {pending && (
          <span>
            <Tag tone="neutral">{pending}</Tag>
          </span>
        )}
      </span>
      {right != null && right !== "" && <span className="rpu-li-r">{right}</span>}
      <Chevron />
    </UiLink>
  );
}
