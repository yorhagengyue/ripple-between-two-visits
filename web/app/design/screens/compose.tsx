/**
 * The composed example screens: whole phone screens built only from components/ui, components/family-ui and
 * components/today, with the story's real words (app/design/content.ts). Each renders inside a 390x844 frame
 * (gallery) or the full viewport (/design/screens/<name>, the screenshots).
 */
import type { ReactNode } from "react";
import {
  FamilyHome,
  FamilyScreen,
  FamilyTop,
  InviteAccept,
  NoReplyAlert,
  ReminderRecorder,
  SharedSection,
  type SharedItem,
} from "@/components/family-ui";
import {
  ActionDock,
  AnswerRefer,
  BodyText,
  BpKeypad,
  ButtonPair,
  CaptureCount,
  DangerButton,
  DarkButton,
  DoneHero,
  DoneRow,
  DrugName,
  ForDoctorCard,
  KeyValueRow,
  ListenBar,
  LiveCaptions,
  MetaBar,
  PrimaryButton,
  ReasonChoices,
  RecordingBar,
  ReviewSentence,
  Rows,
  Said,
  Screen,
  SecondaryButton,
  SourceLink,
  SourceTag,
  StatusHeadline,
  TabBar,
  UndoToast,
} from "@/components/ui";
import { TodayLayout } from "@/components/today";
import { familyCopy, uiCopy, type TabKey } from "@/lib/ui/copy";
import type { UiLocale } from "@/lib/ui/tokens";
import {
  ASKED,
  CAPTIONS,
  CONSENT_SENTENCE,
  dateLabel,
  DOCTOR,
  familyWeek,
  KEYPAD_READING,
  LABEL,
  metaLine,
  tpl,
  WEI_LING,
} from "../content";

export type ScreenName =
  | "elder-today-pending"
  | "elder-today-done"
  | "elder-today-reason"
  | "elder-hero"
  | "elder-bp"
  | "elder-review"
  | "elder-consent"
  | "elder-recording"
  | "family-home"
  | "family-recorder"
  | "family-noreply"
  | "family-shared"
  | "family-invite";

export interface ScreenSpec {
  side: "elder" | "family";
  /** the fake status bar's time */
  time: string;
  caption: { title: string; body: string };
  render: (locale: UiLocale) => ReactNode;
}

const zh = (l: UiLocale) => l === "zh-Hans";
/** the gallery never dials anyone: Dad's number is not in the fixtures */
const DAD_PHONE = "+65 0000 0000";
export const screenHref = (name: ScreenName, locale: UiLocale) => `/design/screens/${name}${locale === "en" ? "?lang=en" : ""}`;
const langSwitch = (name: ScreenName, locale: UiLocale) => screenHref(name, locale === "en" ? "zh-Hans" : "en");

function elderTabs(locale: UiLocale, active: TabKey = "today") {
  return <TabBar active={active} locale={locale} placement="static" />;
}

/** Wei Ling's reminder as it plays at 8:45 (her words, a stand-in voice for now). */
function Reminder({ locale }: { locale: UiLocale }) {
  return (
    <>
      <SourceTag kind="family" locale={locale} when="8:45">
        {zh(locale) ? "女儿 Wei Ling 的语音" : "Wei Ling's voice note"}
      </SourceTag>
      <Said lang="zh-Hans" source={{ kind: "family", ref: WEI_LING.ref }}>
        「{WEI_LING.lines[0]}
        <br />
        {WEI_LING.lines[1]}」
      </Said>
      <ListenBar kind="family" time="0:04" locale={locale} standIn progress={0.5} playing />
    </>
  );
}

/** Today's tablet with what the label says and the button to the label. */
function Dose({ locale }: { locale: UiLocale }) {
  return (
    <>
      <DrugName style={{ marginTop: 0 }}>{LABEL.drug}</DrugName>
      <SourceTag kind="label" locale={locale} style={{ marginTop: 10 }} />
      {zh(locale) ? <BodyText variant="strong" style={{ marginTop: 6 }}>{LABEL.restatedZh}</BodyText> : <BodyText variant="strong" style={{ marginTop: 6 }}>{LABEL.printed}</BodyText>}
      <SourceLink kind="label" href="/design/screens/elder-hero" time={LABEL.dispensed[locale]} locale={locale}>
        {zh(locale) ? "看药袋原文" : "See the label"}
      </SourceLink>
    </>
  );
}

