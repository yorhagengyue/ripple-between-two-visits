/* eslint-disable react/no-children-prop -- createElement(X, props) without JSX: the props types require `children`, so it goes in props */
/**
 * components/ui (Mr Tan), components/family-ui (Wei Ling), components/today and components/me rendered on the server
 * (no DOM): words, links, attributes and the rules the types and the CSS cannot hold by themselves — undo never under
 * 10 s, who-said-it always a node shape with its words (no speaker colour), five worded tabs, one action on the
 * no-reply alert, the switch says 开 / 关 in words, the filming flag, stubs that name their track, and the timeline
 * draft's parts (timeline, header, say bar, boxes, lists, options).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EventCard,
  FamilyButton,
  FamilyHome,
  InviteAccept,
  NoReplyAlert,
  ReminderRecorder,
  SharedSection,
  StatusCard,
} from "@/components/family-ui";
import { FilmingAccountEntry, MeLayout, ProfileEntry } from "@/components/me";
import { DoseSection, TODAY_ORDER, TodayLayout } from "@/components/today";
import {
  ActionDock,
  AddedRow,
  Act,
  Acts,
  AnswerRefer,
  AskField,
  AskVoice,
  BodyText,
  Box,
  BpWeekChart,
  Button,
  ButtonPair,
  Chip,
  Divider,
  DoneRow,
  DrugName,
  EmergencyBlock,
  EmptyState,
  ErrorState,
  FamilySwitchRow,
  Field,
  Hotlines,
  LabelOriginal,
  ListCard,
  ListItem,
  ListenBar,
  LoadingState,
  MetaBar,
  MicPermission,
  NextRow,
  OfflineState,
  Option,
  OptionList,
  OwnWords,
  PageHeader,
  PlayCircle,
  PlayPill,
  PrimaryButton,
  QuestionRow,
  ReadingNumber,
  ReasonChoices,
  RecoveryCode,
  ReviewSentence,
  Said,
  SaidTranslation,
  SayBar,
  Screen,
  SecondaryButton,
  SectionLabel,
  Segmented,
  SourceLink,
  SourceTag,
  StatusHeadline,
  StepBar,
  SubCard,
  SubRow,
  TabBar,
  TapToPlay,
  Timeline,
  TimelineGroup,
  TimelineItem,
  UndoToast,
} from "@/components/ui";
import { AccountHeaderProvider } from "@/components/ui/AccountHeader";
import { ZhUnder } from "@/components/translate/ZhUnder";
import { clampUndoMs, TAB_KEYS, UI_COPY, UNDO_DEFAULT_MS, UNDO_MIN_MS } from "@/lib/ui/copy";
import { NODE_KINDS, NODE_OF_SOURCE, type SourceKind } from "@/lib/ui/tokens";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

describe("who said it: the node's shape and words", () => {
  const kinds: SourceKind[] = ["doctor", "dispenser", "pharmacist", "label", "leaflet", "family", "self", "ripple"];

  it("every SourceTag has its kind, that kind's node and its words", () => {
    for (const kind of kinds) {
      const out = html(createElement(SourceTag, { kind, locale: "zh-Hans" }));
      expect(out, kind).toContain(`data-kind="${kind}"`);
      expect(out, kind).toContain(`<span class="rpu-node" data-node="${NODE_OF_SOURCE[kind]}" aria-hidden="true">`);
      expect(text(out).trim().length, kind).toBeGreaterThan(1);
    }
    // the three who speak at the clinic share one node, the label and the leaflet another: no colour tells them apart
    expect(new Set([NODE_OF_SOURCE.doctor, NODE_OF_SOURCE.dispenser, NODE_OF_SOURCE.pharmacist])).toEqual(new Set(["doc"]));
    expect(text(html(createElement(SourceTag, { kind: "label", locale: "zh-Hans" })))).toBe("药品标签");
    expect(text(html(createElement(SourceTag, { kind: "leaflet", locale: "en" })))).toBe("The leaflet says");
  });

  it("a guessed doctor says so in words, with the dashed ring", () => {
    const out = html(createElement(SourceTag, { kind: "doctor", inferred: true, locale: "zh-Hans", when: "0:49" }));
    expect(out).toContain('data-inferred="true"');
    expect(out).toContain('data-node="unc"');
    expect(text(out)).toBe("好像是医生说的0:49");
    expect(text(html(createElement(SourceTag, { kind: "doctor", inferred: true, locale: "en" })))).toBe("Probably the doctor");
  });

  it("a source button is the play pill with its words and time; a stand-in voice is a separate word tag", () => {
    const zh = html(createElement(SourceLink, { kind: "doctor", href: "/api/visits/v2/clip?u=v2-u08", locale: "zh-Hans", play: true, standIn: true, time: "9月1日 · 0:43", children: "听医生原声" }));
    expect(zh).toContain('href="/api/visits/v2/clip?u=v2-u08"');
    expect(zh).toContain('data-icon="play"');
    expect(text(zh)).toBe("听医生原声9月1日 · 0:43代录音");
    const en = html(createElement(SourceLink, { kind: "label", href: "/p/meds", locale: "en", time: "1 Sep", children: "See the label" }));
    expect(en).toContain('data-icon="play"');
    expect(en).toContain('href="/p/meds"');
    expect(text(en)).toBe("See the label1 Sep");
  });

  it("the stand-in word follows the UI language; her own voice is named once she records it", () => {
    expect(text(html(createElement(ListenBar, { time: "0:04", locale: "en", standIn: true })))).toContain("stand-in recording");
    // C2 track S (round 2): the default no longer names a daughter; a screen that knows the care link words her from it
    expect(text(html(createElement(ListenBar, { time: "0:04", locale: "zh-Hans", ownVoice: true })))).toContain("家人的录音");
    const playing = html(createElement(ListenBar, { time: "0:04", locale: "zh-Hans", progress: 0.5, playing: true }));
    expect(text(playing)).toContain("正在播0:02 / 0:04");
    expect(playing).toContain('aria-pressed="true"');
  });
});

describe("Said", () => {
  it("is a serif blockquote that keeps its source and its own language", () => {
    const out = html(createElement(Said, { source: { kind: "dispenser", ref: "v2-u13" }, lang: "zh-Hans", ruled: true, children: "「忘了吃的话，想起来就吃，但是不要一次吃两粒。」" }));
    expect(out).toMatch(/^<blockquote class="rpu rpu-said"/);
    expect(out).toContain('data-kind="dispenser"');
    expect(out).toContain('data-source-ref="v2-u13"');
    expect(out).toContain('data-ruled="true"');
    expect(out).toContain('lang="zh-Hans"');
  });
});

describe("TabBar", () => {
  it("has the four places in order, each an icon over its word, English that fits at 18px, the current one marked", () => {
    const zh = html(createElement(TabBar, { active: "today", locale: "zh-Hans" }));
    const labelsZh = [...zh.matchAll(/class="rpu-tab-label"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(labelsZh).toEqual(["今天", "就诊", "记录", "我"]);
    const en = html(createElement(TabBar, { active: "records", locale: "en" }));
    const labelsEn = [...en.matchAll(/class="rpu-tab-label"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(labelsEn).toEqual(["Today", "Visits", "Records", "Me"]);
    expect((zh.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(zh).toMatch(/href="\/p\/today"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/p\/today"/);
    expect(en).toMatch(/href="\/p\/records"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/p\/records"/);
    expect(TAB_KEYS).toHaveLength(4);
    // the icon sits before its word in each place (owner 10-14), hidden from a screen reader: the word names the place
    expect([...zh.matchAll(/<svg[^>]*data-icon="(\w+)"/g)].map((m) => m[1])).toEqual(["home", "steth", "doc", "user"]);
    expect(zh).not.toMatch(/<svg(?![^>]*aria-hidden="true")/);
  });
});

describe("UndoToast", () => {
  it("never runs under 10 s and defaults to 12 s", () => {
    expect(UNDO_DEFAULT_MS).toBe(12_000);
    expect(UNDO_MIN_MS).toBe(10_000);
    expect(clampUndoMs(undefined)).toBe(12_000);
    expect(clampUndoMs(3_000)).toBe(10_000);
    expect(clampUndoMs(Number.NaN)).toBe(12_000);
    expect(clampUndoMs(15_000)).toBe(15_000);
    const short = html(createElement(UndoToast, { message: "已记下：吃了", locale: "zh-Hans", durationMs: 2_000 }));
    expect(short).toContain('data-duration-ms="10000"');
    expect(short).toContain("animation-duration:10000ms");
    const normal = html(createElement(UndoToast, { message: "Logged: taken", locale: "en" }));
    expect(normal).toContain('data-duration-ms="12000"');
    expect(text(normal)).toBe("Logged: takenUndo12 s");
  });

  it("can be frozen at a point of the countdown for screenshots", () => {
    const frozen = html(createElement(UndoToast, { message: "已记下：吃了", locale: "zh-Hans", frozenAt: 0.64, placement: "absolute" }));
    expect(frozen).toContain("width:64%");
    expect(frozen).toContain('data-running="false"');
    expect(frozen).toContain('data-placement="absolute"');
    // the countdown is the seconds in the button (0.64 of 12 s), hidden from a screen reader so 「撤销」 stays the name
    expect(text(frozen)).toBe("已记下：吃了撤销8 秒");
    expect(frozen).toMatch(/<span class="rpu-toast-left" aria-hidden="true"[^>]*>8 秒<\/span>/);
    const detailed = html(createElement(UndoToast, { message: "已记下：还没吃", detail: "原因：打太极", locale: "zh-Hans", frozenAt: 1, placement: "inline" }));
    expect(text(detailed)).toBe("已记下：还没吃原因：打太极撤销12 秒");
  });
});

describe("buttons and rows", () => {
  it("PrimaryButton is a button by default and a link with href; pending is busy and disabled; icons never replace words", () => {
    expect(html(createElement(PrimaryButton, { children: "吃了" }))).toMatch(/^<button type="button"[^>]*class="rpu rpu-btn"[^>]*data-variant="primary"/);
    expect(html(createElement(PrimaryButton, { href: "/p/today", children: "吃了" }))).toMatch(/^<a [^>]*href="\/p\/today"/);
    const busy = html(createElement(PrimaryButton, { pending: true, icon: "check", children: "吃了" }));
    expect(busy).toContain('disabled=""');
    expect(busy).toContain('aria-busy="true"');
    expect(text(busy)).toBe("吃了");
    const pair = html(createElement(ButtonPair, { children: [createElement(SecondaryButton, { key: 1, children: "还没吃" }), createElement(SecondaryButton, { key: 2, children: "等一下" })] }));
    expect(text(pair)).toBe("还没吃等一下");
    expect(pair).toContain('data-variant="secondary"');
  });

  it("DoneRow has a bordered 改一下 / Change", () => {
    const zh = html(createElement(DoneRow, { title: "Amlodipine 5 mg", detail: "早上 · 8:52 记的", locale: "zh-Hans", changeHref: "/p/today" }));
    expect(text(zh)).toBe("Amlodipine 5 mg早上 · 8:52 记的改一下");
    expect(zh).toContain("rpu-chip-btn");
    expect(text(html(createElement(DoneRow, { title: "x", locale: "en", changeHref: "/p/today" })))).toContain("Change");
  });

  it("NextRow is a whole-row link with the count in the mono slot and a chevron", () => {
    const row = html(createElement(NextRow, { href: "/p/questions", count: 3, children: "个问题等下次看诊问" }));
    expect(row).toContain('<span class="rpu-row-num">3</span>');
    expect(row).toContain('href="/p/questions"');
    expect(row).toContain('data-icon="chevron"');
  });

  it("LabelOriginal keeps the printed case and is never translated; ReadingNumber has no colour of its own", () => {
    const orig = html(createElement(LabelOriginal, { children: "Take ONE tablet every MORNING" }));
    expect(text(orig)).toBe("Take ONE tablet every MORNING");
    expect(orig).toContain('translate="no"');
    expect(html(createElement(ReadingNumber, { value: "150/95", unit: "mmHg" }))).not.toMatch(/style=|data-tone/);
  });
});

describe("filming flag", () => {
  it("each component passes an explicit filming prop to its root", () => {
    const els: ReactElement[] = [
      createElement(MetaBar, { story: "9月22日 周二 · 晚上 8:15", locale: "zh-Hans", filming: true }),
      createElement(StatusHeadline, { lines: ["早上的药，还没记。"], filming: true }),
      createElement(BodyText, { variant: "lede", children: "x", filming: true }),
      createElement(DrugName, { children: "Amlodipine 5 mg", filming: true }),
      createElement(SectionLabel, { children: "今天早上", filming: true }),
      createElement(SourceTag, { kind: "doctor", locale: "zh-Hans", filming: true }),
      createElement(Said, { source: { kind: "doctor", ref: "v2-u08" }, lang: "en", children: "x", filming: true }),
      createElement(SourceLink, { kind: "label", href: "/p/meds", locale: "zh-Hans", children: "看药袋原文", filming: true }),
      createElement(LabelOriginal, { children: "Take ONE tablet", filming: true }),
      createElement(ListenBar, { time: "0:04", locale: "zh-Hans", filming: true }),
      createElement(PrimaryButton, { children: "吃了", filming: true }),
      createElement(SecondaryButton, { children: "还没吃", filming: true }),
      createElement(ButtonPair, { children: "x", filming: true }),
      createElement(ActionDock, { children: "x", filming: true }),
      createElement(DoneRow, { title: "x", locale: "zh-Hans", filming: true }),
      createElement(NextRow, { href: "/p/questions", children: "x", filming: true }),
      createElement(AskField, { locale: "zh-Hans", filming: true }),
      createElement(UndoToast, { message: "x", locale: "zh-Hans", filming: true }),
      createElement(TabBar, { locale: "zh-Hans", filming: true }),
      createElement(ReadingNumber, { value: "150/95", filming: true }),
      createElement(AddedRow, { href: "/p/questions", children: "x", filming: true }),
      createElement(EmergencyBlock, { title: "x", call: { number: "995" }, locale: "zh-Hans", filming: true }),
      createElement(EmptyState, { children: "x", filming: true }),
      createElement(LoadingState, { locale: "zh-Hans", filming: true }),
      createElement(ErrorState, { children: "x", locale: "zh-Hans", filming: true }),
      createElement(OfflineState, { locale: "zh-Hans", filming: true }),
      createElement(Screen, { locale: "zh-Hans", filming: true, children: "x" }),
    ];
    for (const el of els) {
      const out = html(el);
      expect(out, out.slice(0, 120)).toMatch(/^<[a-z0-9]+ [^>]*data-filming="true"/);
      expect(out, out.slice(0, 120)).toMatch(/^<[a-z0-9]+ [^>]*class="rpu[ "]/);
    }
  });

  it("without the prop the component follows the nearest scope (no attribute of its own)", () => {
    expect(html(createElement(BodyText, { children: "x" }))).not.toContain("data-filming");
    expect(html(createElement(Divider, {}))).not.toContain("data-filming");
  });

  it("screens mark their side for the page checks", () => {
    expect(html(createElement(Screen, { locale: "zh-Hans", children: "x" }))).toContain('data-rp-side="elder"');
    expect(html(createElement(FamilyHome, familyHomeProps()))).toContain('data-rp-side="family"');
  });

  it("a screen carries the page's own data-testid on its root, and has none when the page gives none", () => {
    const named = html(createElement(Screen, { locale: "zh-Hans", fill: "viewport", "data-testid": "front-door", children: "x" }));
    expect(named).toMatch(/^<div [^>]*data-testid="front-door"/);
    // still the screen: its marks are on the same element
    expect(named).toMatch(/^<div [^>]*data-rp="screen"[^>]*data-rp-side="elder"/);
    expect(html(createElement(Screen, { locale: "zh-Hans", children: "x" }))).not.toContain("data-testid");
  });

  it("the welcome page names its screen front-door (app/page.tsx), so a test can find the page by it", () => {
    const source = readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf8");
    expect(source).toMatch(/<Screen [^>]*data-testid="front-door"/);
  });
});

describe("states", () => {
  it("loading has no spinner and a spoken label; error has a retry button; empty is one sentence; offline says what still works", () => {
    const loading = html(createElement(LoadingState, { locale: "zh-Hans", headline: true, lines: 3 }));
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-busy="true"');
    expect(text(loading)).toBe(UI_COPY["zh-Hans"].loading);
    expect(loading).not.toMatch(/spin/i);
    const error = html(createElement(ErrorState, { children: "没连上，药的记录还在。", locale: "zh-Hans" }));
    expect(error).toContain('role="alert"');
    expect(text(error)).toContain("再试一次");
    expect(text(html(createElement(EmptyState, { children: "还没有要问的问题。" })))).toBe("还没有要问的问题。");
    expect(text(html(createElement(OfflineState, { locale: "zh-Hans" })))).toContain("已经记录的都还在");
  });

  it("the microphone states each leave a way forward; tap-to-play is one worded button", () => {
    expect(text(html(createElement(MicPermission, { state: "ask", locale: "zh-Hans" })))).toContain("打开麦克风");
    expect(text(html(createElement(MicPermission, { state: "denied", locale: "zh-Hans", typeHref: "/p/today?type=1" })))).toContain("我想打字");
    expect(text(html(createElement(MicPermission, { state: "unavailable", locale: "en", typeHref: "/p/today?type=1" })))).toContain("I'd rather type");
    expect(text(html(createElement(TapToPlay, { locale: "zh-Hans" })))).toContain("点一下，听家人的提醒");
  });

  it("the emergency block dials the number it shows; every hotline is one tap and selectable text", () => {
    const block = html(createElement(EmergencyBlock, { title: "现在就打 995 叫救护车，不确定也要打。", call: { number: "995" }, locale: "zh-Hans" }));
    expect(block).toContain('href="tel:995"');
    expect(text(block)).toContain("打995");
    const lines = html(
      createElement(Hotlines, {
        locale: "zh-Hans",
        lines: [
          { text: "a", calls: [{ number: "995", urgent: true }] },
          { text: "b", calls: [{ number: "1767" }, { label: "WhatsApp", number: "9151 1767", href: "https://wa.me/6591511767" }] },
          { text: "c", calls: [{ number: "1800-3535-800" }] },
        ],
      }),
    );
    expect(lines).toContain('href="tel:995"');
    expect(lines).toContain('href="tel:1767"');
    expect(lines).toContain('href="https://wa.me/6591511767"');
    expect(lines).toContain('href="tel:18003535800"');
    expect((lines.match(/data-urgent="true"/g) ?? []).length).toBe(1);
  });
});

describe("asking", () => {
  it("voice first: the mic is one worded button; nothing is sent before 问这句", () => {
    const idle = html(createElement(AskVoice, { state: "idle", locale: "zh-Hans" }));
    expect(text(idle)).toContain("按一下开始说，说完再按一下");
    expect(idle).not.toContain("问这句");
    const heard = html(createElement(AskVoice, { state: "heard", heard: "今天 150/95，我能不能多吃一粒？", locale: "zh-Hans" }));
    expect(text(heard)).toContain("「今天 150/95，我能不能多吃一粒？」");
    expect(text(heard)).toContain("问这句");
    expect(text(heard)).toContain("重新说");
  });

  it("typing has a label and a worded send button", () => {
    const f = html(createElement(AskField, { locale: "zh-Hans" }));
    expect(f).toContain('placeholder="想说什么、问什么"');
    expect(f).toMatch(/<label[^>]*for="rpu-ask-q"[^>]*>打字问<\/label>/);
    expect(f).toMatch(/<button type="submit"[^>]*>.*问这句.*<\/button>/);
  });

  it("the refer answer is the parts it is given, each with its source, and the added row at the foot", () => {
    const out = html(
      createElement(AnswerRefer, {
        locale: "zh-Hans",
        question: ["今天 150/95，", "我能不能多吃一粒？"],
        ripple: "RIPPLE-SENTENCE",
        quote: { kind: "doctor", who: "Dr Lim 说过", when: "9月1日", ref: "v2-u08", lang: "en", text: "DOCTOR-WORDS", listen: { label: "听医生原声", href: "/clip", time: "0:43", standIn: true } },
        label: { restated: "每天早上服用一片。", printed: "Take ONE tablet every MORNING" },
        addedHref: "/p/questions",
      }),
    );
    const t = text(out);
    for (const part of ["你问", "今天 150/95，我能不能多吃一粒？", "Ripple", "RIPPLE-SENTENCE", "Dr Lim 说过", "DOCTOR-WORDS", "听医生原声", "代录音", "药品标签", "每天早上服用一片。", "Take ONE tablet every MORNING", "已加入下次就诊的问题单"]) {
      expect(t, part).toContain(part);
    }
    expect(out).toContain('data-source-ref="v2-u08"');
    expect(out).toContain('data-at="bottom"');
  });

  it("reasons: his routine first, then the fixed ones, and 其他原因", () => {
    const out = html(createElement(ReasonChoices, { locale: "zh-Hans", reasons: [{ code: "tai_chi_morning", label: "打太极" }, { code: "forgot", label: "忘记服用" }] }));
    expect(text(out)).toBe("未服药原因打太极忘记服用其他原因");
  });
});

describe("visit, review, questions, switches", () => {
  it("review: progress in words, the guess labelled, three worded answers", () => {
    const out = html(createElement(ReviewSentence, { index: 3, total: 12, sentence: "“At home, we want it below 135 over 85.”", lang: "en", utteranceId: "v1-u08", at: "0:49", locale: "zh-Hans", listenHref: "/clip" }));
    const t = text(out);
    expect(t).toContain("第 3 件 / 共 12 件");
    expect(t).toContain("好像是医生说的");
    expect(t).toContain("这句是医生说的吗？");
    expect(t).toContain("是，医生说的");
    expect(t).toContain("不是");
    expect(t).toContain("不记得");
    expect((out.match(/data-on="true"/g) ?? []).length).toBe(3);
  });

  it("a question says for whom and where it came from, in words", () => {
    const out = html(createElement(QuestionRow, { text: "打太极的早上我常常忘记吃，可以打完太极回来再吃吗？", forWhom: "doctor", origin: "pattern", locale: "zh-Hans" }));
    expect(text(out)).toContain("问医生");
    expect(text(out)).toContain("Ripple 发现的规律");
    expect(text(out)).toContain("尚未询问");
    expect(out).toContain('data-status="open"');
  });

  it("the family switch says 开 / 关 in words and is a real switch", () => {
    const on = html(createElement(FamilySwitchRow, { title: "每天吃药了没有", description: "只有吃了 / 没吃 / 没回", locale: "zh-Hans", defaultOn: true }));
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(text(on)).toContain("开");
    const off = html(createElement(FamilySwitchRow, { title: "看诊录音", locale: "en", on: false }));
    expect(off).toContain('aria-checked="false"');
    expect(text(off)).toContain("Off");
  });
});

describe("page frames", () => {
  it("TodayLayout renders the sections it is given, focus first, in the documented order", () => {
    const out = html(
      createElement(TodayLayout, {
        locale: "zh-Hans",
        meta: "M",
        headline: "H",
        focus: "dose",
        ask: "ASK",
        reminder: "REMINDER",
        dose: "DOSE",
        chat: "CHAT",
      }),
    );
    const order = [...out.matchAll(/data-today-section="(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["dose", "reminder", "chat", "ask"]);
    expect(TODAY_ORDER).toEqual(["reminder", "dose", "bp", "countdown", "watch", "chat", "ask"]);
  });

  it("a stub names its section and the track that builds it", () => {
    const out = html(createElement(DoseSection, { locale: "zh-Hans" }));
    expect(out).toContain('data-section="dose"');
    expect(text(out)).toContain("B 时钟和每一天");
  });

  it("the filming-account entry shows only for crew", () => {
    const base = { locale: "zh-Hans" as const, meta: "M", entries: createElement(ProfileEntry, { locale: "zh-Hans" }), crewEntry: createElement(FilmingAccountEntry, { locale: "zh-Hans" }) };
    expect(html(createElement(MeLayout, { ...base, crew: false }))).not.toContain('data-entry="filming"');
    expect(html(createElement(MeLayout, { ...base, crew: true }))).toContain('data-entry="filming"');
  });
});

describe("the timeline draft's parts", () => {
  it("a timeline entry is a node, a head line (time, who, where from), a title and what it is given", () => {
    const out = html(
      createElement(Timeline, {
        children: [
          createElement(TimelineItem, { key: 1, node: "sch", time: "6:30", who: "散步", meta: "8:30 早饭" }),
          createElement(TimelineItem, { key: 2, node: "now", time: "8:45", title: "早上的药，还没记。", testId: "t-now" }),
          createElement(TimelineItem, { key: 3, node: "rip", say: "好，9:15 再问你。" }),
          createElement(TimelineItem, { key: 4, node: "ok", time: "8:47", title: "早上的药：吃了", note: "Amlodipine 5 mg", frame: "card", dim: true }),
        ],
      }),
    );
    expect(text(out)).toBe("6:30散步 · 8:30 早饭8:45早上的药，还没记。Ripple好，9:15 再问你。8:47早上的药：吃了Amlodipine 5 mg");
    expect([...out.matchAll(/class="rpu-node" data-node="(\w+)"/g)].map((m) => m[1])).toEqual(["sch", "now", "rip", "ok"]);
    // the routine's time is quiet, the time of what is now is not
    expect(out).toMatch(/class="rpu-tl-time" data-quiet="true">6:30</);
    expect(out).toMatch(/class="rpu-tl-time">8:45</);
    // Ripple's sentence is the tinted bubble, and the done node carries a tick drawn as a mark (not a letter)
    expect(out).toMatch(/class="rpu-bubble"[^>]*data-node="rip"/);
    expect(out).toMatch(/data-node="ok" aria-hidden="true"><svg/);
    expect(out).toContain('data-frame="card"');
    expect(out).toContain('data-dim="true"');
    expect(out).toContain('data-testid="t-now"');
  });

  it("a node never stands without words: every kind has a shape, and Ripple names itself", () => {
    expect(NODE_KINDS).toHaveLength(14);
    expect(text(html(createElement(TimelineItem, { node: "rip", say: "记下了。" })))).toBe("Ripple记下了。");
  });

  it("a sub card: her recording with the round play button, the medicine with its source and 「看原文」", () => {
    const out = html(
      createElement(SubCard, {
        children: [
          createElement(SubRow, { key: 1, lead: createElement(PlayCircle, { playing: true, label: "停" }), who: "女儿的录音", meta: "Wei Ling（示例）· 正在播放" }),
          createElement(SubRow, { key: 2, title: "Amlodipine 5 mg", who: "药袋", meta: "9月1日 配药", link: { href: "/p/meds/med-amlodipine", label: "看原文" } }),
        ],
      }),
    );
    expect(text(out)).toBe("女儿的录音 · Wei Ling（示例）· 正在播放Amlodipine 5 mg药袋 · 9月1日 配药 · 看原文");
    expect(out).toMatch(/<button type="button" class="rpu-playc"[^>]*aria-pressed="true"[^>]*aria-label="停"/);
    expect(out).toContain('data-icon="pause"');
    expect(out).toMatch(/<a class="rpu-inline-link"[^>]*href="\/p\/meds\/med-amlodipine"/);
    const idle = html(createElement(PlayCircle, { label: "听" }));
    expect(idle).toContain('aria-pressed="false"');
    expect(idle).toContain('data-icon="play"');
  });

  it("the play pill is outlined when it can play and pressed while it plays; a row of actions has its columns", () => {
    expect(html(createElement(PlayPill, { children: "听原声" }))).toMatch(/<button type="button" class="rpu-src"[^>]*aria-pressed="false"/);
    const on = html(createElement(PlayPill, { children: "正在播放", playing: true }));
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('data-icon="pause"');
    const acts = html(createElement(Acts, { children: [createElement(Act, { key: 1, variant: "primary", children: "吃了" }), createElement(Act, { key: 2, children: "还没吃" })] }));
    expect(acts).toContain("--rpu-cols:2");
    expect(text(acts)).toBe("吃了还没吃");
    expect(html(createElement(Act, { href: "/p/today?change=morning", children: "改" }))).toMatch(/^<a [^>]*href="\/p\/today\?change=morning"/);
  });

  it("someone's English words carry the Chinese under them and the line that says which one counts", () => {
    const out = html(createElement("div", null, createElement(SaidTranslation, { note: "中文翻译，以英文原话为准", children: "在家里量，我们希望它低于 135/85。" })));
    expect(text(out)).toBe("在家里量，我们希望它低于 135/85。中文翻译，以英文原话为准");
    expect(out).toContain('class="rpu-said-zh"');
  });

  it("the header: the title, its subtitle, 「‹ 返回」 above them, words on the right; MetaBar draws the same header", () => {
    const today = html(createElement(PageHeader, { title: "今天", subtitle: "9月19日 周六", locale: "zh-Hans", meHref: "/p/me" }));
    expect(today).toMatch(/<h1 class="rpu-meta-title" data-rp="page-title" data-size="big">今天<\/h1>/);
    expect(today).toMatch(/<span class="rpu-meta-story" data-rp="meta-story">9月19日 周六<\/span>/);
    expect(today).toMatch(/<a class="rpu-me"[^>]*data-kind="me"[^>]*href="\/p\/me"|<a [^>]*href="\/p\/me"[^>]*data-kind="me"/);
    // outside an account (the demo, /design) a header has no language switch unless the page passes one
    expect(today).not.toContain('data-kind="lang"');
    expect(today).not.toContain('data-testid="elder-lang"');
    // on his account Today has nothing at the top right: no 「中 EN」 (owner, 10-15: the language is 「我 › 语言」) and no 「我」
    // circle (owner, 10-14: 「我」 is the fourth place of his bottom bar); the title and its date are as before
    const his = html(createElement(AccountHeaderProvider, { locale: "zh-Hans", children: createElement(PageHeader, { title: "今天", subtitle: "9月19日 周六", locale: "zh-Hans" }) }));
    expect(text(his)).toBe("今天9月19日 周六");
    expect(his).toMatch(/<h1 class="rpu-meta-title" data-rp="page-title" data-size="big">今天<\/h1>/);
    expect(his).not.toContain('data-testid="elder-lang"');
    expect(his).not.toContain('data-kind="me"');
    expect(his).not.toContain('data-kind="lang"');
    // text 18px and up, a round target 48px and up, one word in it: the language a tap changes to
    const langCss = readFileSync(path.join(process.cwd(), "components", "ui", "lang-switch.css"), "utf8");
    const langRule = (sel: string) => new RegExp(`${sel.replace(/[.[\]"]/g, "\\$&")} \\{([^}]*)\\}`).exec(langCss)?.[1] ?? "";
    expect(langRule(".rpu-lang")).toContain("font-size: var(--rp-fs-min)");
    expect(langRule(".rpu-lang")).toContain("min-height: var(--rp-hit)");
    expect(langRule(".rpu-lang")).toContain("min-width: var(--rp-hit)");
    expect(langRule(".rpu-lang")).toContain("font-weight: 800");
    const sub = html(createElement(PageHeader, { back: { href: "/p/bp", label: "血压" }, title: "记一次血压", subtitle: "9月18日 周五", right: "第 1 项", locale: "zh-Hans" }));
    expect(text(sub)).toBe("血压记一次血压9月18日 周五第 1 项");
    expect(sub.indexOf('data-rp="back"')).toBeLessThan(sub.indexOf('data-rp="page-title"'));
    expect(sub).not.toContain('data-size="big"');
    const old = html(createElement(MetaBar, { story: "9月22日 周二 · 晚上 8:15", locale: "zh-Hans", langHref: "/p/today?lang=en" }));
    expect(old).toContain('data-rp="meta"');
    expect(old).toMatch(/data-rp="meta-story">9月22日 周二 · 晚上 8:15</);
    expect(old).toContain('data-kind="lang"');
  });

  it("the say bar says both ways in words; boxes, lists, options, the step bar, the segmented control and a field", () => {
    const bar = html(createElement(SayBar, { locale: "zh-Hans", typeHref: "/p/ask" }));
    expect(text(bar)).toBe("按一下说打字");
    expect(bar).toMatch(/<button type="button" class="rpu-say-btn" data-say="speak"/);
    expect(bar).toMatch(/<a class="rpu-say-btn"[^>]*data-say="type"[^>]*href="\/p\/ask"|<a [^>]*href="\/p\/ask"[^>]*data-say="type"/);
    expect(text(html(createElement(SayBar, { locale: "en" })))).toBe("Tap to speakType");

    const box = html(createElement(Box, { variant: "acc", title: "约 10月5日 看诊，还有 5 天。", link: { href: "/p/questions", label: "看问题单" }, children: "要问的有 3 个。" }));
    expect(box).toContain('data-variant="acc"');
    expect(text(box)).toBe("约 10月5日 看诊，还有 5 天。要问的有 3 个。看问题单");

    const list = html(
      createElement(ListCard, {
        heading: "这周",
        children: [createElement(ListItem, { key: 1, title: "142/85", sub: "9月18日 周五", chevron: true, href: "/p/bp" }), createElement(ListItem, { key: 2, mark: "miss", title: "8月27日 晚上", right: "未确认" })],
      }),
    );
    expect(text(list)).toBe("这周142/859月18日 周五8月27日 晚上未确认");
    expect(list).toContain('data-mk="miss"');
    expect(list).toContain('data-icon="chevron"');

    const opts = html(
      createElement(OptionList, {
        label: "谁在操作",
        children: [createElement(Option, { key: 1, title: "我自己", checked: true }), createElement(Option, { key: 2, title: "家人帮我操作", sub: "家人填的每一项，之后都等你认一遍" })],
      }),
    );
    expect(opts).toContain('role="radiogroup"');
    expect((opts.match(/role="radio"/g) ?? []).length).toBe(2);
    expect((opts.match(/aria-checked="true"/g) ?? []).length).toBe(1);
    expect(html(createElement(Option, { title: "我已经抄下来", multi: true, checked: true }))).toMatch(/role="checkbox"[^>]*aria-checked="true"/);

    const step = html(createElement(StepBar, { index: 3, total: 8, label: "第 3 步，共 8 步" }));
    expect([...step.matchAll(/data-state="(\w+)"/g)].map((m) => m[1])).toEqual(["done", "done", "now", "todo", "todo", "todo", "todo", "todo"]);

    const seg = html(createElement(Segmented, { items: [{ key: "zh", label: "中文", on: true }, { key: "en", label: "English" }] }));
    expect(seg).toContain("--rpu-cols:2");
    expect((seg.match(/aria-pressed="true"/g) ?? []).length).toBe(1);

    const field = html(createElement(Field, { id: "f-pw", label: "密码", error: "这个密码太常见，别人很容易猜到。换一个。", hint: "8 到 72 个字。", defaultValue: "12345678" }));
    expect(field).toMatch(/<label class="rpu-f-label" for="f-pw">密码<\/label>/);
    expect(field).toContain('aria-invalid="true"');
    expect(field).toContain('role="alert"');
  });

  it("the week chart draws a bar only for a day with a reading, and the doctor's numbers as labelled lines", () => {
    const out = html(
      createElement(BpWeekChart, {
        days: [
          { weekday: "一", day: "14", sys: 126, dia: 82 },
          { weekday: "二", day: "15" },
          { weekday: "五", day: "18", sys: 142, dia: 85, today: true },
        ],
        refs: [{ value: 135, label: "135" }, { value: 85, label: "85" }],
        caption: "两条虚线是 Dr Lim 8月24日说的 135/85（录音 0:49）。",
      }),
    );
    expect((out.match(/class="rpu-chart-bar"/g) ?? []).length).toBe(2);
    expect((out.match(/class="rpu-chart-ref"/g) ?? []).length).toBe(2);
    expect(text(out)).toContain("126/82");
    expect(text(out)).toContain("两条虚线是 Dr Lim 8月24日说的 135/85");
    expect(out).not.toMatch(/data-tone|color:/);
  });

  it("the buttons of the draft by name; a disabled one keeps its words", () => {
    for (const variant of ["link", "outline", "small", "on", "danger-outline", "danger-solid"] as const) {
      expect(html(createElement(Button, { variant, children: "x" })), variant).toContain(`data-variant="${variant}"`);
    }
    expect(text(html(createElement(Button, { variant: "primary", disabled: true, children: "下一步" })))).toBe("下一步");
  });
});

function familyHomeProps() {
  return {
    locale: "zh-Hans" as const,
    kicker: "爸爸今天 · 9月19日 周六",
    status: { title: "早上的药吃了", detail: "8:52 他自己点的", tone: "ok" as const },
    stats: [{ key: "dose", label: "这周吃药", value: "5", unit: "/ 6 天" }],
    reminder: { words: "爸，早餐吃了吗？药记得吃哦。", playsAt: "8:45", ownVoice: false },
    recordHref: "/f/record",
    phone: "+65 0000 0000",
    sharedHref: "/f/shared",
    privacy: "这些是爸爸同意给你看的。",
  };
}

describe("what the lines building on the foundation asked for (optional, the earlier use is unchanged)", () => {
  const css = readFileSync(path.join(process.cwd(), "app", "ripple-ui.css"), "utf8");

  it("two timelines one under the other join into one line", () => {
    const item = createElement(TimelineItem, { node: "me", who: "你" });
    const plain = html(createElement(Timeline, { children: item }));
    expect(plain).not.toContain("data-join-");
    expect(html(createElement(Timeline, { joinNext: true, children: item }))).toContain('data-join-next="true"');
    const lower = html(createElement(Timeline, { joinPrev: true, children: item }));
    expect(lower).toContain('data-join-prev="true"');
    expect(lower).not.toContain("data-join-next");
    // the rule comes in from the top edge, and runs to the bottom edge with the last entry's room kept
    expect(css).toMatch(/\.rpu-tl\[data-join-prev="true"\] > \.rpu-tl-item:first-child > \.rpu-tl-rail::before \{ top: 0; \}/);
    expect(css).toMatch(/\.rpu-tl\[data-join-next="true"\] > \.rpu-tl-item:last-child > \.rpu-tl-main \{ padding-bottom: 22px; \}/);
  });

  it("an entry's head line takes a hook; a row of controls and the play pill take theirs", () => {
    const plain = html(createElement(TimelineItem, { node: "doc", who: "医生说", meta: "9月8日 · 0:43" }));
    expect(plain).toContain('<p class="rpu-tl-head">');
    const hooked = html(createElement(TimelineItem, { node: "doc", who: "医生说", meta: "9月8日 · 0:43", headRp: "source-tag", headTestId: "who-when", headAttrs: { "data-kind": "doctor" } }));
    expect(hooked).toContain('<p class="rpu-tl-head" data-rp="source-tag" data-testid="who-when" data-kind="doctor">');
    expect(text(hooked)).toBe("医生说 · 9月8日 · 0:43");
    const pill = html(createElement(PlayPill, { playing: true, testId: "clip", attrs: { "data-src": "/api/visits/v2/clip?u=v2-u08", "data-playing": "true" }, children: "正在播" }));
    expect(pill).toMatch(/<button[^>]*aria-pressed="true"[^>]*data-testid="clip"[^>]*data-src="\/api\/visits\/v2\/clip\?u=v2-u08"[^>]*data-playing="true"/);
  });

  it("a title of 28; a paragraph of 24 and of 18, which filming mode leaves alone", () => {
    expect(html(createElement(TimelineItem, { node: "now", title: "是她吗？", titleSize: "large" }))).toContain('<p class="rpu-tl-title" data-size="large">');
    expect(css).toContain('.rpu-tl-title[data-size="large"] { font-size: var(--rp-fs-ask); }');
    const body = html(createElement(BodyText, { children: "一句话" }));
    expect(body).toContain('data-rp-role="body"');
    expect(body).not.toContain("data-size");
    const large = html(createElement(BodyText, { size: "large", children: "一句话" }));
    expect(large).toContain('data-size="large"');
    expect(large).not.toContain("data-rp-role");
    expect(html(createElement(BodyText, { size: "small", variant: "lede", children: "一句话" }))).toContain('data-variant="lede" data-size="small"');
    expect(css).toContain('.rpu-text[data-size="large"] { font-size: var(--rp-fs-node);');
    expect(css).toContain('.rpu-text[data-size="small"] { font-size: var(--rp-fs-min);');
  });

  it("the source link says in its shape that it is playing", () => {
    const idle = html(createElement(SourceLink, { kind: "doctor", play: true, locale: "zh-Hans", onClick: () => undefined, children: "听原声" }));
    expect(idle).toContain('data-icon="play"');
    expect(idle).not.toContain("aria-pressed");
    const playing = html(createElement(SourceLink, { kind: "doctor", play: true, playing: true, locale: "zh-Hans", onClick: () => undefined, children: "正在播" }));
    expect(playing).toContain('data-icon="pause"');
    expect(playing).toContain('aria-pressed="true"');
  });

  it("a helpline's sentence stands in Ripple's bubble and its numbers are buttons under it: 995 red, a call filled, WhatsApp outlined", () => {
    const out = html(
      createElement(Hotlines, {
        locale: "zh-Hans",
        lines: [
          { text: "请打 995。", calls: [{ number: "995", urgent: true }] },
          { text: "随时可以找人说话。", calls: [{ number: "1767" }, { label: "WhatsApp 发文字", number: "9151 1767", href: "https://wa.me/6591511767" }] },
        ],
      }),
    );
    expect((out.match(/<p class="rpu-bubble" data-rp="bubble" data-node="rip"/g) ?? []).length).toBe(2);
    expect((out.match(/class="rpu-hotline"/g) ?? []).length).toBe(2);
    expect(out).toMatch(/<a class="rpu-act" href="tel:995" data-variant="danger" data-urgent="true" data-rp="call">/);
    expect(out).toMatch(/<a class="rpu-act" href="tel:1767" data-variant="primary" data-rp="call">/);
    expect(out).toMatch(/<a class="rpu-act" href="https:\/\/wa\.me\/6591511767" data-variant="secondary" data-rp="call">/);
    // the number is its own selectable piece of text, after the words
    expect(out).toContain('WhatsApp 发文字 <span class="rpu-call-num">9151 1767</span>');
  });

  it("a screen with nothing fixed at its foot keeps the draft's room there; the default is as it was", () => {
    const child = createElement("p", null, "x");
    expect(html(createElement(Screen, { locale: "zh-Hans", children: child }))).not.toContain("data-foot");
    expect(html(createElement(Screen, { locale: "zh-Hans", foot: "plain", children: child }))).toContain('data-foot="plain"');
    expect(html(createElement(Screen, { locale: "zh-Hans", foot: "dock", children: child }))).toContain('data-foot="dock"');
    expect(css).toContain('.rpu-screen[data-foot="plain"] > .rpu-page { padding-bottom: 40px; }');
    expect(css).toContain('.rpu-screen[data-foot="dock"] > .rpu-page { padding-bottom: 34px; }');
    // a tab bar fixed under the page still decides (its rule comes later)
    expect(css.indexOf('.rpu-screen[data-foot="dock"]')).toBeLessThan(css.indexOf('.rpu-screen[data-tabbar="fixed"] > .rpu-page'));
  });

  it("a field's input fills its 64px box, so the place to tap is never under 48", () => {
    const box = /\.rpu-f-box \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(box).toContain("min-height: var(--rp-h-secondary)");
    expect(box).toContain("padding: 0 16px");
    const input = /\.rpu-f-input \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(input).toContain("align-self: stretch");
    expect(input).toContain("min-height: calc(var(--rp-h-secondary) - 5px)");
    expect(css).toMatch(/--rp-h-secondary: calc\(64 \* var\(--rp-u\)\)/);
  });

  it("the header's title can be a plain line where the screen has its own heading", () => {
    const heading = html(createElement(PageHeader, { title: "问一句", subtitle: "10月10日 周六", locale: "zh-Hans", back: { href: "/p/today" } }));
    expect(heading).toMatch(/<h1 class="rpu-meta-title" data-rp="page-title">问一句<\/h1>/);
    const line = html(createElement(PageHeader, { title: "问一句", titleAs: "p", subtitle: "10月10日 周六", locale: "zh-Hans", back: { href: "/p/today" } }));
    expect(line).toMatch(/<p class="rpu-meta-title" data-rp="page-title">问一句<\/p>/);
    expect(line).not.toContain("<h1");
  });

  it("an option and a box hand a caller's data-* attributes to their root; the lower buttons can be the white strip at the foot", () => {
    const opt = html(createElement(Option, { title: "女儿", checked: true, "data-testid": "rel-daughter", "data-state": "on" }));
    expect(opt).toMatch(/<button[^>]*class="rpu-opt"[^>]*data-testid="rel-daughter"[^>]*data-state="on"/);
    expect(html(createElement(Option, { title: "女儿", testId: "rel", attrs: { "data-kind": "relation" } }))).toMatch(/data-testid="rel"[^>]*data-kind="relation"/);
    const box = html(createElement(Box, { variant: "acc", title: "等你认", "data-testid": "waiting", "data-count": 2 }));
    expect(box).toMatch(/<div class="rpu rpu-box" data-rp="box" data-variant="acc"[^>]*data-testid="waiting"[^>]*data-count="2"/);
    expect(html(createElement(ActionDock, { children: "x" }))).not.toContain("data-bar");
    const bar = html(createElement(ActionDock, { bar: true, "data-testid": "foot", children: "x" }));
    expect(bar).toContain('data-bar="true"');
    expect(bar).toContain('data-testid="foot"');
    expect(css).toMatch(/\.rpu-dock\[data-bar="true"\] \{[^}]*position: sticky;[^}]*background: var\(--rp-white\);[^}]*border-top: 1px solid var\(--rp-line\);/);
    expect(css).toContain('.rpu-screen:has(.rpu-dock[data-bar="true"]) > .rpu-page { padding-bottom: var(--rpu-bottom); }');
  });

  it("entries that share an element of their own stay on one line: the group is a real block and the rule runs through it", () => {
    const pair = createElement(TimelineGroup, {
      as: "article",
      testId: "pair",
      "data-question": "q-1",
      children: [createElement(TimelineItem, { key: "q", node: "me", who: "你问", say: "能不能多吃一粒？" }), createElement(TimelineItem, { key: "a", node: "doc", who: "医生说" })],
    });
    const out = html(createElement(Timeline, { children: pair }));
    expect(out).toMatch(/<div class="rpu rpu-tl" data-rp="timeline"><article class="rpu-tl-group" data-rp="tl-group" data-testid="pair" data-question="q-1"><div class="rpu-tl-item"/);
    expect((out.match(/class="rpu-tl-item"/g) ?? []).length).toBe(2);
    // every entry of a group is a middle one; only the line's very first and very last entry end the rule
    expect(css).toContain(".rpu-tl > .rpu-tl-group > .rpu-tl-item > .rpu-tl-rail::before { display: block; top: 0; bottom: 0; height: auto; }");
    expect(css).toContain(".rpu-tl > .rpu-tl-group > .rpu-tl-item > .rpu-tl-main { padding-bottom: 22px; }");
    expect(css).toContain(".rpu-tl > .rpu-tl-group:first-child > .rpu-tl-item:first-child > .rpu-tl-rail::before { top: calc(14 * var(--rp-u)); }");
    expect(css).toContain(".rpu-tl > .rpu-tl-group:last-child > .rpu-tl-item:last-child > .rpu-tl-rail::before { bottom: auto; height: calc(14 * var(--rp-u)); }");
    expect(css).toContain(".rpu-tl > .rpu-tl-group:last-child > .rpu-tl-item:last-child > .rpu-tl-main { padding-bottom: 0; }");
    // a group is a block with a box of its own (never display: contents): a page finds it, measures it, scrolls to it
    expect(/\.rpu-tl-group \{([^}]*)\}/.exec(css)?.[1]).toContain("display: block");
  });

  it("his own words have a piece of their own: his solid round node and the plain face, never the serif", () => {
    const out = html(createElement(OwnWords, { who: "你问", meta: "9月22日", testId: "his-words", "data-source": "question", children: "今天 150/95，我能不能多吃一粒？" }));
    expect(out).toMatch(/^<div class="rpu rpu-own" data-rp="own-words" data-testid="his-words" data-source="question">/);
    expect(out).toContain('<span class="rpu-node" data-node="me" aria-hidden="true"></span>');
    expect(out).toContain('<span class="rpu-tl-who" data-node="me">你问</span>');
    expect(text(out)).toBe("你问 · 9月22日今天 150/95，我能不能多吃一粒？");
    // the words: the plain bubble (sans), not Ripple's tinted one, and no quote of someone else's
    expect(out).toContain('<p class="rpu-bubble" data-rp="bubble" data-rp-role="say">今天 150/95，我能不能多吃一粒？</p>');
    expect(out).not.toContain("blockquote");
    expect(out).not.toContain("rpu-said");
    expect(html(createElement(OwnWords, { size: "sub", children: "我今天好累" }))).toContain('data-size="sub"');
    expect(html(createElement(OwnWords, { children: "我今天好累" }))).not.toContain("rpu-tl-head");
    // <Said> still refuses his own words
    expect(() => html(createElement(Said, { source: { kind: "self" as never, ref: "note-1" }, lang: "zh-Hans", children: "我今天好累" }))).toThrow(/needs a source/);
    expect(/\.rpu-bubble \{([^}]*)\}/.exec(css)?.[1]).not.toContain("font-family");
  });

  it("the Chinese under English words in the draft's shape: serif 22, #2C3644, a 3px #D5DCE5 rule on the left, one 18px line under it", () => {
    const loose = html(createElement(SaidTranslation, { note: "中文翻译，以英文原话为准", children: "请不要自己改药量。" }));
    expect(loose).toBe('<p class="rpu-said-zh" data-rp="said-translation" lang="zh-Hans">请不要自己改药量。</p><p class="rpu-said-note">中文翻译，以英文原话为准</p>');
    // with a hook the two get an element of their own
    const hooked = html(createElement(SaidTranslation, { note: "中文翻译，以英文原话为准", testId: "line-translation", attrs: { "data-line": "v2-u08" }, children: "请不要自己改药量。" }));
    expect(hooked).toBe(`<div class="rpu rpu-said-pair" data-testid="line-translation" data-line="v2-u08">${loose}</div>`);
    // <ZhUnder> (components/translate) is that piece: the Chinese first, the back end's label as the line under it
    const under = html(createElement(ZhUnder, { text: "请不要自己改药量。", locale: "zh-Hans", testId: "relay-translation" }));
    expect(under).toBe(`<div class="rpu rpu-said-pair" data-testid="relay-translation">${loose}</div>`);
    expect(html(createElement(ZhUnder, { text: "请不要自己改药量。", locale: "en" }))).toBe("");
    const zhRule = /\.rpu-said-zh \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(zhRule).toContain("font-family: var(--rp-font-serif)");
    expect(zhRule).toContain("font-size: var(--rp-fs-row)");
    expect(zhRule).toContain("color: var(--rp-ink-2)");
    expect(zhRule).toContain("border-left: 3px solid var(--rp-line)");
    expect(css).toMatch(/--rp-fs-row: calc\(22 \* var\(--rp-u\)\)/);
    expect(css).toMatch(/--rp-ink-2: #2C3644;/);
    expect(css).toMatch(/--rp-line: #D5DCE5;/);
    expect(/\.rpu-said-note \{([^}]*)\}/.exec(css)?.[1]).toContain("font-size: var(--rp-fs-min)");
    expect(css).toMatch(/--rp-fs-min: calc\(18 \* var\(--rp-u\)\)/);
  });

  it("the header: the switch and the account's line can be switched off, the way back can be a button, and it takes a hook", () => {
    const under = createElement("p", { "data-testid": "example-line" }, "示例资料：陈先生（虚构人物）");
    const inAccount = (props: Parameters<typeof PageHeader>[0]) => html(createElement(AccountHeaderProvider, { locale: "zh-Hans", under, children: createElement(PageHeader, props) }));
    const usual = inAccount({ title: "简报", locale: "zh-Hans", back: { href: "/p/questions" } });
    // owner 10-14: 「我」 is a place of his bottom bar, never a circle in his header, even where a page asks for one
    expect(usual).not.toContain('data-kind="me"');
    expect(inAccount({ title: "简报", locale: "zh-Hans", meHref: "/p/me" })).not.toContain('data-kind="me"');
    expect(usual).not.toContain('data-testid="elder-lang"');
    expect(usual).toContain('data-testid="example-line"');
    // the page the doctor reads: neither (owner's decision of 2026-10-14)
    const forDoctor = inAccount({ title: "简报", locale: "zh-Hans", back: { href: "/p/questions" }, me: false, under: false });
    expect(forDoctor).not.toContain('data-kind="me"');
    expect(forDoctor).not.toContain('data-testid="elder-lang"');
    expect(forDoctor).not.toContain("example-line");
    // nothing at the right end, wherever the screen goes back to (owner 10-15)
    const underMe = inAccount({ title: "语言", locale: "zh-Hans", back: { href: "/p/me", label: "我" } });
    expect(underMe).not.toContain('data-kind="me"');
    expect(underMe).not.toContain('data-testid="elder-lang"');
    expect(html(createElement(PageHeader, { title: "简报", locale: "zh-Hans", meHref: "/p/me", me: false }))).not.toContain('data-kind="me"');
    // the way back: a link as before, now with a hook; a button where the screen goes back in place
    const link = html(createElement(PageHeader, { title: "换密码", locale: "zh-Hans", back: { href: "/p/me", label: "我", testId: "back-to-me" } }));
    expect(link).toMatch(/<a class="rpu-back" data-rp="back" data-testid="back-to-me" href="\/p\/me">/);
    const button = html(createElement(PageHeader, { title: "换密码", locale: "zh-Hans", back: { onClick: () => undefined, testId: "step-back" } }));
    expect(button).toMatch(/<button type="button" class="rpu-back" data-rp="back" data-testid="step-back">/);
    expect(text(button)).toBe("返回换密码");
    expect(css).toMatch(/button\.rpu-back \{[^}]*border: 0;[^}]*background: none;/);
    // MetaBar hands the same way back through
    expect(html(createElement(MetaBar, { locale: "zh-Hans", back: { onClick: () => undefined, testId: "retake" } }))).toContain('<button type="button" class="rpu-back" data-rp="back" data-testid="retake">');
  });

  it("a row of actions, its buttons, a segment and a chip each take a page's hooks", () => {
    const row = html(
      createElement(Acts, {
        "data-rp": "question-actions",
        attrs: { "data-question": "q-1" },
        children: [
          createElement(Act, { key: "edit", href: "/p/questions/q-1/edit", "data-action": "edit", "data-testid": "q-edit", children: "改" }),
          createElement(Act, { key: "skip", "data-action": "skip", "data-rp": "skip-question", children: "不问了" }),
          createElement(Act, { key: "plain", children: "听" }),
        ],
      }),
    );
    expect(row).toMatch(/<div class="rpu-acts" data-rp="question-actions" data-question="q-1"/);
    expect(row).toMatch(/<a class="rpu-act" data-rp="act" data-action="edit" data-testid="q-edit" data-variant="secondary" href="\/p\/questions\/q-1\/edit">改<\/a>/);
    expect(row).toContain('<button data-action="skip" data-rp="skip-question" type="button" class="rpu-act" data-variant="secondary">不问了</button>');
    expect(row).toMatch(/<button type="button" class="rpu-act" data-rp="act" data-variant="secondary">听<\/button>/);
    expect(html(createElement(Acts, { children: createElement(Act, { children: "听" }) }))).toContain('<div class="rpu-acts" data-rp="acts"');

    const seg = html(
      createElement(Segmented, {
        label: "问谁",
        testId: "ask-whom",
        items: [
          { key: "doctor", label: "问医生", on: true, testId: "whom-doctor", attrs: { "data-who": "doctor" } },
          { key: "pharmacist", label: "问药剂师", href: "/p/questions/new?who=pharmacist", testId: "whom-pharmacist", attrs: { "data-who": "pharmacist" } },
          { key: "none", label: "都不是" },
        ],
      }),
    );
    expect(seg).toMatch(/<div class="rpu rpu-seg" data-rp="segmented" role="group" aria-label="问谁" data-testid="ask-whom"/);
    expect(seg).toMatch(/<button type="button" class="rpu-seg-item" data-seg="doctor" aria-pressed="true" data-testid="whom-doctor" data-who="doctor">问医生<\/button>/);
    expect(seg).toMatch(/<a class="rpu-seg-item" data-seg="pharmacist" data-testid="whom-pharmacist" data-who="pharmacist" href="\/p\/questions\/new\?who=pharmacist">问药剂师<\/a>/);
    expect(seg).toContain('<button type="button" class="rpu-seg-item" data-seg="none" aria-pressed="false">都不是</button>');

    const chip = html(createElement(Chip, { on: true, disabled: true, "data-on": "true", attrs: { "data-food": "soup" }, children: "汤" }));
    expect(chip).toMatch(/<button type="button" class="rpu-chip" data-rp="chip" aria-pressed="true" disabled="" data-food="soup" data-on="true">汤<\/button>/);
    expect(html(createElement(Chip, { children: "汤" }))).toBe('<button type="button" class="rpu-chip" data-rp="chip" aria-pressed="false">汤</button>');
  });

  it("a button keeps a data-rp its page gave it, and a link button passes data-* on; the look still comes from the variant", () => {
    const plain = html(createElement(PrimaryButton, { children: "保存" }));
    expect(plain).toMatch(/<button type="button" class="rpu rpu-btn" data-rp="primary" data-variant="primary">/);
    const named = html(createElement(Button, { variant: "danger-outline", "data-rp": "me-entry", "data-testid": "logout", children: "退出登录" }));
    expect(named).toBe('<button data-rp="me-entry" data-testid="logout" type="button" class="rpu rpu-btn" data-variant="danger-outline"><span>退出登录</span></button>');
    const link = html(createElement(SecondaryButton, { href: "/p/questions", "data-action": "open-list", "data-testid": "to-list", children: "去问题单" }));
    expect(link).toMatch(/<a class="rpu rpu-btn" data-rp="secondary" data-action="open-list" data-testid="to-list" data-variant="secondary" href="\/p\/questions">/);
    // a full-width control that starts at the line's text ends where its column ends
    expect(css).toContain(".rpu-btn.rpu-ind, .rpu-opt.rpu-ind, .rpu-tap-play.rpu-ind { width: calc(100% - var(--rp-indent)); }");
  });

  it("a screen takes a page's own data-* (never over its own marks); the recovery code takes a hook and a spoken label; a box can be an alert", () => {
    const child = createElement("p", null, "x");
    const screen = html(createElement(Screen, { locale: "zh-Hans", "data-testid": "page-privacy", "data-locale": "zh-Hans", "data-version": "2026-10-01", "data-rp": "mine", "data-rp-side": "family", children: child }));
    expect(screen).toMatch(/^<div class="rpu rpu-screen" lang="zh-Hans"[^>]*data-locale="zh-Hans"[^>]*data-version="2026-10-01"/);
    expect(screen).toContain('data-testid="page-privacy"');
    expect(screen).toContain('data-rp="screen"');
    expect(screen).toContain('data-rp-side="elder"');
    expect(screen).not.toContain('data-rp="mine"');
    expect(screen).not.toContain('data-rp-side="family"');

    const code = html(createElement(RecoveryCode, { code: "K7M2-9QXA", note: "抄在纸上", testId: "recovery-code", label: "恢复码: K 7 M 2 9 Q X A", "data-shown": "once" }));
    expect(code).toMatch(/^<div class="rpu rpu-code" data-rp="recovery-code" data-shown="once">/);
    expect(code).toContain('<p class="rpu-code-t" translate="no" data-testid="recovery-code" aria-label="恢复码: K 7 M 2 9 Q X A">K7M2-9QXA</p>');
    expect(html(createElement(RecoveryCode, { code: "K7M2-9QXA" }))).toBe('<div class="rpu rpu-code" data-rp="recovery-code"><p class="rpu-code-t" translate="no">K7M2-9QXA</p></div>');

    expect(html(createElement(Box, { variant: "red", role: "alert", title: "没有存上，再试一次。" }))).toMatch(/^<div class="rpu rpu-box" role="alert" data-rp="box" data-variant="red">/);
    expect(html(createElement(Box, { title: "x" }))).not.toContain("role=");
  });

  it("while an undo bar stands at the foot, the page is longer by the bar's height and the lower buttons stay above it", () => {
    // the bar tells its screen how high it is (--rpu-toast-h, set in the browser); without a bar the page ends as before
    expect(css).toContain('.rpu-page::after { content: ""; display: block; flex: none; height: var(--rpu-toast-h, 0px); }');
    expect(/\.rpu-dock\[data-bar="true"\] \{([^}]*)\}/.exec(css)?.[1]).toContain("bottom: calc(var(--rpu-bottom) + var(--rpu-toast-h, 0px));");
    const source = readFileSync(path.join(process.cwd(), "components", "ui", "UndoToast.tsx"), "utf8");
    expect(source).toContain('screen.style.setProperty("--rpu-toast-h", `${el.offsetHeight}px`)');
    expect(source).toContain('screen.style.removeProperty("--rpu-toast-h")');
    // a bar inside a gallery row is not at the foot of anything
    expect(source).toContain('placement === "inline"');
  });
});

describe("daughter side", () => {
  it("home (dark second draft, track D): one sentence first, counts as rows, one solid button, call, the shared line", () => {
    const out = html(createElement(FamilyHome, familyHomeProps()));
    const t = text(out);
    for (const part of ["早上的药吃了", "8:52 他自己点的", "这周吃药", "5", "/ 6 天", "录一段新的提醒", "打电话给爸爸", "这些是爸爸同意给你看的。"]) {
      expect(t, part).toContain(part);
    }
    expect(out).toContain('href="tel:+6500000000"');
    // one solid button per screen; no "·" chain in what it says of itself
    expect((out.match(/data-variant="primary"/g) ?? []).length).toBe(1);
    expect(t).not.toContain("你的提醒 ·");
  });

  it("no reply: amber, exactly one action (call Dad), and what Ripple will not do", () => {
    const out = html(createElement(NoReplyAlert, { locale: "zh-Hans", title: "爸爸尚未回应早上的药提醒。", detail: "8:45 和 9:15 两次提醒均未回应。", phone: "+65 0000 0000" }));
    expect(out).toContain('data-kind="check"');
    expect((out.match(/<a /g) ?? []).length + (out.match(/<button /g) ?? []).length).toBe(1);
    expect(text(out)).toContain("打电话给爸爸");
    expect(text(out)).toContain("Ripple 不会替他记药");
  });

  it("shared: every item listed; unshared ones say so; she has no switch", () => {
    const out = html(
      createElement(SharedSection, {
        locale: "zh-Hans",
        items: [
          { title: "每天吃药了没有", shared: true, grant: "dose_summary" },
          { title: "他自己写的笔记", shared: false, grant: "notes" },
        ],
      }),
    );
    expect(text(out)).toContain("爸爸同意给你看的");
    expect(text(out)).toContain("没有分享");
    expect(out).not.toContain('role="switch"');
    expect(out).not.toMatch(/<button /);
  });

  it("recorder: each state shows its own buttons, in words", () => {
    const idle = text(html(createElement(ReminderRecorder, { state: "idle", locale: "zh-Hans", playsAt: "8:45" })));
    expect(idle).toContain("开始录");
    expect(idle).toContain("录一句话，每天 8:45 放给爸爸听。");
    const done = text(html(createElement(ReminderRecorder, { state: "recorded", locale: "zh-Hans", playsAt: "8:45", elapsed: "0:04" })));
    for (const w of ["刚录好的，先听一遍再决定。", "听一遍", "重录", "删掉这段", "就用这段", "0:04"]) expect(done, w).toContain(w);
    const live = text(html(createElement(ReminderRecorder, { state: "recording", locale: "zh-Hans", playsAt: "8:45", elapsed: "0:03" })));
    for (const w of ["在录了，慢慢说。", "说完按「录完了」。", "0:03", "录完了", "不录了"]) expect(live, w).toContain(w);
    expect(text(html(createElement(ReminderRecorder, { state: "recording", locale: "en", playsAt: "8:45" })))).toContain("Done");
    // the v3 draft's E6 and I5, a screen each: the microphone not yet allowed, and refused. The words are the ones
    // written before the draft, the sentence split at its full stop into the title and the line under it
    const ask = text(html(createElement(ReminderRecorder, { state: "mic-ask", locale: "zh-Hans", playsAt: "8:45" })));
    for (const w of ["录音要用麦克风。", "点下面的按钮，手机会问你，请点「允许」。", "打开麦克风"]) expect(ask, w).toContain(w);
    const denied = text(html(createElement(ReminderRecorder, { state: "mic-denied", locale: "zh-Hans", playsAt: "8:45" })));
    for (const w of ["麦克风被关掉了", "在手机的设置里给这个浏览器打开麦克风，再回来录。", "再试一次"]) expect(denied, w).toContain(w);
    const doneEn = text(html(createElement(ReminderRecorder, { state: "recorded", locale: "en", playsAt: "8:45", elapsed: "0:04" })));
    for (const w of ["Just recorded. Listen to it first, then decide.", "Listen", "Record again", "Use this one", "Delete this one"]) expect(doneEn, w).toContain(w);
  });

  it("invite, status card, event card and buttons", () => {
    // a name stands where 他 stood (her word is not one that says he or she: lib/care/copy.ts elderWords); 爸爸 says 他
    expect(text(html(createElement(InviteAccept, { state: "invite", locale: "zh-Hans", inviter: "陈先生", shares: [] })))).toContain("陈先生邀请你看陈先生的 Ripple");
    expect(text(html(createElement(InviteAccept, { state: "waiting", locale: "zh-Hans", inviter: "陈先生", shares: [] })))).toContain("等陈先生在手机上确认是你");
    expect(text(html(createElement(InviteAccept, { state: "invite", locale: "zh-Hans", inviter: "爸爸", shares: [] })))).toContain("爸爸邀请你看他的 Ripple");
    expect(text(html(createElement(InviteAccept, { state: "waiting", locale: "zh-Hans", inviter: "爸爸", shares: [] })))).toContain("等他在手机上确认是你");
    expect(text(html(createElement(StatusCard, { label: "看诊录音", state: "off", locale: "zh-Hans" })))).toContain("没有分享");
    const card = html(createElement(EventCard, { kind: "doctor", tag: "医生说", quote: "Please don't change the dose yourself." }));
    expect(card).toContain('data-kind="doctor"');
    expect(card).toContain('data-icon="steth"');
    expect(html(createElement(FamilyButton, { children: "录一段新的提醒" }))).toMatch(/^<button type="button" class="rpf rpf-btn" data-variant="primary"/);
  });
});
