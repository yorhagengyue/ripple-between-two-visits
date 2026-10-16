import type { Metadata } from "next";
import {
  CountPill,
  CountPills,
  EventCard,
  FamilyButton,
  FamilyEmpty,
  FamilyError,
  FamilyHero,
  FamilyLoading,
  FamilyNote,
  FamilyTop,
  InviteAccept,
  NoReplyAlert,
  ReminderRecorder,
  SharedSection,
  StatusCard,
  StatusGrid,
  type RecorderState,
  type SharedItem,
} from "@/components/family-ui";
import { contrastRatio } from "@/lib/ui/contrast";
import { familyCopy } from "@/lib/ui/copy";
import { FAMILY_COLOURS, FAMILY_PAIRS, FAMILY_TYPE_SCALE, FAMILY_WASHES, type UiLocale } from "@/lib/ui/tokens";
import { Block, Board, Cell, PhoneFrame, Section } from "../Gallery";
import { dateLabel, DOCTOR, familyWeek, WEI_LING } from "../content";
import { RecorderDemo } from "../demos";
import { SCREENS, screenHref } from "../screens/compose";

export const metadata: Metadata = { title: "Ripple UI · daughter" };

/**
 * /design/family: Wei Ling's components (components/family-ui) in Zicheng's v3-light look, in every state, in 华语 and
 * English, at phone width. Counts only, never readings; everything she sees is what Dad shares.
 */

const zh = (l: UiLocale) => l === "zh-Hans";
const all = [...FAMILY_COLOURS, ...FAMILY_WASHES];
const hex = (name: string) => (name === "--rpf-on-teal" ? "#06201E" : name === "--rpf-on-rec" ? "#FFFFFF" : all.find((c) => c.name === name)?.value ?? "#000000");

function shares(locale: UiLocale): SharedItem[] {
  return zh(locale)
    ? [
        { grant: "dose_summary", title: "每天吃药了没有", detail: "只有吃了 / 没吃 / 没回", shared: true },
        { grant: "bp_summary", title: "这周量了几次血压", detail: "次数，不含读数", shared: true },
        { grant: "questions_count", title: "有几个问题要问医生", detail: "个数，不含内容", shared: true },
        { grant: "no_reply_alert", title: "两次提醒没回时通知你", shared: true },
        { grant: "visit_transcripts", title: "看诊录音和逐字稿", shared: false },
        { grant: "notes", title: "他自己写的笔记", shared: false },
      ]
    : [
        { grant: "dose_summary", title: "Whether he took his medicine each day", detail: "Only taken / not taken / no reply", shared: true },
        { grant: "bp_summary", title: "How many times he measured this week", detail: "The count, not the readings", shared: true },
        { grant: "visit_transcripts", title: "Visit recordings and transcripts", shared: false },
        { grant: "notes", title: "His own notes", shared: false },
      ];
}

const RECORDER_STATES: { state: RecorderState; cap: string }[] = [
  { state: "mic-ask", cap: "要麦克风" },
  { state: "mic-denied", cap: "麦克风被拒绝" },
  { state: "recording", cap: "正在录" },
  { state: "playing", cap: "正在听回" },
  { state: "saving", cap: "加载中 · 正在保存" },
  { state: "error", cap: "出错 · 没存上" },
  { state: "saved", cap: "存好了" },
  { state: "deleted", cap: "删掉了" },
];

