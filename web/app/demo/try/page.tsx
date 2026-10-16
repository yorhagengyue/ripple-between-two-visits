/**
 * /demo/try — "ask your own question". Not a page of its own until it does more than /demo already does (real-status:
 * "Try it" was an empty shell; real-app 12: off the navigation until it works): the judge's own question is on /demo,
 * next to the phone that answers it and the backstage that shows every step. 307 there.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DemoTry(): never {
  redirect("/demo#own-question-input");
}
