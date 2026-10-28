// 3D teddy bear buddy with glasses. Reads its mood from the classes on #buddy (set by setMood in index.html),
// and falls back to the flat avatar image if WebGL or the three.js CDN isn't available.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const wrap = document.getElementById("avatarWrap");
const buddyEl = document.getElementById("buddy");
const MOODS = ["waiting", "content", "happy", "love", "poke"];

function webglOK() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch (e) {
    return false;
  }
}

// Damped spring: overshoots a little and settles, which is what makes the motion feel squishy.
class Spring {
  constructor(x, stiffness = 170, damping = 9) { this.x = x; this.v = 0; this.k = stiffness; this.d = damping; }
  step(target, dt) {
    for (let i = 0; i < 2; i++) {
      const h = dt / 2;
      this.v += ((target - this.x) * this.k - this.v * this.d) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

// ---------- puffy heart geometry, for the little hearts that float around ----------
const heartShape = new THREE.Shape();
heartShape.moveTo(0, -1.0);
heartShape.bezierCurveTo(-0.3, -0.7, -1.2, -0.2, -1.2, 0.4);
heartShape.bezierCurveTo(-1.2, 1.0, -0.5, 1.2, 0, 0.75);
heartShape.bezierCurveTo(0.5, 1.2, 1.2, 1.0, 1.2, 0.4);
heartShape.bezierCurveTo(1.2, -0.2, 0.3, -0.7, 0, -1.0);

function heartGeometry(segments = 32) {
  // push a sphere out to the heart outline (polar radius table) so it comes out round and pillowy
  const BINS = 360;
  const table = new Float32Array(BINS);
  for (const p of heartShape.getSpacedPoints(2000)) {
    const i = Math.floor(((Math.atan2(p.x, p.y) + Math.PI) / (Math.PI * 2)) * BINS) % BINS;
    table[i] = Math.max(table[i], Math.hypot(p.x, p.y));
  }
  for (let i = 0; i < BINS; i++) if (!table[i]) table[i] = table[(i + BINS - 1) % BINS];
  const geo = new THREE.SphereGeometry(1, segments, segments * 0.75);
  geo.rotateX(Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = table[Math.floor(((Math.atan2(x, y) + Math.PI) / (Math.PI * 2)) * BINS) % BINS];
    pos.setXYZ(i, x * r, y * r, z * 0.8);
  }
  geo.computeVertexNormals();
  return geo;
}

function start() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  wrap.appendChild(renderer.domElement);
  wrap.classList.add("is-3d");

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0.5, 7.2);
  camera.lookAt(0, 0.1, 0);

  scene.add(new THREE.HemisphereLight(0xfff8f0, 0xf3d6c0, 1.1));
  const key = new THREE.DirectionalLight(0xfff1e6, 2.0);
  key.position.set(2.5, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffd9c2, 1.6);
  rim.position.set(-3, 2.5, -4);
  scene.add(rim);

  // ---------- materials: sheen gives the fur a soft, fuzzy edge ----------
  const FUR = new THREE.Color(0x87502d);
  const FUR_SAD = new THREE.Color(0x7d6658);
  const fur = new THREE.MeshPhysicalMaterial({
    color: FUR.clone(), roughness: 0.8, sheen: 0.7, sheenColor: new THREE.Color(0xd9a074), sheenRoughness: 0.55,
  });
  const cream = new THREE.MeshPhysicalMaterial({
    color: 0xeec79a, roughness: 0.75, sheen: 0.8, sheenColor: new THREE.Color(0xfff0dc), sheenRoughness: 0.5,
  });
  const dark = new THREE.MeshPhysicalMaterial({ color: 0x24130d, roughness: 0.2, clearcoat: 1 });
  const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const frame = new THREE.MeshPhysicalMaterial({ color: 0x161111, roughness: 0.25, clearcoat: 1 });
  const lens = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0, depthWrite: false });
  const tongueMat = new THREE.MeshStandardMaterial({ color: 0xff8fa3, roughness: 0.45 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x5e1a1a, roughness: 0.6, side: THREE.DoubleSide });

  function softDot(rgba) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, rgba);
    grad.addColorStop(1, rgba.replace(/[\d.]+\)$/, "0)"));
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  const blushMat = new THREE.MeshBasicMaterial({ map: softDot("rgba(255,120,150,1)"), transparent: true, depthWrite: false });

  const ball = (r, mat, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), mat);
    m.scale.set(sx, sy, sz);
    return m;
  };

  // squash pivots at the feet; rig sits on top of it
  const GROUND = -1.5;
  const root = new THREE.Group();
  const squash = new THREE.Group();
  squash.position.y = GROUND;
  const rig = new THREE.Group();
  rig.position.y = -GROUND;
  root.add(squash);
  squash.add(rig);
  scene.add(root);

  // ---------- body: round little belly ----------
  const body = ball(0.62, fur, 1, 0.95, 0.9);
  body.position.y = -0.8;
  const belly = ball(0.42, cream, 1, 1.05, 0.35);
  belly.position.set(0, -0.86, 0.43);
  const tail = ball(0.14, fur);
  tail.position.set(0, -1.0, -0.56);
  rig.add(body, belly, tail);

  // ---------- head: big and round (chibi proportions); pivots at the neck so it can tilt ----------
  const HEAD_R = 0.95;
  const neck = new THREE.Group();
  neck.position.y = -0.45;
  const head = new THREE.Group();
  head.position.y = 0.8; // head centre ends up at y = 0.35
  neck.add(head);
  rig.add(neck);
  head.add(ball(HEAD_R, fur, 1.04, 0.96, 0.96));

  // places a part on the head's front surface, facing outward
  const Z = new THREE.Vector3(0, 0, 1);
  function onHead(obj, x, y, lift = 0) {
    const z = Math.sqrt(Math.max(0, HEAD_R * HEAD_R - x * x - y * y)) * 0.96;
    const n = new THREE.Vector3(x, y, z).normalize();
    obj.position.set(x, y, z).addScaledVector(n, lift);
    obj.quaternion.setFromUnitVectors(Z, n);
    head.add(obj);
    return obj;
  }

  // ears
  function makeEar(side) {
    const pivot = new THREE.Group();
    // pivot sits at the base of the ear so rotating it flops the ear
    pivot.position.set(side * 0.5, 0.5, -0.05);
    const ear = ball(0.3, fur, 1, 1, 0.7);
    ear.position.y = 0.2;
    const inner = ball(0.17, cream, 1, 1, 0.4);
    inner.position.set(0, 0.2, 0.17);
    pivot.add(ear, inner);
    pivot.rotation.z = -side * 0.35;
    head.add(pivot);
    return pivot;
  }
  const earL = makeEar(-1);
  const earR = makeEar(1);

  // muzzle, nose, mouth
  const muzzle = onHead(ball(0.34, cream, 1.18, 0.86, 0.55), 0, -0.12, -0.05);
  const nose = onHead(ball(0.1, dark, 1.35, 0.95, 0.8), 0, 0.0, 0.15);
  const noseShine = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), shineMat);
  noseShine.position.set(0.035, 0.04, 0.08);
  nose.add(noseShine);

  const mouth = onHead(new THREE.Group(), 0, -0.19, 0.13);
  const open = new THREE.Group();
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.11, 32, Math.PI, Math.PI), mouthMat);
  const tongue = ball(0.06, tongueMat, 1, 0.85, 0.45);
  tongue.position.set(0.02, -0.075, 0.02);
  open.add(hole, tongue);
  const smile = new THREE.Group(); // a little "ω"
  for (const x of [-0.055, 0.055]) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 8, 20, Math.PI), dark);
    arc.rotation.z = Math.PI;
    arc.position.x = x;
    smile.add(arc);
  }
  const frown = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 20, Math.PI), dark);
  frown.position.y = -0.06;
  mouth.add(open, smile, frown);

  // ---------- eyes: glossy beads with sparkles ----------
  const EYE_X = 0.34, EYE_Y = 0.22;
  function makeEye(x) {
    const eye = new THREE.Group();
    const open = new THREE.Group();
    const iris = new THREE.Group();
    const bead = ball(0.14, dark, 1, 1.12, 0.5);
    const shine1 = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), shineMat);
    shine1.position.set(0.04, 0.05, 0.065);
    const shine2 = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), shineMat);
    shine2.position.set(-0.04, -0.05, 0.065);
    iris.add(bead, shine1, shine2);
    open.add(iris);
    const closed = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 10, 24, Math.PI), dark);
    closed.position.y = -0.03;
    closed.visible = false;
    eye.add(open, closed);
    onHead(eye, x, EYE_Y, 0.0);
    return { open, closed, iris };
  }
  const eyeL = makeEye(-EYE_X);
  const eyeR = makeEye(EYE_X);

  // ---------- round glasses ----------
  const glasses = new THREE.Group();
  const GLASS_Z = Math.sqrt(HEAD_R * HEAD_R - EYE_Y * EYE_Y) * 0.96 + 0.08;
  glasses.position.set(0, EYE_Y, GLASS_Z);
  for (const x of [-EYE_X, EYE_X]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 16, 48), frame);
    r.position.set(x, 0, -0.06);
    r.rotation.y = -Math.sign(x) * 0.35; // follow the round face
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.225, 32), lens);
    l.position.copy(r.position);
    l.rotation.copy(r.rotation);
    glasses.add(r, l);
  }
  const bridge = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 8, 16, Math.PI), frame);
  bridge.position.set(0, 0.03, 0.02);
  glasses.add(bridge);
  head.add(glasses);

  // ---------- brows & blush ----------
  function makeBrow(x) {
    const b = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 8, 20, Math.PI), dark);
    b.scale.y = 0.55;
    onHead(new THREE.Group(), x, 0.5, 0.01).add(b);
    return b;
  }
  const browL = makeBrow(-EYE_X);
  const browR = makeBrow(EYE_X);
  for (const x of [-0.56, 0.56]) {
    const c = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), blushMat);
    c.scale.y = 0.7;
    onHead(c, x, -0.12, 0.01);
  }

  // ---------- stubby arms with round paws ----------
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.5, -0.6, 0.05);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.16, 8, 16), fur);
    arm.position.y = -0.18;
    const paw = ball(0.17, fur);
    paw.position.y = -0.36;
    const pad = ball(0.08, cream, 1, 1, 0.4);
    pad.position.set(0, -0.38, 0.15);
    shoulder.add(arm, paw, pad);
    rig.add(shoulder);
    return shoulder;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // ---------- legs with toe-bean pads ----------
  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.3, -1.14, 0.08);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.06, 8, 16), fur);
    leg.position.y = -0.12;
    const foot = ball(0.2, fur, 1, 0.65, 1.25);
    foot.position.set(0, -0.23, 0.08);
    const pad = ball(0.1, cream, 1, 1, 0.3);
    pad.position.set(0, -0.23, 0.33);
    hip.add(leg, foot, pad);
    rig.add(hip);
    return hip;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // ---------- ground shadow ----------
  const shadowMat = new THREE.MeshBasicMaterial({ map: softDot("rgba(120,60,40,0.35)"), transparent: true, depthWrite: false });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.0), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = GROUND - 0.02;
  scene.add(shadow);

  // ---------- floating mini hearts ----------
  const miniGeo = heartGeometry(32);
  const minis = [];
  function spawnMini() {
    const m = new THREE.Mesh(miniGeo, new THREE.MeshPhysicalMaterial({
      color: Math.random() < 0.5 ? 0xff5c7a : 0xff9bb5, roughness: 0.35, clearcoat: 1, transparent: true,
    }));
    m.scale.setScalar(0.1 + Math.random() * 0.08);
    m.position.set((Math.random() - 0.5) * 3.0, -0.4 + Math.random() * 1.4, 0.7 + Math.random() * 0.5);
    m.userData = { life: 0, vy: 0.7 + Math.random() * 0.5, spin: (Math.random() - 0.5) * 5, sway: Math.random() * 6 };
    scene.add(m);
    minis.push(m);
  }

  // ---------- state ----------
  const readMood = () => MOODS.find((m) => buddyEl.classList.contains(m)) || "content";
  let mood = readMood();
  let moodStart = 0;
  let clockT = 0;
  const squashS = new Spring(1, 200, 7);
  const rollS = new Spring(0, 120, 6);
  const leanS = new Spring(0, 90, 10);
  const turnS = new Spring(0, 60, 9);
  const tiltS = new Spring(0, 110, 7); // head tilt on the neck
  const armLS = new Spring(-0.35, 140, 8);
  const armRS = new Spring(0.35, 140, 8);
  const earS = new Spring(0, 240, 6); // ears flop a beat behind
  const glassesS = new Spring(0, 260, 9);

  new MutationObserver(() => {
    const m = readMood();
    if (m === mood) return;
    mood = m;
    moodStart = clockT;
    if (m === "poke") { tiltS.v += 6; squashS.v -= 5; earS.v += 8; }
    if (m === "happy") squashS.v -= 4;
  }).observe(buddyEl, { attributes: true, attributeFilter: ["class"] });

  const pointer = new THREE.Vector2();
  addEventListener("pointermove", (e) => {
    const r = wrap.getBoundingClientRect();
    pointer.set(
      THREE.MathUtils.clamp((e.clientX - (r.left + r.width / 2)) / r.width, -1, 1),
      THREE.MathUtils.clamp(-(e.clientY - (r.top + r.height / 2)) / r.height, -1, 1),
    );
  });

  // drag to spin; a drag shouldn't also count as a poke
  const canvas = renderer.domElement;
  let dragging = false, lastX = 0, moved = 0, userSpin = 0, swallowClick = false;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; moved = 0; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    userSpin += (e.clientX - lastX) * 0.012;
    moved += Math.abs(e.clientX - lastX);
    lastX = e.clientX;
  });
  canvas.addEventListener("pointerup", () => { dragging = false; swallowClick = moved > 6; });
  canvas.addEventListener("click", (e) => { if (swallowClick) { e.stopPropagation(); swallowClick = false; } });

  const ease = (cur, target, k) => cur + (target - cur) * k;
  const look = new THREE.Vector2();
  let irisScale = 1, sad = 0, blushA = 0.6;
  let nextBlink = 2, blinkUntil = 0, nextMini = 0, lastHop = -1, lastY = 0;

  function resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(wrap);
  resize();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    // dt is capped for smoothing; mood timing uses real elapsed time so slow frames don't stretch it
    const dt = Math.min(clock.getDelta(), 0.05);
    clockT = clock.elapsedTime;
    const t = clockT;
    const e = t - moodStart;
    const k = 1 - Math.exp(-dt * 8);

    const breathe = Math.sin(t * 2.4) * 0.025;
    let y = 0, squashT = 1 + breathe, rollT = Math.sin(t * 0.9) * 0.03;
    let leanT = -pointer.y * 0.06, turnT = pointer.x * 0.4, spin = 0;
    let tiltT = Math.sin(t * 0.9) * 0.06 + pointer.x * 0.08;
    let armLT = -0.35 - Math.sin(t * 1.8) * 0.08, armRT = 0.35 + Math.sin(t * 1.8 + 0.6) * 0.08;
    let lookT = new THREE.Vector2(pointer.x * 0.03, pointer.y * 0.025);
    let irisT = 1, sadT = 0, blushT = 0.6, browRot = 0, browY = 0, earT = 0;
    let winkL = false, winkR = false, mouthMode = "smile", tapL = 0, tapR = 0, miniEvery = 0;

    if (mood === "waiting") {
      // alternates between staring at the floor scuffing a foot, and looking up with puppy eyes
      const pleading = t % 7 > 3.5;
      sadT = 1;
      blushT = 0.35;
      browRot = 0.4;
      browY = -0.02;
      earT = -0.35; // ears droop
      mouthMode = "frown";
      armLT = -0.12; armRT = 0.12;
      if (pleading) {
        leanT = -0.05;
        turnT = Math.sin(t * 0.8) * 0.12;
        tiltT = 0.22 + Math.sin(t * 1.6) * 0.04; // head tilt 🥺
        lookT.set(0, 0.02);
        irisT = 1.2;
      } else {
        leanT = 0.18;
        turnT = Math.sin(t * 0.5) * 0.25;
        tiltT = Math.sin(t * 1.1) * 0.06;
        lookT.set(Math.sin(t * 0.7) * 0.02, -0.04);
        tapR = Math.max(0, Math.sin(t * 4)) * 0.5; // scuffing a foot
      }
      const sigh = (t % 5) / 5;
      if (sigh > 0.82) squashT -= Math.sin(((sigh - 0.82) / 0.18) * Math.PI) * 0.07;
    } else if (mood === "content") {
      // little happy waddle
      const step = t * 3.2;
      y = Math.abs(Math.sin(step)) * 0.06;
      rollT = Math.sin(step) * 0.06;
      tiltT += Math.sin(step) * 0.05;
      tapL = Math.max(0, Math.sin(step)) * 0.3;
      tapR = Math.max(0, -Math.sin(step)) * 0.3;
      armLT = -0.45 - Math.sin(step) * 0.25;
      armRT = 0.45 - Math.sin(step) * 0.25;
    } else if (mood === "happy") {
      const HOP = 0.75;
      const p = (e % HOP) / HOP;
      const hop = Math.floor(e / HOP);
      y = 4 * p * (1 - p) * 0.6;
      if (hop !== lastHop) { if (hop > 0) { squashS.v -= 7; earS.v -= 10; } lastHop = hop; } // jelly landing
      squashT = 1.08;
      if (e < HOP) spin = THREE.MathUtils.smootherstep(e / HOP, 0, 1) * Math.PI * 2;
      armLT = -2.6 - Math.sin(t * 16) * 0.25;
      armRT = 2.6 + Math.sin(t * 16 + 1) * 0.25;
      turnT = 0; leanT = -0.08; tiltT = Math.sin(t * 6) * 0.12;
      lookT.set(0, 0.02);
      blushT = 1;
      browY = 0.04;
      earT = Math.sin(t * 18) * 0.15;
      winkR = true;
      winkL = hop % 2 === 1; // alternates wink and ^^
      mouthMode = "open";
      tapL = tapR = 0.4 * Math.sin(p * Math.PI);
      miniEvery = 0.1;
    } else if (mood === "love") {
      const b = (t % 0.9) / 0.9;
      if (b < 0.06 && e > 0.2) squashS.v += 0.6; // heartbeat thump
      y = Math.sin(t * 2) * 0.04;
      tiltT = Math.sin(t * 1.4) * 0.15;
      turnT = Math.sin(t * 0.7) * 0.3;
      armLT = -1.6 - Math.sin(t * 3) * 0.3;
      armRT = 1.6 + Math.sin(t * 3 + 1) * 0.3;
      blushT = 1;
      browY = 0.04;
      winkL = winkR = true;
      mouthMode = "open";
      miniEvery = 0.45;
    } else if (mood === "poke") {
      tiltT = 0;
      turnT = 0;
      armLT = -1.0; armRT = 1.0;
      blushT = 1;
      browY = 0.04;
      winkL = winkR = true;
      mouthMode = "open";
    }

    // springs + smoothing
    const sq = squashS.step(squashT, dt);
    root.position.y = y;
    squash.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)); // keep volume while squishing
    root.rotation.set(leanS.step(leanT, dt), turnS.step(turnT, dt) + spin + userSpin, rollS.step(rollT, dt));
    neck.rotation.z = tiltS.step(tiltT, dt);
    if (!dragging) userSpin = ease(userSpin, 0, 1 - Math.exp(-dt * 3));
    armL.rotation.z = armLS.step(armLT, dt);
    armR.rotation.z = armRS.step(armRT, dt);
    legL.rotation.x = -tapL;
    legR.rotation.x = -tapR;
    const ear = earS.step(earT, dt);
    earL.rotation.z = 0.35 - ear;
    earR.rotation.z = -0.35 + ear;

    const vy = (y - lastY) / Math.max(dt, 1e-3);
    lastY = y;
    glasses.position.y = EYE_Y + glassesS.step(THREE.MathUtils.clamp(-vy * 0.01, -0.05, 0.05), dt);

    sad = ease(sad, sadT, k);
    fur.color.copy(FUR).lerp(FUR_SAD, sad * 0.5);
    blushA = ease(blushA, blushT, k);
    blushMat.opacity = blushA;

    // face
    look.lerp(lookT, k);
    irisScale = ease(irisScale, irisT, k);
    browL.rotation.z = browRot;
    browR.rotation.z = -browRot;
    browL.position.y = browR.position.y = browY;
    if (t > nextBlink) { blinkUntil = t + 0.12; nextBlink = t + 2.2 + Math.random() * 3; }
    const blinkS = t < blinkUntil ? 0.08 : 1;
    for (const [eye, closed] of [[eyeL, winkL], [eyeR, winkR]]) {
      eye.open.visible = !closed;
      eye.closed.visible = closed;
      eye.open.scale.y = blinkS;
      eye.iris.position.set(look.x, look.y, 0);
      eye.iris.scale.setScalar(irisScale);
    }
    open.visible = mouthMode === "open";
    tongue.visible = mood === "happy" || mood === "love";
    smile.visible = mouthMode === "smile";
    frown.visible = mouthMode === "frown";

    // shadow shrinks while airborne
    shadow.scale.setScalar(1 - y * 0.5);
    shadowMat.opacity = 1 - y * 0.6;

    // mini hearts drift up, swaying
    if (miniEvery && t > nextMini) { spawnMini(); nextMini = t + miniEvery; }
    for (let i = minis.length - 1; i >= 0; i--) {
      const m = minis[i];
      const d = m.userData;
      d.life += dt;
      m.position.y += d.vy * dt;
      m.position.x += Math.sin(d.life * 4 + d.sway) * 0.3 * dt;
      m.rotation.y += d.spin * dt;
      m.material.opacity = Math.min(1, 1.6 - (d.life / 1.4) * 1.6);
      if (d.life > 1.4) { scene.remove(m); m.material.dispose(); minis.splice(i, 1); }
    }

    renderer.render(scene, camera);
  });
}

if (webglOK()) {
  try {
    start();
  } catch (err) {
    // anything goes wrong → show the flat avatar instead of an empty box
    console.error(err);
    wrap.querySelector("canvas")?.remove();
    wrap.classList.remove("is-3d");
  }
}
