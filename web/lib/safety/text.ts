/** Small text helpers shared by the safety layer. Pure functions. */

export const hasHan = (s: string): boolean => /\p{Script=Han}/u.test(s);

/**
 * A user input without invisible format characters (zero-width spaces and joiners, soft hyphens, BOM, word joiner,
 * bidi controls: Unicode category Cf), so "can I ta​ke t​wo tablets" reads as the words it shows.
 */
export function stripInvisible(text: string): string {
  return text.replace(/\p{Cf}/gu, "");
}

/** Language of a user input: any Han character -> zh-Hans, otherwise en. */
export function detectLang(text: string): "zh-Hans" | "en" {
  return hasHan(text) ? "zh-Hans" : "en";
}

/**
 * A loose key for matching (label fields, withheld visit lines, "is the generator's span inside the source?"): NFKC,
 * lower case, curly quotes straightened, punctuation and whitespace removed. "Take one tablet every morning." ==
 * "Take ONE tablet every MORNING". NOT the verbatim test: it also equates "Please don't. Change the dose ..." with
 * "Please don't change the dose. ...", so a quote is decided with sameQuote / matchWholeSentences below.
 */
export function normalizeForCompare(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

/** True when `part` (normalised) appears inside `whole` (normalised). Empty part is never contained. */
export function containsNormalized(whole: string, part: string): boolean {
  const p = normalizeForCompare(part);
  return p.length > 0 && normalizeForCompare(whole).includes(p);
}

/** Sentence pieces of a text (sentenceSpans; terminal marks stay on the piece). */
export function sentencePieces(text: string): string[] {
  return sentenceSpans(text).map((s) => s.text);
}

/**
 * Sentence-ending marks. 。！？｡ (Chinese) always end a sentence. The others (. ! ? and their full-width and small
 * forms, the ellipsis) end one only when whitespace, a Han character or the end of the text follows, so "0.5",
 * "2.5 mg", "e.g.," and "a.m.x" are never cut (fix round 1, 10-09: "Take 0.5 tablet every MORNING" used to give the
 * whole "sentence" "5 tablet every MORNING"). A semicolon and a line break are NOT sentence ends: "Do not\ntake two
 * tablets at once" and "Take one tablet; not with grapefruit" are one sentence each, so no part of them can be quoted
 * on its own.
 */
const CJK_TERMINAL = "。！？｡";
const LATIN_TERMINAL = ".!?．﹒﹖﹗…";
const TERMINAL = CJK_TERMINAL + LATIN_TERMINAL;
/** Closing quotes and brackets that stay with the sentence they close ('He said "stop."' is one piece). */
const CLOSERS = "\"'”’」』)）\\]»›";
const RUN_RE = new RegExp(`[${TERMINAL}]+[${CLOSERS}]*`, "gu");
const MARKS_RE = new RegExp(`^[${TERMINAL}]+`, "u");
/** The sentence-ending mark of a piece, also when a closing quote follows it (after quote unification). */
const TRAILING_TERMINAL_RE = new RegExp(`([${TERMINAL}]+)(["')\\]）»›]*)$`, "u");

/**
 * Words a full stop does not end a sentence after ("Mr. Tan", "approx. 2 hours", "Tab. Amlodipine", "Blk. 123").
 * Single letters ("a.m.", "e.g.", "vitamin A.") are handled apart. Merging two real sentences is safe (the quote must
 * then take both); cutting one sentence in two is not.
 */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "mdm", "dr", "prof", "st", "sr", "jr", "approx", "appt", "apt", "etc", "vs", "tab", "tabs", "cap", "caps",
  "inj", "sig", "hr", "hrs", "min", "mins", "max", "wk", "wks", "yr", "yrs", "mo", "fig", "dept", "blk", "ave", "rd", "no", "nos",
]);

