/**
 * Ripple UI for Mr Tan's phone, in the look of the timeline draft. Gallery: /design. Styles: app/ripple-ui.css
 * (Part A, imported once in app/layout.tsx). Tokens as data: lib/ui/tokens.ts. Words the components say themselves:
 * lib/ui/copy.ts. Notes (Chinese, one line per component): web/progress/fe.md (the first build's: f2.md).
 */
export { Screen, FilmingScope, ActionDock } from "./Screen";
export { MetaBar, PageHeader, type HeaderBack } from "./MetaBar";
export { StatusHeadline } from "./StatusHeadline";
export { BodyText, DrugName } from "./BodyText";
export { SectionLabel } from "./SectionLabel";
export {
  Timeline,
  TimelineGroup,
  TimelineItem,
  NodeMark,
  Bubble,
  OwnWords,
  TlNote,
  TlControls,
  SaidTranslation,
  PlayPill,
  PlayCircle,
  PlayGlyph,
  SubCard,
  SubRow,
  Acts,
  Act,
  Chevron,
  type TimelineItemProps,
} from "./Timeline";
export { SayBar } from "./SayBar";
export { Box, type BoxVariant } from "./Box";
export { ListCard, ListItem, ListMark, type ListMarkKind } from "./List";
export { StepBar, Field, OptionList, Option, Chips, Chip, Segmented, KvList, KvRow, RecoveryCode, SectionTitle, type SegmentItem } from "./Forms";
export { BpWeekChart, type BpWeekDay } from "./BpWeekChart";
export { SourceTag } from "./SourceTag";
export { Said, assertSaidSource, type SaidProps, type SaidSource, type SaidSpeaker } from "./Said";
export { SourceLink } from "./SourceLink";
export { Tag } from "./Tag";
export { LabelOriginal } from "./LabelOriginal";
export { ListenBar } from "./ListenBar";
export { PrimaryButton, SecondaryButton, GhostButton, DangerButton, DarkButton, Button, ButtonNote, ButtonPair, ButtonRow, type ButtonProps, type ButtonVariant } from "./Buttons";
export { DoneHero, DoneRow, KeyValueRow, NextRow, Rows, AddedRow, Divider, ReadingNumber } from "./Rows";
export { AskVoice, AskField, type VoiceState } from "./AskField";
export { ReasonChoices, type ReasonOption } from "./ReasonChoices";
export { UndoToast } from "./UndoToast";
export { TabBar } from "./TabBar";
export { EmergencyBlock, Hotlines, type EmergencyCall, type Hotline } from "./EmergencyBlock";
export { EmptyState, LoadingState, ErrorState, OfflineState } from "./States";
export { MicPermission, TapToPlay, type MicState } from "./Permission";
export { ForDoctorCard, RecordingBar, LiveCaptions, CaptureCount } from "./Visit";
export { ReviewSentence, type ReviewAnswer } from "./ReviewSentence";
export {
  AnswerQuestion,
  RippleLine,
  QuotedBlock,
  LabelBlock,
  LeafletBlock,
  AnswerExplain,
  AnswerRefer,
  AnswerUnknownMed,
  AnswerNoted,
  AnswerCantHelp,
  AnswerEmergency,
  AnswerSelfHarm,
  type QuotedWords,
  type LabelWords,
  type LeafletWords,
} from "./AnswerCards";
export { QuestionRow, ORIGIN_WORDS, type QuestionOrigin } from "./QuestionRow";
export { BriefHeader, BriefItem, BriefNum, BriefOwnWords, BriefQuestions } from "./Brief";
export { FamilySwitchRow, ToggleList } from "./FamilySwitch";
export { BpKeypad } from "./BpKeypad";
export { Icon, SOURCE_ICON, TAB_ICON, type IconName } from "./icons";
export { UiLink } from "./UiLink";
