// Kestrel Yard — boot and the game loop. The renderer owns the scene, the
// camera and every mesh; the simulation (state + mover + weapons + combat +
// bots) owns the numbers. A fixed 60 Hz step advances the sim, rendering
// reads the result — the two never interleave. Also here: the staged
// screenshot modes (?shot=menu|play|buy|plant) and the scripted self-test
// (?selftest=1), which drives the same sim functions the game uses.
import * as THREE from 'three';
import { createMatch, startRound, nextRound, aliveOf } from './state.js';
import { MAP, buildMapMeshes, siteAt } from './map.js';
import { movePlayer, eyeHeight, forwardOf } from './mover.js';
import { WEAPONS, tryFire, startReload, tickReload, decayBloom, currentSpread, throwGrenade, buyItem } from './weapons.js';
import { resolveShot, tickGrenades, tickObjective, tickSpike, checkRoundEnd, applyDamage } from './combat.js';
import { botStep, botBuy, botHolding } from './bots.js';
import { ensureAudio, playEvent, setMuted, isMuted } from './audio.js';
import { bindInput, pollInput, isLocked, scriptedInput } from './input.js';
import { initHud, updateHud, renderBuyMenu, setBuyOpen, setMenuOpen } from './hud.js';
import { PALETTE } from './palette.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') || '1');
const SHOT = params.get('shot');
const SELFTEST = params.get('selftest') === '1';

let m = createMatch(SEED);
let renderer;
let scene;
let camera;
let viewGun;
let muzzle;
let botMeshes = new Map();
let spikeMesh;
let tracerPool = [];
let effects = [];
let buyOpen = false;
let menuShown = true;
let lastTracerSeen = 0;
let acc = 0;
let lastT = 0;

// --- Boot -------------------------------------------------------------------
function boot() {
  initHud();
  renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('game') });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyTop);
  scene.fog = new THREE.Fog(PALETTE.fog, 28, 95);
  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 220);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // Dusk light: a low warm sun, a cool sky fill, sodium lamps at the yard's
  // poles, and a soft southern fill so faces turned away from the sun still
  // read. Exposure 1.35 keeps the dusk mood without crushing the shadows.
  scene.add(new THREE.HemisphereLight(0x93a7c9, 0x4a4038, 2.2));
  scene.add(new THREE.AmbientLight(0x8a94a8, 0.55));
  const sun = new THREE.DirectionalLight(0xffb36b, 1.9);
  sun.position.set(28, 42, -18);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x93a7c9, 1.0);
  fill.position.set(-10, 25, 40);
  scene.add(fill);
  for (const l of MAP.lamps.slice(0, 3)) {
    const pt = new THREE.PointLight(PALETTE.lamp, 14, 20, 1.6);
    pt.position.set(l.x, 5.2, l.z);
    scene.add(pt);
  }
  buildMapMeshes(scene, THREE);
  buildViewGun();
  buildSpikeMesh();
  for (const p of m.players) {
    if (p.isBot) botMeshes.set(p.id, buildBotMesh(p));
  }

  bindInput(renderer.domElement, {
    onMute: () => setMuted(!isMuted()),
    onBuy: () => { if (m.phase === 'buy') buyOpen = !buyOpen; },
    onLockRequest: () => {
      ensureAudio();
      if (m.phase === 'matchEnd') return true;
      return m.phase !== 'matchEnd';
    },
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  if (SELFTEST) runSelfTest();
  if (SHOT) stageShot(SHOT);
  // In shot mode the staging owns the menu overlay; otherwise show it until
  // the player locks the pointer.
  if (!SHOT) setMenuOpen(menuShown, 'KESTREL YARD');
  lastT = performance.now();
  requestAnimationFrame(frame);
}

function buildViewGun() {
  viewGun = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.12, 0.5),
    new THREE.MeshLambertMaterial({ color: 0xc9a06a }),
  );
  const barrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.34),
    new THREE.MeshLambertMaterial({ color: 0x4a3f30 }),
  );
  barrel.position.set(0, 0.03, -0.4);
  const sight = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.07, 0.1),
    new THREE.MeshLambertMaterial({ color: 0xe8a13a }),
  );
  sight.position.set(0, 0.11, -0.1);
  const mag = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.16, 0.1),
    new THREE.MeshLambertMaterial({ color: 0x8a7a5a }),
  );
  mag.position.set(0, -0.13, 0.05);
  viewGun.add(body, barrel, sight, mag);
  viewGun.scale.setScalar(0.7);
  viewGun.position.set(0.26, -0.27, -0.68);
  viewGun.rotation.y = -0.08;
  viewGun.rotation.z = 0.02;
  camera.add(viewGun);
  muzzle = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, side: THREE.DoubleSide }),
  );
  muzzle.position.set(0, 0.03, -0.62);
  viewGun.add(muzzle);
}

