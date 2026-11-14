// Kestrel Yard — bot brains. Five Falcon bots attack along three lanes, five
// Warden bots hold the sites and mid; both sides rotate to a planted Spike,
// plant and defuse, react to gunfire they hear, and hold angles. A bot is a
// small state machine (route / hold / engage / rotate / plant / defuse) with a
// reaction delay, burst fire and seeded aim error, so fights feel like
// duels rather than aimbots. Staging shots freeze them (see main.js).
import { MAP, segmentBlocked, siteAt } from './map.js';
import { movePlayer, forwardOf } from './mover.js';
import { tryFire, currentSpread, buyItem } from './weapons.js';
import { resolveShot, tickObjective } from './combat.js';

const SEE_DIST = 55;
const HEAR_DIST = 32;
const ENGAGE_DIST = 48;

// Buy for bots at the start of the buy phase: armour first, then a flash,
// then a better gun when the money is there.
export function botBuy(m, p) {
  if (p.money >= 650 && !p.owned.kevlar) buyItem(m, p, 'kevlar');
  if (p.money >= 200 && p.grenades.flash < 1 && m.rng.chance(0.6)) buyItem(m, p, 'flash');
  if (p.weapon === 'p9' && p.money >= 1500) buyItem(m, p, 'hornet');
}

