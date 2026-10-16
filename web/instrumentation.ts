/**
 * Runs once when a Next.js server starts (next dev, next start), before it answers anything.
 *
 * A real deployment (RIPPLE_DEPLOYED=1, set only on the hosting server) must not run with a developer tool, the
 * in-memory identity provider or a missing account secret:
 *   - lib/dev/startup.ts (the foundation): RIPPLE_DEV_TOOLS=1 (the test clock, the developer routes), AUTH_PROVIDER=memory
 *     (or no provider) and SPEECH_PROVIDER=devfake stop the server here;
 *   - lib/auth/boot.ts (track A): also RIPPLE_TEST_CLOCK set, Supabase Auth without its three settings, and
 *     AUTH_COOKIE_SECRET, RATE_LIMIT_SALT or RECOVERY_PEPPER missing, short or left at the development value;
 *   - lib/guard/boot.ts (track L): TRUSTED_PROXY_HOPS not set (the per-IP limits could not tell visitors apart), or an
 *     EDGE_SECRET too short to be one.
 * Track L also installs the peer stamp here (lib/guard/peer-install.ts): from then on a request carries the address its
 * socket came from, which the per-IP limits read when no proxy of ours is in front.
 * Everything else starts as before (the recording build: next start with RIPPLE_DEV_TOOLS=1 and no RIPPLE_DEPLOYED).
 *
 * The checks are loaded for the Node.js runtime only: Next.js builds this file for the Edge runtime too, and the
 * documented NEXT_RUNTIME branch keeps process.exit out of that build.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { refuseUnsafeStart } = await import("@/lib/dev/startup");
    refuseUnsafeStart();
    const { refuseUnsafeAuthStart } = await import("@/lib/auth/boot");
    refuseUnsafeAuthStart();
    // C2 track L (only add): a deployment must say how the client address is read (lib/guard/client-ip.ts)
    const { refuseUnsafeGuardStart } = await import("@/lib/guard/boot");
    refuseUnsafeGuardStart();
    // C2 track L (only add): every request carries the address its socket came from (lib/guard/peer.ts)
    const { installPeerStamp } = await import("@/lib/guard/peer-install");
    installPeerStamp();
    // C2 track B (only add): register the scheduled jobs (POST /api/dev/tick sees them) and start the JOBS=1 loop
    const { startJobLoop } = await import("@/lib/jobs");
    startJobLoop();
  }
}