function buildBotMesh(p) {
  const g = new THREE.Group();
  const teamColor = p.team === 'falcons' ? PALETTE.falcon : PALETTE.warden;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.34), new THREE.MeshLambertMaterial({ color: teamColor }));
  torso.position.y = 1.08;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshLambertMaterial({ color: 0x2a2320 }));
  head.position.y = 1.62;
  const band = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 4, 0, Math.PI * 2, 0, 0.7), new THREE.MeshLambertMaterial({ color: teamColor }));
  band.position.y = 1.62;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), new THREE.MeshLambertMaterial({ color: 0x23201c }));
  legL.position.set(-0.15, 0.36, 0);
  const legR = legL.clone();
  legR.position.x = 0.15;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.6), new THREE.MeshLambertMaterial({ color: 0x1e1e22 }));
  gun.position.set(0.2, 1.15, -0.3);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.1), new THREE.MeshLambertMaterial({ color: 0xe85a3a }));
  pack.position.set(0, 1.15, 0.24);
  pack.visible = false;
  pack.name = 'spike-pack';
  g.add(torso, head, band, legL, legR, gun, pack);
  g.userData.player = p;
  scene.add(g);
  return g;
}

function buildSpikeMesh() {
  spikeMesh = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.34), new THREE.MeshLambertMaterial({ color: 0x2a2a2e }));
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff5a3a }));
  light.position.y = 0.16;
  spikeMesh.add(box, light);
  spikeMesh.visible = false;
  scene.add(spikeMesh);
}

// --- Simulation step --------------------------------------------------------
// One fixed step. Pure sim plus event emission; the frame loop drains events
// for sound and effects afterwards. The self-test calls this directly.
export function simStep(match, input, dt) {
  const mm = match;
  mm.time += dt;
  mm.phaseT += dt;

  if (mm.phase === 'buy') {
    if (mm._buyDone !== mm.round) {
      for (const p of mm.players) if (p.isBot) botBuy(mm, p);
      mm._buyDone = mm.round;
    }
    mm.roundTime -= dt;
    if (mm.phaseT >= 15) {
      mm.phase = 'live';
      mm.phaseT = 0;
      mm.banner = { title: 'GO', sub: mm.players[0].hasSpike ? 'Plant the Spike' : 'Stop the plant', t: mm.time };
    }
  } else if (mm.phase === 'live') {
    mm.roundTime -= dt;
  } else if (mm.phase === 'roundEnd') {
    if (mm.phaseT >= 4) nextRound(mm);
    return;
  } else if (mm.phase === 'matchEnd') {
    return;
  }

  const me = mm.players[0];
  // Human look + movement (allowed during buy and live).
  if (me.alive && (mm.phase === 'buy' || mm.phase === 'live')) {
    me.yaw -= (input.lookDX || 0) * 0.0022;
    me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - (input.lookDY || 0) * 0.0022));
    me.ads = !!input.ads;
    movePlayer(mm, me, input, dt);
    decayBloom(me, dt);
    tickReload(mm, me, dt);
    if (input.reload) startReload(mm, me);
    if (input.fire && mm.phase === 'live') {
      const fired = tryFire(mm, me, mm.time);
      if (fired === 'shot') resolveShot(mm, me, shotDir(mm, me));
    }
    if (input.grenade) {
      const kind = me.grenades.frag > 0 ? 'frag' : 'flash';
      if (me.grenades[kind] > 0) throwGrenade(mm, me, kind);
    }
    if (input.digit && mm.phase === 'buy') {
      const item = ['vk7', 'hornet', 'longshot', 'frag', 'flash', 'kevlar'][input.digit - 1];
      if (item) buyItem(mm, me, item);
    }
    tickObjective(mm, me, dt, !!input.use);
  }

  // Bots act only once the round is live (and never while staging a shot).
  if (mm.phase === 'live' && !mm.staging) {
    for (const p of mm.players) {
      if (!p.isBot || !p.alive) continue;
      botStep(mm, p, dt);
      tickReload(mm, p, dt);
      decayBloom(p, dt);
      tickObjective(mm, p, dt, botHolding(p));
    }
  }

  tickGrenades(mm, dt);
  tickSpike(mm, dt);
  checkRoundEnd(mm);
}

