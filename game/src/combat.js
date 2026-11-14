// Kestrel Yard — combat. Hitscan resolution (wall ray first, then player
// hitboxes), damage with head/torso/leg zones and Kevlar, kill rewards,
// grenade arcs and blasts, Spike plant/defuse/detonation, and the checks that
// end a round. Everything here is deterministic sim: no rendering, no sound.
import { MAP, rayHitWall, siteAt } from './map.js';
import { eyeHeight } from './mover.js';
import { WEAPONS, FRAG_RADIUS, FRAG_DAMAGE, FLASH_RADIUS } from './weapons.js';
import { pushEvent, feed, endRound, KILL_MONEY, PLANT_MONEY, PLANT_TIME, DEFUSE_TIME, SPIKE_FUSE } from './state.js';

// Resolve one hitscan shot from a player. dir is the (already spread) unit
// direction; origin is the eye. Returns the hit player and zone, or null.
export function resolveShot(m, shooter, dir) {
  const w = WEAPONS[shooter.weapon];
  const ox = shooter.pos.x;
  const oy = eyeHeight(shooter);
  const oz = shooter.pos.z;
  const wallT = rayHitWall(ox, oy, oz, dir.x, dir.y, dir.z, w.range);
  let best = null;
  let bestT = wallT;
  for (const p of m.players) {
    if (!p.alive || p.id === shooter.id) continue;
    const hit = rayVsPlayer(ox, oy, oz, dir, p);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      best = { player: p, zone: hit.zone, t: hit.t };
    }
  }
  const end = {
    x: ox + dir.x * Math.min(bestT, w.range),
    y: oy + dir.y * Math.min(bestT, w.range),
    z: oz + dir.z * Math.min(bestT, w.range),
  };
  m.tracers.push({ from: { x: ox, y: oy, z: oz }, to: end, t: m.time, shooter: shooter.id });
  if (m.tracers.length > 24) m.tracers.shift();
  if (!best) return null;
  applyDamage(m, shooter, best.player, w.damage, best.zone);
  return best;
}

// Ray vs a player's three hit zones: head sphere, torso box, legs box.
// Returns {t, zone} for the nearest zone hit, or null.
export function rayVsPlayer(ox, oy, oz, dir, p) {
  const cx = p.pos.x;
  const cz = p.pos.z;
  const crouch = p.crouch;
  const headY = p.pos.y + (crouch ? 0.95 : 1.55);
  const headR = 0.24;
  // Head: ray-sphere.
  const hx = cx - ox;
  const hy = headY - oy;
  const hz = cz - oz;
  const b = hx * dir.x + hy * dir.y + hz * dir.z;
  let best = null;
  if (b > 0) {
    const d2 = hx * hx + hy * hy + hz * hz - b * b;
    if (d2 < headR * headR) {
      const t = b - Math.sqrt(headR * headR - d2);
      if (t > 0) best = { t, zone: 'head' };
    }
  }
  // Torso and legs: ray vs vertical slabs, approximated as boxes.
  const torso = rayVsZone(ox, oy, oz, dir, cx, cz, p.pos.y + (crouch ? 0.55 : 0.85), p.pos.y + (crouch ? 1.0 : 1.5), 0.42);
  if (torso && (!best || torso.t < best.t)) best = { t: torso.t, zone: 'torso' };
  const legs = rayVsZone(ox, oy, oz, dir, cx, cz, p.pos.y, p.pos.y + (crouch ? 0.55 : 0.85), 0.38);
  if (legs && (!best || legs.t < best.t)) best = { t: legs.t, zone: 'legs' };
  return best;
}

function rayVsZone(ox, oy, oz, dir, cx, cz, y0, y1, half) {
  // Slab test on x/z, then check the y range at the entry distance.
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [ox, dir.x, cx - half, cx + half],
    [oz, dir.z, cz - half, cz + half],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  const y = oy + dir.y * tmin;
  if (y < y0 || y > y1) return null;
  return { t: tmin };
}

// Damage with zone multiplier and Kevlar (halves damage while armour lasts).
export function applyDamage(m, attacker, victim, base, zone) {
  let mult = 1;
  if (zone === 'head') mult = 4;
  else if (zone === 'legs') mult = 0.75;
  let dmg = Math.round(base * mult);
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, Math.round(dmg * 0.5));
    victim.armor -= absorbed;
    dmg -= absorbed;
  }
  victim.hp -= dmg;
  pushEvent(m, { kind: 'hit', attacker: attacker.id, victim: victim.id, zone, dmg, hp: Math.max(0, victim.hp) });
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths += 1;
    attacker.kills += 1;
    attacker.money += KILL_MONEY;
    feed(m, `${attacker.name} eliminated ${victim.name}`, attacker.team);
    pushEvent(m, { kind: 'kill', attacker: attacker.id, victim: victim.id });
    if (victim.hasSpike) {
      victim.hasSpike = false;
      // The Spike drops where its carrier fell; a Falcon can pick it up.
      m.spike.state = 'dropped';
      m.spike.carrierId = null;
      m.spike.pos = { x: victim.pos.x, z: victim.pos.z };
      pushEvent(m, { kind: 'spikeDropped', x: victim.pos.x, z: victim.pos.z });
    }
  }
}

