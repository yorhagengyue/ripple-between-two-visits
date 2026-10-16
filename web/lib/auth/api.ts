/**
 * The account routes' shapes (track A), shared by the routes, the pages, the e2e helpers and other tracks' tests.
 * Client-safe: types and paths only.
 *
 *   POST /api/auth/check-login    { login }                                  200 { ok, kind } · 400 <login problem> · 409 login_taken
 *   POST /api/auth/signup         SignupBody                                 201 SignupAnswer + the sign-in cookies
 *   POST /api/auth/login          LoginBody                                  200 LoginAnswer · 401 invalid_credentials · 423 locked { until }
 *   POST /api/auth/refresh        {}                                         200 { ok } · 401 not_signed_in (the browser's shared refresh)
 *   POST /api/auth/logout         { everywhere? }                            200 { next } (cookies cleared)
 *   POST /api/auth/recover        RecoverBody                                200 RecoverAnswer · 401 invalid_recovery
 *   POST /api/auth/password       { current, password }                      200 { ok } · 401 wrong_password (other devices signed out)
 *   POST /api/auth/recovery-code  { password }                               200 { recovery_code } (the old one stops working)
 *   GET  /api/auth/devices                                                   200 { devices: DeviceView[] }
 *   POST /api/auth/devices/sign-out  { device }                              200 { ended }
 *   GET  /api/me                                                             200 MeAnswer
 *
 * Family-assisted reset (real-app 2.4, 3.6; lib/auth/family-reset.ts has every rule):
 *   GET  /api/auth/recover/helper                                            200 ResetHelpersAnswer (his active family, each switch)
 *   POST /api/auth/recover/helper { link_id, on, locale? }                   200 { helper } · 404 link_not_found · 409 link_not_active
 *   POST /api/auth/recover/help   { login }                                  200 FamilyHelpAnswer · 403 help_unavailable · 429 too_many
 *   GET  /api/family/links/[id]/reset-code                                   200 FamilyHelpState (her page: is he asking?)
 *   POST /api/family/links/[id]/reset-code {}                                200 FamilyCodeAnswer · 409 helper_off / no_request · 429 too_many
 *   POST /api/auth/recover/family { login, code, password, not_my_phone? }   200 FamilyRecoverAnswer + the sign-in cookies · 401 invalid_family_code
 *
 * 「读给我听」 and the Today line:
 *   POST /api/auth/read-aloud     { screen, locale, part? }                  200 audio/wav · 404 tts_unavailable (the mock voice)
 *   POST /api/auth/notice-seen    { event }                                  200 { ok } (the reset line on his Today page is done)
 *
 * Every POST takes application/json only, and refuses another site's Origin (403 bad_origin). Errors are { error }
 * with one of AuthRouteError; 429 too_many and 423 locked carry `until` (ISO) as well.
 */

export const AUTH_PATHS = {
  checkLogin: "/api/auth/check-login",
  signup: "/api/auth/signup",
  login: "/api/auth/login",
  refresh: "/api/auth/refresh",
  logout: "/api/auth/logout",
  recover: "/api/auth/recover",
  password: "/api/auth/password",
  recoveryCode: "/api/auth/recovery-code",
  devices: "/api/auth/devices",
  deviceSignOut: "/api/auth/devices/sign-out",
  me: "/api/me",
  resetHelper: "/api/auth/recover/helper",
  familyHelp: "/api/auth/recover/help",
  familyRecover: "/api/auth/recover/family",
  /** her side, for one of her links */
  familyResetCode: (linkId: string) => `/api/family/links/${encodeURIComponent(linkId)}/reset-code`,
  readAloud: "/api/auth/read-aloud",
  noticeSeen: "/api/auth/notice-seen",
} as const;

/** One of his active family members on 「忘记密码时让家人帮我」. */
export interface ResetHelperView {
  link_id: string;
  /** how he calls her (「Wei Ling」), or null */
  label: string | null;
  relation: string | null;
  on: boolean;
}

export interface ResetHelpersAnswer {
  helpers: ResetHelperView[];
}

/** He asked for help: until when, and who can give the code. */
export interface FamilyHelpAnswer {
  expires_at: string;
  helpers: string[];
}

/** Her page asks: is he asking for help right now? */
export interface FamilyHelpState {
  enabled: boolean;
  pending: boolean;
  expires_at: string | null;
}

