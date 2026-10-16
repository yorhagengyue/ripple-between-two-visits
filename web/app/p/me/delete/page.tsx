/**
 * /p/me/delete — 「删除账号」 (journey 15; real-app 3.11 删除账号 两屏; the elder brief 15.2 「先写清楚会删掉什么（录音、照片、
 * 记录、女儿的查看）、删了不能恢复，再确认一次才删。这是全 app 唯一要第二步确认的地方」; C2 track H; laid out after the timeline
 * draft's 15-2 and 15-3). First screen: what goes, the family members who stop seeing his records (his active and
 * accepted links, by the names he gave them), that it cannot be brought back, how long backups keep a copy, 「先导出」.
 * Second screen: his password, then POST /api/me/delete. Then a last screen says it is done; this phone is signed out.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { asHLocale } from "@/lib/privacy/copy";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { DeleteFlow } from "./DeleteFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "删除账号 · Ripple" };

export default async function DeletePage() {
  const [ctx, uiLocale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account" || ctx.subject.relation !== "self" || !ctx.subject.userId) notFound();
  const locale = asHLocale(uiLocale);
  const links = await ctx.store.listCareLinks({ patient_id: ctx.subject.userId, status: ["active", "accepted"] });
  const names = [...new Set(links.map((l) => l.family_label?.trim()).filter((n): n is string => !!n))];
  return <DeleteFlow locale={locale} familyNames={names} />;
}
