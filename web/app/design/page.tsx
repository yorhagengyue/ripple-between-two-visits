import type { ReactNode } from "react";
import {
  AnswerCantHelp,
  AnswerEmergency,
  AnswerExplain,
  AnswerNoted,
  AnswerRefer,
  AnswerSelfHarm,
  AnswerUnknownMed,
  AddedRow,
  AskField,
  AskVoice,
  BodyText,
  BriefHeader,
  BriefItem,
  BriefNum,
  BriefOwnWords,
  BriefQuestions,
  ButtonPair,
  CaptureCount,
  DangerButton,
  DarkButton,
  Divider,
  DoneHero,
  DoneRow,
  DrugName,
  EmergencyBlock,
  EmptyState,
  ErrorState,
  ForDoctorCard,
  Hotlines,
  KeyValueRow,
  LabelOriginal,
  ListenBar,
  LiveCaptions,
  LoadingState,
  MetaBar,
  MicPermission,
  NextRow,
  OfflineState,
  OwnWords,
  PrimaryButton,
  QuestionRow,
  ReadingNumber,
  ReasonChoices,
  RecordingBar,
  ReviewSentence,
  Rows,
  Said,
  SecondaryButton,
  SectionLabel,
  SourceLink,
  SourceTag,
  StatusHeadline,
  TabBar,
  Tag,
  TapToPlay,
  Timeline,
  TimelineGroup,
  TimelineItem,
  UndoToast,
  type Hotline,
} from "@/components/ui";
import { ZhUnder } from "@/components/translate/ZhUnder";
import zhSet from "@/fixtures/translations/example.zh.json";
import { TEMPLATES } from "@/lib/safety/templates";
import { contrastRatio } from "@/lib/ui/contrast";
import { COLOURS, FILL_PAIRS, PAPER, TINTS, TYPE_SCALE, type SourceKind, type UiLocale } from "@/lib/ui/tokens";
import { Block, Board, Cell, PhoneFrame, Section } from "./Gallery";
import { BackDemo, KeypadDemo, SwitchesDemo, VoiceDemo, type SwitchSpec } from "./demos";
import { ToastDemo } from "./ToastDemo";
import {
  ANKLE_LINE,
  ASKED,
  briefNumbers,
  CANT_HELP,
  CAPTIONS,
  CONSENT_SENTENCE,
  COUNTER_LINES,
  DOCTOR,
  EXTRA_TABLET_ANSWER,
  HERO_READING,
  LABEL,
  LEAFLET,
  metaLine,
  NOTES,
  PHARMACIST_LINE,
  question,
  tpl,
  UNKNOWN_MED,
  WEI_LING,
} from "./content";
import { SCREENS, screenHref } from "./screens/compose";

/**
 * /design: Mr Tan's components (components/ui) in every state they have — normal, empty, loading, error, offline,
 * pending, filming — in 华语 and English, at phone width; the tokens; and the Today screens rebuilt from them.
 * The daughter side is /design/family, the composed screens /design/screens, the page frames /design/frames.
 * Every clinical word is real (app/design/content.ts).
 */

const FG: Record<string, string> = { "--rp-on-accent": "#FFFFFF", "--rp-on-ink": "#FFFFFF", "--rp-on-urgent": "#FFFFFF", "--rp-toast-accent": "#8FD9D1", "--rp-lcd-ink": "#E8F3EF", "--rp-lcd-label": "#BFD2CD", "--rp-lcd-empty": "#8FA6A1" };
const hex = (name: string) => FG[name] ?? [...COLOURS, ...TINTS].find((c) => c.name === name)?.value ?? "#000000";

const R4_QUOTE = `“${DOCTOR.R4.text}”`;
/** the checked-in Chinese of R4 (fixtures/translations: the same line an example account shows under it) */
const R4_ZH = (zhSet.lines as readonly { id: string; zh: string }[]).find((l) => l.id === DOCTOR.R4.ref)?.zh ?? "";
const zh = (l: UiLocale) => l === "zh-Hans";

function hotlines(locale: UiLocale): Hotline[] {
  const lines: Hotline[] = [
    { text: tpl("self_harm_995", locale), calls: [{ number: "995", urgent: true }] },
    {
      text: tpl("self_harm_sos", locale),
      calls: [
        { label: zh(locale) ? "打 SOS" : "Call SOS", number: "1767" },
        { label: "WhatsApp", number: "9151 1767", href: "https://wa.me/6591511767" },
      ],
    },
    { text: tpl("self_harm_mindline", locale), calls: [{ label: zh(locale) ? "打 mindline" : "Call mindline", number: "1771" }] },
  ];
  if (zh(locale)) lines.push({ text: TEMPLATES.self_harm_care_corner.zh, calls: [{ number: "1800-3535-800" }] });
  return lines;
}

function switches(locale: UiLocale): SwitchSpec[] {
  return zh(locale)
    ? [
        { name: "dose_summary", title: "每天吃药了没有", description: "她只看到吃了 / 没吃 / 没回", on: true },
        { name: "bp_summary", title: "这周量了几次血压", description: "只有次数，不含读数", on: true },
        { name: "questions_count", title: "要问医生的问题个数", description: "只有个数，不含内容", on: true },
        { name: "no_reply_alert", title: "没回提醒时告诉她", description: "两次提醒都没回才说", on: true },
        { name: "visit_transcripts", title: "看诊录音", description: "看诊时说的话", on: false },
        { name: "notes", title: "我自己记下的话", description: "我写的笔记", on: false },
      ]
    : [
        { name: "dose_summary", title: "Whether I took my medicine", description: "She sees only taken / not taken / no reply", on: true },
        { name: "bp_summary", title: "How often I measured this week", description: "The count only, not the readings", on: true },
        { name: "questions_count", title: "How many questions for the doctor", description: "The number only, not what they are", on: true },
        { name: "no_reply_alert", title: "Tell her when I don't reply", description: "Only after two reminders get no reply", on: true },
        { name: "visit_transcripts", title: "Visit recordings", description: "What was said at my visits", on: false },
        { name: "notes", title: "My own notes", description: "What I wrote down myself", on: false },
      ];
}

function heroQuote(locale: UiLocale) {
  return {
    kind: "doctor" as const,
    who: zh(locale) ? "Dr Lim 说过" : "Dr Lim said",
    when: DOCTOR.R4.date[locale],
    ref: DOCTOR.R4.ref,
    lang: "en" as const,
    text: R4_QUOTE,
    listen: { label: zh(locale) ? "听医生原声" : "Hear Dr Lim", href: "/design#sourcelink", time: DOCTOR.R4.at, standIn: true },
  };
}

function heroLabel(locale: UiLocale) {
  return {
    restated: zh(locale) ? LABEL.restatedZh : undefined,
    printed: LABEL.printed,
    open: { label: zh(locale) ? "看药袋原文" : "See the label", href: "/design#labeloriginal", time: LABEL.dispensed[locale] },
  };
}

const KINDS: readonly SourceKind[] = ["doctor", "dispenser", "pharmacist", "label", "leaflet", "family", "self", "ripple"];

