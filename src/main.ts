import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

import {
  State,
  Move,
  Color,
  initialState,
  applyMove,
  legalMoves,
  gameResult,
  inCheck,
  fileOf,
  rankOf,
  sq,
} from "./chess";
import { Difficulty } from "./ai";
import { buildPiece } from "./pieces";

const $ = <T extends Element>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error("missing " + sel);
  return el;
};

// ---------------------------------------------------------------- renderer
const app = $<HTMLDivElement>("#app");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x140026, 0.045);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 7.5, 8.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 6;
controls.maxDistance = 16;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

// audio
const listener = new THREE.AudioListener();
camera.add(listener);

// ---------------------------------------------------------------- post fx
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.9, // strength
  0.6, // radius
  0.55, // threshold
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- lighting
scene.add(new THREE.AmbientLight(0x4a3a6a, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(5, 12, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 40;
key.shadow.camera.left = -8;
key.shadow.camera.right = 8;
key.shadow.camera.top = 8;
key.shadow.camera.bottom = -8;
key.shadow.bias = -0.0004;
scene.add(key);
const fillCyan = new THREE.PointLight(0x00e5ff, 60, 30);
fillCyan.position.set(-6, 3, 6);
scene.add(fillCyan);
const fillPink = new THREE.PointLight(0xff2bd6, 60, 30);
fillPink.position.set(6, 3, -6);
scene.add(fillPink);

// ---------------------------------------------------------------- skybox
new THREE.TextureLoader().load(
  "./assets/skybox/vaporwave-synthwave-night-sky-deep-purple-to-hot-p.jpg",
  (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(tex).texture;
    scene.background = tex;
  },
);

// ---------------------------------------------------------------- board
const BOARD = new THREE.Group();
scene.add(BOARD);

function worldPos(square: number, y = 0): THREE.Vector3 {
  return new THREE.Vector3(fileOf(square) - 3.5, y, 3.5 - rankOf(square));
}

const tileMeshes: THREE.Mesh[] = [];
const tileBaseEmissive: number[] = [];
for (let i = 0; i < 64; i++) {
  const light = (fileOf(i) + rankOf(i)) % 2 === 1;
  const mat = new THREE.MeshStandardMaterial({
    color: light ? 0x241848 : 0x12082a,
    emissive: light ? 0x1b6fff : 0x6a13c4,
    emissiveIntensity: 0.18,
    metalness: 0.4,
    roughness: 0.4,
  });
  const tile = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.2, 0.98), mat);
  const p = worldPos(i, -0.1);
  tile.position.copy(p);
  tile.receiveShadow = true;
  tile.userData.square = i;
  tileBaseEmissive.push(mat.emissiveIntensity);
  tileMeshes.push(tile);
  BOARD.add(tile);
}

// glowing border frame
const frameMat = new THREE.MeshStandardMaterial({
  color: 0x0a0418,
  emissive: 0x00e5ff,
  emissiveIntensity: 0.4,
  metalness: 0.6,
  roughness: 0.3,
});
const frame = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.22, 9.2), frameMat);
frame.position.y = -0.16;
frame.receiveShadow = true;
BOARD.add(frame);

// reflective floor under everything
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x05010f,
  metalness: 0.9,
  roughness: 0.35,
});
const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.27;
floor.receiveShadow = true;
scene.add(floor);

// rank/file glow guides
const guideMat = new THREE.MeshBasicMaterial({ color: 0xb14bff });
for (let i = 0; i < 8; i++) {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 8), guideMat);
  bar.position.set(i - 3.5 + 0.5, -0.18, 0);
  // subtle, optional — keep faint
  bar.visible = false;
  BOARD.add(bar);
}

// ---------------------------------------------------------------- highlights
const highlightGroup = new THREE.Group();
scene.add(highlightGroup);

function clearHighlights() {
  highlightGroup.clear();
}