const SHARED: Record<UiLocale, SharedItem[]> = {
  "zh-Hans": [
    { grant: "dose_summary", title: "每天吃药了没有", detail: "只有吃了 / 没吃 / 没回", shared: true },
    { grant: "bp_summary", title: "这周量了几次血压", detail: "次数，不含读数", shared: true },
    { grant: "questions_count", title: "有几个问题要问医生", detail: "个数，不含内容", shared: true },
    { grant: "no_reply_alert", title: "两次提醒没回时通知你", shared: true },
    { grant: "visit_transcripts", title: "看诊录音和逐字稿", shared: false },
    { grant: "notes", title: "他自己写的笔记", shared: false },
  ],
  en: [
    { grant: "dose_summary", title: "Whether he took his medicine each day", detail: "Only taken / not taken / no reply", shared: true },
    { grant: "bp_summary", title: "How many times he measured this week", detail: "The count, not the readings", shared: true },
    { grant: "questions_count", title: "How many questions wait for the doctor", detail: "The number, not what they are", shared: true },
    { grant: "no_reply_alert", title: "Tell you when two reminders get no reply", shared: true },
    { grant: "visit_transcripts", title: "Visit recordings and transcripts", shared: false },
    { grant: "notes", title: "His own notes", shared: false },
  ],
};

