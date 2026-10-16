/**
 * The scripted fallback and the crew key (web-app.md section 8: "评委的在线链接上关掉剧本兜底").
 *
 * Until the C2 follow-up this file held a second key mechanism: the fallback was unlocked per session by typing the
 * crew key on the visit page, with its own counter (five wrong, ten minutes). That is gone (real-app 5.2: one gate).
 * The fallback now needs exactly two things, and both are asked elsewhere:
 *   - the crew: lib/crew/gate.ts isCrew(req) (the rp_crew cookie, or the key in a header or body), on the switch's
 *     route (POST /api/visits/[id]/scripted) and on the `fallback` flag of /extract: 404 for anyone else;
 *   - a filming scope: lib/visit/fallback.ts filmingSession (the crew's filming session in filming mode, or an account
 *     its owner marked as a filming account).
 * A filming phone that is not the crew's yet signs in at the door: /backstage/crew, or the key field on
 * /p/visit?crew=1, which posts to the same door (POST /api/session/crew) and leaves the same cookie.
 *
 * What is left here: where the key comes from (for the screens that say whether a key exists on this server), and the
 * dev key's name for the modules that imported it from here. Server-only.
 */
import { crewGateSource, DEV_ONLY_CREW_KEY } from "@/lib/session/crew-key";

export { DEV_ONLY_CREW_KEY };

export type CrewKeySource = "env" | "dev_default" | "none";

/**
 * Where the expected key comes from right now (prints nothing secret): SCRIPTED_FALLBACK_KEY when set (web/.env on the
 * filming laptop; never on the judge deployment), else the dev key while the developer tools are on, else none (a
 * production build without the key: nobody is the crew, and the fallback cannot be switched on at all).
 */
export function crewKeySource(): CrewKeySource {
  const source = crewGateSource();
  return source === "none" ? "none" : source === "dev_default" ? "dev_default" : "env";
}
