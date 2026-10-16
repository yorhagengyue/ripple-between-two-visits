"use client";

/**
 * The film crew types the crew key once on each crew browser (POST /api/session/crew sets the rp_crew cookie, a hash of
 * the key). After that the crew's pages open for this browser (lib/crew/gate.ts): the director's remote, the backstage
 * screen, joining with a code, the story clock on /demo. Judges never have the key; without it those answer 404.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

async function call(method: "POST" | "DELETE", body?: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/session/crew", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, error: data.error };
}

export function CrewSignIn({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setStatus(null);
    try {
      const out = await call("POST", { key });
      setKey("");
      setStatus(out.ok ? null : out.error === "crew_key_attempts" ? "Too many wrong keys. Wait ten minutes, then try again." : "That is not the crew key.");
      if (out.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function createFilming() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "filming", role: "director" }),
        credentials: "same-origin",
      });
      if (res.ok) router.push("/director");
      else setStatus("The filming session could not be created. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (signedIn) {
    return (
      <div className="flex flex-col gap-3" data-testid="crew-signed-in">
        <p className="text-[18px]">This browser is signed in as the film crew: the director&apos;s remote, the backstage screen and the story clock on the demo page are open.</p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-[18px]" aria-label="Crew pages" data-testid="crew-links">
          <Link className="inline-flex min-h-11 items-center underline" href="/director">
            Director
          </Link>
          <Link className="inline-flex min-h-11 items-center underline" href="/backstage">
            Backstage
          </Link>
          <Link className="inline-flex min-h-11 items-center underline" href="/demo">
            Demo with the story clock
          </Link>
          <Link className="inline-flex min-h-11 items-center underline" href="/join">
            Join a phone with a code
          </Link>
        </nav>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="rp-btn rp-btn-accent min-h-12 text-[18px]" disabled={busy} onClick={() => void createFilming()} data-testid="crew-new-filming">
            New filming session
          </button>
          <button
            type="button"
            className="rp-btn rp-btn-ghost min-h-12 text-[18px]"
            disabled={busy}
            onClick={() => void call("DELETE").then(() => router.refresh())}
            data-testid="crew-sign-out"
          >
            Forget the key on this browser
          </button>
        </div>
        {status ? (
          <p className="text-[18px] text-ink-2" role="alert" data-testid="crew-status">
            {status}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) void signIn();
      }}
      data-testid="crew-sign-in"
    >
      <label className="flex flex-col gap-1 text-[18px]">
        Crew key
        <input
          type="password"
          autoComplete="off"
          className="min-h-12 rounded-xl border border-hair-2 bg-surface px-3 text-[18px] text-ink"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          data-testid="crew-key"
        />
      </label>
      <button type="submit" className="rp-btn rp-btn-accent min-h-12 self-start text-[18px]" disabled={busy || !key.trim()} data-testid="crew-key-submit">
        Use this key on this browser
      </button>
      {status ? (
        <p className="text-[18px] text-ink-2" role="alert" data-testid="crew-status">
          {status}
        </p>
      ) : null}
    </form>
  );
}