function addDot(square: number, capture: boolean) {
  const geo = capture
    ? new THREE.TorusGeometry(0.4, 0.05, 12, 32)
    : new THREE.CircleGeometry(0.16, 24);
  const mat = new THREE.MeshBasicMaterial({
    color: capture ? 0xff2bd6 : 0x39ff14,
    transparent: true,
    opacity: 0.95,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.copy(worldPos(square, 0.02));
  m.userData.square = square;
  m.userData.highlight = true;
  highlightGroup.add(m);
}

let selectRing: THREE.Mesh | null = null;
function setSelectRing(square: number | null) {
  if (selectRing) {
    highlightGroup.remove(selectRing);
    selectRing = null;
  }
  if (square === null) return;
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(0.46, 0.04, 12, 40),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.copy(worldPos(square, 0.02));
  selectRing = m;
  highlightGroup.add(m);
}

// ---------------------------------------------------------------- pieces
let state: State = initialState();
let difficulty: Difficulty = "smart";
const pieceObjs = new Map<number, THREE.Group>(); // square -> mesh

function buildAllPieces() {
  for (const obj of pieceObjs.values()) BOARD.remove(obj);
  pieceObjs.clear();
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (!p) continue;
    const g = buildPiece(p.type, p.color);
    g.position.copy(worldPos(i));
    g.userData.square = i;
    pieceObjs.set(i, g);
    BOARD.add(g);
  }
}

// ---------------------------------------------------------------- tweens
interface Tween {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  onDone?: () => void;
}
const tweens: Tween[] = [];
function moveTween(obj: THREE.Object3D, to: THREE.Vector3, dur: number, arc: number, onDone?: () => void) {
  tweens.push({ obj, from: obj.position.clone(), to: to.clone(), t: 0, dur, arc, onDone });
}
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

// ---------------------------------------------------------------- VFX bursts
interface Burst {
  pts: THREE.Points;
  vel: Float32Array;
  t: number;
  life: number;
  mat: THREE.PointsMaterial;
}
const bursts: Burst[] = [];
function spawnBurst(pos: THREE.Vector3, color: number) {
  const n = 90;
  const geo = new THREE.BufferGeometry();
  const arr = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = pos.x;
    arr[i * 3 + 1] = pos.y + 0.4;
    arr[i * 3 + 2] = pos.z;
    const a = Math.random() * Math.PI * 2;
    const up = Math.random() * 3 + 1;
    const r = Math.random() * 3 + 1;
    vel[i * 3] = Math.cos(a) * r;
    vel[i * 3 + 1] = up;
    vel[i * 3 + 2] = Math.sin(a) * r;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size: 0.16,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  bursts.push({ pts, vel, t: 0, life: 0.7, mat });
}

// ---------------------------------------------------------------- audio
let moveBuf: AudioBuffer | null = null;
let capBuf: AudioBuffer | null = null;
const loader = new THREE.AudioLoader();
loader.load("./assets/sfx/satisfying-soft-thunk-click-placing-a-glowing-ches.mp3", (b) => (moveBuf = b));
loader.load("./assets/sfx/punchy-glitchy-electric-zap-capture-impact-bassy-n.mp3", (b) => (capBuf = b));
function play(buf: AudioBuffer | null, vol: number) {
  if (!buf) return;
  if (listener.context.state === "suspended") listener.context.resume();
  const a = new THREE.Audio(listener);
  a.setBuffer(buf);
  a.setVolume(vol);
  a.play();
}

// ---------------------------------------------------------------- HUD
const hud = document.createElement("div");
hud.className = "hud";
hud.innerHTML = `
  <div class="title">VIBE CHESS<small>NEON · YOU vs THE MACHINE</small></div>
  <div class="status you" id="status">YOUR MOVE</div>
  <div class="captured">
    <div id="capYou">you: 0 captured</div>
    <div id="capCpu">cpu: 0 captured</div>
  </div>
  <div class="panel">
    <div class="diff" id="diff">
      <button data-d="chill">CHILL</button>
      <button data-d="smart" class="active">SMART</button>
      <button data-d="ruthless">RUTHLESS</button>
    </div>
    <button class="btn" id="newgame">NEW GAME</button>
  </div>
  <div class="banner" id="banner">
    <h1 id="bannerTitle">CHECKMATE</h1>
    <p id="bannerSub">tap NEW GAME to run it back</p>
  </div>
`;
document.body.appendChild(hud);

const statusEl = $<HTMLDivElement>("#status");
const capYouEl = $<HTMLDivElement>("#capYou");
const capCpuEl = $<HTMLDivElement>("#capCpu");
const banner = $<HTMLDivElement>("#banner");
const bannerTitle = $<HTMLHeadingElement>("#bannerTitle");
const bannerSub = $<HTMLParagraphElement>("#bannerSub");

let youCaptured = 0;
let cpuCaptured = 0;
function updateCaps() {
  capYouEl.textContent = `you: ${youCaptured} captured`;
  capCpuEl.textContent = `cpu: ${cpuCaptured} captured`;
}

function setStatus(text: string, cls: string) {
  statusEl.textContent = text;
  statusEl.className = "status " + cls;
}

$<HTMLDivElement>("#diff").addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const d = t.getAttribute("data-d") as Difficulty | null;
  if (!d) return;
  difficulty = d;
  for (const b of Array.from(document.querySelectorAll("#diff button")))
    b.classList.toggle("active", b === t);
});