export default function FamilyGalleryPage() {
  const w = familyWeek(26);
  return (
    <Board
      side="family"
      current="/design/family"
      eyebrow="RIPPLE UI · 女儿端 · ZICHENG V3-LIGHT"
      title="Wei Ling 手机上的组件"
      lede="照 Zicheng 的 v3-light：#F5F7F8 底上的白卡片，事件颜色只做浅底和边（医生蓝、核对黄、Ripple 青），圆角 16 加轻阴影，新内容淡入上浮，计数用小胶囊。组件在 components/family-ui，样式在 app/ripple-ui.css 第二部分。"
      rules={[
        "字至少 16，对比度至少 AA：v3 不够 AA 的字色调深了一档，底色和边照旧",
        "点按区域至少 44×44",
        "只有次数，没有读数；不评判；没回用琥珀色，不用红色",
        "她能做的只有三件：看爸爸同意给她看的、录提醒、打电话",
        "每一处都写明是爸爸同意给她看的",
      ]}
    >
      <Section id="screens" title="整屏 · 三个主要的屏" note="首页、录提醒、没回的通知。全部整屏样例在 /design/screens。">
        <div className="rpd-phones">
          {(["family-home", "family-recorder", "family-noreply"] as const).map((n) => (
            <PhoneFrame key={n} side="family" name={n} time={SCREENS[n].time} caption={SCREENS[n].caption} href={screenHref(n, "zh-Hans")}>
              {SCREENS[n].render("zh-Hans")}
            </PhoneFrame>
          ))}
        </div>
      </Section>

      <Section id="tokens" title="颜色 · Colour" note="v3 的填充色和边原样保留；字色按 AA 调过的写在说明里。浅底是 v3 的 rgba 叠在白底上的实色，自动检查才量得到。">
        <div className="rpd-swatches">
          {all.map((c) => (
            <div className="rpd-swatch" key={c.name}>
              <span className="rpd-chip" style={{ background: c.value }} />
              <span className="rpd-swatch-name">{c.name}</span>
              <span className="rpd-swatch-meta">
                {c.value} · {c.role}
              </span>
              <span className="rpd-swatch-meta">{c.note ?? c.use}</span>
            </div>
          ))}
          {FAMILY_PAIRS.map((p) => (
            <div className="rpd-swatch" key={`${p.fg}-${p.bg}`}>
              <span className="rpd-chip" style={{ background: hex(p.bg), borderColor: hex(p.fg), borderWidth: 6 }} />
              <span className="rpd-swatch-name">
                {p.fg.replace("--rpf-", "")} / {p.bg.replace("--rpf-", "")}
              </span>
              <span className="rpd-swatch-meta">
                {contrastRatio(hex(p.fg), hex(p.bg)).toFixed(2)}:1 · {p.use}
              </span>
            </div>
          ))}
        </div>
        <p className="rpd-note">
          字号：最小 {FAMILY_TYPE_SCALE.min}，正文 {FAMILY_TYPE_SCALE.body}，数字 {FAMILY_TYPE_SCALE.value}，标题 {FAMILY_TYPE_SCALE.title} / {FAMILY_TYPE_SCALE.hero}。
        </p>
      </Section>

      <Section id="components" title="组件 · Components" note="每格 390 宽，在她的页面底色上。">
        <Block id="top" name="FamilyTop · FamilyHero · FamilyNote" note="最上面就是答案：图标、一句话、几点谁点的。青色勾是吃了，琥珀色铃是没回，灰色是今天没有要吃的。">
          {(["zh-Hans", "en"] as const).map((locale) => (
            <Cell key={locale} cap={zh(locale) ? "华语 · 吃了" : "English · taken"} lang={locale}>
              <FamilyTop kicker={`${familyCopy(locale, null).dadToday} · ${dateLabel(26, locale)}`} locale={locale} langHref="/design/family#top" />
              <FamilyHero title={zh(locale) ? "早上的药吃了" : "Morning medicine: taken"} detail={zh(locale) ? "8:52 他自己点的" : "He tapped it himself at 8:52"} style={{ marginTop: 10 }} />
              <FamilyNote style={{ marginTop: 14 }}>{familyCopy(locale, null).privacy}</FamilyNote>
            </Cell>
          ))}
          <Cell cap="没回 · 琥珀色" lang="zh-Hans">
            <FamilyHero tone="chk" title="早上的药还没回" detail="8:45 和 9:15 两次提醒" />
          </Cell>
          <Cell cap="空 · 今天没有要吃的药" lang="zh-Hans" state="empty">
            <FamilyHero tone="quiet" title="今天没有要吃的药" detail="下次看诊以后才开始记" />
          </Cell>
        </Block>

        <Block id="statuscard" name="StatusCard · StatusGrid" note="这周的一个数：白卡片、16 的说明、26 的数字。只有次数，不显示读数。爸爸没分享的写「没有分享」。">
          {(["zh-Hans", "en"] as const).map((locale) => (
            <Cell key={locale} cap={zh(locale) ? "华语 · 9月19日这周" : "English · week of 14 Sep"} lang={locale}>
              <StatusGrid>
                <StatusCard locale={locale} label={zh(locale) ? "这周吃药" : "Medicine this week"} value={`${w.daysTaken}`} unit={zh(locale) ? `/ ${w.daysDue} 天` : `of ${w.daysDue} days`} />
                <StatusCard locale={locale} label={zh(locale) ? "这周量血压" : "BP checks this week"} value={`${w.readings}`} unit={zh(locale) ? "次" : "times"} />
                <StatusCard locale={locale} label={zh(locale) ? "下次看诊" : "Next visit"} value={zh(locale) ? "约 10月5日" : "About 5 Oct"} />
                <StatusCard locale={locale} label={zh(locale) ? "要问医生的" : "For the doctor"} value={`${w.questions}`} unit={zh(locale) ? "个" : "question"} />
              </StatusGrid>
            </Cell>
          ))}
          <Cell cap="没有分享 · 加载中 · 出错" lang="zh-Hans" state="loading">
            <StatusGrid>
              <StatusCard locale="zh-Hans" label="看诊录音" state="off" />
              <StatusCard locale="zh-Hans" label="这周吃药" state="loading" />
              <StatusCard locale="zh-Hans" label="这周量血压" state="error" foot="没取到，正在重试" />
            </StatusGrid>
          </Cell>
        </Block>

        <Block id="eventcard" name="EventCard" note="事件卡：事件颜色只做浅底和边，标签用字、点和图标一起说是什么；出现时淡入上浮。医生说的只在爸爸分享了看诊录音时出现。">
          <Cell cap="Ripple 青 · 她的提醒" lang="zh-Hans">
            <EventCard kind="ripple" tag="你的提醒 · 每天 8:45 播给他" quote={WEI_LING.text} quoteLang="zh-Hans" source="现在放的是代录音" />
          </Cell>
          <Cell cap="核对黄 · 没回" lang="zh-Hans">
            <EventCard kind="check" tag="提醒没有回" title="爸爸还没回早上的药。">
              8:45 和 9:15 两次提醒都没有回。
            </EventCard>
          </Cell>
          <Cell cap="医生蓝 · 爸爸分享了看诊时" lang="zh-Hans">
            <EventCard kind="doctor" tag="医生说" quote={DOCTOR.R4.text} quoteLang="en" source={`9月1日 看诊 · ${DOCTOR.R4.at} · 推断：医生`} />
          </Cell>
          <Cell cap="English" lang="en">
            <EventCard
              kind="ripple"
              tag="Your reminder · daily at 8:45"
              quote={WEI_LING.text}
              quoteLang="zh-Hans"
              source="A stand-in voice plays it now"
              actions={
                <FamilyButton href="/design/screens/family-recorder?lang=en" variant="secondary" size="small" icon="mic">
                  Record a new one
                </FamilyButton>
              }
            />
          </Cell>
        </Block>

        <Block id="countpill" name="CountPill · CountPills" note="v3 的计数小胶囊：白底细边、事件颜色的点、字和加粗的数。">
          {(["zh-Hans", "en"] as const).map((locale) => (
            <Cell key={locale} cap={zh(locale) ? "华语" : "English"} lang={locale}>
              <CountPills>
                <CountPill kind="doctor" label={zh(locale) ? "医生交代" : "Doctor's notes"} count={2} />
                <CountPill kind="check" label={zh(locale) ? "没回" : "No reply"} count={1} />
                <CountPill kind="ripple" label={zh(locale) ? "要问的" : "To ask"} count={w.questions} />
              </CountPills>
            </Cell>
          ))}
        </Block>

        <Block id="noreply" name="NoReplyAlert" note="两次提醒都没回：琥珀色，不是红色。他上一次记录，一个动作：打电话给爸爸；写明 Ripple 不会做什么。">
          {(["zh-Hans", "en"] as const).map((locale) => (
            <Cell key={locale} cap={zh(locale) ? "华语" : "English"} lang={locale}>
              <NoReplyAlert
                locale={locale}
                title={zh(locale) ? "爸爸还没回早上的药。" : "Dad hasn't answered about his morning medicine."}
                detail={zh(locale) ? "8:45 和 9:15 两次提醒都没有回。" : "Neither reminder, at 8:45 or 9:15, got a reply."}
                lastEntry={{ when: zh(locale) ? "昨晚 9:12" : "Last night 9:12", what: zh(locale) ? "量了血压" : "Blood pressure" }}
                phone="+65 0000 0000"
              />
            </Cell>
          ))}
        </Block>

        <Block id="shared" name="SharedSection" note="爸爸让她看到的：只读，分享了的打勾，没分享的写「没有分享」；她没有开关。">
          {(["zh-Hans", "en"] as const).map((locale) => (
            <Cell key={locale} cap={zh(locale) ? "华语" : "English"} lang={locale}>
              <SharedSection items={shares(locale)} locale={locale} />
            </Cell>
          ))}
          <Cell cap="空 · 爸爸还没打开任何一项" lang="zh-Hans" state="empty">
            <FamilyEmpty locale="zh-Hans" title="爸爸还没有分享任何一项。">
              他在自己的手机上打开以后，这里马上会出现。
            </FamilyEmpty>
          </Cell>
        </Block>

        <Block id="recorder" name="ReminderRecorder" note="录提醒：录、听一遍、重录、删掉、就用这段。红圈是录音键（红色 = 录音）。第一格是真的，用假时钟：点「开始录」。">
          <Cell cap="真的 · 华语" lang="zh-Hans">
            <RecorderDemo locale="zh-Hans" />
          </Cell>
          <Cell cap="录好了 · English" lang="en">
            <ReminderRecorder state="recorded" locale="en" playsAt="8:45" elapsed="0:04" />
          </Cell>
          {RECORDER_STATES.map((r) => (
            <Cell key={r.state} cap={r.cap} lang="zh-Hans" state={r.state === "saving" ? "loading" : r.state === "error" || r.state === "mic-denied" ? "error" : "normal"}>
              <ReminderRecorder state={r.state} locale="zh-Hans" playsAt="8:45" elapsed={r.state === "recording" ? "0:03" : "0:04"} progress={0.5} />
            </Cell>
          ))}
        </Block>

        <Block id="invite" name="InviteAccept" note="接受一次性邀请：先看清爸爸现在分享什么，再接受；然后等爸爸确认是她；用过的邀请说清楚怎么办。">
          <Cell cap="邀请 · 华语" lang="zh-Hans">
            <InviteAccept state="invite" locale="zh-Hans" inviter="陈先生" shares={shares("zh-Hans")} acceptHref="/design/family#invite" notNowHref="/design/family#invite" />
          </Cell>
          <Cell cap="Invite · English" lang="en">
            <InviteAccept state="invite" locale="en" inviter="Mr Tan" shares={shares("en")} acceptHref="/design/family#invite" />
          </Cell>
          <Cell cap="等爸爸确认" lang="zh-Hans" state="loading">
            <InviteAccept state="waiting" locale="zh-Hans" inviter="陈先生" shares={[]} />
          </Cell>
          <Cell cap="好了" lang="zh-Hans">
            <InviteAccept state="done" locale="zh-Hans" inviter="陈先生" shares={[]} homeHref="/design/screens/family-home" />
          </Cell>
          <Cell cap="用过了" lang="zh-Hans" state="empty">
            <InviteAccept state="used" locale="zh-Hans" inviter="陈先生" shares={[]} />
          </Cell>
          <Cell cap="出错" lang="zh-Hans" state="error">
            <InviteAccept state="error" locale="zh-Hans" inviter="陈先生" shares={[]} />
          </Cell>
        </Block>

        <Block id="states" name="FamilyEmpty · FamilyLoading · FamilyError · FamilyButton" note="空：一句话。加载中：页面的形状，灰色，不转圈。出错：说清楚，再试一次。按钮：青色主按钮、带边的次按钮、灰色的轻按钮。">
          {(["zh-Hans", "en"] as const).map((locale) => (
            <Cell key={`e-${locale}`} cap={zh(locale) ? "空 · 华语" : "Empty · English"} lang={locale} state="empty">
              <FamilyEmpty locale={locale} title={zh(locale) ? "还没有记录。" : "Nothing logged yet."}>
                {zh(locale) ? "爸爸开始记吃药以后，这里会出现这周的情况。" : "Once Dad starts logging his medicine, this week shows here."}
              </FamilyEmpty>
            </Cell>
          ))}
          {(["zh-Hans", "en"] as const).map((locale) => (
            <Cell key={`l-${locale}`} cap={zh(locale) ? "加载中 · 华语" : "Loading · English"} lang={locale} state="loading">
              <FamilyLoading locale={locale} />
            </Cell>
          ))}
          {(["zh-Hans", "en"] as const).map((locale) => (
            <Cell key={`x-${locale}`} cap={zh(locale) ? "出错 · 华语" : "Error · English"} lang={locale} state="error">
              <FamilyError locale={locale} retryHref="/design/family#states">
                {zh(locale) ? "上面显示的是上一次取到的。" : "What you see is the last update we got."}
              </FamilyError>
            </Cell>
          ))}
          <Cell cap="按钮" lang="zh-Hans">
            <div style={{ display: "grid", gap: 10 }}>
              <FamilyButton icon="mic" href="/design/screens/family-recorder">
                录一段新的提醒
              </FamilyButton>
              <FamilyButton variant="secondary" icon="phone" href="tel:+6500000000">
                打电话给爸爸
              </FamilyButton>
              <FamilyButton variant="quiet" icon="lock" size="small" href="/design/screens/family-shared">
                爸爸让你看到的
              </FamilyButton>
              <FamilyButton pending>正在保存…</FamilyButton>
            </div>
          </Cell>
        </Block>
      </Section>
    </Board>
  );
}