export const SCREENS: Record<ScreenName, ScreenSpec> = {
  "elder-today-pending": {
    side: "elder",
    time: "8:45",
    caption: { title: "今天 ① 早上 8:45，药还没记", body: "一句大字说现在的状态。女儿的话用衬线字，标「女儿 Wei Ling」和人像图标；整屏一个实心按钮，在下半屏。" },
    render: (locale) => (
      <TodayLayout
        locale={locale}
        fill="container"
        tabBarPlacement="static"
        tabBar={elderTabs(locale)}
        meta={<MetaBar story={metaLine(26, "08:45", locale)} locale={locale} langHref={langSwitch("elder-today-pending", locale)} />}
        headline={<StatusHeadline lines={zh(locale) ? ["早上的药，还没记。"] : ["Morning medicine:", "not logged yet."]} />}
        reminder={<Reminder locale={locale} />}
        dose={<Dose locale={locale} />}
        actions={
          <>
            <PrimaryButton icon="check">{uiCopy(locale).taken}</PrimaryButton>
            <ButtonPair>
              <SecondaryButton>{uiCopy(locale).notTaken}</SecondaryButton>
              <SecondaryButton>{uiCopy(locale).later}</SecondaryButton>
            </ButtonPair>
          </>
        }
      />
    ),
  },
  "elder-today-done": {
    side: "elder",
    time: "8:52",
    caption: { title: "今天 ② 点了「吃了」", body: "马上说「记好了」和几点；Wei Ling 会看到什么写清楚。底下黑条 12 秒内能撤销，不弹确认框。" },
    render: (locale) => (
      <TodayLayout
        locale={locale}
        fill="container"
        tabBarPlacement="static"
        tabBar={elderTabs(locale)}
        toast={<UndoToast message={zh(locale) ? "已记下：吃了" : "Logged: taken"} locale={locale} placement="absolute" frozenAt={0.64} />}
        meta={<MetaBar story={metaLine(26, "08:52", locale)} locale={locale} langHref={langSwitch("elder-today-done", locale)} />}
        headline={<DoneHero locale={locale} title={zh(locale) ? "记好了。" : "Logged."} detail={zh(locale) ? "早上 8:52 吃的。" : "Taken at 8:52 am."} />}
        focus="dose"
        dose={
          <>
            <SourceTag kind="family" locale={locale} style={{ marginTop: 4 }}>
              {zh(locale) ? "Wei Ling 会看到：今天吃了" : "Wei Ling will see: taken today"}
            </SourceTag>
            <DoneRow title={LABEL.drug} detail={zh(locale) ? "早上 · 8:52 记的" : "Morning · logged 8:52"} locale={locale} changeHref="/design/screens/elder-today-pending" />
          </>
        }
        countdown={
          <Rows style={{ marginTop: 0 }}>
            <KeyValueRow label={zh(locale) ? "今天还要做的" : "Still to do today"} value={zh(locale) ? "没有了" : "Nothing"} />
            <KeyValueRow label={zh(locale) ? "下次看诊" : "Next visit"} value={zh(locale) ? "大约 10月5日" : "About 5 Oct"} />
            <KeyValueRow label={zh(locale) ? "要问医生的" : "For the doctor"} value={zh(locale) ? "1 个" : "1 question"} href="/design#questionrow" />
          </Rows>
        }
      />
    ),
  },
  "elder-today-reason": {
    side: "elder",
    time: "9:15",
    caption: { title: "今天 ③ 点了「还没吃」", body: "问一句原因，不说教。打太极的早上，「打太极」排第一；「我自己说」打开说话。点一下就记，第 2 下。" },
    render: (locale) => (
      <Screen locale={locale} fill="container" tabBar={elderTabs(locale)}>
        <MetaBar story={metaLine(17, "09:15", locale)} locale={locale} langHref={langSwitch("elder-today-reason", locale)} />
        <StatusHeadline lines={zh(locale) ? ["早上的药，还没吃。"] : ["Morning medicine:", "not taken yet."]} />
        <DrugName>{LABEL.drug}</DrugName>
        <ActionDock>
          <ReasonChoices
            locale={locale}
            reasons={
              zh(locale)
                ? [
                    { code: "tai_chi_morning", label: "打太极" },
                    { code: "forgot", label: "忘了" },
                    { code: "away", label: "出门了" },
                    { code: "not_with_me", label: "药不在身边" },
                  ]
                : [
                    { code: "tai_chi_morning", label: "Tai chi" },
                    { code: "forgot", label: "Forgot" },
                    { code: "away", label: "I was out" },
                    { code: "not_with_me", label: "Medicine not with me" },
                  ]
            }
          />
        </ActionDock>
      </Screen>
    ),
  },
  "elder-hero": {
    side: "elder",
    time: "20:15",
    caption: { title: "主镜头：「今天 150/95，我能不能多吃一粒？」", body: "他的问题当标题。Ripple 只有一句固定的话；Dr Lim 的原话（衬线、蓝线、听诊器图标）能点开听；药袋原文用等宽字；最后一行：已在问题单里。" },
    render: (locale) => (
      <Screen locale={locale} fill="container" tabBar={elderTabs(locale)}>
        <MetaBar story={metaLine(29, "20:15", locale)} locale={locale} langHref={langSwitch("elder-hero", locale)} />
        <AnswerRefer
          locale={locale}
          question={ASKED.hero[locale]}
          ripple={tpl("refer_doctor", locale)}
          quote={{
            kind: "doctor",
            who: zh(locale) ? "Dr Lim 说过" : "Dr Lim said",
            when: DOCTOR.R4.date[locale],
            ref: DOCTOR.R4.ref,
            lang: "en",
            text: `“${DOCTOR.R4.text}”`,
            listen: { label: zh(locale) ? "听医生原声" : "Hear Dr Lim", href: "/design#sourcelink", time: DOCTOR.R4.at, standIn: true },
          }}
          label={{
            restated: zh(locale) ? LABEL.restatedZh : undefined,
            printed: LABEL.printed,
          }}
          addedHref="/design#questionrow"
        />
      </Screen>
    ),
  },
  "elder-bp": {
    side: "elder",
    time: "7:40",
    caption: { title: "记血压：照着血压计抄", body: "屏幕仿血压计的三行：上面的数、下面的数、心跳（可以不填）。大号数字键，不弹手机自带的小键盘。读数不着色、不评判。" },
    render: (locale) => (
      <Screen locale={locale} fill="container">
        <MetaBar back={{ href: "/design/screens/elder-today-done" }} story={dateLabel(39, locale)} locale={locale} langHref={langSwitch("elder-bp", locale)} />
        <StatusHeadline lines={[uiCopy(locale).bpTitle]} />
        <BodyText variant="lede">{uiCopy(locale).bpHint}</BodyText>
        <BpKeypad locale={locale} initial={{ sys: String(KEYPAD_READING.systolic), dia: String(KEYPAD_READING.diastolic), active: "dia" }} />
      </Screen>
    ),
  },
  "elder-review": {
    side: "elder",
    time: "11:20",
    caption: { title: "看诊后回顾：一句一句认", body: "每次只问一句，可以先听原声。点「是，医生说的」以后，这句才会在别处写成「医生说」；「不记得」也是正常的答案。" },
    render: (locale) => (
      <Screen locale={locale} fill="container">
        <MetaBar story={dateLabel(0, locale)} locale={locale} langHref={langSwitch("elder-review", locale)} />
        <ReviewSentence
          index={3}
          total={12}
          context={zh(locale) ? "刚才的看诊" : "This morning's visit"}
          sentence={`“${DOCTOR.R1.text}”`}
          lang="en"
          utteranceId={DOCTOR.R1.ref}
          at={DOCTOR.R1.at}
          listenHref="/design#reviewsentence"
          standIn
          locale={locale}
        />
      </Screen>
    ),
  },
  "elder-consent": {
    side: "elder",
    time: "10:02",
    caption: { title: "看诊前：先问医生能不能录", body: "他不用自己用英文开口：给医生看黑底白字那一句。医生点头，他按红色按钮开始录（红色只给急症和录音）。" },
    render: (locale) => (
      <Screen locale={locale} fill="container">
        <MetaBar back={{ href: "/design/screens/elder-today-pending" }} locale={locale} langHref={langSwitch("elder-consent", locale)} />
        <StatusHeadline lines={[uiCopy(locale).consentTitle]} />
        <BodyText variant="lede">{uiCopy(locale).consentSub}</BodyText>
        <ForDoctorCard locale={locale}>{CONSENT_SENTENCE}</ForDoctorCard>
        <ActionDock>
          <DangerButton icon="dot">{uiCopy(locale).consentStart}</DangerButton>
          <SecondaryButton>{uiCopy(locale).consentSkip}</SecondaryButton>
        </ActionDock>
      </Screen>
    ),
  },
  "elder-recording": {
    side: "elder",
    time: "10:05",
    caption: { title: "录音中：手机平放在桌上", body: "只有三样：红点和时间、最近两句字幕、一个大大的「录完了」。医生说什么都不用他当场看懂。" },
    render: (locale) => (
      <Screen locale={locale} fill="container">
        <RecordingBar elapsed="03:12" locale={locale} />
        <BodyText variant="lede">{uiCopy(locale).recordingKeep}</BodyText>
        <LiveCaptions earlier={CAPTIONS.earlier} now={CAPTIONS.now} locale={locale} />
        <CaptureCount count={5} locale={locale} />
        <ActionDock>
          <DarkButton icon="stop">{uiCopy(locale).stop}</DarkButton>
        </ActionDock>
      </Screen>
    ),
  },
  "family-home": {
    side: "family",
    time: "12:31",
    caption: { title: "女儿端首页：中午瞄一眼", body: "最上面就是答案：吃了，几点，他自己点的。四个数字只回答「这周怎么样」，不显示读数。看到的都是爸爸同意给她看的。" },
    render: (locale) => {
      const w = familyWeek(26);
      const copy = familyCopy(locale, null);
      return (
        <FamilyHome
          locale={locale}
          fill="container"
          kicker={`${copy.dadToday} · ${dateLabel(26, locale)}`}
          langHref={langSwitch("family-home", locale)}
          status={{ title: zh(locale) ? "早上的药吃了" : "Morning medicine: taken", detail: zh(locale) ? "8:52 他自己点的" : "He tapped it himself at 8:52", tone: "ok" }}
          stats={[
            { key: "dose", label: zh(locale) ? "这周吃药" : "Medicine this week", value: `${w.daysTaken}`, unit: zh(locale) ? `/ ${w.daysDue} 天` : `of ${w.daysDue} days` },
            { key: "bp", label: zh(locale) ? "这周量血压" : "BP checks this week", value: `${w.readings}`, unit: zh(locale) ? "次" : "times" },
            { key: "visit", label: zh(locale) ? "下次看诊" : "Next visit", value: zh(locale) ? "约 10月5日" : "About 5 Oct" },
            { key: "questions", label: zh(locale) ? "要问医生的" : "For the doctor", value: `${w.questions}`, unit: zh(locale) ? "个" : "question" },
          ]}
          reminder={{ words: WEI_LING.text, playsAt: "8:45", ownVoice: false }}
          recordHref="/design/screens/family-recorder"
          phone={DAD_PHONE}
          sharedHref="/design/screens/family-shared"
          privacy={zh(locale) ? "这些是爸爸同意给你看的。他的笔记和看诊录音没有分享。" : "Dad agreed to share these. His notes and visit recordings are not shared."}
        />
      );
    },
  },
  "family-recorder": {
    side: "family",
    time: "20:10",
    caption: { title: "女儿录提醒：录、听、重录、删、就用这段", body: "点红圈开始、再点停。先听一遍再决定。用了以后，爸爸那边显示「女儿的录音」，不是代录音。" },
    render: (locale) => (
      <FamilyScreen locale={locale} fill="container">
        <FamilyTop back={{ href: "/design/screens/family-home" }} locale={locale} langHref={langSwitch("family-recorder", locale)} />
        <ReminderRecorder state="recorded" locale={locale} playsAt="8:45" elapsed="0:04" current={{ words: WEI_LING.text, ownVoice: false }} />
      </FamilyScreen>
    ),
  },
  "family-noreply": {
    side: "family",
    time: "9:50",
    caption: { title: "两次提醒都没回", body: "琥珀色，不是红色：这是「去问问」，不是急症。只有一个动作：打电话给爸爸。也写明 Ripple 不会做什么。" },
    render: (locale) => (
      <FamilyScreen locale={locale} fill="container">
        <FamilyTop kicker={`${familyCopy(locale, null).dadToday} · ${dateLabel(42, locale)}`} locale={locale} langHref={langSwitch("family-noreply", locale)} />
        <NoReplyAlert
          locale={locale}
          title={zh(locale) ? "爸爸还没回早上的药。" : "Dad hasn't answered about his morning medicine."}
          detail={zh(locale) ? "8:45 和 9:15 两次提醒都没有回。" : "Neither reminder, at 8:45 or 9:15, got a reply."}
          lastEntry={{ when: zh(locale) ? "昨晚 9:12" : "Last night 9:12", what: zh(locale) ? "量了血压" : "Blood pressure" }}
          phone={DAD_PHONE}
          fill
        />
      </FamilyScreen>
    ),
  },
  "family-shared": {
    side: "family",
    time: "12:40",
    caption: { title: "爸爸让你看到的", body: "只读：分享了的打勾，没分享的写「没有分享」，不藏不猜。她没有任何开关。" },
    render: (locale) => (
      <FamilyScreen locale={locale} fill="container">
        <FamilyTop back={{ href: "/design/screens/family-home" }} locale={locale} langHref={langSwitch("family-shared", locale)} />
        <SharedSection items={SHARED[locale]} locale={locale} heading={familyCopy(locale, null).sharedTitle} />
      </FamilyScreen>
    ),
  },
  "family-invite": {
    side: "family",
    time: "19:05",
    caption: { title: "接受邀请", body: "先看清楚爸爸现在同意给她看什么，再点「接受邀请」；之后等爸爸确认是她。" },
    render: (locale) => (
      <FamilyScreen locale={locale} fill="container">
        <FamilyTop locale={locale} langHref={langSwitch("family-invite", locale)} />
        <InviteAccept state="invite" locale={locale} inviter={zh(locale) ? "陈先生" : "Mr Tan"} shares={SHARED[locale]} acceptHref="/design/family#invite" notNowHref="/design/family#invite" />
      </FamilyScreen>
    ),
  },
};

export const SCREEN_NAMES = Object.keys(SCREENS) as ScreenName[];