$<HTMLButtonElement>("#newgame").addEventListener("click", () => newGame());

// ---------------------------------------------------------------- AI worker
const worker = new Worker(new URL("./ai.worker.ts", import.meta.url), {
  type: "module",
});
worker.onmessage = (e: MessageEvent<Move | null>) => {
  const m = e.data;
  if (m) doMove(m, true);
};

// ---------------------------------------------------------------- game flow
const PLAYER: Color = "w";
let busy = false; // animation or thinking in progress
let selected: number | null = null;
let targets = new Map<number, Move>();

function newGame() {
  state = initialState();
  youCaptured = 0;
  cpuCaptured = 0;
  updateCaps();
  selected = null;
  targets.clear();
  clearHighlights();
  setSelectRing(null);
  buildAllPieces();
  banner.classList.remove("show");
  busy = false;
  setStatus("YOUR MOVE", "you");
}

function selectSquare(square: number) {
  const moves = legalMoves(state).filter((m) => m.from === square);
  if (moves.length === 0) return;
  selected = square;
  targets.clear();
  clearHighlights();
  setSelectRing(square);
  for (const m of moves) {
    // prefer queen promotion for the visual target
    if (!targets.has(m.to) || m.promotion === "q") targets.set(m.to, m);
    addDot(m.to, !!m.capture);
  }
}

function deselect() {
  if (selected !== null) {
    const prev = pieceObjs.get(selected);
    if (prev) prev.position.y = 0;
  }
  selected = null;
  targets.clear();
  clearHighlights();
  setSelectRing(null);
}

function squareOf(obj: THREE.Object3D | null): number | null {
  let o = obj;
  while (o) {
    if (o.userData && typeof o.userData.square === "number")
      return o.userData.square as number;
    o = o.parent;
  }
  return null;
}

function doMove(move: Move, isAi: boolean) {
  busy = true;
  deselect();

  // resolve capture square
  let capSquare: number | null = null;
  if (move.enPassant) {
    const capRank = state.turn === "w" ? rankOf(move.to) - 1 : rankOf(move.to) + 1;
    capSquare = sq(fileOf(move.to), capRank);
  } else if (move.capture) {
    capSquare = move.to;
  }

  if (capSquare !== null) {
    const victim = pieceObjs.get(capSquare);
    if (victim) {
      const col = state.board[capSquare]?.color === "w" ? 0x00e5ff : 0xff2bd6;
      spawnBurst(victim.position, col);
      BOARD.remove(victim);
      pieceObjs.delete(capSquare);
    }
    if (isAi) cpuCaptured++;
    else youCaptured++;
    updateCaps();
    play(capBuf, 0.6);
  } else {
    play(moveBuf, 0.5);
  }

  const mover = pieceObjs.get(move.from);
  pieceObjs.delete(move.from);

  // castling: move rook visually
  if (move.castle) {
    const home = rankOf(move.from);
    const rFrom = move.castle === "k" ? sq(7, home) : sq(0, home);
    const rTo = move.castle === "k" ? sq(5, home) : sq(3, home);
    const rook = pieceObjs.get(rFrom);
    if (rook) {
      pieceObjs.delete(rFrom);
      moveTween(rook, worldPos(rTo), 0.32, 0.0);
      rook.userData.square = rTo;
      pieceObjs.set(rTo, rook);
    }
  }

  const movingColor = state.turn;
  const finishVisual = () => {
    if (mover) {
      // promotion: swap mesh
      if (move.promotion) {
        BOARD.remove(mover);
        const g = buildPiece(move.promotion, movingColor);
        g.position.copy(worldPos(move.to));
        g.userData.square = move.to;
        pieceObjs.set(move.to, g);
        BOARD.add(g);
      } else {
        mover.userData.square = move.to;
        pieceObjs.set(move.to, mover);
      }
    }
    state = applyMove(state, move);
    afterMove();
  };

  if (mover) {
    moveTween(mover, worldPos(move.to), 0.34, 0.55, finishVisual);
  } else {
    finishVisual();
  }
}

