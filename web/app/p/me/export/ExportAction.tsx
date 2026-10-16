"use client";

/**
 * 「导出我的资料」 (journey 15; C2 track H; the timeline draft's 15-1a and 15-1b): one tap makes the file (POST
 * /api/me/export) and saves it on this phone.
 *
 *   before   a plain box: what the file is, that its recording and photo links work for 24 hours, how many exports are
 *            left today; the filled button 「导出我的资料」 under it
 *   after    a ticked node 「文件做好了」: the file's name, until when the links in it work; under the line 「再存一次这份
 *            文件」 (saves the same file again without counting) and how many exports are left; the filled button stays
 *            for another export
 * After three today the button rests (grey) and the line says from which day he can export again. The file is made on
 * request and handed to the phone: nothing is kept on the server, so there is no link to copy (the draft's 「复制链接」).
 */
import { useEffect, useRef, useState } from "react";
import { P, Said } from "@/components/me/parts";
import { Box, PrimaryButton, SecondaryButton, Timeline, TimelineItem } from "@/components/ui";
import { hCopy, type HLocale } from "@/lib/privacy/copy";
import { dateWords, momentWords } from "@/lib/privacy/words";
import { fetchSignedIn } from "@/lib/session/client";
import { localDate } from "@/lib/time/clock";

interface Done {
  name: string;
  url: string;
  linksExpire: string | null;
  files: number;
}

function save(url: string, name: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ExportAction({ locale, tz, left: initialLeft, resetsAt: initialResets }: { locale: HLocale; tz: string; left: number; resetsAt: string }) {
  const c = hCopy(locale);
  const [left, setLeft] = useState(initialLeft);
  const [resetsAt, setResetsAt] = useState(initialResets);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function run() {
    if (busy || left <= 0) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetchSignedIn("/api/me/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { until?: string };
        setLeft(0);
        if (body.until) setResetsAt(body.until);
        return;
      }
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const blob = await res.blob();
      const name = res.headers.get("x-ripple-export-name") || "ripple-export.json";
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      save(url, name);
      setDone({ name, url, linksExpire: res.headers.get("x-ripple-links-expire"), files: Number(res.headers.get("x-ripple-export-files") ?? "0") });
      setLeft(Number(res.headers.get("x-ripple-export-left") ?? left - 1));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const resetDay = dateWords(localDate(Date.parse(resetsAt), tz), locale);
  // how many are left today, or from which day he can export again (one of the two, with its own test hook)
  const leftLine = <span data-testid={left > 0 ? "export-left" : "export-none-left"}>{left > 0 ? c.exportLeft(left) : c.exportNoneLeft(resetDay)}</span>;
  return (
    <div className="rpu rpu-stack" data-rp="export" data-testid="export" data-left={left}>
      {done ? (
        <>
          <div data-testid="export-done" data-file={done.name} data-files={done.files}>
            <Timeline>
              <TimelineItem
                node="ok"
                title={c.exportDoneTitle}
                note={`${c.exportDoneFile(done.name)}\n${done.files > 0 && done.linksExpire ? c.exportDoneLinks(momentWords(done.linksExpire, locale, tz)) : c.exportDoneNoFiles}`}
              />
            </Timeline>
          </div>
          <SecondaryButton className="rpu-ind" style={{ width: "auto" }} onClick={() => save(done.url, done.name)} data-testid="export-again">
            {c.exportAgain}
          </SecondaryButton>
          <P quiet indent>
            {leftLine}
          </P>
        </>
      ) : (
        <Box variant="line" title={c.exportTitle}>
          <span style={{ display: "block" }}>{c.exportLede}</span>
          <span style={{ display: "block", marginTop: 6 }}>{leftLine}</span>
        </Box>
      )}
      {failed && (
        <Said tone="problem" testId="export-failed">
          {c.exportFailed}
        </Said>
      )}
      <PrimaryButton pending={busy} disabled={left <= 0} onClick={() => void run()} data-testid="export-button">
        {busy ? c.exportWorking : c.exportButton}
      </PrimaryButton>
    </div>
  );
}