/** The 6-digit code she reads to him (in this answer only). */
export interface FamilyCodeAnswer {
  code: string;
  expires_at: string;
}

export interface FamilyRecoverBody {
  login: string;
  /** the 6 digits she read to him */
  code: string;
  /** the new password */
  password: string;
  not_my_phone?: boolean;
}

export interface FamilyRecoverAnswer {
  next: string;
  /** how he calls the family member who helped, or null */
  helper: string | null;
}

export type UiLanguage = "zh-Hans" | "en";
/** blank (he goes to /onboard), Mr Tan's example (to /p/today), or none: a family member with no space of her own (/f) */
export type SignupSpace = "blank" | "example" | "none";

export interface SignupBody {
  /** a username (letters, digits, . _ -) or an e-mail address */
  login: string;
  password: string;
  /** how the app addresses him (「陈先生」) */
  display_name: string;
  locale: UiLanguage;
  /** someone in the family is tapping for him; the consents are still his (recorded with assisted = true) */
  assisted: boolean;
  consents: {
    terms_privacy: { version: string };
    ai_processing: { decision: "granted" | "declined"; version: string };
    /** required when space is "example" */
    example_data?: { version: string };
  };
  space: SignupSpace;
}

export interface SignupAnswer {
  /** where he goes after writing the code down: /onboard (blank) or /p/today (example) */
  next: string;
  /** shown once, never stored in the clear: "ABCD-EFGH-JKLM" */
  recovery_code: string;
  /** the login as he types it next time */
  login: string;
}

export interface LoginBody {
  login: string;
  password: string;
  /** 「这不是我的手机」: the sign-in ends when the browser closes, 12 hours at most */
  not_my_phone?: boolean;
  /** where to go afterwards (a path on this site; anything else is ignored) */
  next?: string;
}

export interface LoginAnswer {
  next: string;
}

export interface RecoverBody {
  login: string;
  code: string;
  /** the new password */
  password: string;
  not_my_phone?: boolean;
}

export interface RecoverAnswer {
  next: string;
  /** the new recovery code (the one he used no longer works) */
  recovery_code: string;
}

export interface PasswordBody {
  current: string;
  password: string;
}

export interface RecoveryCodeAnswer {
  recovery_code: string;
}

/** One device he signed in on (the rp_device cookie), as his devices page shows it. */
export interface DeviceView {
  /** opaque: what the sign-out call names */
  ref: string;
  /** "iPhone · Safari", or null when nothing is known */
  label: string | null;
  /** the device this request came from */
  current: boolean;
  /** a sign-in is still open there */
  signed_in: boolean;
  /** signed in with 「这不是我的手机」 */
  ephemeral: boolean;
  first_seen_at: string;
  last_seen_at: string;
}

export interface DevicesAnswer {
  devices: DeviceView[];
}

/** GET /api/me: his account as the app may show it. No user id, no scope id, no token hashes. */
export interface MeAnswer {
  account: {
    /** the username, or the e-mail address he signs in with */
    login: string | null;
    login_kind: "username" | "email";
    display_name: string | null;
    locale: string | null;
    created_at: string;
  };
  /** his own space; null for a family member who has none */
  scope: { example_data: boolean; onboarding: string | null; d0: string; tz: string; today: string } | null;
  links: {
    as_patient: { id: string; relation: string | null; family_label: string | null; status: string; confirmed_at: string | null }[];
    as_family: { id: string; relation: string | null; patient_label: string | null; status: string }[];
  };
  /** the latest decision per consent kind */
  consents: { kind: string; decision: string; version: string | null; assisted: boolean; at: string }[];
  /** this sign-in: 「这不是我的手机」 or not */
  session: { ephemeral: boolean } | null;
}

export type AuthRouteError =
  | "invalid_body"
  | "bad_origin"
  | "login_empty"
  | "username_invalid"
  | "username_reserved"
  | "email_invalid"
  | "email_reserved_domain"
  | "login_taken"
  | "password_short"
  | "password_long"
  | "password_common"
  | "password_like_login"
  | "consent_required"
  | "consent_version"
  | "invalid_credentials"
  | "locked"
  | "too_many"
  | "invalid_recovery"
  | "wrong_password"
  | "not_signed_in"
  | "device_not_found"
  | "help_unavailable"
  | "invalid_family_code"
  | "link_not_found"
  | "link_not_active"
  | "helper_off"
  | "no_request"
  | "tts_unavailable"
  | "unavailable";
