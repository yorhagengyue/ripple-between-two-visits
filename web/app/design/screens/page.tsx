import { Board, PhoneFrame, Section } from "../Gallery";
import { SCREEN_NAMES, SCREENS, screenHref } from "./compose";

/**
 * /design/screens: every composed example screen as a 390x844 phone, in 华语 and in English, each linking to its
 * full-screen version (/design/screens/<name>), where the screenshots are taken.
 */
export default function ScreensPage() {
  const elder = SCREEN_NAMES.filter((n) => SCREENS[n].side === "elder");
  const family = SCREEN_NAMES.filter((n) => SCREENS[n].side === "family");
  return (
    <Board
      side="elder"
      current="/design/screens"
      eyebrow="RIPPLE UI · 整屏样例"
      title="用组件拼出来的整屏"
      lede="每一屏只用 components/ui、components/family-ui 和 components/today 拼，文字取自 fixtures、kb、lib/safety 的固定句和设计简报。手机下面的链接打开 390×844 的整屏版。"
    >
      <Section id="elder" title="陈先生的手机 · 华语">
        <div className="rpd-phones">
          {elder.map((n) => (
            <PhoneFrame key={n} side="elder" name={n} time={SCREENS[n].time} caption={SCREENS[n].caption} href={screenHref(n, "zh-Hans")}>
              {SCREENS[n].render("zh-Hans")}
            </PhoneFrame>
          ))}
        </div>
      </Section>
      <Section id="family" title="Wei Ling 的手机 · 华语">
        <div className="rpd-phones">
          {family.map((n) => (
            <PhoneFrame key={n} side="family" name={n} time={SCREENS[n].time} caption={SCREENS[n].caption} href={screenHref(n, "zh-Hans")}>
              {SCREENS[n].render("zh-Hans")}
            </PhoneFrame>
          ))}
        </div>
      </Section>
      <Section id="en" title="English" lang="en" note="The same screens in English. Quotes keep their language: Wei Ling's words stay Chinese, Dr Lim's stay English.">
        <div className="rpd-phones">
          {SCREEN_NAMES.map((n) => (
            <PhoneFrame key={n} side={SCREENS[n].side} name={n} time={SCREENS[n].time} href={screenHref(n, "en")} hrefLabel="Open full screen">
              {SCREENS[n].render("en")}
            </PhoneFrame>
          ))}
        </div>
      </Section>
    </Board>
  );
}