// One bot step. dt is fixed. The bot reads the match, moves with movePlayer,
// fires through the same tryFire/resolveShot path as the human, and reports
// whether it is holding the use key (plant/defuse) via p.ai.holding.
export function botStep(m, p, dt) {
  const ai = p.ai;
  ai.holding = false;
  if (!p.alive) return;
  // Flashed bots freeze in place, crouched, until the white clears.
  if (m.time < p.blindUntil) {
    p.crouch = true;
    movePlayer(m, p, { f: 0, s: 0, jump: false, crouch: true, ads: false }, dt);
    return;
  }
  p.crouch = false;

  // --- Perception: nearest visible enemy, with a reaction delay. ---
  const enemy = visibleEnemy(m, p);
  if (enemy && ai.target !== enemy.id) {
    ai.target = enemy.id;
    ai.reactAt = m.time + m.rng.range(0.28, 0.5);
    ai.burstLeft = 0;
  } else if (!enemy) {
    ai.target = null;
  }
  const target = enemy && m.time >= ai.reactAt ? enemy : null;

  // --- Objective state: plant / defuse / rotate to a planted Spike. ---
  if (m.spike.state === 'planted' && m.spike.pos) {
    const d = Math.hypot(p.pos.x - m.spike.pos.x, p.pos.z - m.spike.pos.z);
    if (p.team === 'wardens' && d < 2.0) {
      ai.state = 'defuse';
      ai.holding = true;
      aimAt(m, p, m.spike.pos.x, m.spike.pos.y + 1, m.spike.pos.z, dt, 2.5);
      movePlayer(m, p, { f: 0, s: 0, jump: false, crouch: false, ads: false }, dt);
      return;
    }
    if (p.team === 'falcons' && d > 6) ai.state = 'rotate';
    if (p.team === 'wardens') ai.state = 'rotate';
  }
  if (p.team === 'falcons' && p.hasSpike && m.spike.state === 'carried') {
    const site = siteAt(p.pos.x, p.pos.z);
    if (site) {
      ai.state = 'plant';
      ai.holding = true;
      movePlayer(m, p, { f: 0, s: 0, jump: false, crouch: true, ads: false }, dt);
      return;
    }
    ai.state = 'route';
    ai.plantSite = ai.plantSite || (MAP.sites[Math.abs(p.pos.x) < 1 ? 0 : p.pos.x < 0 ? 0 : 1]);
  }

  // --- Combat: face the target, strafe, fire in bursts. ---
  if (target) {
    ai.state = 'engage';
    const tx = target.pos.x;
    const ty = target.pos.y + (target.crouch ? 1.0 : 1.35);
    const tz = target.pos.z;
    aimAt(m, p, tx, ty, tz, dt, 4.5);
    if (m.time > ai.strafeAt) {
      ai.strafeDir = m.rng.chance(0.5) ? 1 : -1;
      ai.strafeAt = m.time + m.rng.range(0.7, 1.5);
    }
    const input = { f: 0, s: ai.strafeDir * 0.6, jump: false, crouch: false, ads: m.rng.chance(0.7) };
    movePlayer(m, p, input, dt);
    if (m.time >= ai.burstAt) {
      if (ai.burstLeft <= 0) {
        ai.burstLeft = p.weapon === 'longshot' ? 1 : 3 + Math.floor(m.rng.next() * 3);
        ai.burstAt = m.time + m.rng.range(0.45, 0.9);
      }
    }
    if (ai.burstLeft > 0 && m.time >= ai.reactAt) {
      const fired = tryFire(m, p, m.time);
      if (fired === 'shot') {
        ai.burstLeft -= 1;
        const dir = aimDir(m, p, tx, ty, tz);
        resolveShot(m, p, dir);
      } else if (fired === 'dry') {
        ai.burstLeft = 0;
      }
    }
    return;
  }

  // --- Hearing: a gunshot nearby pulls the bot toward the sound. ---
  const heard = hearShot(m, p);
  if (heard && ai.state !== 'rotate') {
    ai.investigate = heard;
    ai.state = 'investigate';
  }

  // --- Movement along the route / investigation / rotation. ---
  let dest = null;
  if (ai.state === 'rotate' && m.spike.pos) {
    dest = { x: m.spike.pos.x, z: m.spike.pos.z };
  } else if (ai.state === 'investigate' && ai.investigate) {
    dest = ai.investigate;
  } else if (p.hasSpike && m.spike.state === 'carried') {
    // The carrier always walks to the nearer site, whatever its lane was.
    const a = MAP.sites[0];
    const b = MAP.sites[1];
    const da = Math.hypot(p.pos.x - a.x, p.pos.z - a.z);
    const db = Math.hypot(p.pos.x - b.x, p.pos.z - b.z);
    dest = da < db ? { x: a.x, z: a.z } : { x: b.x, z: b.z };
  } else {
    const lane = MAP.lanes[ai.lane || 0];
    const wp = lane[Math.min(ai.wp, lane.length - 1)];
    dest = wp;
    if (p.team === 'wardens') {
      const hold = MAP.wardenHolds[p.id - 5] || MAP.wardenHolds[0];
      dest = ai.wp === 0 ? hold : lane[Math.min(ai.wp, lane.length - 1)];
    }
  }
  const dx = dest.x - p.pos.x;
  const dz = dest.z - p.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1.4) {
    if (ai.state === 'investigate') {
      ai.state = 'route';
      ai.investigate = null;
    } else if (ai.state === 'rotate') {
      ai.state = 'hold';
      ai.holdUntil = m.time + 2.5;
    } else {
      const lane = MAP.lanes[ai.lane || 0];
      if (ai.wp < lane.length - 1) {
        ai.wp += 1;
      } else {
        ai.state = 'hold';
        ai.holdUntil = m.time + m.rng.range(2, 4.5);
      }
    }
    // Hold: scan the lane slowly instead of standing frozen.
    p.yaw += Math.sin(m.time * 0.7 + p.id) * 0.35 * dt;
    movePlayer(m, p, { f: 0, s: 0, jump: false, crouch: false, ads: false }, dt);
    return;
  }
  if (ai.state === 'hold' && m.time < ai.holdUntil) {
    p.yaw += Math.sin(m.time * 0.7 + p.id) * 0.5 * dt;
    movePlayer(m, p, { f: 0, s: 0, jump: false, crouch: false, ads: false }, dt);
    return;
  }
  if (ai.state === 'hold') ai.state = 'route';
  // Turn toward the destination and walk.
  const wantYaw = Math.atan2(-dx, -dz);
  p.yaw = turnToward(p.yaw, wantYaw, 5 * dt);
  const fwd = forwardOf(p.yaw);
  const dot = fwd.x * (dx / dist) + fwd.z * (dz / dist);
  const input = { f: dot > 0.3 ? 1 : 0.3, s: 0, jump: false, crouch: false, ads: false };
  // Hop a low crate if it blocks the way straight ahead.
  const ahead = { x: p.pos.x + fwd.x * 1.2, z: p.pos.z + fwd.z * 1.2 };
  const blocker = MAP.colliders.find((b) => ahead.x > b.minX && ahead.x < b.maxX && ahead.z > b.minZ && ahead.z < b.maxZ && b.h <= 1.05);
  if (blocker && p.onGround) input.jump = true;
  // Stuck detection: barely moved while routing for 2 s -> skip a waypoint.
  if (!ai.lastPos) ai.lastPos = { x: p.pos.x, z: p.pos.z, t: m.time };
  if (m.time - ai.lastPos.t > 2) {
    const moved = Math.hypot(p.pos.x - ai.lastPos.x, p.pos.z - ai.lastPos.z);
    if (moved < 0.4 && ai.state === 'route') ai.wp = Math.min(ai.wp + 1, MAP.lanes[ai.lane || 0].length - 1);
    ai.lastPos = { x: p.pos.x, z: p.pos.z, t: m.time };
  }
  movePlayer(m, p, input, dt);
}

