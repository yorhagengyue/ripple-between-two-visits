/**
 * What to do with a recording kept on this phone (components/visit/elder/recording-store.ts), given what the server
 * says about its visit (C2 track V; real-app 2.13, 2.14). Pure: the page hands in the visits of his account as the
 * server listed them; nothing here reads or deletes anything.
 *
 *   offer   the visit still needs its recording: it is unfinished (recording, transcribing), it waits for its text with
 *           no recording saved, or it was ended with nothing at all (no recording, no line: ended on another phone
 *           while this one held the recording). The page shows 「上次的录音（…）还没传」 with 「现在传」.
 *   saved   the visit is past recording and the server holds a recording on it: the phone copy is no longer needed
 *           (the page drops it through dropConfirmed, with the server's path as the proof).
 *   hold    anything else: the server does not list that visit for this account, it is only planned, or it has a record
 *           (lines he may have checked) and no recording. The copy stays on the phone, untouched and not offered:
 *           sending it would start that visit's record again. Never deleted for not being on a list.
 */
export type KnownVisitStatus = "planned" | "recording" | "transcribing" | "awaiting_transcript" | "review" | "confirmed";

/** One visit of his account, as the page's server half read it. */
export interface KnownVisit {
  id: string;
  status: KnownVisitStatus;
  /** the recording's path saved on the visit (null: the server has no recording of it) */
  audioPath: string | null;
  /** waiting for his check with no line at all and no recording: nothing was recorded for it yet */
  empty?: boolean;
}

export type KeptAction = "offer" | "saved" | "hold";

export function classifyKept(visit: KnownVisit | null | undefined): KeptAction {
  if (!visit) return "hold";
  if (visit.status === "recording" || visit.status === "transcribing") return "offer";
  if (visit.status === "awaiting_transcript") return visit.audioPath ? "saved" : "offer";
  if (visit.status === "review" || visit.status === "confirmed") return visit.audioPath ? "saved" : visit.status === "review" && visit.empty === true ? "offer" : "hold";
  return "hold";
}

/**
 * The upload of this page is confirmed: the path the browser uploaded to is the one the server now has on the visit.
 * Anything else (no upload here, no path on the visit, another path) is not a confirmation.
 */
export function uploadConfirmed(uploadedPath: string | null | undefined, serverAudioPath: string | null | undefined): serverAudioPath is string {
  return typeof uploadedPath === "string" && uploadedPath !== "" && serverAudioPath === uploadedPath;
}