// Aim direction from the eye with the weapon's spread applied (seeded).
function shotDir(match, p) {
  const spread = currentSpread(match, p);
  const cp = Math.cos(p.pitch);
  let dx = -Math.sin(p.yaw) * cp;
  let dy = Math.sin(p.pitch);
  let dz = -Math.cos(p.yaw) * cp;
  dx += match.rng.gauss() * spread;
  dy += match.rng.gauss() * spread;
  dz += match.rng.gauss() * spread;
  const l = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / l, y: dy / l, z: dz / l };
}

// --- Frame loop -------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - lastT);
  lastT = now;
  if (!m.frozen) {
    acc += dtMs / 1000;
    let n = 0;
    while (acc >= STEP && n < 5) {
      simStep(m, pollInput(), STEP);
      acc -= STEP;
      n++;
    }
    if (n === 5) acc = 0;
  }
  drainEvents();
  syncScene();
  const me = m.players[0];
  camera.position.set(me.pos.x, eyeHeight(me), me.pos.z);
  camera.rotation.set(me.pitch, me.yaw, 0);
  // View-model: bob with movement, kick on fire, centre when aiming.
  const moving = Math.hypot(me.vel.x, me.vel.z);
  const bob = Math.sin(m.time * 11) * 0.008 * Math.min(1, moving / 5);
  const kick = Math.max(0, me.recoil * 2.2);
  const adsK = me.ads ? 1 : 0;
  viewGun.position.set(
    0.26 + (0 - 0.26) * adsK,
    -0.27 + (-0.2 + 0.27) * adsK + bob,
    -0.68 + (-0.48 + 0.68) * adsK + kick * 0.09,
  );
  muzzle.material.opacity = m.time - me.lastShotAt < 0.05 ? 0.9 : 0;
  updateHud(m, me, { spread: currentSpread(m, me) });
  if (buyOpen && m.phase === 'buy') {
    setBuyOpen(true);
    renderBuyMenu(m, me);
  } else {
    setBuyOpen(false);
  }
  // In shot mode the staging owns the overlays; the loop must not hide them.
  if (!SHOT) setMenuOpen(!isLocked() && m.phase !== 'matchEnd' && menuShown, 'KESTREL YARD');
  if (m.phase === 'matchEnd') setMenuOpen(true, m.winner === 'falcons' ? 'FALCONS WIN THE MATCH' : 'WARDENS WIN THE MATCH');
  renderer.render(scene, camera);
}

function drainEvents() {
  for (const ev of m.events.splice(0)) {
    playEvent(ev);
    if (ev.kind === 'explosion' || ev.kind === 'detonation') addExplosion(ev.x, ev.y ?? 0.6, ev.z);
  }
  // Tracers: lines from the sim's tracer list, fading fast.
  while (lastTracerSeen < m.tracers.length) {
    const t = m.tracers[lastTracerSeen++];
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(t.from.x, t.from.y, t.from.z),
      new THREE.Vector3(t.to.x, t.to.y, t.to.z),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 }));
    scene.add(line);
    tracerPool.push({ line, born: m.time });
    if (tracerPool.length > 24) {
      const old = tracerPool.shift();
      scene.remove(old.line);
      old.line.geometry.dispose();
    }
  }
  for (const t of tracerPool) {
    const age = m.time - t.born;
    t.line.material.opacity = Math.max(0, 0.9 - age * 8);
  }
}

function addExplosion(x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.85 }),
  );
  mesh.position.set(x, Math.max(0.6, y), z);
  scene.add(mesh);
  const light = new THREE.PointLight(0xff8a3a, 60, 26, 1.4);
  light.position.set(x, y + 1, z);
  scene.add(light);
  effects.push({ mesh, light, born: m.time });
}

