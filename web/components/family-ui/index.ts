/**
 * Ripple UI for Wei Ling's phone, laid out as the v3 draft (Ripple-Daughter-v3, the fe-d track): one large sentence
 * per screen, the week as seven marks with their words, a three-column timeline, hairline rows, no cards, one solid
 * button per screen. Gallery: /design/family. Styles: app/ripple-ui.css Part B. Presentational only: every component
 * takes plain props; app/f and components/family wire the data (lib/care) into them. Notes: web/progress/fe-d.md.
 */
export { FamilyScreen, FamilyTop, FamilyHero, FamilyDock, FamilyNote, FamilySection, LangToggle, type FamilyTopProps } from "./FamilyScreen";
export { FamilyTabs, familyTabHrefs, type FamilyTabKey } from "./FamilyTabs";
export { FamilyButton } from "./FamilyButton";
export { StatusCard, StatusGrid, FactRow, FactRows } from "./StatusCard";
export { EventCard, type EventKind } from "./EventCard";
export { CountPill, CountPills } from "./CountPill";
export { NoReplyAlert } from "./NoReplyAlert";
export { SharedSection, SharedRows, type SharedItem } from "./SharedSection";
export { ReminderRecorder, type RecorderState } from "./ReminderRecorder";
export { InviteAccept, type InviteState } from "./InviteAccept";
export { FamilyEmpty, FamilyLoading, FamilyError, FamilyHomeSkeleton } from "./FamilyStates";
export { FamilyHome, type FamilyHomeProps, type FamilyStat } from "./FamilyHome";
export { WeekStrip, DayMark, type WeekStripDay, type DayMarkKind, type MarkKind } from "./WeekStrip";
export { Timeline, type TimelineItem } from "./Timeline";
export { Quote } from "./Quote";
export { Waveform, SAMPLE_LEVELS } from "./Waveform";
export { DayList, type DayListRow } from "./DayList";
export { MonthNav, MonthGrid, MonthLegend, MonthLegendItem, MonthDayPanel, MonthRow, BpDot, VisitRing, type MonthGridCell } from "./MonthGrid";
export { LinkRow, NoticeRow, AgreedRow, ConsentFoot, StepList, DashList, Chip, PlayButton, EmptyBlock, Stepper, BannerPreview, Said, TextLine, MicMark, LangSegment } from "./FamilyBits";
export { FamilySheet } from "./Sheet";
export { BackGlyph, ChevronRight, ChevronLeft, CheckGlyph, BellGlyph, PlayGlyph } from "./Glyphs";