// Nearest enemy the bot can see: in range, roughly in front, line of sight.
export function visibleEnemy(m, p) {
  let best = null;
  let bestD = Infinity;
  const eyeY = p.pos.y + 1.55;
  for (const q of m.players) {
    if (!q.alive || q.team === p.team) continue;
    const dx = q.pos.x - p.pos.x;
    const dz = q.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > SEE_DIST || d > bestD) continue;
    // Roughly in front (150-degree cone) unless very close.
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const facing = (fx * dx + fz * dz) / (d || 1);
    if (d > 6 && facing < -0.1) continue;
    if (segmentBlocked(p.pos.x, eyeY, p.pos.z, q.pos.x, q.pos.y + 1.3, q.pos.z)) continue;
    best = q;
    bestD = d;
  }
  return best;
}

// A recent shot event near the bot (hearing). Returns a point or null.
function hearShot(m, p) {
  for (let i = m.events.length - 1; i >= 0; i--) {
    const ev = m.events[i];
    if (ev.kind !== 'shot' || m.time - ev.t > 1.2) continue;
    const shooter = m.players[ev.player];
    if (!shooter || shooter.team === p.team) continue;
    const d = Math.hypot(shooter.pos.x - p.pos.x, shooter.pos.z - p.pos.z);
    if (d < HEAR_DIST) return { x: shooter.pos.x, z: shooter.pos.z };
  }
  return null;
}

// Turn the bot's yaw toward a point, limited by a turn rate.
function aimAt(m, p, x, y, z, dt, rate) {
  const dx = x - p.pos.x;
  const dz = z - p.pos.z;
  const wantYaw = Math.atan2(-dx, -dz);
  p.yaw = turnToward(p.yaw, wantYaw, rate * dt);
  const dy = y - (p.pos.y + 1.55);
  const dist = Math.hypot(dx, dz);
  const wantPitch = Math.atan2(dy, dist || 1);
  p.pitch += Math.max(-rate * dt, Math.min(rate * dt, wantPitch - p.pitch));
}

// Aim direction from the eye to a point, with seeded error that grows with
// distance and the weapon's spread — bots miss, especially far away.
function aimDir(m, p, x, y, z) {
  const ex = p.pos.x;
  const ey = p.pos.y + 1.55;
  const ez = p.pos.z;
  let dx = x - ex;
  let dy = y - ey;
  let dz = z - ez;
  const len = Math.hypot(dx, dy, dz) || 1;
  const err = currentSpread(m, p) * 2.2 + len * 0.0009;
  dx += m.rng.gauss() * err * len;
  dy += m.rng.gauss() * err * len;
  dz += m.rng.gauss() * err * len;
  const l = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / l, y: dy / l, z: dz / l };
}

export function turnToward(yaw, want, maxStep) {
  let d = want - yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return yaw + Math.max(-maxStep, Math.min(maxStep, d));
}

// Exposed for the self-test and main loop: hold the use key for this bot.
export function botHolding(p) {
  return !!p.ai.holding;
}