function syncScene() {
  for (const p of m.players) {
    if (!p.isBot) continue;
    const g = botMeshes.get(p.id);
    if (!g) continue;
    g.position.set(p.pos.x, p.pos.y, p.pos.z);
    if (p.alive) {
      g.rotation.set(0, p.yaw, 0);
      g.visible = true;
      const pack = g.getObjectByName('spike-pack');
      if (pack) pack.visible = p.hasSpike;
    } else {
      g.rotation.set(-Math.PI / 2, p.yaw, 0);
      g.position.y = 0.25;
    }
  }
  // Spike on the ground when planted or dropped.
  if ((m.spike.state === 'planted' || m.spike.state === 'dropped') && m.spike.pos) {
    spikeMesh.visible = true;
    spikeMesh.position.set(m.spike.pos.x, 0.12, m.spike.pos.z);
  } else {
    spikeMesh.visible = false;
  }
  // Grenades in flight.
  for (const e of effects) {
    const age = m.time - e.born;
    const s = 1 + age * 14;
    e.mesh.scale.setScalar(Math.min(s, 9));
    e.mesh.material.opacity = Math.max(0, 0.85 - age * 1.4);
    e.light.intensity = Math.max(0, 60 - age * 90);
    if (age > 0.8) {
      scene.remove(e.mesh);
      scene.remove(e.light);
      effects.splice(effects.indexOf(e), 1);
    }
  }
  // Grenade meshes: reuse a small pool keyed by live grenades.
  syncGrenades();
}

let grenadeMeshes = [];
function syncGrenades() {
  while (grenadeMeshes.length < m.grenades.length) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshLambertMaterial({ color: 0x2a2a2e }));
    scene.add(mesh);
    grenadeMeshes.push(mesh);
  }
  m.grenades.forEach((g, i) => {
    grenadeMeshes[i].visible = true;
    grenadeMeshes[i].position.set(g.pos.x, g.pos.y, g.pos.z);
  });
  for (let i = m.grenades.length; i < grenadeMeshes.length; i++) grenadeMeshes[i].visible = false;
}

// --- Staged screenshots -----------------------------------------------------
// Deterministic setups for ?shot=menu|play|buy|plant&seed=N. The sim is
// advanced to 13 seconds into round 1, bots are frozen so they hold their
// poses, and the camera is the player's eye.
function stageShot(kind) {
  const me = m.players[0];
  // 13 s in: buy phase nearly over, timer reads 1:27 like the reference.
  // The player does not walk during staging — the camera spots are placed
  // by hand so every shot frames the yard, not a container face.
  for (let i = 0; i < 13 * 60; i++) simStep(m, scriptedInput(), STEP);
  m.staging = true;
  m.frozen = true;
  // Only the menu shot shows the title overlay; the others hide it.
  setMenuOpen(kind === 'menu', 'KESTREL YARD');
  if (kind === 'menu') {
    me.pos.x = 0;
    me.pos.z = 16;
    me.yaw = -0.45;
    me.pitch = -0.02;
  } else if (kind === 'play' || kind === 'buy') {
    // Mid-lane view: the player at the south crates, a Warden in the lane
    // ahead, in the crosshair, facing away.
    me.pos.x = 0;
    me.pos.z = 12;
    me.pos.y = 0;
    me.yaw = 0;
    me.pitch = 0;
    const w = m.players[5];
    w.pos.x = -1;
    w.pos.z = 4.5;
    w.pos.y = 0;
    w.yaw = Math.PI;
    w.alive = true;
    w.hp = 100;
    if (kind === 'buy') {
      buyOpen = true;
      setBuyOpen(true);
      renderBuyMenu(m, me);
    }
  } else if (kind === 'plant') {
    // Inside Site A, planting, a Warden ahead beyond the crane legs.
    me.pos.x = -22;
    me.pos.z = -5;
    me.pos.y = 0;
    me.yaw = 0.15;
    me.pitch = 0.02;
    me.hasSpike = true;
    me.planting = 1.9;
    m.spike.state = 'carried';
    m.spike.carrierId = me.id;
    const w = m.players[5];
    w.pos.x = -22;
    w.pos.z = -13;
    w.pos.y = 0;
    w.yaw = Math.PI;
    w.alive = true;
    w.hp = 100;
  }
  syncScene();
  camera.position.set(me.pos.x, eyeHeight(me), me.pos.z);
  camera.rotation.set(me.pitch, me.yaw, 0);
  updateHud(m, me, { spread: currentSpread(m, me) });
}

