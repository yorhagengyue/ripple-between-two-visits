// A test card for overlay2.js (not part of the film).
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { image } from "../media.js";
import { caption, stamp, expCard, statCard, featureLabel, urlCard } from "../overlay2.js";
shot("overlay2 test", 0, 3, ({ lt, ov, wait }) => {
  STAGE.lights("lab");
  let qr; wait(image("assets/qr.png").then((i) => (qr = i)));
  ov.push((c) => caption(c, "40 to 80% of what doctors say is forgotten right away.", 80, 80, 1, { source: "Kessels, J R Soc Med 2003" }));
  ov.push((c) => stamp(c, "STRICTLY BOUNDED", 1450, 260, 1));
  ov.push((c) => expCard(c, "01", "Can I take one more?", 1));
  ov.push((c) => statCard(c, "51 / 51", "questions passed", "frozen set of 51 questions, live model, 10 Oct; our own questions", 420, 520, 1));
  ov.push((c) => featureLabel(c, "MEDICATION UNDERSTANDING", "Scan a box: how to take it, what it is for, and the doctor's own words.", 900, 430, 1));
  ov.push((c) => urlCard(c, "app.ripple-health-ai.com", qr, 1200, 820, 1));
});
