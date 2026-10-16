import type { Metadata } from "next";
import {
  AccountEntry,
  AiConsentEntry,
  DataEntry,
  FamilyEntry,
  FilmingAccountEntry,
  MeLayout,
  NotificationsEntry,
  ProfileEntry,
} from "@/components/me";
import {
  AskSection,
  BpSection,
  ChatSection,
  CountdownSection,
  DoseSection,
  ExampleBanner,
  ReminderSection,
  TodayLayout,
  WatchSection,
} from "@/components/today";
import { MetaBar, StatusHeadline, TabBar } from "@/components/ui";
import type { UiLocale } from "@/lib/ui/tokens";
import { Board, PhoneFrame, Section } from "../Gallery";
import { metaLine } from "../content";

export const metadata: Metadata = { title: "Ripple UI · frames" };

/**
 * /design/frames: the Today screen and the 「我」 screen as frames of named sections, every section a stub that
 * renders a placeholder until its track replaces it. The table under each says which file, which track.
 */

const TODAY_MAP = [
  ["banner", "components/today/ExampleBanner.tsx", "C 示例资料和建档"],
  ["reminder", "components/today/ReminderSection.tsx", "B 时钟和每一天（录音来自 D）"],
  ["dose", "components/today/DoseSection.tsx", "B 时钟和每一天"],
  ["bp", "components/today/BpSection.tsx", "B 时钟和每一天（超过 180 的转述由 S 提供）"],
  ["countdown", "components/today/CountdownSection.tsx", "B 时钟和每一天"],
  ["watch", "components/today/WatchSection.tsx", "K 新功能"],
  ["chat", "components/today/ChatSection.tsx", "K 新功能"],
  ["ask", "components/today/AskSection.tsx", "S 安全层和问一句"],
] as const;

const ME_MAP = [
  ["profile", "components/me/ProfileEntry.tsx", "C 示例资料和建档"],
  ["family", "components/me/FamilyEntry.tsx", "D 女儿端"],
  ["notifications", "components/me/NotificationsEntry.tsx", "I 推送"],
  ["data", "components/me/DataEntry.tsx", "H 我的数据"],
  ["ai", "components/me/AiConsentEntry.tsx", "H 我的数据"],
  ["account", "components/me/AccountEntry.tsx", "A 账号和登录"],
  ["filming", "components/me/FilmingAccountEntry.tsx", "J 拍摄账号（只给拍摄组）"],
] as const;

function TodayFrame({ locale }: { locale: UiLocale }) {
  return (
    <TodayLayout
      locale={locale}
      fill="container"
      tabBarPlacement="static"
      tabBar={<TabBar active="today" locale={locale} placement="static" />}
      meta={<MetaBar story={metaLine(26, "08:45", locale)} locale={locale} langHref="/design/frames" />}
      banner={<ExampleBanner locale={locale} />}
      headline={<StatusHeadline lines={[locale === "zh-Hans" ? "（状态句）" : "(status sentence)"]} />}
      reminder={<ReminderSection locale={locale} />}
      dose={<DoseSection locale={locale} />}
      bp={<BpSection locale={locale} />}
      countdown={<CountdownSection locale={locale} />}
      watch={<WatchSection locale={locale} />}
      chat={<ChatSection locale={locale} />}
      ask={<AskSection locale={locale} />}
    />
  );
}

function MeFrame({ locale, crew }: { locale: UiLocale; crew: boolean }) {
  return (
    <MeLayout
      locale={locale}
      fill="container"
      tabBarPlacement="static"
      crew={crew}
      tabBar={<TabBar locale={locale} placement="static" />}
      meta={<MetaBar back={{ href: "/design/frames#today" }} locale={locale} langHref="/design/frames#me" />}
      entries={
        <>
          <ProfileEntry locale={locale} />
          <FamilyEntry locale={locale} />
          <NotificationsEntry locale={locale} />
          <DataEntry locale={locale} />
          <AiConsentEntry locale={locale} />
          <AccountEntry locale={locale} />
        </>
      }
      crewEntry={<FilmingAccountEntry locale={locale} />}
    />
  );
}

function StubMap({ rows }: { rows: readonly (readonly [string, string, string])[] }) {
  return (
    <ul className="rpd-rules" style={{ gridTemplateColumns: "1fr", marginTop: 16 }}>
      {rows.map(([key, file, owner]) => (
        <li key={key}>
          <span>
            <b>{key}</b> · <span className="rpd-code">{file}</span> · {owner}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function FramesPage() {
  return (
    <Board
      side="elder"
      current="/design/frames"
      eyebrow="RIPPLE UI · 页面框架"
      title="今天页和「我」页：分成小块，每块一条线"
      lede="今天页（/p/today）和「我」页（/p/me）拆成具名的小块。每块一个文件，现在是占位，由对应的线换成真的。页面文件不在这里改：各线做页面时，用这里的框架。"
    >
      <Section id="today" title="今天页 · TodayLayout" note="顺序：顶行、示例横幅、状态句、需要他的那一块（focus）、提醒、药、血压、离下次看诊、手表、今天说过的话、问一句。没有的块不出现，块之间一根细线。">
        <div className="rpd-phones">
          <PhoneFrame side="elder" name="today-frame" time="8:45">
            <TodayFrame locale="zh-Hans" />
          </PhoneFrame>
          <PhoneFrame side="elder" name="today-frame-en" time="8:45">
            <TodayFrame locale="en" />
          </PhoneFrame>
        </div>
        <StubMap rows={TODAY_MAP} />
      </Section>
      <Section id="me" title="「我」页 · MeLayout" note="每项一行：图标、名字、一句现状、箭头，整行能点。拍摄账号那一行只在拍摄组自己的账号上出现。入口还没定：MetaBar 能在顶行加「我」，但和日期、中/EN 一起会挤成两行（见 /design 的 MetaBar 样张），底部栏仍是五项。">
        <div className="rpd-phones">
          <PhoneFrame side="elder" name="me-frame" time="19:30">
            <MeFrame locale="zh-Hans" crew={false} />
          </PhoneFrame>
          <PhoneFrame side="elder" name="me-frame-crew" time="19:30">
            <MeFrame locale="zh-Hans" crew />
          </PhoneFrame>
          <PhoneFrame side="elder" name="me-frame-en" time="19:30">
            <MeFrame locale="en" crew={false} />
          </PhoneFrame>
        </div>
        <StubMap rows={ME_MAP} />
      </Section>
    </Board>
  );
}
