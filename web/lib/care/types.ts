/**
 * Family links on real accounts (C2 track D; real-app 2.19-2.22, 3.10): shapes the pages, the routes and the other
 * tracks share. Types only; client-safe.
 *
 * A link is him (the patient) and one family member. He invites (a one-time link, 7 days), she accepts while signed
 * in, he confirms it is her; only then does she see anything, and only what he switched on for that link. He can stop
 * sharing, she can leave; either ends the link for good (he can invite again).
 */
import type { FamilyGrantItems } from "@/lib/store/types";

/** A link as either side sees its state ("left": she ended it; "revoked": he did). */
export type LinkState = "invited" | "accepted" | "active" | "declined" | "expired" | "revoked" | "left";

/** One link as he sees it on /p/family (never the token or its hash). */
export interface PatientLinkView {
  id: string;
  state: LinkState;
  /** how he named her ("Wei Ling") */
  familyLabel: string | null;
  /** "daughter", "son", "wife", ... or his own word */
  relation: string | null;
  /** how she calls him ("爸爸") */
  patientLabel: string | null;
  invitedAt: string;
  /** the invitation's end (invited only) */
  expiresAt: string | null;
  acceptedAt: string | null;
  confirmedAt: string | null;
  endedAt: string | null;
  /** her account once she accepted: the name she gave and how she signs in (a username, or null for an e-mail account) */
  her: { displayName: string | null; username: string | null } | null;
  items: FamilyGrantItems;
  /** how many times the switches were set (1 = as invited) */
  version: number;
}

/** One link as she sees it (her own side only). */
export interface FamilyLinkView {
  id: string;
  state: LinkState;
  /** how she calls him on her screens ("爸爸"); falls back to the words of her page */
  patientLabel: string | null;
  relation: string | null;
  acceptedAt: string | null;
  confirmedAt: string | null;
  endedAt: string | null;
}

/** A family member a notice about him may go to (track I, the family_no_reply notice). */
export interface FamilyRecipient {
  /** her user id (the push subscriptions are hers) */
  userId: string;
  linkId: string;
  /** how he named her */
  label: string | null;
  /** how she calls him, for the notice's words (「爸爸还没回早上的药」) */
  patientLabel: string | null;
  /** her language */
  locale: "zh-Hans" | "en";
  /** his switch "tell her when I do not reply to two reminders", for this link */
  noReplyAlert: boolean;
  confirmedAt: string | null;
}

/** One look (or write) she made through a link, for his screens (track H's 查看记录 too). */
export interface CareAccessEntry {
  id: string;
  /** ISO */
  at: string;
  linkId: string | null;
  /** her label as it was then (kept when her account is gone) */
  who: string | null;
  /** what she looked at: grant keys, "reminder", "profile_fact" */
  items: string[];
  route: string;
}

/** One version of a link's switches, with what changed from the version before (his history list). */
export interface GrantVersionView {
  version: number;
  at: string;
  items: FamilyGrantItems;
  /** the switches this version turned on / off (empty for version 1) */
  turnedOn: (keyof FamilyGrantItems)[];
  turnedOff: (keyof FamilyGrantItems)[];
}
