// Kestrel Yard — the one store. Every number the simulation reads or writes
// lives on the match object built here; rendering reads it, never the reverse.
// A match is 5v5, first to 5 rounds, at most 9 rounds, 100-second rounds whose
// first 15 seconds are the buy phase. Money, the Spike, grenades, the killfeed
// and the per-round events all live here so the self-test can drive the whole
// game without a browser frame.
import { makeRng } from './rng.js';
import { MAP } from './map.js';

export const ROUND_TIME = 100;
export const BUY_TIME = 15;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 5;
export const SPIKE_FUSE = 35;
export const START_MONEY = 1000;
export const KILL_MONEY = 300;
export const PLANT_MONEY = 300;
export const WIN_MONEY = 3000;
export const LOSS_MONEY = 1900;

export const FALCON_NAMES = ['Bram', 'Dax', 'Milo', 'Ren'];
export const WARDEN_NAMES = ['Kira', 'Tessa', 'Noor', 'Felix', 'Juna'];

// A fresh player: the human is falcons[0]; the other nine are bots.
export function makePlayer(id, name, team, isBot, spawn) {
  return {
    id, name, team, isBot,
    pos: { x: spawn.x, y: 0, z: spawn.z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: spawn.yaw, pitch: 0,
    hp: 100, armor: 0, alive: true,
    crouch: false, onGround: true,
    money: START_MONEY,
    kills: 0, deaths: 0,
    // Loadout: everyone starts with the P9 sidearm; Falcons start with the
    // VK-7 rifle and one frag already bought, like the buy menu shows.
    owned: { p9: true, vk7: team === 'falcons', hornet: false, longshot: false, frag: team === 'falcons', flash: false, kevlar: false },
    weapon: team === 'falcons' ? 'vk7' : 'p9',
    ammo: { p9: { mag: 12, reserve: 48 }, vk7: { mag: 30, reserve: 90 }, hornet: { mag: 32, reserve: 96 }, longshot: { mag: 5, reserve: 20 } },
    grenades: { frag: team === 'falcons' ? 1 : 0, flash: 0 },
    reloading: 0, reloadTotal: 0,
    spread: 0, recoil: 0, lastShotAt: -10, ads: false,
    flash: 0, blindUntil: 0,
    // Spike / objective progress.
    planting: 0, defusing: 0, hasSpike: false,
    // Bot brain (ignored for the human).
    ai: {
      state: 'route', lane: 0, wp: 0, holdUntil: 0, target: null,
      reactAt: 0, burstLeft: 0, burstAt: 0, investigate: null, hearAt: -10,
      strafeDir: 1, strafeAt: 0, plantSite: null, stuckAt: 0, lastPos: null,
    },
  };
}

export function createMatch(seed) {
  const rng = makeRng(seed);
  const falconSpawns = MAP.spawns.falcons;
  const wardenSpawns = MAP.spawns.wardens;
  const players = [];
  players.push(makePlayer(0, 'You', 'falcons', false, falconSpawns[0]));
  FALCON_NAMES.forEach((name, i) => {
    players.push(makePlayer(i + 1, name, 'falcons', true, falconSpawns[i + 1]));
  });
  WARDEN_NAMES.forEach((name, i) => {
    players.push(makePlayer(5 + i, name, 'wardens', true, wardenSpawns[i]));
  });
  // The Spike rides with a random Falcon bot at the start of every round.
  const carrier = players[1 + Math.floor(rng.next() * 4)];
  carrier.hasSpike = true;

  return {
    seed,
    rng,
    time: 0,
    round: 1,
    players,
    score: { falcons: 0, wardens: 0 },
    phase: 'buy', // buy | live | roundEnd | matchEnd
    phaseT: 0, // seconds spent in this phase
    roundTime: ROUND_TIME,
    spike: { state: 'carried', carrierId: carrier.id, site: null, pos: null, fuse: 0 },
    grenades: [], // live grenades: {kind, pos, vel, fuse, owner}
    tracers: [], // render-only, drained by main.js
    events: [], // {kind, ...} drained by main.js for sound/HUD
    killfeed: [], // {text, team, t}
    banner: null, // {title, sub, t}
    winner: null, // 'falcons' | 'wardens' once the match ends
    roundWinner: null,
    roundReason: '',
    // Which lanes the Falcon bots take this round (shuffled, seeded).
    lanes: [0, 1, 2, 0].sort(() => rng.next() - 0.5),
  };
}

// Start the next round: respawn everyone, reset the timer, re-deal the Spike.
export function startRound(m) {
  m.phase = 'buy';
  m.phaseT = 0;
  m.roundTime = ROUND_TIME;
  m.spike = { state: 'carried', carrierId: null, site: null, pos: null, fuse: 0 };
  m.grenades.length = 0;
  m.roundWinner = null;
  m.roundReason = '';
  m.players.forEach((p) => {
    p.hp = 100;
    p.alive = true;
    p.planting = 0;
    p.defusing = 0;
    p.flash = 0;
    p.reloading = 0;
    p.spread = 0;
    p.recoil = 0;
    p.hasSpike = false;
    const spawn = p.team === 'falcons'
      ? MAP.spawns.falcons[p.id]
      : MAP.spawns.wardens[p.id - 5];
    p.pos.x = spawn.x;
    p.pos.z = spawn.z;
    p.pos.y = 0;
    p.vel.x = 0;
    p.vel.y = 0;
    p.vel.z = 0;
    p.yaw = spawn.yaw;
    p.pitch = 0;
    p.ai.state = 'route';
    p.ai.wp = 0;
    p.ai.target = null;
    p.ai.investigate = null;
    p.ai.plantSite = null;
    p.ai.holdUntil = 0;
  });
  const bots = m.players.filter((p) => p.isBot && p.team === 'falcons');
  const carrier = bots[Math.floor(m.rng.next() * bots.length)];
  carrier.hasSpike = true;
  m.spike.carrierId = carrier.id;
  // Fresh lane draw each round.
  m.lanes = [0, 1, 2, 0].sort(() => m.rng.next() - 0.5);
  m.players.forEach((p, i) => {
    if (p.isBot && p.team === 'falcons') p.ai.lane = m.lanes[i % 4];
    if (p.isBot && p.team === 'wardens') p.ai.lane = i % 3;
  });
  pushEvent(m, { kind: 'roundStart', round: m.round });
}

export function aliveOf(m, team) {
  return m.players.filter((p) => p.team === team && p.alive);
}

export function pushEvent(m, ev) {
  ev.t = m.time;
  m.events.push(ev);
  if (m.events.length > 64) m.events.splice(0, m.events.length - 64);
}

export function feed(m, text, team) {
  m.killfeed.push({ text, team, t: m.time });
  if (m.killfeed.length > 5) m.killfeed.shift();
}

// End a round: score it, pay the teams, set the banner. The match ends when a
// team reaches WIN_ROUNDS or MAX_ROUNDS have been played.
export function endRound(m, winner, reason) {
  if (m.phase === 'roundEnd' || m.phase === 'matchEnd') return;
  m.roundWinner = winner;
  m.roundReason = reason;
  m.score[winner] += 1;
  m.players.forEach((p) => {
    p.money += p.team === winner ? WIN_MONEY : LOSS_MONEY;
  });
  m.banner = { title: winner === 'falcons' ? 'FALCONS TAKE THE ROUND' : 'WARDENS TAKE THE ROUND', sub: reason, t: m.time };
  pushEvent(m, { kind: 'roundEnd', winner, reason });
  const over = m.score.falcons >= WIN_ROUNDS || m.score.wardens >= WIN_ROUNDS || m.round >= MAX_ROUNDS;
  if (over) {
    m.phase = 'matchEnd';
    m.winner = m.score.falcons > m.score.wardens ? 'falcons' : m.score.wardens > m.score.falcons ? 'wardens' : 'falcons';
    m.banner = { title: m.winner === 'falcons' ? 'FALCONS WIN THE MATCH' : 'WARDENS WIN THE MATCH', sub: `${m.score.falcons} — ${m.score.wardens}`, t: m.time };
    pushEvent(m, { kind: 'matchEnd', winner: m.winner });
  } else {
    m.phase = 'roundEnd';
    m.phaseT = 0;
  }
}

// Advance to the next round after the roundEnd banner has shown.
export function nextRound(m) {
  m.round += 1;
  startRound(m);
}

// True when a value is a finite number; used by the self-test's NaN sweep.
export function isCleanNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