function Langs({ children }: { children: (locale: UiLocale) => ReactNode }) {
  return (
    <>
      {children("zh-Hans")}
      {children("en")}
    </>
  );
}

export default function DesignPage() {
  const b = briefNumbers();
  return (
    <Board
      side="elder"
      current="/design"
      eyebrow="RIPPLE UI · 老人端 · 适老的极简"
      title="陈先生手机上的组件"
      lede="tone v2 的适老规矩为准，版式沿用 direction.md：暖白底、一个强调色、靠留白和细线分组。组件在 components/ui，样式在 app/ripple-ui.css 第一部分。每个组件给华语、English 和它有的空、加载中、出错、拍摄模式状态。"
      rules={[
        "一屏一件事；主按钮 64 高、整行宽、放下半屏",
        "只点：不滑、不长按、不双击；不弹确认框，撤销条 12 秒",
        "字最小 18（标签、底部栏也是），跟手机字号一起变大；不锁缩放",
        "谁说的：图标 + 文字 + 颜色一起，不只靠颜色",
        "次按钮有看得见的 2.5px 边",
        "读数不评判；红色只给急症和「正在录音」",
        "别人的原话衬线，Ripple 和他自己的话无衬线，药袋原文等宽",
        "对比度至少 WCAG AA；只做浅色",
      ]}
    >
      {/* ---------- the Today screens ---------- */}
      <Section id="today" title="今天 · 三个状态（整屏样例的一部分）" note="只用 components/ui 和 components/today 拼，文字取自 fixtures。全部整屏样例在 /design/screens。">
        <div className="rpd-phones">
          {(["elder-today-pending", "elder-today-done", "elder-hero"] as const).map((n) => (
            <PhoneFrame key={n} side="elder" name={n} time={SCREENS[n].time} caption={SCREENS[n].caption} href={screenHref(n, "zh-Hans")}>
              {SCREENS[n].render("zh-Hans")}
            </PhoneFrame>
          ))}
        </div>
      </Section>

      {/* ---------- tokens ---------- */}
      <Section id="tokens" title="颜色 · Colour" note={`对比度按 WCAG 算，底色是 paper ${PAPER}。文字色都过 4.5:1；line 是细线，不做文字；edge 是次按钮的边。急症红只铺急症和录音。`}>
        <div className="rpd-swatches">
          {[...COLOURS, ...TINTS].map((c) => (
            <div className="rpd-swatch" key={c.name}>
              <span className="rpd-chip" style={{ background: c.value }} />
              <span className="rpd-swatch-name">{c.name}</span>
              <span className="rpd-swatch-meta">
                {c.value} · {c.role === "ground" || c.role === "decor" ? c.role : `${contrastRatio(c.value, PAPER).toFixed(2)}:1`}
              </span>
              <span className="rpd-swatch-meta">{c.use}</span>
            </div>
          ))}
          {FILL_PAIRS.map((p) => (
            <div className="rpd-swatch" key={`${p.fg}-${p.bg}`}>
              <span className="rpd-chip" style={{ background: hex(p.bg), borderColor: hex(p.fg), borderWidth: 6 }} />
              <span className="rpd-swatch-name">
                {p.fg.replace("--rp-", "")} / {p.bg.replace("--rp-", "")}
              </span>
              <span className="rpd-swatch-meta">
                {contrastRatio(hex(p.fg), hex(p.bg)).toFixed(2)}:1 · {p.use}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="type"
        title="字 · Type"
        note="别人的原话：Literata / Noto Serif SC。Ripple 和他自己的话：Atkinson Hyperlegible Next / 苹方、微软雅黑。药袋原文和读数：Atkinson Hyperlegible Mono。18 是最小字号。每个字号写成 calc(N × --rp-u)：手机调大字号，整套跟着变大。"
      >
        <div className="rpd-scale">
          <div className="rpd-scale-row">
            <span className="rpd-scale-px">{TYPE_SCALE.headline}px</span>
            <StatusHeadline lines={["早上的药，还没记。"]} style={{ marginTop: 0 }} />
          </div>
          <div className="rpd-scale-row">
            <span className="rpd-scale-px">{TYPE_SCALE.reading}px</span>
            <ReadingNumber value={`${HERO_READING.systolic}/${HERO_READING.diastolic}`} unit="mmHg" style={{ marginTop: 0 }} />
          </div>
          <div className="rpd-scale-row">
            <span className="rpd-scale-px">{TYPE_SCALE.drug}px</span>
            <DrugName style={{ marginTop: 0 }}>{LABEL.drug}</DrugName>
          </div>
          <div className="rpd-scale-row">
            <span className="rpd-scale-px">{TYPE_SCALE.saidZh}px</span>
            <Said lang="zh-Hans" source={{ kind: "family", ref: WEI_LING.ref }} style={{ marginTop: 0 }}>
              「{WEI_LING.text}」
            </Said>
          </div>
          <div className="rpd-scale-row">
            <span className="rpd-scale-px">{TYPE_SCALE.saidEn}px</span>
            <Said lang="en" source={{ kind: "doctor", ref: DOCTOR.R1.ref }} style={{ marginTop: 0 }}>
              “{DOCTOR.R1.text}”
            </Said>
          </div>
          <div className="rpd-scale-row">
            <span className="rpd-scale-px">{TYPE_SCALE.body}px</span>
            <BodyText style={{ marginTop: 0 }}>药袋上写着：{LABEL.restatedZh}</BodyText>
          </div>
          <div className="rpd-scale-row">
            <span className="rpd-scale-px">18px</span>
            <LabelOriginal style={{ marginTop: 0 }}>{LABEL.printed}</LabelOriginal>
          </div>
          <div className="rpd-scale-row">
            <span className="rpd-scale-px">{TYPE_SCALE.min}px</span>
            <SectionLabel>{metaLine(29, "20:15", "zh-Hans")}</SectionLabel>
          </div>
        </div>
      </Section>

      {/* ---------- components ---------- */}
      <Section id="components" title="组件 · Components" note="底色就是页面底色 paper。每格 390 宽，是手机上的实际大小。">
        <Block
          id="timeline"
          name="Timeline · TimelineGroup · OwnWords · SaidTranslation · PageHeader"
          note="时间线稿的几样零件：两根线接成一根（joinNext / joinPrev），一问一答包成一个元素线不断（TimelineGroup），他自己的话不在线上时的样子（OwnWords：实心圆加普通字体），英文原话下面的中文（宋体 22、左边一根线、下面一行 18 的说明），页头的返回可以是按钮。"
        >
          <Cell cap="两根线接成一根 · 英文原话下面的中文" lang="zh-Hans">
            <Timeline joinNext>
              <TimelineItem node="me" who="你问" say={ASKED.hero["zh-Hans"].join("")} />
            </Timeline>
            <Timeline joinPrev>
              <TimelineItem node="doc" who="医生说" meta={`${DOCTOR.R4.date["zh-Hans"]} · ${DOCTOR.R4.at}`} headRp="source-tag">
                <Said lang="en" source={{ kind: "doctor", ref: DOCTOR.R4.ref }} style={{ marginTop: 0 }}>
                  {R4_QUOTE}
                </Said>
                <ZhUnder text={R4_ZH} locale="zh-Hans" />
              </TimelineItem>
              <TimelineItem node="rip" say={tpl("refer_doctor", "zh-Hans")} />
            </Timeline>
          </Cell>
          <Cell cap="一问一答各包成一个元素，线不断" lang="zh-Hans">
            <Timeline>
              <TimelineGroup as="article" data-question="q-1">
                <TimelineItem node="me" who="你问" say={ASKED.hero["zh-Hans"].join("")} />
                <TimelineItem node="rip" say={tpl("refer_doctor", "zh-Hans")} />
              </TimelineGroup>
              <TimelineGroup as="article" data-question="q-2">
                <TimelineItem node="me" who="你问" say={ASKED.explain["zh-Hans"].join("")} />
                <TimelineItem node="lab" who="单张写着" note={LEAFLET.from["zh-Hans"]}>
                  <p className="rpu-said" lang="zh-Hans" style={{ marginTop: 0 }}>
                    {LEAFLET.purpose["zh-Hans"]}
                  </p>
                </TimelineItem>
              </TimelineGroup>
            </Timeline>
          </Cell>
          <Cell cap="他自己的话，不在线上" lang="zh-Hans">
            <div className="rpu-stack">
              <OwnWords who="你问" meta={DOCTOR.R4.date["zh-Hans"]}>
                {ASKED.hero["zh-Hans"].join("")}
              </OwnWords>
              <OwnWords size="sub" who="你说">
                {NOTES.tired}
              </OwnWords>
            </div>
          </Cell>
          <Cell cap="页头 · 返回是按钮，没有「我」" lang="zh-Hans">
            <BackDemo locale="zh-Hans" />
          </Cell>
        </Block>

        <Block id="metabar" name="MetaBar" note="顶部一行：真实日期和时间，或「‹ 返回」；右边「中/EN」（direction.md），带边的 48 高按钮。没有标题栏。「我」的入口还没定。">
          <Cell cap="华语" lang="zh-Hans">
            <MetaBar story={metaLine(26, "08:45", "zh-Hans")} locale="zh-Hans" langHref="/design#metabar" />
          </Cell>
          <Cell cap="English" lang="en">
            <MetaBar story={metaLine(29, "20:15", "en")} locale="en" langHref="/design#metabar" />
          </Cell>
          <Cell cap="加「我」（待定：会挤成两行）" lang="zh-Hans">
            <MetaBar story={metaLine(26, "08:45", "zh-Hans")} locale="zh-Hans" langHref="/design#metabar" meHref="/design/frames#me" />
          </Cell>
          <Cell cap="下一层 · 返回" lang="zh-Hans">
            <MetaBar back={{ href: "/design#metabar" }} locale="zh-Hans" langHref="/design#metabar" />
          </Cell>
          <Cell cap="拍摄模式 · 不变" lang="zh-Hans" filming>
            <MetaBar story={metaLine(29, "20:15", "zh-Hans")} locale="zh-Hans" langHref="/design#metabar" />
          </Cell>
        </Block>

        <Block id="statusheadline" name="StatusHeadline" note="每屏最上面一句大字（34，800）；主镜头用他的问题当标题（30）；问他的话 28。">
          <Cell cap="华语 · 状态" lang="zh-Hans">
            <StatusHeadline lines={["早上的药，还没记。"]} style={{ marginTop: 0 }} />
          </Cell>
          <Cell cap="English · status" lang="en">
            <StatusHeadline lines={["Morning medicine:", "not logged yet."]} style={{ marginTop: 0 }} />
          </Cell>
          <Cell cap="华语 · 他的问题" lang="zh-Hans">
            <StatusHeadline variant="question" kicker="你问" lines={ASKED.hero["zh-Hans"]} style={{ marginTop: -14 }} />
          </Cell>
          <Cell cap="English · his question" lang="en">
            <StatusHeadline variant="question" kicker="You asked" lines={ASKED.hero.en} style={{ marginTop: -14 }} />
          </Cell>
          <Cell cap="问他 · ask" lang="zh-Hans">
            <StatusHeadline variant="ask" lines={["这句是医生说的吗？"]} />
          </Cell>
          <Cell cap="空 · 今天没有要核对的药" lang="zh-Hans" state="empty">
            <StatusHeadline lines={["今天没有要核对的药。"]} style={{ marginTop: 0 }} />
          </Cell>
        </Block>

        <Block id="bodytext" name="BodyText · DrugName" note="Ripple 的话和他自己的话：无衬线 20（拍摄模式 22）；药名 25。别人的原话不放这里，放 Said。">
          <Cell cap="华语" lang="zh-Hans">
            <BodyText variant="lede" style={{ marginTop: 0 }}>
              Wei Ling 那边会看到「今天吃了」。
            </BodyText>
            <DrugName>{LABEL.drug}</DrugName>
            <BodyText>药袋上写着：{LABEL.restatedZh}</BodyText>
            <BodyText variant="answer">{TEMPLATES.refer_doctor.zh}</BodyText>
          </Cell>
          <Cell cap="English" lang="en">
            <BodyText variant="lede" style={{ marginTop: 0 }}>
              Wei Ling will see “taken today”.
            </BodyText>
            <DrugName>{LABEL.drug}</DrugName>
            <BodyText>The label says: {LABEL.printed}.</BodyText>
            <BodyText variant="answer">{TEMPLATES.refer_doctor.en}</BodyText>
          </Cell>
          <Cell cap="拍摄模式 · 22" lang="zh-Hans" filming>
            <BodyText variant="lede" style={{ marginTop: 0 }}>
              Wei Ling 那边会看到「今天吃了」。
            </BodyText>
            <BodyText variant="answer">{TEMPLATES.refer_doctor.zh}</BodyText>
          </Cell>
        </Block>

        <Block id="sectionlabel" name="SectionLabel" note="普通的组名（18，ink-3）。说话人不用它：说话人用 SourceTag。">
          <Cell cap="华语" lang="zh-Hans">
            <SectionLabel>今天早上</SectionLabel>
            <Divider />
            <SectionLabel time="8:45">今天还要做的</SectionLabel>
          </Cell>
          <Cell cap="English" lang="en">
            <SectionLabel>This morning</SectionLabel>
            <Divider />
            <SectionLabel time="8:45">Still to do today</SectionLabel>
          </Cell>
        </Block>

        <Block id="sourcetag" name="SourceTag" note="谁说的、写在哪：圆形图标 + 文字 + 颜色三样一起。推断的医生用虚线圈和「好像是医生说的」。">
          <Cell cap="华语 · 八种" lang="zh-Hans">
            <div style={{ display: "grid", gap: 12 }}>
              {KINDS.map((k) => (
                <SourceTag key={k} kind={k} locale="zh-Hans" when={k === "doctor" ? "9月1日 · 0:43" : undefined} />
              ))}
              <SourceTag kind="doctor" inferred locale="zh-Hans" when={DOCTOR.R1.at} />
            </div>
          </Cell>
          <Cell cap="English" lang="en">
            <div style={{ display: "grid", gap: 12 }}>
              {KINDS.map((k) => (
                <SourceTag key={k} kind={k} locale="en" when={k === "doctor" ? "1 Sep · 0:43" : undefined} />
              ))}
              <SourceTag kind="doctor" inferred locale="en" when={DOCTOR.R1.at} />
            </div>
          </Cell>
          <Cell cap="带名字" lang="zh-Hans">
            <div style={{ display: "grid", gap: 12 }}>
              <SourceTag kind="family" locale="zh-Hans" when="8:45">
                女儿 Wei Ling 的语音
              </SourceTag>
              <SourceTag kind="doctor" locale="zh-Hans" when="9月1日">
                Dr Lim 说过
              </SourceTag>
              <SourceTag kind="dispenser" locale="zh-Hans" when="9月1日">
                柜台 Auntie Mei 说过
              </SourceTag>
              <SourceTag kind="pharmacist" locale="zh-Hans" when="9月5日">
                药剂师 Raj 说过
              </SourceTag>
            </div>
          </Cell>
        </Block>

        <Block id="said" name="Said" note="别人的原话：衬线 600，中文 24、英文 22。必须给出处（不给编译不过）；可加说话人颜色的竖线。上面总配一个 SourceTag。">
          <Cell cap="华语 · 女儿的原话" lang="zh-Hans">
            <SourceTag kind="family" locale="zh-Hans" when="8:45">
              女儿 Wei Ling 的语音
            </SourceTag>
            <Said lang="zh-Hans" source={{ kind: "family", ref: WEI_LING.ref }}>
              「{WEI_LING.lines[0]}
              <br />
              {WEI_LING.lines[1]}」
            </Said>
          </Cell>
          <Cell cap="English UI · Dr Lim, with rule" lang="en">
            <SourceTag kind="doctor" locale="en" when="1 Sep">
              Dr Lim said
            </SourceTag>
            <Said lang="en" ruled source={{ kind: "doctor", ref: DOCTOR.R4.ref }}>
              {R4_QUOTE}
            </Said>
          </Cell>
          <Cell cap="华语 · 柜台的原话" lang="zh-Hans">
            <SourceTag kind="dispenser" locale="zh-Hans" when={`9月1日 · ${COUNTER_LINES[1].at}`}>
              柜台 Auntie Mei 说过
            </SourceTag>
            <Said lang="zh-Hans" ruled source={{ kind: "dispenser", ref: COUNTER_LINES[1].ref }}>
              「{COUNTER_LINES[1].text}」
            </Said>
          </Cell>
          <Cell cap="华语 · 药剂师的原话" lang="zh-Hans">
            <SourceTag kind="pharmacist" locale="zh-Hans" when="9月5日">
              药剂师 Raj 说过
            </SourceTag>
            <Said lang="en" ruled source={{ kind: "pharmacist", ref: PHARMACIST_LINE.ref }}>
              “{PHARMACIST_LINE.text}”
            </Said>
          </Cell>
          <Cell cap="拍摄模式 · 原话字号不变" lang="zh-Hans" filming>
            <SourceTag kind="doctor" locale="zh-Hans" when={`9月1日 · ${ANKLE_LINE.at}`}>
              Dr Lim 说过
            </SourceTag>
            <Said lang="en" ruled source={{ kind: "doctor", ref: ANKLE_LINE.ref }}>
              “{ANKLE_LINE.text}”
            </Said>
          </Cell>
        </Block>

        <Block id="sourcelink" name="SourceLink" note="出处是真按钮：50 高、2px 说话人颜色的边、图标、字和时间；代录音另加一个字标签。">
          <Cell cap="华语 · 五种" lang="zh-Hans">
            <SourceLink kind="doctor" play href="/design#sourcelink" time={`9月1日 · ${DOCTOR.R4.at}`} standIn locale="zh-Hans">
              听医生原声
            </SourceLink>
            <SourceLink kind="label" href="/design#labeloriginal" time="9月1日" locale="zh-Hans">
              看药袋原文
            </SourceLink>
            <SourceLink kind="leaflet" href="/design#sourcelink" time="3月2日审阅" locale="zh-Hans">
              看单张原文
            </SourceLink>
            <SourceLink kind="dispenser" play href="/design#sourcelink" time={`9月1日 · ${COUNTER_LINES[1].at}`} standIn locale="zh-Hans">
              听柜台原声
            </SourceLink>
            <SourceLink kind="family" play href="/design#sourcelink" time="0:04" standIn locale="zh-Hans">
              听女儿的提醒
            </SourceLink>
          </Cell>
          <Cell cap="English" lang="en">
            <SourceLink kind="doctor" play href="/design#sourcelink" time={`1 Sep · ${DOCTOR.R4.at}`} standIn locale="en">
              Hear Dr Lim
            </SourceLink>
            <SourceLink kind="label" href="/design#labeloriginal" time="1 Sep" locale="en">
              See the label
            </SourceLink>
            <SourceLink kind="pharmacist" play href="/design#sourcelink" time={`5 Sep · ${PHARMACIST_LINE.at}`} standIn locale="en">
              Hear the pharmacist
            </SourceLink>
          </Cell>
          <Cell cap="出错 · 录音放不了" lang="zh-Hans" state="error">
            <SourceLink kind="doctor" play disabled time={DOCTOR.R4.at} locale="zh-Hans">
              录音暂时放不了
            </SourceLink>
          </Cell>
        </Block>

        <Block id="tag" name="Tag" note="一个词的带边小标签（18）：代录音、女儿的录音、问医生、还没问、NEW。不是按钮。">
          <Cell cap="华语" lang="zh-Hans">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <Tag tone="family">代录音</Tag>
              <Tag tone="family">女儿的录音</Tag>
              <Tag tone="doctor" icon="steth">
                问医生
              </Tag>
              <Tag>还没问</Tag>
              <Tag tone="ink" icon="sparkle">
                NEW
              </Tag>
              <Tag tone="accent">已确认</Tag>
            </div>
          </Cell>
          <Cell cap="English" lang="en">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <Tag tone="family">stand-in recording</Tag>
              <Tag tone="doctor" icon="steth">
                For the doctor
              </Tag>
              <Tag>Not asked yet</Tag>
            </div>
          </Cell>
        </Block>

        <Block id="labeloriginal" name="LabelOriginal" note="药袋原文：等宽 18，原样大小写，不翻译；上面配「药袋上写着」。">
          <Cell cap="华语页面里" lang="zh-Hans">
            <SourceTag kind="label" locale="zh-Hans" />
            <BodyText variant="strong" style={{ marginTop: 6 }}>
              {LABEL.restatedZh}
            </BodyText>
            <LabelOriginal>{LABEL.printed}</LabelOriginal>
            <SourceLink kind="label" href="/design#labeloriginal" time="9月1日" locale="zh-Hans">
              看药袋原文
            </SourceLink>
          </Cell>
          <Cell cap="English" lang="en">
            <SourceTag kind="label" locale="en" />
            <LabelOriginal>{LABEL.printedName}</LabelOriginal>
            <LabelOriginal>{LABEL.printed}</LabelOriginal>
          </Cell>
        </Block>

        <Block id="listenbar" name="ListenBar" note="能听的录音：带字的按钮（▶ 听 / 正在播）、细进度线，不画波形；谁的声音用字标出来。">
          <Cell cap="华语 · 正在播 · 代录音" lang="zh-Hans">
            <ListenBar kind="family" time="0:04" locale="zh-Hans" standIn progress={0.5} playing />
          </Cell>
          <Cell cap="华语 · 女儿自己录的" lang="zh-Hans">
            <ListenBar kind="family" time="0:04" locale="zh-Hans" ownVoice />
          </Cell>
          <Cell cap="English · Dr Lim, paused" lang="en">
            <ListenBar kind="doctor" time={DOCTOR.R4.at} label="Hear Dr Lim" locale="en" standIn />
          </Cell>
          <Cell cap="出错 · 放不了" lang="zh-Hans" state="error">
            <ListenBar kind="family" time="0:04" locale="zh-Hans" unavailable />
          </Cell>
        </Block>

        <Block id="buttons" name="PrimaryButton · SecondaryButton · ButtonPair · DangerButton · DarkButton" note="一屏一个实心主按钮：64 高、整行宽。次按钮 60 高、白底 2.5px 深边。红色只给开始录音和 995；「录完了」用黑色 72 高。">
          <Cell cap="华语" lang="zh-Hans">
            <PrimaryButton icon="check">吃了</PrimaryButton>
            <ButtonPair style={{ marginTop: 14 }}>
              <SecondaryButton>还没吃</SecondaryButton>
              <SecondaryButton>等一下</SecondaryButton>
            </ButtonPair>
          </Cell>
          <Cell cap="English" lang="en">
            <PrimaryButton icon="check">Taken</PrimaryButton>
            <ButtonPair style={{ marginTop: 14 }}>
              <SecondaryButton>Not yet</SecondaryButton>
              <SecondaryButton>Later</SecondaryButton>
            </ButtonPair>
          </Cell>
          <Cell cap="加载中 · 点了以后在记" lang="zh-Hans" state="loading">
            <PrimaryButton pending icon="check">
              吃了
            </PrimaryButton>
            <ButtonPair style={{ marginTop: 14 }}>
              <SecondaryButton disabled>还没吃</SecondaryButton>
              <SecondaryButton disabled>等一下</SecondaryButton>
            </ButtonPair>
          </Cell>
          <Cell cap="录音 · 红色和黑色" lang="zh-Hans">
            <DangerButton icon="dot">医生同意了，开始录</DangerButton>
            <DarkButton icon="stop" style={{ marginTop: 14 }}>
              录完了
            </DarkButton>
          </Cell>
          <Cell cap="拍摄模式 · 不变" lang="zh-Hans" filming>
            <PrimaryButton icon="check">吃了</PrimaryButton>
          </Cell>
        </Block>

        <Block id="donerow" name="DoneHero · DoneRow" note="点完马上告诉他：大勾、「记好了。」和几点。完成的事收成一行：打钩、几点、带边的「改一下」。">
          <Cell cap="华语" lang="zh-Hans">
            <DoneHero locale="zh-Hans" title="记好了。" detail="早上 8:52 吃的。" style={{ marginTop: 0 }} />
            <DoneRow title={LABEL.drug} detail="早上 · 8:52 记的" locale="zh-Hans" changeHref="/design#donerow" />
          </Cell>
          <Cell cap="English" lang="en">
            <DoneHero locale="en" title="Logged." detail="Taken at 8:52 am." style={{ marginTop: 0 }} />
            <DoneRow title={LABEL.drug} detail="Morning · logged 8:52" locale="en" changeHref="/design#donerow" />
          </Cell>
        </Block>

        <Block id="rows" name="KeyValueRow · NextRow · AddedRow" note="一行一件事，下面一根细线；能点的整行是链接，带箭头。">
          <Cell cap="华语" lang="zh-Hans">
            <Rows style={{ marginTop: 0 }}>
              <KeyValueRow label="今天还要做的" value="没有了" />
              <KeyValueRow label="下次看诊" value="大约 10月5日" />
              <KeyValueRow label="要问医生的" value="1 个" href="/design#questionrow" />
            </Rows>
            <NextRow href="/design#questionrow" count={3}>
              个问题等下次看诊问
            </NextRow>
            <AddedRow href="/design#questionrow">已在下次看诊的问题单里</AddedRow>
          </Cell>
          <Cell cap="English" lang="en">
            <Rows style={{ marginTop: 0 }}>
              <KeyValueRow label="Still to do today" value="Nothing" />
              <KeyValueRow label="For the doctor" value="1 question" href="/design#questionrow" />
            </Rows>
            <AddedRow href="/design#questionrow">In the questions for your next visit</AddedRow>
          </Cell>
          <Cell cap="空 · 没有要问的" lang="zh-Hans" state="empty">
            <EmptyState icon="list" action={{ label: "写一个问题", href: "/design#askfield" }}>
              还没有要问医生的问题。
            </EmptyState>
          </Cell>
          <Cell cap="拍摄模式 · 22" lang="zh-Hans" filming>
            <KeyValueRow label="下次看诊" value="大约 10月5日" />
          </Cell>
        </Block>

        <Block id="reading" name="ReadingNumber" note="读数：等宽 46，单位小字。不着色、不评判，只摆在医生说过的数字旁边。">
          <Cell cap="华语 · 医生说的数旁边" lang="zh-Hans">
            <SectionLabel>9月22日 · 晚上</SectionLabel>
            <ReadingNumber value={`${HERO_READING.systolic}/${HERO_READING.diastolic}`} unit="mmHg" />
            <Divider />
            <SourceTag kind="doctor" locale="zh-Hans" when={`8月24日 · ${DOCTOR.R1.at}`}>
              Dr Lim 说过
            </SourceTag>
            <Said lang="en" ruled source={{ kind: "doctor", ref: DOCTOR.R1.ref }}>
              “{DOCTOR.R1.text}”
            </Said>
          </Cell>
          <Cell cap="English" lang="en">
            <SectionLabel>22 Sep · evening</SectionLabel>
            <ReadingNumber value={`${HERO_READING.systolic}/${HERO_READING.diastolic}`} unit="mmHg" />
          </Cell>
          <Cell cap="空 · 还没有读数" lang="zh-Hans" state="empty">
            <EmptyState icon="pulse">还没有血压读数。</EmptyState>
          </Cell>
          <Cell cap="加载中" lang="zh-Hans" state="loading">
            <LoadingState locale="zh-Hans" lines={2} />
          </Cell>
        </Block>

        <Block id="undotoast" name="UndoToast" note="底部的黑条：白底「撤销」按钮，下面一根线倒计时，12 秒（不少于 10 秒），不弹确认框。第三格是真的：点一下看。">
          <Cell cap="华语 · 停在 64%" lang="zh-Hans">
            <UndoToast message="已记下：吃了" locale="zh-Hans" placement="inline" frozenAt={0.64} />
          </Cell>
          <Cell cap="English · frozen at 30%" lang="en">
            <UndoToast message="Logged: taken" locale="en" placement="inline" frozenAt={0.3} />
          </Cell>
          <Cell cap="真的跑 · 12 秒" lang="zh-Hans">
            <ToastDemo locale="zh-Hans" />
          </Cell>
        </Block>

        <Block id="tabbar" name="TabBar" note="四个位置（10-14）：今天、就诊、记录、我；图标在上，字在下（18）。当前一项加粗、紫色、上沿 4px 的条，不只靠颜色。360 宽放得下英文。">
          <Cell cap="华语 · 今天" lang="zh-Hans" bleed>
            <TabBar active="today" locale="zh-Hans" placement="static" />
          </Cell>
          <Cell cap="English · Records" lang="en" bleed>
            <TabBar active="records" locale="en" placement="static" />
          </Cell>
          <Cell cap="华语 · 我" lang="zh-Hans" bleed>
            <TabBar active="me" locale="zh-Hans" placement="static" />
          </Cell>
        </Block>

        <Block id="emergency" name="EmergencyBlock · Hotlines" note="唯一铺红色的地方：995 固定句，号码最大。自伤：语气平静，每个号码一下就能打，号码是能复制的字；华语界面加 Care Corner。">
          <Langs>
            {(locale) => (
              <Cell key={`em-${locale}`} cap={zh(locale) ? "华语 · 995" : "English · 995"} lang={locale}>
                <EmergencyBlock title={tpl("emergency_995", locale)} call={{ number: "995" }} locale={locale} style={{ marginTop: 0 }} />
              </Cell>
            )}
          </Langs>
          <Langs>
            {(locale) => (
              <Cell key={`sh-${locale}`} cap={zh(locale) ? "华语 · 自伤热线" : "English · self-harm lines"} lang={locale}>
                <Hotlines lines={hotlines(locale)} locale={locale} style={{ marginTop: 0 }} />
              </Cell>
            )}
          </Langs>
          <Cell cap="拍摄模式 · 正文 22" lang="zh-Hans" filming>
            <Hotlines lines={hotlines("zh-Hans")} locale="zh-Hans" style={{ marginTop: 0 }} />
          </Cell>
        </Block>

        <Block id="states" name="EmptyState · LoadingState · ErrorState · OfflineState" note="空：一句平话。加载中：安静的骨架，不转圈。出错：说清楚什么还在，再给「再试一次」。没网：能看已有的，不能问新问题。">
          <Cell cap="空 · 华语" lang="zh-Hans" state="empty">
            <EmptyState icon="list" action={{ label: "写一个问题", href: "/design#askfield" }}>
              还没有要问医生的问题。
            </EmptyState>
          </Cell>
          <Cell cap="Empty · English" lang="en" state="empty">
            <EmptyState icon="list" action={{ label: "Write a question", href: "/design#askfield" }}>
              No questions for your doctor yet.
            </EmptyState>
          </Cell>
          <Cell cap="加载中 · 华语" lang="zh-Hans" state="loading">
            <MetaBar story={metaLine(26, "08:45", "zh-Hans")} locale="zh-Hans" langHref="/design#states" />
            <LoadingState locale="zh-Hans" headline lines={3} button />
          </Cell>
          <Cell cap="Loading · English" lang="en" state="loading">
            <LoadingState locale="en" headline lines={3} />
          </Cell>
          <Cell cap="出错 · 华语" lang="zh-Hans" state="error">
            <ErrorState locale="zh-Hans" retryHref="/design#states">
              没连上，药的记录还在。
            </ErrorState>
          </Cell>
          <Cell cap="Error · English" lang="en" state="error">
            <ErrorState locale="en" retryHref="/design#states">
              Couldn&apos;t connect. Your medicine log is still here.
            </ErrorState>
          </Cell>
          <Cell cap="没网 · 华语" lang="zh-Hans" state="offline">
            <OfflineState locale="zh-Hans" />
          </Cell>
          <Cell cap="Offline · English" lang="en" state="offline">
            <OfflineState locale="en" />
          </Cell>
          <Cell cap="拍摄模式 · 22" lang="zh-Hans" filming state="empty">
            <EmptyState icon="pulse">还没有血压读数。</EmptyState>
          </Cell>
        </Block>

        <Block id="permission" name="MicPermission · TapToPlay" note="要麦克风之前先说清楚、点哪个；被拒绝了说去哪里打开，也能改成打字。浏览器挡住自动播放时，一个大按钮「点一下，听女儿的提醒」。">
          <Cell cap="要麦克风" lang="zh-Hans">
            <MicPermission state="ask" locale="zh-Hans" />
          </Cell>
          <Cell cap="被拒绝了" lang="zh-Hans" state="error">
            <MicPermission state="denied" locale="zh-Hans" typeHref="/design#askfield" />
          </Cell>
          <Cell cap="没有麦克风" lang="zh-Hans" state="error">
            <MicPermission state="unavailable" locale="zh-Hans" typeHref="/design#askfield" />
          </Cell>
          <Cell cap="English · ask" lang="en">
            <MicPermission state="ask" locale="en" />
          </Cell>
          <Cell cap="点一下才能放" lang="zh-Hans">
            <TapToPlay locale="zh-Hans" />
          </Cell>
          <Cell cap="Tap to play" lang="en">
            <TapToPlay locale="en" />
          </Cell>
        </Block>

        <Block id="askvoice" name="AskVoice" note="先说后打字：大的麦克风按钮（字在按钮里）、听到的话、「问这句」才发出去。正在听时变红（红色 = 录音）。第一格是真的：点麦克风。">
          <Cell cap="真的 · 点麦克风" lang="zh-Hans">
            <VoiceDemo locale="zh-Hans" heard={ASKED.hero["zh-Hans"].join("")} />
          </Cell>
          <Cell cap="正在听" lang="zh-Hans">
            <AskVoice state="listening" locale="zh-Hans" showPrompt={false} typeHref="/design#askfield" />
          </Cell>
          <Cell cap="听到了" lang="zh-Hans">
            <AskVoice state="heard" heard={ASKED.hero["zh-Hans"].join("")} locale="zh-Hans" showPrompt={false} typeHref="/design#askfield" />
          </Cell>
          <Cell cap="English · idle" lang="en">
            <AskVoice state="idle" locale="en" typeHref="/design#askfield" />
          </Cell>
        </Block>

        <Block id="askfield" name="AskField" note="打字问：带标签的 56 高输入框和带字的「问这句」按钮（没有只有箭头的按钮）。">
          <Cell cap="华语 · 空" lang="zh-Hans">
            <AskField locale="zh-Hans" />
          </Cell>
          <Cell cap="English · typed" lang="en">
            <AskField locale="en" defaultValue={ASKED.explain.en[0]} />
          </Cell>
          <Cell cap="加载中 · 正在发" lang="zh-Hans" state="loading">
            <AskField locale="zh-Hans" defaultValue={NOTES.tired} pending />
          </Cell>
          <Cell cap="没网 · 不能问新问题" lang="zh-Hans" state="offline">
            <AskField locale="zh-Hans" disabled />
            <OfflineState locale="zh-Hans" />
          </Cell>
        </Block>

        <Block id="reasons" name="ReasonChoices" note="点了「还没吃」：问一句原因，不说教。他自己的作息排前（打太极的早上「打太极」第一），「我自己说」打开说话。">
          <Cell cap="华语 · 打太极的早上" lang="zh-Hans">
            <ReasonChoices
              locale="zh-Hans"
              reasons={[
                { code: "tai_chi_morning", label: "打太极" },
                { code: "forgot", label: "忘了" },
                { code: "away", label: "出门了" },
                { code: "not_with_me", label: "药不在身边" },
              ]}
            />
          </Cell>
          <Cell cap="English" lang="en">
            <ReasonChoices
              locale="en"
              reasons={[
                { code: "forgot", label: "Forgot" },
                { code: "away", label: "I was out" },
                { code: "not_with_me", label: "Medicine not with me" },
              ]}
            />
          </Cell>
        </Block>

        <Block id="visit" name="ForDoctorCard · RecordingBar · LiveCaptions · CaptureCount" note="看诊：给医生看的黑底白字一句；录音中红点和时间、最近两句字幕（说话人还没认，用无衬线）、已经记下几件事。">
          <Langs>
            {(locale) => (
              <Cell key={`fd-${locale}`} cap={zh(locale) ? "同意 · 华语" : "Consent · English"} lang={locale}>
                <StatusHeadline lines={[zh(locale) ? "要录这次看诊吗？" : "Record this visit?"]} style={{ marginTop: 0 }} />
                <ForDoctorCard locale={locale}>{CONSENT_SENTENCE}</ForDoctorCard>
              </Cell>
            )}
          </Langs>
          <Langs>
            {(locale) => (
              <Cell key={`rec-${locale}`} cap={zh(locale) ? "录音中 · 华语" : "Recording · English"} lang={locale}>
                <RecordingBar elapsed="03:12" locale={locale} style={{ marginTop: 0 }} />
                <LiveCaptions earlier={CAPTIONS.earlier} now={CAPTIONS.now} locale={locale} />
                <CaptureCount count={5} locale={locale} />
              </Cell>
            )}
          </Langs>
        </Block>

        <Block id="reviewsentence" name="ReviewSentence" note="回家一句一句认：第几件、能先听；问「这句是医生说的吗？」三个按钮在下半屏。只有点「是」才会在别处写成「医生说」。">
          <Langs>
            {(locale) => (
              <Cell key={`rv-${locale}`} cap={zh(locale) ? "华语 · 第 3 件" : "English · 3 of 12"} lang={locale}>
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
              </Cell>
            )}
          </Langs>
        </Block>

        <Block id="answers" name="Answer cards" note="他问的任何一句，回答都是这七种之一；每一段都标出处。临床的字都从安全层来（固定句、医生原话、药袋、单张），组件自己不写。">
          <Langs>
            {(locale) => (
              <Cell key={`ex-${locale}`} cap={zh(locale) ? "解释 · 华语" : "Explain · English"} lang={locale}>
                <AnswerExplain
                  locale={locale}
                  question={ASKED.explain[locale]}
                  leaflet={{ lines: [LEAFLET.purpose[locale]], from: LEAFLET.from[locale], open: { label: zh(locale) ? "看单张原文" : "Open the leaflet", href: "/design#answers" } }}
                  quote={{
                    kind: "doctor",
                    who: zh(locale) ? "Dr Lim 说过" : "Dr Lim said",
                    when: DOCTOR.R3.date[locale],
                    ref: DOCTOR.R3.ref,
                    lang: "en",
                    text: `“${DOCTOR.R3.text}”`,
                    listen: { label: zh(locale) ? "听医生原声" : "Hear Dr Lim", href: "/design#answers", time: DOCTOR.R3.at, standIn: true },
                  }}
                />
              </Cell>
            )}
          </Langs>
          <Langs>
            {(locale) => (
              <Cell key={`rf-${locale}`} cap={zh(locale) ? "拒答转介（主镜头）· 华语" : "Refuse and refer (hero) · English"} lang={locale}>
                <AnswerRefer locale={locale} question={ASKED.hero[locale]} ripple={tpl("refer_doctor", locale)} quote={heroQuote(locale)} label={heroLabel(locale)} addedHref="/design#questionrow" />
              </Cell>
            )}
          </Langs>
          <Langs>
            {(locale) => (
              <Cell key={`um-${locale}`} cap={zh(locale) ? "认不出的药 · 华语" : "Unknown medicine · English"} lang={locale}>
                <AnswerUnknownMed
                  locale={locale}
                  question={ASKED.unknown[locale]}
                  sentence={UNKNOWN_MED.en}
                  zhLine={UNKNOWN_MED.zh}
                  addedHref="/design#questionrow"
                  addedLabel={zh(locale) ? "已加进问题单：问药剂师" : "Added to the questions for your pharmacist"}
                />
              </Cell>
            )}
          </Langs>
          <Langs>
            {(locale) => (
              <Cell key={`nt-${locale}`} cap={zh(locale) ? "只记录 · 华语" : "Note only · English"} lang={locale}>
                <AnswerNoted
                  locale={locale}
                  question={ASKED.tired[locale]}
                  noted={tpl("noted", locale)}
                  checkIn={tpl("check_in_dose", locale)}
                  checkInHref="/design/screens/elder-today-pending"
                  checkInLabel={zh(locale) ? "去记今天的药" : "Log today's tablet"}
                />
              </Cell>
            )}
          </Langs>
          <Langs>
            {(locale) => (
              <Cell key={`ch-${locale}`} cap={zh(locale) ? "帮不上 · 华语" : "Can't help · English"} lang={locale}>
                <AnswerCantHelp locale={locale} question={ASKED.weather[locale]} sentence={CANT_HELP[locale]} yesHref="/design#answers" noHref="/design#answers" />
              </Cell>
            )}
          </Langs>
          <Langs>
            {(locale) => (
              <Cell key={`em2-${locale}`} cap={zh(locale) ? "急症 995 · 华语" : "Emergency 995 · English"} lang={locale}>
                <AnswerEmergency locale={locale} question={ASKED.emergency[locale]} sentence={tpl("emergency_995", locale)} />
              </Cell>
            )}
          </Langs>
          <Langs>
            {(locale) => (
              <Cell key={`sh2-${locale}`} cap={zh(locale) ? "自伤热线 · 华语" : "Self-harm lines · English"} lang={locale}>
                <AnswerSelfHarm locale={locale} question={ASKED.selfHarm[locale]} lines={hotlines(locale)} />
              </Cell>
            )}
          </Langs>
          <Cell cap="拍摄模式 · 主镜头，正文 22" lang="zh-Hans" filming>
            <AnswerRefer locale="zh-Hans" question={ASKED.hero["zh-Hans"]} ripple={tpl("refer_doctor", "zh-Hans")} quote={heroQuote("zh-Hans")} label={heroLabel("zh-Hans")} addedHref="/design#questionrow" />
          </Cell>
          <Cell cap="加载中 · 正在找出处" lang="zh-Hans" state="loading">
            <StatusHeadline variant="question" kicker="你问" lines={ASKED.hero["zh-Hans"]} style={{ marginTop: -14 }} />
            <LoadingState locale="zh-Hans" lines={4} />
          </Cell>
          <Cell cap="出错" lang="zh-Hans" state="error">
            <StatusHeadline variant="question" kicker="你问" lines={ASKED.hero["zh-Hans"]} style={{ marginTop: -14 }} />
            <ErrorState locale="zh-Hans" retryHref="/design#answers">
              这一句没问出去，问题还在这里。
            </ErrorState>
          </Cell>
        </Block>

        <Block id="questionrow" name="QuestionRow" note="问题单的一条：问谁、从哪来（图标 + 字）、他的原话；问过了，答案是医生或药剂师的原话，能听。">
          <Cell cap="华语 · 规律，还没问" lang="zh-Hans">
            <QuestionRow
              locale="zh-Hans"
              forWhom="doctor"
              origin="pattern"
              when="9月18日"
              text={question("q-tai-chi").text}
              evidence="漏吃的 4 个早上都在打太极的日子：9月8日、9月10日、9月17日、9月29日"
            />
          </Cell>
          <Cell cap="华语 · 被拒答的，问过了" lang="zh-Hans">
            <QuestionRow
              locale="zh-Hans"
              forWhom="doctor"
              origin="refused"
              when="9月22日"
              text={question("q-extra-tablet").text}
              answer={{
                kind: "doctor",
                who: "Dr Lim 说过",
                when: "10月5日",
                ref: EXTRA_TABLET_ANSWER.ref,
                lang: "en",
                text: `“${EXTRA_TABLET_ANSWER.text}”`,
                listen: { label: "听医生原声", href: "/design#questionrow", time: EXTRA_TABLET_ANSWER.at, standIn: true },
              }}
            />
          </Cell>
          <Cell cap="华语 · 认不出的药，药剂师答了" lang="zh-Hans">
            <QuestionRow
              locale="zh-Hans"
              forWhom="pharmacist"
              origin="unknown_medicine"
              when="9月1日"
              text={question("q-relative-box").text}
              answer={{
                kind: "pharmacist",
                who: "药剂师 Raj 说过",
                when: "9月5日",
                ref: PHARMACIST_LINE.ref,
                lang: "en",
                text: `“${PHARMACIST_LINE.text}”`,
                listen: { label: "听药剂师原声", href: "/design#questionrow", time: PHARMACIST_LINE.at, standIn: true },
              }}
            />
          </Cell>
          <Cell cap="华语 · 离开前问的" lang="zh-Hans">
            <QuestionRow
              locale="zh-Hans"
              forWhom="doctor"
              origin="before_you_go"
              when="8月24日"
              text={question("q-machine").text}
              answer={{ kind: "doctor", who: "Dr Lim 说过", when: "8月24日", ref: "v1-u12", lang: "zh-Hans", text: `「${question("q-machine").answer}」` }}
            />
          </Cell>
          <Cell cap="English · his own" lang="en">
            <QuestionRow locale="en" forWhom="doctor" origin="own" when="23 Sep" text={question("q-knee-2").text} />
          </Cell>
          <Cell cap="空 · 华语" lang="zh-Hans" state="empty">
            <EmptyState icon="list" action={{ label: "写一个问题", href: "/design#askfield" }}>
              还没有要问医生的问题。
            </EmptyState>
          </Cell>
          <Cell cap="加载中" lang="zh-Hans" state="loading">
            <LoadingState locale="zh-Hans" lines={3} />
          </Cell>
        </Block>

        <Block id="brief" name="BriefHeader · BriefItem · BriefOwnWords · BriefQuestions" note="复诊时把手机递给医生：默认英文大字，数字等宽；他写的话照登中文、注明没翻译；只有数字和他的问题，没有评价。「和上次比有变化」用黑边字标签，不用红色。">
          <Cell cap="English (default, for Dr Lim)" lang="en">
            <BriefHeader kicker="FOR DR LIM · 5 OCT" title="Since the visit on 1 Sep" />
            <BriefItem>
              Home readings: <BriefNum>{b.readings}</BriefNum>, average <BriefNum>{b.average}</BriefNum>. <BriefNum>{b.notBelow}</BriefNum> were not below the {b.target} you gave on 24 Aug.
            </BriefItem>
            <BriefItem>
              Morning tablet: <BriefNum>{b.taken}</BriefNum> of {b.mornings} taken. The {b.missed} missed were all {b.missedWeekdays.join("/")} (tai chi mornings).
            </BriefItem>
            <BriefOwnWords intro="He wrote on 30 Sep:" words={NOTES.ankle} />
            <BriefQuestions items={["Can I take an extra tablet when my reading is high (e.g. 150/95)?", "On tai chi mornings I often forget. Can I take it after tai chi?"]} />
          </Cell>
          <Cell cap="华语（他自己看）" lang="zh-Hans">
            <BriefHeader kicker="给 Dr Lim 看 · 10月5日" title="9月1日看诊以后" lang="zh-Hans" />
            <BriefItem lang="zh-Hans">
              在家量了 <BriefNum>{b.readings}</BriefNum> 次，平均 <BriefNum>{b.average}</BriefNum>；<BriefNum>{b.notBelow}</BriefNum> 次不低于医生 8月24日说的 {b.target}。
            </BriefItem>
            <BriefItem lang="zh-Hans" isNew newLabel="新">
              早上的药：{b.mornings} 个早上吃了 <BriefNum>{b.taken}</BriefNum> 个，漏的 {b.missed} 个都在周二、周四（打太极的早上）。
            </BriefItem>
          </Cell>
          <Cell cap="空 · 还没有可以给医生看的" lang="zh-Hans" state="empty">
            <EmptyState icon="doc">上次看诊以后还没有记录。</EmptyState>
          </Cell>
        </Block>

        <Block id="switches" name="FamilySwitchRow" note="「Wei Ling 能看到什么」：每项一个大开关，开关里直接写「开 / 关」；下面一行说清她会看到什么。第一格是真的：点开关。">
          <Cell cap="真的 · 华语" lang="zh-Hans">
            <SwitchesDemo locale="zh-Hans" items={switches("zh-Hans")} />
          </Cell>
          <Cell cap="English" lang="en">
            <SwitchesDemo locale="en" items={switches("en").slice(0, 3)} />
          </Cell>
          <Cell cap="加载中 · 正在改" lang="zh-Hans" state="loading">
            <SwitchesDemo locale="zh-Hans" items={switches("zh-Hans").slice(4, 5)} pendingName="visit_transcripts" />
          </Cell>
          <Cell cap="出错 · 没改成" lang="zh-Hans" state="error">
            <SwitchesDemo locale="zh-Hans" items={switches("zh-Hans").slice(0, 1)} />
            <ErrorState locale="zh-Hans" retryHref="/design#switches">
              没改成，再试一次。
            </ErrorState>
          </Cell>
        </Block>

        <Block id="bpkeypad" name="BpKeypad" note="仿血压计的三行（上面的数、下面的数、心跳可以不填）和大号数字键；不弹手机自带的小键盘；读数不着色。每格都是真的：点数字。">
          <Cell cap="真的 · 华语 · 输到一半" lang="zh-Hans">
            <KeypadDemo locale="zh-Hans" initial={{ sys: "138", dia: "82", active: "dia" }} />
          </Cell>
          <Cell cap="English · empty" lang="en" state="empty">
            <KeypadDemo locale="en" />
          </Cell>
        </Block>
      </Section>
    </Board>
  );
}