// --- Self-test --------------------------------------------------------------
// Thirteen scripted checks over the real sim, run synchronously at boot.
// Writes window.__selftest (lines) and a <pre id="selftest"> for headless reads.
function runSelfTest() {
  const lines = [];
  const check = (name, ok) => lines.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const step = (n, input) => {
    for (let i = 0; i < n; i++) simStep(m, input, STEP);
  };
  const me = m.players[0];
  try {
    check('match starts in buy phase', m.phase === 'buy');
    check('five falcons (player + 4 bots)', m.players.filter((p) => p.team === 'falcons').length === 5);
    check('five wardens', m.players.filter((p) => p.team === 'wardens').length === 5);
    step(15 * 60 + 30, scriptedInput());
    check('buy phase ticks', m.phase === 'live');
    const sx = me.pos.x;
    const sz = me.pos.z;
    step(60, scriptedInput({ f: 1 }));
    check('player moves forward', Math.hypot(me.pos.x - sx, me.pos.z - sz) > 0.5);
    const bot = m.players.find((p) => p.isBot && p.team === 'falcons');
    const bx = bot.pos.x;
    const bz = bot.pos.z;
    step(120, scriptedInput());
    check('bots move along routes', Math.hypot(bot.pos.x - bx, bot.pos.z - bz) > 0.5);
    // Hitscan kill: a Warden 5 m ahead, one Longshot headshot.
    const target = m.players[5];
    target.alive = true;
    target.hp = 100;
    me.owned.longshot = true;
    me.weapon = 'longshot';
    me.ammo.longshot = { mag: 5, reserve: 20 };
    const fwd = forwardOf(me.yaw);
    target.pos.x = me.pos.x + fwd.x * 5;
    target.pos.z = me.pos.z + fwd.z * 5;
    target.pos.y = 0;
    const moneyBefore = me.money;
    let dead = false;
    for (let i = 0; i < 120 && !dead; i++) {
      const dx = target.pos.x - me.pos.x;
      const dy = target.pos.y + 1.55 - (me.pos.y + 1.62);
      const dz = target.pos.z - me.pos.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      const fired = tryFire(m, me, m.time);
      if (fired === 'shot') resolveShot(m, me, { x: dx / l, y: dy / l, z: dz / l });
      dead = !target.alive;
      simStep(m, scriptedInput(), STEP);
    }
    check('hitscan kills a bot', dead);
    check('kill money awarded', me.money > moneyBefore);
    // Plant: freeze the bots, carry the Spike to Site A, hold E.
    m.staging = true;
    m.players.forEach((p) => { if (p.isBot && p.team === 'falcons') p.hasSpike = false; });
    me.hasSpike = true;
    m.spike.state = 'carried';
    m.spike.carrierId = me.id;
    me.pos.x = -22;
    me.pos.z = -8;
    me.pos.y = 0;
    step(4 * 60 + 30, scriptedInput({ use: true }));
    check('spike plants', m.spike.state === 'planted');
    // Bomb round continues with no defenders left.
    for (const p of m.players) {
      if (p.team === 'wardens' && p.alive) applyDamage(m, me, p, 999, 'torso');
    }
    step(120, scriptedInput());
    check('bomb round continues with no defenders', m.phase === 'live');
    m.spike.fuse = 0.05;
    step(30, scriptedInput());
    check('detonation ends the round Falcon', m.roundWinner === 'falcons');
    check('score recorded', m.score.falcons === 1);
    // No NaN anywhere in player state.
    let clean = true;
    for (const p of m.players) {
      for (const v of [p.pos.x, p.pos.y, p.pos.z, p.vel.x, p.vel.y, p.vel.z, p.yaw, p.pitch, p.hp, p.money, p.spread, p.recoil, p.planting, p.defusing]) {
        if (typeof v !== 'number' || !Number.isFinite(v)) clean = false;
      }
      for (const a of Object.values(p.ammo)) {
        if (!Number.isFinite(a.mag) || !Number.isFinite(a.reserve)) clean = false;
      }
    }
    check('no NaN in player state', clean);
  } catch (err) {
    lines.push(`FAIL self-test threw: ${err.message}`);
  }
  const text = lines.join('\n');
  window.__selftest = text;
  const pre = document.createElement('pre');
  pre.id = 'selftest';
  pre.textContent = text;
  pre.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;background:#000;color:#0f0;font-size:11px;padding:6px;margin:0';
  document.body.appendChild(pre);
  console.log(text);
}

boot();
