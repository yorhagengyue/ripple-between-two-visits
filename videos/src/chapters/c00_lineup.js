// A model sheet of the cast, used to check the look. Not part of the film.
import * as THREE from "three";
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { toon } from "../look.js";
import { makeTanBot, makeLimBot, makeWeiBot } from "../bots.js";
import { kf, wob, seg, pop } from "../core.js";
import { timeCard, sfx, bubble, title } from "../overlay.js";

const room = new THREE.Group();
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), toon("#f2b98a")); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; room.add(floor);
const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), toon("#7b6bd8")); wall.position.set(0, 3, -2.5); wall.receiveShadow = true; room.add(wall);
STAGE.set("lineup", room);
STAGE.actor("tan", makeTanBot());
STAGE.actor("lim", makeLimBot());
STAGE.actor("wei", makeWeiBot());

shot("lineup", 0, 6, ({ t, lt, ov }) => {
  STAGE.show("lineup");
  STAGE.lights("warm");
  const cx = kf(lt, [[0, -0.4], [6, 0.4]]);
  STAGE.cam([cx, 1.25, 4.2], [0, 0.75, 0], 34);
  STAGE.pose("tan", { x: -1.05, rotY: 0.25, face: lt > 2 && lt < 2.15 ? "blink" : "code", wave: lt > 1 ? lt : null, headYaw: 0.1 });
  STAGE.pose("wei", { x: 0, rotY: 0, face: "happy", dy: Math.abs(wob(lt, 1.2)) * 0.08, armL: 0.4 });
  STAGE.pose("lim", { x: 1.1, rotY: -0.25, face: lt > 3 ? "wow" : "code", tilt: wob(lt, 0.5) * 0.08 });
  ov.push((c) => timeCard(c, "10:30 AM", "Dr Lim · follow-up", seg(lt, 0.3, 0.8)));
  ov.push((c) => sfx(c, "BEEP! BEEP!", 420, 260, 96, lt - 0.6));
  ov.push((c) => bubble(c, ["Good morning, Mr Tan!", "早上好"], 1450, 260, 1300, 420, seg(lt, 1.6, 1.9)));
  ov.push((c) => title(c, "A day in the life of", "MR TAN", 960, 160, seg(lt, 3.2, 3.7), { size: 150 }));
});