/** Does the run of terminal marks at [s, e) end a sentence? (see TERMINAL above) */
function endsSentence(text: string, s: number, e: number): boolean {
  const marks = MARKS_RE.exec(text.slice(s, e))?.[0] ?? "";
  if ([...marks].some((ch) => CJK_TERMINAL.includes(ch))) return true;
  const after = text.slice(e);
  if (after.trim() === "") return true;
  if (!/^\s/u.test(after) && !/^\p{Script=Han}/u.test(after)) return false; // "0.5", "e.g.,", "Hello.World"
  const next = after.trimStart();
  // (case never decides a boundary: a quote in another case must split the same way; "approx. two hours" is the
  // abbreviation list's job, and "Do not! take two" splits but cannot be quoted from "take" on: DANGLING_END)
  if (/^[.．﹒]$/u.test(marks)) {
    const before = text.slice(0, s);
    // the whole word before the full stop, apostrophes included: "don't." ends a sentence, "a." does not (fix round 2:
    // the "t" of "Please don't. Change the dose yourself." was read as an initial, so that line was one "sentence")
    const word = (/[\p{L}'’ʼ]+$/u.exec(before)?.[0] ?? "").replace(/^['’ʼ]+/u, "");
    if (word && ABBREVIATIONS.has(word.toLowerCase())) return false;
    // initials and dotted abbreviations: "a.m. Take", "e.g. Take", "vitamin A. Then" (merged: fail closed)
    if ([...word].length === 1) return false;
    if (/\d$/u.test(before) && /^\d/u.test(next)) return false; // "2. 5 mg"
  }
  return true;
}

export interface SentenceSpan {
  /** offsets into the text as written (trimmed piece) */
  start: number;
  end: number;
  /** the piece as written, trimmed */
  text: string;
}

/** Sentence pieces with their positions in the text as written (no normalisation, so a match can be shown as written). */
export function sentenceSpans(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  const push = (from: number, to: number) => {
    const raw = text.slice(from, to);
    const piece = raw.trim();
    if (!piece) return;
    const start = from + (raw.length - raw.trimStart().length);
    out.push({ start, end: start + piece.length, text: piece });
  };
  let from = 0;
  for (const m of text.matchAll(RUN_RE)) {
    const s = m.index!;
    const e = s + m[0].length;
    if (!endsSentence(text, s, e)) continue;
    push(from, e);
    from = e;
  }
  push(from, text.length);
  return out;
}

/** The verbatim key of one piece: the words and inner punctuation, and the class of its sentence-ending mark. */
interface PieceKey {
  base: string;
  /** "?" or "!" when the piece ends with one, "." for a full stop or an ellipsis (any script), "" for no mark at all */
  mark: "" | "." | "?" | "!";
}

function pieceKey(piece: string): PieceKey {
  const s = piece
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛ʼ]/g, "'")
    .replace(/[“”„‟«»「」『』〝〞]/g, '"')
    .replace(/\s+/gu, "");
  const m = TRAILING_TERMINAL_RE.exec(s);
  if (!m) return { base: s, mark: "" };
  const mark = /[?？]/u.test(m[1]) ? "?" : /[!！]/u.test(m[1]) ? "!" : ".";
  return { base: s.slice(0, m.index) + m[2], mark };
}

/**
 * The verbatim key of ONE sentence piece: NFKC, lower case, quote style unified (‘ ’ ʼ -> ', “ ” „ « » 「 」 -> "),
 * whitespace removed, the piece's own sentence-ending mark dropped. Every other punctuation mark stays, and the
 * comparison is piece by piece, so a moved sentence boundary is a different quote: "Please don't. Change the dose
 * yourself ..." is not R4 ("Please don't change the dose yourself. If your readings ..."). The ending mark is
 * compared apart (sameMark): a full stop may be left out, a "?" or "!" may not become another mark.
 */
export function quoteKey(piece: string): string {
  return pieceKey(piece).base;
}

/**
 * The ending marks agree: the same class (full stop, "?", "!"), or one side has no mark at all (a quote may leave the
 * final mark out; the source's own text is what is shown). A "." never stands for a "?" or "!", nor the other way.
 */
const sameMark = (a: PieceKey["mark"], b: PieceKey["mark"]): boolean => a === b || a === "" || b === "";

const keysOf = (text: string): PieceKey[] => sentenceSpans(text).map((s) => pieceKey(s.text)).filter((k) => k.base);

const samePiece = (a: PieceKey, b: PieceKey): boolean => a.base === b.base && sameMark(a.mark, b.mark);

/** The same sentences, piece by piece (quoteKey): the verbatim test for whole texts (R1-R4, restatements, templates). */
export function sameQuote(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ka = keysOf(a);
  const kb = keysOf(b);
  return ka.length > 0 && ka.length === kb.length && ka.every((k, i) => samePiece(k, kb[i]));
}

