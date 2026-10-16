/**
 * The rp_crew cookie on responses (lib/session/crew-key.ts). httpOnly, same-site lax, 30 days; it holds a sha256
 * of the crew key, never the key. Server-only.
 */
import type { NextResponse } from "next/server";
import { CREW_COOKIE, CREW_COOKIE_DAYS, crewCookieValue } from "./crew-key";

export function setCrewCookie(res: NextResponse, key: string): void {
  res.cookies.set(CREW_COOKIE, crewCookieValue(key), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: CREW_COOKIE_DAYS * 24 * 3600,
  });
}

export function clearCrewCookie(res: NextResponse): void {
  res.cookies.set(CREW_COOKIE, "", { path: "/", sameSite: "lax", httpOnly: true, maxAge: 0 });
}
