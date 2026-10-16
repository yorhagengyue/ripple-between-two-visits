/**
 * Passwords too common to accept (docs/plan/real-app.md 3.4: no composition rules, a list instead). Lower case, 8
 * characters or more (shorter ones are refused for their length anyway): the usual English lists' head, keyboard walks,
 * repeated digits, and the ones people in Singapore and China pick (pinyin, 520 / 1314, lucky 8s, the app's own name).
 * Client-safe: the sign-up page checks before sending, the server checks again.
 */
export const COMMON_PASSWORDS: readonly string[] = [
  // digits
  "12345678", "123456789", "1234567890", "0123456789", "87654321", "987654321", "9876543210", "12341234", "11223344",
  "112233445566", "123123123", "12312312", "123456123456", "147258369", "159357456", "741852963", "135792468",
  "11111111", "22222222", "33333333", "44444444", "55555555", "66666666", "77777777", "88888888", "99999999",
  "00000000", "111111111", "1111111111", "888888888", "8888888888", "666666666", "5201314520", "52013145201314",
  "1314520520", "13145201314", "520520520", "12345679", "123654789", "12348765", "19491001", "20082008", "20262026",
  "19900101", "19800101", "20000101", "12121212", "13131313", "16888888", "18888888", "68686868", "86868686",
  // words
  "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "p@ssword", "pa55word", "iloveyou",
  "iloveyou1", "sunshine", "princess", "football", "baseball", "basketball", "superman", "batman123", "starwars",
  "whatever", "trustno1", "welcome1", "welcome123", "letmein1", "letmein123", "admin123", "administrator",
  "changeme", "changeme1", "qwertyui", "qwertyuiop", "qwerty123", "qwerty12", "asdfghjk", "asdfghjkl", "zxcvbnm1",
  "zxcvbnm123", "1qaz2wsx", "1qazxsw2", "zaq12wsx", "qazwsxedc", "q1w2e3r4", "q1w2e3r4t5", "1q2w3e4r", "1q2w3e4r5t",
  "qwer1234", "1234qwer", "asdf1234", "abcd1234", "abc12345", "abc123456", "a1234567", "a12345678", "aa123456",
  "aa12345678", "a1b2c3d4", "abcdefgh", "abcdefg1", "monkey123", "dragon123", "master123", "shadow123", "michael1",
  "jennifer", "computer", "internet", "samsung1", "iphone123", "google123", "facebook", "whatsapp", "telegram",
  "dontknow", "nopassword", "secret123", "hello123", "helloworld", "goodluck", "freedom1", "liverpool", "chelsea1",
  "manchester", "arsenal1", "pokemon1", "minecraft", "fortnite",
  // pinyin and local favourites
  "woaini1314", "woaini520", "woaini123", "woaiwojia", "iloveyou520", "wangyang", "zhangwei", "wangwei", "liuyang",
  "zhanglei", "lilei123", "hanmeimei", "aini1314", "1314aini", "qq123456", "qq12345678", "wechat123", "taobao123",
  "huawei123", "xiaomi123", "baidu123", "nihao123", "nihaonihao", "jiayou123", "zhongguo", "beijing2008",
  "shanghai", "singapore", "singapore1", "singapore123", "merlion1", "sengkang", "tampines", "jurongwest",
  "uncle123", "auntie123", "ahgong123", "ahma1234", "laoban123",
  // the app and this project
  "ripple123", "ripple2026", "ripple1234", "rippleapp", "healthier", "healthy1", "healthy123", "medicine",
  "doctor123", "clinic123", "mrtan123", "chentan1", "weiling1",
];

const SET = new Set(COMMON_PASSWORDS);

/** Is this password (any case) on the list, one character repeated, or a straight run of digits or letters? */
export function isCommonPassword(password: string): boolean {
  const p = password.normalize("NFKC").toLowerCase();
  if (SET.has(p)) return true;
  if (/^(.)\1+$/u.test(p)) return true;
  if (/^(..)\1+$/u.test(p) || /^(...)\1+$/u.test(p)) return true; // abababab, abcabcabc
  const codes = [...p].map((c) => c.codePointAt(0)!);
  const step = codes[1] - codes[0];
  if ((step === 1 || step === -1) && codes.every((c, i) => i === 0 || c - codes[i - 1] === step)) return true;
  return false;
}