// Grenade physics: gravity, bounce off the ground and walls (damped), fuse.
export function tickGrenades(m, dt) {
  for (let i = m.grenades.length - 1; i >= 0; i--) {
    const g = m.grenades[i];
    g.vel.y -= 12 * dt;
    g.pos.x += g.vel.x * dt;
    g.pos.y += g.vel.y * dt;
    g.pos.z += g.vel.z * dt;
    if (g.pos.y < 0.12) {
      g.pos.y = 0.12;
      g.vel.y = Math.abs(g.vel.y) * 0.42;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
      g.bounced += 1;
    }
    // Simple wall bounce: clamp to the yard and reflect.
    if (g.pos.x < MAP.bounds.minX + 0.1 || g.pos.x > MAP.bounds.maxX - 0.1) {
      g.vel.x *= -0.45;
      g.pos.x = Math.max(MAP.bounds.minX + 0.1, Math.min(MAP.bounds.maxX - 0.1, g.pos.x));
      g.bounced += 1;
    }
    if (g.pos.z < MAP.bounds.minZ + 0.1 || g.pos.z > MAP.bounds.maxZ - 0.1) {
      g.vel.z *= -0.45;
      g.pos.z = Math.max(MAP.bounds.minZ + 0.1, Math.min(MAP.bounds.maxZ - 0.1, g.pos.z));
      g.bounced += 1;
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      detonateGrenade(m, g);
      m.grenades.splice(i, 1);
    }
  }
}

function detonateGrenade(m, g) {
  if (g.kind === 'frag') {
    pushEvent(m, { kind: 'explosion', x: g.pos.x, y: g.pos.y, z: g.pos.z, radius: FRAG_RADIUS });
    for (const p of m.players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.pos.x - g.pos.x, (p.pos.y + 0.9) - g.pos.y, p.pos.z - g.pos.z);
      if (d < FRAG_RADIUS) {
        const dmg = Math.round(FRAG_DAMAGE * (1 - d / (FRAG_RADIUS * 1.15)));
        const owner = m.players[g.owner];
        if (owner && p.id !== g.owner) applyDamage(m, owner, p, dmg, 'torso');
        else if (p.id === g.owner) applyDamage(m, owner || p, p, Math.round(dmg * 0.5), 'torso');
      }
    }
  } else {
    pushEvent(m, { kind: 'flash', x: g.pos.x, y: g.pos.y, z: g.pos.z });
    for (const p of m.players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.pos.x - g.pos.x, (p.pos.y + 1.5) - g.pos.y, p.pos.z - g.pos.z);
      if (d > FLASH_RADIUS) continue;
      // Flashed only when looking toward the burst (dot of view dir vs burst).
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      const tx = (g.pos.x - p.pos.x) / (d || 1);
      const tz = (g.pos.z - p.pos.z) / (d || 1);
      const facing = fx * tx + fz * tz;
      if (facing > -0.15) {
        p.flash = Math.max(p.flash, 1 - d / (FLASH_RADIUS * 1.3));
        p.blindUntil = m.time + 1.2 + p.flash * 1.6;
      }
    }
  }
}

// Plant / defuse progress. Called every sim step for the player holding E.
export function tickObjective(m, p, dt, holding) {
  const site = siteAt(p.pos.x, p.pos.z);
  if (p.team === 'falcons' && p.hasSpike && site && m.spike.state === 'carried' && holding) {
    p.planting += dt;
    if (p.planting >= PLANT_TIME) {
      p.planting = 0;
      m.spike.state = 'planted';
      m.spike.site = site.id;
      m.spike.pos = { x: site.x, z: site.z };
      m.spike.fuse = SPIKE_FUSE;
      p.hasSpike = false;
      p.money += PLANT_MONEY;
      feed(m, `Spike planted at Site ${site.id}`, 'falcons');
      pushEvent(m, { kind: 'planted', site: site.id });
    }
  } else {
    p.planting = Math.max(0, p.planting - dt * 2);
  }
  if (p.team === 'wardens' && m.spike.state === 'planted' && m.spike.pos
    && Math.hypot(p.pos.x - m.spike.pos.x, p.pos.z - m.spike.pos.z) < 2.2 && holding) {
    p.defusing += dt;
    if (p.defusing >= DEFUSE_TIME) {
      p.defusing = 0;
      m.spike.state = 'defused';
      endRound(m, 'wardens', 'The Spike was defused');
    }
  } else {
    p.defusing = Math.max(0, p.defusing - dt * 2);
  }
  // Pick up a dropped Spike by walking over it.
  if (p.team === 'falcons' && m.spike.state === 'dropped' && m.spike.pos
    && Math.hypot(p.pos.x - m.spike.pos.x, p.pos.z - m.spike.pos.z) < 1.2) {
    p.hasSpike = true;
    m.spike.state = 'carried';
    m.spike.carrierId = p.id;
    m.spike.pos = null;
    pushEvent(m, { kind: 'spikePickup', player: p.id });
  }
}

// Spike fuse countdown; detonation ends the round for the Falcons even if the
// Wardens are all dead — that is the bomb round's whole point.
export function tickSpike(m, dt) {
  if (m.spike.state !== 'planted') return;
  m.spike.fuse -= dt;
  if (m.spike.fuse <= 0) {
    m.spike.state = 'detonated';
    pushEvent(m, { kind: 'detonation', site: m.spike.site });
    endRound(m, 'falcons', 'The Spike detonated');
  }
}

// Round-end checks: elimination wins only while the Spike is not ticking,
// and the clock running out favours the defending Wardens.
export function checkRoundEnd(m) {
  if (m.phase !== 'live') return;
  const falcons = m.players.filter((p) => p.team === 'falcons' && p.alive).length;
  const wardens = m.players.filter((p) => p.team === 'wardens' && p.alive).length;
  if (m.spike.state === 'planted') return; // spike decides the round now
  if (falcons === 0 && wardens > 0) endRound(m, 'wardens', 'Falcons eliminated');
  else if (wardens === 0 && falcons > 0) endRound(m, 'falcons', 'Wardens eliminated');
  else if (falcons === 0 && wardens === 0) endRound(m, 'wardens', 'Both teams down');
  else if (m.roundTime <= 0) endRound(m, 'wardens', 'Time expired — Wardens hold');
}