/**
 * A sentence that cannot stand without the next one: it ends on a negation or a word that needs more ("Please
 * don't." "Do not." "……但是不要。"). A transcript can carry one (Whisper reads a pause as a full stop), and the
 * sentence after it then says the opposite of what was meant ("Please don't. Change the dose yourself."), so it is
 * never quoted without this one. Tested after the sentence-final particles are taken off (stripParticles: "Cannot
 * lah." "千万不要啊。" end on their negation; fix round 2).
 */
const DANGLING_END =
  /(?:\b(?:not|never|no|nor|nope|nah|don'?t|doesn'?t|didn'?t|won'?t|wouldn'?t|couldn'?t|can'?t|cannot|shouldn'?t|mustn'?t|isn'?t|aren'?t|needn'?t|dowan|dun|avoid|without|except|unless|only|and|or|but|to|the|a|an|of|with|than|before|after|if|when|until|jangan|usah|tidak|tak|bukan|kecuali|hanya|dan|atau|kalau|jika)|\b(?:tak|tidak|x)\s+(?:boleh|payah|perlu|usah)|不要|不用|不能|不可以|不行|不好|不必|不|别|別|没有|没|沒|无|無|勿|禁止|避免|除非|但是|但|如果|要是|假如|只有|只|唔好|唔得|唔使|唔可以|唔|冇|莫|毋通|毋好|毋|千万|千萬|和|或|跟|与|與|同|袂使得|袂使|袂|வேண்டாம்|கூடாது|முடியாது)$/iu;
/**
 * The negations of DANGLING_END (not the connectors): a sentence ending on one of these, followed by another sentence
 * of the same quote, makes the quote read the other way round ("Please don't. Change the dose yourself."; "……但是不要。
 * 一次吃两粒。"), so such a quote is never shown, not even whole (ambiguousBoundary; fix round 2). Fix round 3 adds the
 * endings the red team found missing: Singlish dowan / dun / "no need" / "not good" / "don't want", Malay tak boleh /
 * tak payah / tak perlu, Hokkien 袂使得, Tamil வேண்டாம் / கூடாது / முடியாது (after the particles are taken off: 不可以的, 不要了,
 * 唔得㗎, "Cannot liao", "Tak boleh punya").
 */