function afterMove() {
  const result = gameResult(state);
  const checked = inCheck(state, state.turn);

  if (result === "checkmate") {
    busy = false;
    const youWon = state.turn !== PLAYER;
    bannerTitle.textContent = youWon ? "YOU WIN" : "CHECKMATE";
    bannerSub.textContent = youWon
      ? "you cooked the machine — run it back?"
      : "the machine got you — run it back?";
    banner.classList.add("show");
    setStatus(youWon ? "YOU WIN!" : "CHECKMATE", "alert");
    return;
  }
  if (result === "stalemate" || result === "draw") {
    busy = false;
    bannerTitle.textContent = "DRAW";
    bannerSub.textContent = "nobody blinked — run it back?";
    banner.classList.add("show");
    setStatus("DRAW", "alert");
    return;
  }

  if (state.turn === PLAYER) {
    busy = false;
    setStatus(checked ? "CHECK — YOUR MOVE" : "YOUR MOVE", checked ? "alert" : "you");
  } else {
    busy = true;
    setStatus(checked ? "CHECK — CPU THINKING…" : "CPU THINKING…", "think");
    // let the frame paint before handing off
    setTimeout(() => {
      worker.postMessage({ state, side: "b", difficulty });
    }, 120);
  }
}

// ---------------------------------------------------------------- input
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = { x: 0, y: 0 };

renderer.domElement.addEventListener("pointerdown", (e) => {
  downPos = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener("pointerup", (e) => {
  // ignore drags (camera orbit)
  if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) return;
  if (busy || state.turn !== PLAYER) return;
  if (listener.context.state === "suspended") listener.context.resume();

  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(
    [...highlightGroup.children, ...BOARD.children],
    true,
  );
  if (hits.length === 0) {
    deselect();
    return;
  }
  const square = squareOf(hits[0].object);
  if (square === null) {
    deselect();
    return;
  }

  // clicking a legal target?
  if (selected !== null && targets.has(square)) {
    doMove(targets.get(square)!, false);
    return;
  }

  // clicking own piece -> select
  const p = state.board[square];
  if (p && p.color === PLAYER) {
    if (selected === square) deselect();
    else selectSquare(square);
  } else {
    deselect();
  }
});

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let pulse = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  pulse += dt;

  // tweens
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const k = Math.min(tw.t / tw.dur, 1);
    const e = easeInOut(k);
    tw.obj.position.lerpVectors(tw.from, tw.to, e);
    tw.obj.position.y += Math.sin(e * Math.PI) * tw.arc;
    if (k >= 1) {
      tw.obj.position.copy(tw.to);
      tweens.splice(i, 1);
      tw.onDone?.();
    }
  }

  // bursts
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.t += dt;
    const pos = b.pts.geometry.getAttribute("position") as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let j = 0; j < a.length; j += 3) {
      b.vel[j + 1] -= 9 * dt; // gravity
      a[j] += b.vel[j] * dt;
      a[j + 1] += b.vel[j + 1] * dt;
      a[j + 2] += b.vel[j + 2] * dt;
    }
    pos.needsUpdate = true;
    b.mat.opacity = Math.max(0, 1 - b.t / b.life);
    if (b.t >= b.life) {
      scene.remove(b.pts);
      b.pts.geometry.dispose();
      b.mat.dispose();
      bursts.splice(i, 1);
    }
  }

  // selected piece hover + glow pulse
  if (selectRing) {
    selectRing.scale.setScalar(1 + Math.sin(pulse * 4) * 0.06);
    (selectRing.material as THREE.MeshBasicMaterial).opacity = 1;
  }
  if (selected !== null) {
    const obj = pieceObjs.get(selected);
    if (obj) obj.position.y = Math.abs(Math.sin(pulse * 3)) * 0.12;
  }

  controls.update();
  composer.render();
}

// ---------------------------------------------------------------- resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloom.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- boot
buildAllPieces();
updateCaps();
animate();

const loadEl = document.querySelector(".loading");
if (loadEl) {
  loadEl.classList.add("hide");
  setTimeout(() => loadEl.remove(), 700);
}
