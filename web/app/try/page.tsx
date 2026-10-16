/**
 * /try — the old address of "Try it" (real-app 5.3: moved to /demo/try). 307 to /demo/try.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function OldTry(): never {
  redirect("/demo/try");
}