const NEGATION_END =
  /(?:\b(?:not|never|no|nope|nah|don'?t|doesn'?t|didn'?t|won'?t|wouldn'?t|couldn'?t|can'?t|cannot|shouldn'?t|mustn'?t|needn'?t|dowan|dun|jangan|usah|tidak|tak|bukan)|\b(?:no need|not good|no good|not ok|not okay|don'?t want|dun want|do not want|better not|rather not)|\b(?:tak|tidak|x)\s+(?:boleh|payah|perlu|usah)|不要|不用|不能|不可以|不行|不好|不必|不|别|別|勿|禁止|唔好|唔得|唔使|唔可以|唔|毋通|毋好|毋|莫|袂使得|袂使|袂|வேண்டாம்|கூடாது|முடியாது)$/iu;
/**
 * A sentence ending on a negated verb with no object (fix round 3, the red team's V3: Whisper broke a pause after the
 * verb): "Do not take." "Don't stop." "Never take." "You must not take." "Stop taking." 「不要吃。」「不要一次吃。」「别停。」「唔好食。」
 * "Jangan makan." The next sentence may be its object ("Two tablets at once." "Taking it is not needed …"), so it never
 * stands alone, and a spoken line with this boundary inside is never shown, not even whole (ambiguousBoundary).
 */
const NEG_EN = String.raw`(?:not|never|don'?t|dont|do not|doesn'?t|does not|didn'?t|did not|won'?t|will not|can'?t|cannot|can not|shouldn'?t|should not|mustn'?t|must not|needn'?t|no need to|better not|stop|quit|avoid)`;
const MED_VERB_EN = String.raw`(?:take|taking|took|eat|eating|swallow|swallowing|use|using|stop|stopping|skip|skipping|change|changing|double|doubling|increase|increasing|reduce|reducing|cut|cutting|halve|halving|add|adding|mix|mixing|combine|combining|drink|drinking|give|giving|have|having|chew|chewing|crush|crushing|split|splitting|miss|missing|continue|continuing|start|starting)`;
const NEGATED_VERB_END = new RegExp(
  String.raw`(?:\b${NEG_EN}\s+(?:(?:just|ever|even|really|please|you|to|again|yourself)\s+)*${MED_VERB_EN}|(?:不要|不用|不能|不可以|不可|不准|不许|不許|不得|别|別|勿|莫|甭|唔好|唔可以|唔使|唔准|毋通|毋好|袂使|千万别|千萬別|千万不要|千萬不要|不)(?:再|自己|随便|隨便|乱|亂|一次|同时|同時|一起|一齊|多|就)?(?:吃|服|用|停|换|換|改|加|减|減|吞|食|喝|拿|吃药|吃藥|服药|服藥|食藥|食药)|\b(?:jangan|tak|tidak|x|usah|tak boleh|tidak boleh|berhenti)\s+(?:makan|ambil|minum|telan|guna|berhenti|tukar|tambah|kurangkan|ubah))$`,
  "iu",
);
/**
 * Inside one sentence, a mark that may be a lost full stop right after a negation, then an instruction (fix round 3, the
 * red team's V4: "Please don't; change the dose yourself.", "Please don't.Change …", "Please don't...change …", "Please
 * don't, change …", "Please don't - change …", "Please don't: change …", 「不要，一次吃两粒。」): read with that mark as a
 * full stop it says the opposite, so a spoken line with it is never shown (ambiguousBoundary). Only an instruction after
 * it counts ("If you don't, call me." is not one).
 */
const INNER_BOUNDARY_EN =
  /\b(?:not|never|no|nope|nah|don'?t|dont|doesn'?t|didn'?t|won'?t|wouldn'?t|can'?t|cannot|shouldn'?t|mustn'?t|needn'?t|dowan|dun|jangan|usah|tidak|tak|bukan)(?:\s*(?:lah|leh|lor|ah|liao|please|ok|okay))*\s*(?:[;:,–—-]+|\.{2,}|…+|[.!?](?=\S))\s*(?:(?:please|just|you|then)\s+)?(?:take|change|stop|skip|double|eat|swallow|use|increase|reduce|cut|halve|add|mix|combine|have|give|chew|crush|split|miss|continue|start|drink|makan|ambil|minum|telan|tukar|tambah|kurangkan|berhenti|two|three|more|another|extra|both|\d)\b/iu;
const INNER_BOUNDARY_ZH =
  /(?:不要|不用|不能|不可以|不行|不好|别|別|勿|唔好|唔得|唔可以|唔使|毋通|袂使|千万不要|千萬不要)(?:[啊呀哦喔啦嘛吧呢咯囉啰喇嘞咧哟呦哈嘅喎噃咩矣唷呵㗎的了])*\s*[，,、；;：:—…\-]+\s*(?:一次|一齐|一齊|一起|同时|同時|再|多|自己|两|兩|二|三|吃|服|食|换|換|改|加|减|減|停|吞|喝)/u;
/**
 * A sentence that qualifies the one before it ("Take TWO tablets. Only if needed." "Take one. Not at night."): the
 * one before is never quoted without it.
 */
const QUALIFIER_START =
  /^(?:(?:only|not|unless|except|but|or|otherwise|if needed|when needed|as needed|as required|no more than|not more than|never more than|do not exceed|don'?t exceed|never exceed|not to exceed|maximum|max|at most|up to|kecuali|tetapi|tapi|hanya|atau|jangan melebihi|tidak melebihi|maksimum)\b|除非|但是|但|不过|不過|只有|只能|只|或者|否则|否則|如有需要|需要时|需要時|必要时|必要時|不要超过|不要超過|不可超过|不可超過|不超过|不超過|最多|每天最多|一天最多)/iu;

/**
 * Sentence-final particles of Singlish, Malay, Mandarin, Cantonese and Hokkien ("Cannot lah." "Don't ah." "不要哦。"
 * "唔好呀。"): they carry tone, not meaning, so a negation before them still ends the sentence. ("one" is not here: it is
 * also a number.)
 */
// (fix round 3: liao and punya, Singlish and Malay tone words, and 㗎 / 的 / 了 / 噶 / 架 after a refusal: 「唔得㗎」「不可以的」
// 「不要了」 "Cannot liao" "Tak boleh punya")
const PARTICLE_EN = /[\s,，]+(?:lah|la|leh|lor|loh|ah|ar|hor|meh|mah|wor|sia|ya|yah|ok|okay|eh|uh|hah|ha|oh|ah|tau|kan|liao|punya)$/iu;
const PARTICLE_ZH = /[啊呀哦喔噢啦嘛吧呢咯囉啰喇嘞咧哟呦哈嘅喎噃咩矣唷呵㗎的了噶架]+$/u;
/** Singlish "one" after a refusal is a tone word ("Cannot one."); elsewhere it is a number, so only there. */
const NEGATION_ONE = /\b(cannot|can'?t|can not|don'?t|dont|won'?t|not|no|never|dowan|dun)\s+one$/iu;

const stripEnd = (piece: string): string => piece.replace(new RegExp(`[${TERMINAL}${CLOSERS}\\s]+$`, "u"), "");
const stripStart = (piece: string): string => piece.replace(new RegExp(`^[${CLOSERS}"'“‘「『\\s]+`, "u"), "");

/** A piece without its final marks and sentence-final particles ("Cannot lah." -> "Cannot"; "千万不要啊。" -> "千万不要"). */
export function stripParticles(piece: string): string {
  let s = stripEnd(piece.replace(/[‘’ʼ]/g, "'"));
  for (;;) {
    const next = stripEnd(s.replace(PARTICLE_EN, "").replace(PARTICLE_ZH, "").replace(NEGATION_ONE, "$1")).replace(/[\s,，、]+$/u, "");
    if (next === s) return s;
    s = next;
  }
}

/** Words a bare refusal is made of besides its negation ("Please do not, ever." "No no no, don't." "I wouldn't."). */
const BARE_FILLER = new Set([
  "please", "pls", "i", "you", "we", "really", "absolutely", "definitely", "certainly", "ever", "better", "sorry", "oh", "uh",
  "um", "doctor", "doc", "uncle", "auntie", "aunty", "mr", "mrs", "madam", "mdm", "sir", "tan", "boleh", "so", "just", "then",
  "it", "that", "this", "really", "still", "at", "all", "need", "way", "okay", "ok", "do", "dont", "can", "must", "should",
  "will", "would", "encik", "pakcik", "makcik", "saya", "awak", "nanti", "lagi", "sekali", "pun",
  // fix round 3 (the red team's V2: "Don't want." "Not good." "Jangan sekali-kali." "Tak boleh punya." "Don't do that.")
  "want", "good", "allowed", "advisable", "recommended", "kali", "pernah", "payah", "perlu", "like",
]);
const BARE_NEGATION_WORD = /^(?:no|not|never|nope|nah|don'?t|doesn'?t|won'?t|wouldn'?t|can'?t|cannot|shouldn'?t|mustn'?t|needn'?t|jangan|tak|tidak|usah|x|dowan|dun|stop)$/i;
/** A Mandarin, Cantonese or Hokkien refusal standing alone: 不行。 不要哦。 千万不要啊。 唔好呀。 毋通。 (fix round 3: 袂使得, 不准, 不要这样) */
const BARE_NEGATION_ZH =
  /^(?:千万|千萬|绝对|絕對|真的|一定|你|请|請|对|對|哎|唉|医生说|醫生說)*(?:不要|不行|不可以|不能|不好|不用|不必|别|別|唔好|唔得|唔可以|唔使|唔准|毋通|毋好|毋免|毋使|袂使得|袂使|袂用得|莫|勿|甭|冇得|不可|不准|不许|不許)+(?:这样|這樣|那样|那樣|咁|噉|这么做|這麼做)?$/u;
/** A Tamil refusal standing alone (Tamil Lexicon: வேண்டாம் "not wanted", கூடாது "must not", முடியாது "cannot"). */
const BARE_NEGATION_TA = /^(?:வேண்டாம்|கூடாது|முடியாது|இல்லை|வேண்டா)$/u;

/**
 * A sentence that is only a refusal ("Please don't." "Cannot lah." "Nope." "Please do not, ever." "Tak boleh." "不行。"
 * "千万不要啊。"): whatever follows it in a transcript is what he must NOT do, so the next sentence is never quoted without
 * it, and a quote holding it before another sentence is never shown (fix round 2, the red team's P2 list).
 */
export function isBareNegation(piece: string): boolean {
  const s = stripParticles(piece);
  if (!s) return false;
  if (hasHan(s)) return BARE_NEGATION_ZH.test(s.replace(/[\s\p{P}]/gu, ""));
  if (/\p{Script=Tamil}/u.test(s)) return BARE_NEGATION_TA.test(s.replace(/[\s\p{P}]/gu, ""));
  const words = s.toLowerCase().replace(/[’ʼ]/g, "'").split(/[^\p{L}']+/u).filter(Boolean);
  return words.length > 0 && words.some((w) => BARE_NEGATION_WORD.test(w)) && words.every((w) => BARE_NEGATION_WORD.test(w) || BARE_FILLER.has(w));
}

/**
 * Words that open a condition or a time limit (English, Malay; "once" is not one: "Once a day."). Fix round 3: assuming,
 * supposing, "should it go above", "in the event", and Malay itupun kalau.
 */
const CONDITION_START_EN =
  /^(?:if|when|whenever|unless|until|till|in case|as long as|so long as|provided|providing|only if|only when|except|before|after|while|assuming|supposing|in the event|on condition|should (?:it|the|your|you|he|she|that)|were (?:it|the)|had (?:it|the)|kalau|jika|sekiranya|apabila|bila|asalkan|selagi|sebelum|selepas|lepas|itupun kalau|itu pun kalau)\b/iu;
const CONDITION_START_ZH = /^(?:如果|要是|假如|假使|万一|萬一|只要|除非|一旦|等到|当|當|若是|若)/u;
const CONDITION_END_ZH = /(?:的话|的話|的时候|的時候|时候|時候|时|時|之前|以前|之后|之後|以后|以後|后|後|才(?:吃|食|服|用|可以|能|行|好))$/u;
/** Words before a condition that do not give it a clause of its own ("Ah, if above 180." "And only if needed." 「嗯，如果……」). */
const LEADING_FILLER =
  /^(?:(?:ah+|um+|uh+|er+m?|oh|eh|well|and|then|but|so|also|just|that is|i mean|嗯|啊|呃|哦|那|就是|然后|然後|itupun|itu pun|tapi|dan)(?:[\s,，、]+|$))+/iu;

/**
 * A sentence that is only a condition, with no clause of its own ("If it is above 180." "When pain is severe." "In
 * case of a very high reading." "如果血压高过一百八。" "血压很高的时候。" "Kalau tekanan darah tinggi sangat."): it limits the
 * sentence next to it, so that sentence is never quoted without it (fix round 2). A condition followed by a comma
 * has its own clause ("If your readings are high, write them down ...") and does not count. Fix round 3: filler words
 * before it do not give it a clause ("Ah, if above 180." "That is, if it is above 180." "Just when it's above 180."), and
 * 「高过一百八才吃。」 (only then) is one.
 */
export function isBareCondition(piece: string): boolean {
  const s = stripParticles(stripStart(piece)).replace(LEADING_FILLER, "");
  if (!s || /[,，、;；:：]/u.test(s)) return false;
  if (hasHan(s)) return CONDITION_START_ZH.test(s) || CONDITION_END_ZH.test(s);
  return CONDITION_START_EN.test(s);
}

/**
 * A sentence that takes back or corrects the one before it (fix round 3, the red team's V1: "Take two tablets. No, one."
 * "… Sorry, I mean one tablet." "… That is wrong." 「早上吃两粒。不对，一粒。」「食两粒。唔係，一粒。」 "… Eh salah, satu biji."): the one
 * before is never quoted without it.
 */
const RETRACTION_START =
  /^(?:(?:no|nope|nah)(?=\s*(?:[,.!;:]|$)|\s+no\b)|(?:sorry|actually|i mean|wait|oops|correction|scratch that|my mistake|wrong|that'?s wrong|that is wrong|that'?s not right|that is not right|eh salah|salah|silap|bukan)\b|不对|不對|不是|说错|說錯|我说错|我說錯|错了|錯了|唔係|唔系|唔啱|唔對|唔对|讲错|講錯|தவறு|இல்லை)/iu;
/** A sentence that ends on a limit ("Above 180 only." "Once a WEEK only."). */
const ONLY_END = /\bonly$/iu;
/**
 * A short sentence that starts with a negation ("Never at once." "Do not take more." 「不要一次吃。」「别一起吃。」「唔好一齐食。」
 * "Jangan sekali gus.") or with how often or when ("Twice daily." "Every 6 hours." "With food." "On Mondays."): right after a
 * dose it limits it. Short only (at most four words or ten characters), so the doctor's next full instruction ("Please
 * don't change the dose yourself.") is not read as one (fix round 3).
 */
const NEGATION_START =
  /^(?:(?:please\s+)?(?:no|not|never|don'?t|dont|do not|doesn'?t|cannot|can'?t|won'?t|must not|mustn'?t|should not|shouldn'?t|avoid|jangan|tak boleh|tidak boleh)\b|不要|别|別|不能|不可以|不准|唔好|唔可以|唔准|毋通|袂使|莫|勿|வேண்டாம்|கூடாது)/iu;
const TIMING_START =
  /^(?:(?:once|twice|thrice|\d+\s*times|every|each|daily|weekly|monthly|with|without|after|before|on|at|in the|morning|mornings|night|nights|evening|bedtime|maximum|max|not more|no more|sekali|dua kali|setiap|selepas|sebelum)\b|每天|每日|每周|每週|每晚|一天|一日|饭后|饭前|飯後|飯前|早上|晚上|睡前|最多|只能)/iu;
const isShort = (piece: string): boolean => {
  const s = stripParticles(piece);
  return hasHan(s) ? [...s.replace(/[\s\p{P}]/gu, "")].length <= 10 : s.split(/\s+/u).filter(Boolean).length <= 4;
};

/** The sentence before a quote leaves it hanging: a dangling end, a negated verb with no object, a bare refusal or condition. */
function leavesHanging(piece: string): boolean {
  const s = stripParticles(piece);
  return DANGLING_END.test(s) || NEGATED_VERB_END.test(s) || isBareNegation(piece) || isBareCondition(piece);
}

/**
 * The sentence after a quote limits it: a qualifier, a bare condition, a bare refusal, a correction, a final "only", or a
 * short negation or timing sentence (NEGATION_START, TIMING_START).
 */
function limitsPrevious(piece: string): boolean {
  const raw = stripStart(piece);
  const start = raw.replace(LEADING_FILLER, "").replace(/^[嗯啊呃哦唉哎]+/u, "");
  // (QUALIFIER_START on the sentence as written too: "But take it after food." starts with a qualifier, "but")
  if (QUALIFIER_START.test(raw) || QUALIFIER_START.test(start) || isBareCondition(piece) || isBareNegation(piece) || RETRACTION_START.test(start) || ONLY_END.test(stripParticles(piece))) return true;
  return isShort(piece) && (NEGATION_START.test(start) || TIMING_START.test(start));
}

/**
 * A spoken line's neighbours in the transcript (fix round 3): a line is shown whole (verify.ts sourceQuote), but Whisper
 * can also break "Please don't. | Change the dose yourself." or "Take two tablets. | No, one." across two lines of the
 * same speaker. True when the line before (`before`, its last sentence) leaves this one hanging.
 */
export function contextHangs(before: string): boolean {
  const pieces = sentenceSpans(before).filter((s) => quoteKey(s.text));
  return pieces.length > 0 && leavesHanging(pieces[pieces.length - 1].text);
}

/** True when the line after (`after`, its first sentence) limits, takes back or corrects this one (see contextHangs). */
export function contextLimits(after: string): boolean {
  const pieces = sentenceSpans(after).filter((s) => quoteKey(s.text));
  return pieces.length > 0 && limitsPrevious(pieces[0].text);
}

/** May sentences [i, j) of `spans` be quoted without their neighbours? (leavesHanging, limitsPrevious) */
function standsAlone(spans: SentenceSpan[], i: number, j: number): boolean {
  if (i > 0 && leavesHanging(spans[i - 1].text)) return false;
  if (j < spans.length && limitsPrevious(spans[j].text)) return false;
  return true;
}

/**
 * A text whose sentence boundary turns a refusal round: a sentence that ends on a negation or is only a refusal,
 * followed by another sentence ("Please don't. Change the dose yourself. ..." "Cannot lah. Take two at once."
 * "……但是不要。一次吃两粒。"). Even word for word, as a whole, it reads as the opposite of what was said, so it is never
 * shown as anyone's words (fix round 2: a confirmed transcript line with a moved full stop was relayed in full).
 */
export function ambiguousBoundary(text: string, opts: { printed?: boolean } = {}): boolean {
  const pieces = sentenceSpans(text).filter((s) => quoteKey(s.text));
  for (let k = 0; k + 1 < pieces.length; k++) {
    const s = stripParticles(pieces[k].text);
    if (isBareNegation(pieces[k].text) || NEGATION_END.test(s)) return true;
    // fix round 3 (V3): a negated verb with no object ("Do not take. Two tablets at once."). Not for printed text (a
    // label): its full stops are printed, not a pause Whisper read as one ("Do not crush. Swallow whole.")
    if (!opts.printed && NEGATED_VERB_END.test(s)) return true;
  }
  // fix round 3 (V4): a mark inside a sentence that may be a lost full stop, right after a negation
  const t = text.replace(/[‘’ʼ]/g, "'");
  return INNER_BOUNDARY_EN.test(t) || INNER_BOUNDARY_ZH.test(t);
}

/**
 * True when `part` is one or more whole, consecutive sentences of `whole`, piece by piece (quoteKey and the ending mark),
 * with no other test (fix round 3): verify.ts then shows the WHOLE spoken line or label, never the part, so a sentence
 * after "Please don't." or before "No, one." can never be shown without them (matchWholeSentences below decides for the
 * sources that are quoted sentence by sentence).
 */
export function sentenceRunOf(whole: string, part: string): boolean {
  const want = keysOf(part);
  if (want.length === 0) return false;
  const spans = keysOf(whole);
  for (let i = 0; i + want.length <= spans.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length && ok; j++) ok = samePiece(spans[i + j], want[j]);
    if (ok) return true;
  }
  return false;
}

/**
 * When `part` is one or more whole, consecutive sentences of `whole` (piece by piece, quoteKey), those sentences as
 * written in `whole`; otherwise null. A fragment cut out of a sentence is not: "your readings are high" is inside R4
 * but is not a sentence of it, so it cannot pass as the doctor's words. Neither is a quote whose sentence boundary
 * moved ("Please don't. Change the dose yourself if ..."): punctuation inside a sentence and the boundaries count.
 * Nor are sentences that do not stand alone in the source: after a sentence that ends on a negation ("Please don't."
 * "……但是不要。", a bare refusal "Cannot lah." or a bare condition "If it is above 180.") or before one that qualifies
 * them ("Only if needed." "When pain is severe."). Nor a quote whose own sentence boundary turns a refusal round
 * (ambiguousBoundary: "Please don't. Change the dose yourself."), not even the whole text. The caller shows the
 * returned text, never `part`, so what the patient reads is always the source's own words.
 */
export function matchWholeSentences(whole: string, part: string): string | null {
  const want = keysOf(part);
  if (want.length === 0) return null;
  const all = sentenceSpans(whole);
  const spans = all.map((s) => ({ ...s, key: pieceKey(s.text) })).filter((s) => s.key.base);
  for (let i = 0; i + want.length <= spans.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length && ok; j++) ok = samePiece(spans[i + j].key, want[j]);
    if (!ok) continue;
    // the neighbours are judged in the source as written (all pieces, also one that is only a mark)
    const first = all.findIndex((s) => s.start === spans[i].start);
    const last = all.findIndex((s) => s.start === spans[i + want.length - 1].start);
    if (!standsAlone(all, first, last + 1)) continue;
    const quoted = whole.slice(spans[i].start, spans[i + want.length - 1].end);
    if (ambiguousBoundary(quoted)) continue;
    return quoted;
  }
  return null;
}

/** True when `part` is one or more whole, consecutive sentences of `whole` (see matchWholeSentences). */
export function isWholeSentencesOf(whole: string, part: string): boolean {
  return matchWholeSentences(whole, part) !== null;
}

/** Runs of digits that may contain spaces or dashes inside ("9151 1767", "1800-3535-800"), digits only. */
export function digitRuns(text: string): string[] {
  return [...text.normalize("NFKC").matchAll(/\d(?:[\d\s\-–]*\d)?/g)].map((m) => m[0].replace(/\D/g, ""));
}

export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
