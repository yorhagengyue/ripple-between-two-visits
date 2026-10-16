/**
 * The words of 「拍摄账号」 (/p/me/filming; C2 track J), in his two languages. Declarative sentences, no clinical words:
 * the page is about the account's clock and records, nothing about his health. Client-safe.
 */
export type FilmingLocale = "zh-Hans" | "en";

export interface FilmingCopy {
  back: string;
  title: string;
  lede: string;
  records: string;
  crewOnly: string;
  markedTitle: string;
  markedLede: string;
  nowLabel: string;
  /** the account's date and time, moved by the director */
  movedNow: (now: string) => string;
  codeLabel: string;
  mark: string;
  marking: string;
  endHint: string;
  end: string;
  ending: string;
  failed: string;
}

const ZH: FilmingCopy = {
  back: "我",
  title: "拍摄账号",
  lede: "标成拍摄账号以后，拍摄组的导演台能把这个账号拨到故事里的任意一天。",
  records: "导演把它铺到某一天时，这个账号里的记录会换成陈先生故事里的记录，日期用故事里的日期。结束拍摄以后，日子回到今天，记录留着。",
  crewOnly: "只有带拍摄组口令的手机看得到这一页。普通账号，拍摄组碰不到。",
  markedTitle: "这是拍摄账号。",
  markedLede: "导演台能拨它的日子：铺到故事里的某一天、往后拨、弹提醒、模拟没回。",
  nowLabel: "现在",
  movedNow: (now) => `${now}（导演拨的）`,
  codeLabel: "导演台上的编号",
  mark: "标成拍摄账号",
  marking: "正在标……",
  endHint: "结束拍摄：日子回到今天，导演台不能再拨这个账号。",
  end: "结束拍摄",
  ending: "正在结束……",
  failed: "没有改成。网络通了以后再点一次。",
};

const EN: FilmingCopy = {
  back: "Me",
  title: "Filming account",
  lede: "Once this is the filming account, the film crew's director can move it to any day of the story.",
  records: "When the director lays it out to a day, its records are replaced by Mr Tan's story, on the story's dates. When filming ends, the account is back on today's date and the records stay.",
  crewOnly: "Only a phone with the film crew's key sees this page. The crew cannot touch an ordinary account.",
  markedTitle: "This is the filming account.",
  markedLede: "The director can move its day: lay it out to a day of the story, move it forward, pop the reminder, simulate no reply.",
  nowLabel: "Now",
  movedNow: (now) => `${now} (moved by the director)`,
  codeLabel: "Desk code",
  mark: "Make this the filming account",
  marking: "Marking…",
  endHint: "End filming: the account is back on today's date, and the director can no longer move it.",
  end: "End filming",
  ending: "Ending…",
  failed: "That did not change. Tap again once the phone is online.",
};

export function filmingCopy(locale: FilmingLocale | string): FilmingCopy {
  return locale === "en" ? EN : ZH;
}
