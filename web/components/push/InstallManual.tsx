import { installManual, type PushPageLocale } from "@/lib/push/copy";

/**
 * The manual's section on reminders and the Home Screen (/how; C2 track I, follow-up; real-app 2.6: 「iOS 只给加到主屏的
 * 网页 app 推送，这一条也写进使用说明」). The same sentences the phone shows (lib/push/copy.ts installManual, whose three
 * iPhone steps are the ones on 「我 › 提醒和通知」 and in setting up), in English and in 华语, in /how's own type sizes.
 * No product names, file paths or addresses.
 */
function Part({ locale }: { locale: PushPageLocale }) {
  const m = installManual(locale);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border-2 border-hair-2 bg-surface-2 p-4" lang={locale === "en" ? "en" : "zh-Hans"} data-testid={`how-install-${locale === "en" ? "en" : "zh"}`}>
      <h3 className="text-[19px] font-bold">{m.title}</h3>
      <p className="text-[18px] leading-snug">{m.why}</p>
      <p className="text-[18px] leading-snug">{m.android}</p>
      <p className="text-[18px] font-semibold leading-snug">{m.iphoneLead}</p>
      <ol className="flex list-decimal flex-col gap-1.5 pl-6 text-[18px] leading-snug" data-testid="how-install-steps">
        {m.iphoneSteps.map((s) => (
          <li key={s} className="[overflow-wrap:anywhere]">
            {s}
          </li>
        ))}
      </ol>
      <p className="text-[18px] leading-snug">{m.then}</p>
    </div>
  );
}

export function InstallManual() {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="how-install" data-testid="how-install">
      <h2 id="how-install" className="text-[24px] font-bold">
        Reminders and the Home Screen · <span lang="zh-Hans">提醒和主屏幕</span>
      </h2>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <Part locale="en" />
        <Part locale="zh-Hans" />
      </div>
    </section>
  );
}
