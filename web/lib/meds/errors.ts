/** Errors of the M3 medicine operations, with the HTTP status the routes answer. */
export type MedsErrorCode =
  | "photo_not_in_session"
  | "photo_not_found"
  | "label_unreadable"
  | "med_not_found"
  | "label_mismatch"
  | "not_all_confirmed"
  | "cannot_relabel"
  | "no_question"
  | "visit_not_found"
  | "visit_not_yet"
  | "utterance_not_found"
  | "visit_not_for_question"
  | "not_an_answer"
  | "speaker_not_at_visit"
  | "bad_read_token"
  | "read_token_expired"
  | "read_token_session"
  | "bad_edit"
  | "bad_name"
  | "med_exists"
  | "not_unidentified"
  | "example_only"
  | "ai_off"
  | "label_which"
  | "bad_time";

const STATUS: Record<MedsErrorCode, number> = {
  photo_not_in_session: 403,
  photo_not_found: 404,
  label_unreadable: 422,
  med_not_found: 404,
  label_mismatch: 409,
  not_all_confirmed: 400,
  cannot_relabel: 409,
  no_question: 404,
  visit_not_found: 404,
  visit_not_yet: 409,
  utterance_not_found: 404,
  visit_not_for_question: 409,
  not_an_answer: 409,
  speaker_not_at_visit: 400,
  bad_read_token: 400,
  read_token_expired: 410,
  read_token_session: 403,
  bad_edit: 400,
  bad_name: 400,
  med_exists: 409,
  not_unidentified: 409,
  example_only: 403,
  // his consent to AI processing is off: a label photo is not read (he types the label's words himself)
  ai_off: 403,
  // a medicine waits for its label and it is not clear whether this label is its own: he is asked (detail.waiting),
  // nothing is written until he says (real-app 2.16, 6.9)
  label_which: 409,
  // a reminder time that is not a time, or lies outside its part of the day (detail: slot, from, to)
  bad_time: 400,
};

export class MedsError extends Error {
  readonly status: number;
  constructor(
    readonly code: MedsErrorCode,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MedsError";
    this.status = STATUS[code];
  }
}
