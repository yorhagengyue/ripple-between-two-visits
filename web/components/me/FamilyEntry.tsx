import { patientLinks } from "@/lib/care/links";
import type { PatientLinkView } from "@/lib/care/types";
import { getPageSubject } from "@/lib/subject";
import { careEntryStore } from "@/lib/subject/care";
import { nowMs } from "@/lib/time/now";
import type { UiLocale } from "@/lib/ui/tokens";
import { MeEntry } from "./MeEntry";

/** One line of where things stand with his family (「Wei Ling 能看到 3 项」, 「Wei Ling 接受了，等你确认」). Pure. */
export function familyStatus(links: readonly PatientLinkView[], locale: UiLocale): string {
  const zh = locale === "zh-Hans";
  const name = (l: PatientLinkView) => l.familyLabel ?? l.her?.displayName ?? (zh ? "家人" : "Family");
  const waiting = links.find((l) => l.state === "accepted");
  if (waiting) return zh ? `${name(waiting)} 接受了，等你确认` : `${name(waiting)} accepted; confirm it's her`;
  const active = links.filter((l) => l.state === "active");
  if (active.length) {
    return active
      .map((l) => {
        const n = Object.values(l.items).filter(Boolean).length;
        return zh ? `${name(l)} 能看到 ${n} 项` : `${name(l)} sees ${n} ${n === 1 ? "item" : "items"}`;
      })
      .join(zh ? "；" : "; ");
  }
  if (links.some((l) => l.state === "invited")) return zh ? "邀请已发出，等她接受" : "Invitation sent; waiting";
  return zh ? "还没有邀请家人" : "No family member invited yet";
}

/**
 * 我 · 家人能看到什么 (entry "family"; C2 track D): where things stand with each family member, read from his links on
 * the server (this request's own subject: his space, self mode). Pages: app/p/family.
 */
export async function FamilyEntry({ locale, href = "/p/family" }: { locale: UiLocale; href?: string }) {
  const zh = locale === "zh-Hans";
  let status: string = zh ? "她只看得到你打开的项目" : "She sees only what you switch on";
  const ctx = await getPageSubject().catch(() => null);
  if (ctx && ctx.subject.kind === "account" && ctx.subject.relation === "self" && ctx.subject.userId) {
    const links = await patientLinks(ctx.store, careEntryStore(), ctx.session, ctx.subject.userId, nowMs()).catch(() => null);
    if (links) status = familyStatus(links, locale);
  }
  return <MeEntry entry="family" href={href} title={zh ? "家人能看到什么" : "What my family can see"} status={status} />;
}
