"use client";

/**
 * /p/bp could not be drawn (real-app 2.25; the timeline draft's 通用-2). On an account the blood pressure page keeps
 * its header and tab bar and says so in the app's own two fixed sentences, with 「再试一次」 and 「先看今天」
 * (components/bp/BpPageStates.tsx). The demo's page (judge sandbox, filming session) keeps the app's own error screen:
 * the error goes on to app/error.tsx.
 */
import { BpErrorScreen } from "@/components/bp/BpPageStates";
import { useLiveSession } from "@/components/live/LiveSession";

export default function BpError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { session } = useLiveSession();
  if (session.kind !== "account") throw error;
  return <BpErrorScreen reset={reset} />;
}
