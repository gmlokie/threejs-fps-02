// Kestrel Yard — weapons. The arsenal, its numbers, firing with recoil and
// spread, reloading, grenade throws and the buy menu economy. Firing is
// hitscan: this file decides when a shot goes out and how wild it is;
// combat.js decides what it hits.
import { pushEvent } from './state.js';

export const WEAPONS = {
  p9: {
    name: 'P9 Sidearm', kind: 'pistol', price: 0, damage: 26, headMult: 4, legMult: 0.75,
    rate: 0.16, mag: 12, reserveMax: 48, reload: 1.4, spread: 0.011, moveSpread: 0.02,
    recoil: 0.011, range: 60, auto: false, color: 0x8a7a5a,
  },
  vk7: {
    name: 'VK-7 Rifle', kind: 'rifle', price: 2500, damage: 34, headMult: 4, legMult: 0.75,
    rate: 0.115, mag: 30, reserveMax: 90, reload: 2.3, spread: 0.007, moveSpread: 0.016,
    recoil: 0.014, range: 90, auto: true, color: 0xc9a06a,
  },
  hornet: {
    name: 'Hornet SMG', kind: 'smg', price: 1500, damage: 22, headMult: 4, legMult: 0.75,
    rate: 0.075, mag: 32, reserveMax: 96, reload: 2.0, spread: 0.013, moveSpread: 0.014,
    recoil: 0.009, range: 45, auto: true, color: 0x7a8a9a,
  },
  longshot: {
    name: 'Longshot DMR', kind: 'dmr', price: 4000, damage: 88, headMult: 4, legMult: 0.75,
    rate: 0.9, mag: 5, reserveMax: 20, reload: 3.0, spread: 0.0015, moveSpread: 0.03,
    recoil: 0.05, range: 120, auto: false, color: 0x5a6e5a,
  },
};

export const BUY_MENU = [
  { id: 'vk7', label: 'VK-7 Rifle', price: 2500 },
  { id: 'hornet', label: 'Hornet SMG', price: 1500 },
  { id: 'longshot', label: 'Longshot DMR', price: 4000 },
  { id: 'frag', label: 'Frag Grenade', price: 300 },
  { id: 'flash', label: 'Flash Grenade', price: 200 },
  { id: 'kevlar', label: 'Kevlar Armour', price: 650 },
];

export const GRENADE_SPEED = 13;
export const FRAG_RADIUS = 7;
export const FRAG_DAMAGE = 95;
export const FLASH_RADIUS = 22;

// Current spread for a shot: base + movement + air + accumulated recoil bloom.
// Stopping to aim pays: firing on the move or in the air is far wilder.
export function currentSpread(m, p) {
  const w = WEAPONS[p.weapon];
  const moving = Math.hypot(p.vel.x, p.vel.z);
  let s = w.spread + p.spread;
  s += (moving / 5.4) * w.moveSpread;
  if (!p.onGround) s += 0.02;
  if (p.ads) s *= 0.45;
  if (p.crouch) s *= 0.8;
  return s;
}

// Try to fire one shot. Returns 'shot' | 'dry' | 'wait'. The caller (main loop
// or bot brain) asks every step while the trigger is held; rate limits here.
export function tryFire(m, p, now) {
  const w = WEAPONS[p.weapon];
  const ammo = p.ammo[p.weapon];
  if (p.reloading > 0 || !p.alive) return 'wait';
  if (now - p.lastShotAt < w.rate) return 'wait';
  if (ammo.mag <= 0) {
    p.lastShotAt = now;
    pushEvent(m, { kind: 'dry', player: p.id });
    startReload(m, p);
    return 'dry';
  }
  ammo.mag -= 1;
  p.lastShotAt = now;
  p.spread = Math.min(0.05, p.spread + w.recoil * 0.55);
  p.recoil = Math.min(0.09, p.recoil + w.recoil);
  pushEvent(m, { kind: 'shot', player: p.id, weapon: p.weapon, spread: currentSpread(m, p) });
  return 'shot';
}

// Spread bloom decays when not firing.
export function decayBloom(p, dt) {
  p.spread = Math.max(0, p.spread - dt * 0.06);
  p.recoil = Math.max(0, p.recoil - dt * 0.22);
}

export function startReload(m, p) {
  const w = WEAPONS[p.weapon];
  const ammo = p.ammo[p.weapon];
  if (p.reloading > 0 || ammo.mag >= w.mag || ammo.reserve <= 0) return false;
  p.reloading = w.reload;
  p.reloadTotal = w.reload;
  pushEvent(m, { kind: 'reload', player: p.id, weapon: p.weapon });
  return true;
}

export function tickReload(m, p, dt) {
  if (p.reloading <= 0) return;
  p.reloading -= dt;
  if (p.reloading <= 0) {
    p.reloading = 0;
    const w = WEAPONS[p.weapon];
    const ammo = p.ammo[p.weapon];
    const need = w.mag - ammo.mag;
    const take = Math.min(need, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
  }
}

// Throw a grenade from the player's eye, arcing forward. Returns the grenade.
export function throwGrenade(m, p, kind) {
  if (p.grenades[kind] <= 0 || !p.alive) return null;
  p.grenades[kind] -= 1;
  const yaw = p.yaw;
  const pitch = p.pitch;
  const fx = -Math.sin(yaw) * Math.cos(pitch);
  const fy = Math.sin(pitch) + 0.32;
  const fz = -Math.cos(yaw) * Math.cos(pitch);
  const g = {
    kind, owner: p.id,
    pos: { x: p.pos.x, y: p.pos.y + 1.4, z: p.pos.z },
    vel: { x: fx * GRENADE_SPEED, y: fy * GRENADE_SPEED + 2.5, z: fz * GRENADE_SPEED },
    fuse: kind === 'frag' ? 2.2 : 1.4, bounced: 0,
  };
  m.grenades.push(g);
  pushEvent(m, { kind: 'throw', player: p.id, kind });
  return g;
}

// Buy one menu item during the buy phase. Returns a message for the HUD.
export function buyItem(m, p, id) {
  if (m.phase !== 'buy') return 'Buy phase is over';
  const item = BUY_MENU.find((b) => b.id === id);
  if (!item) return 'Unknown item';
  if (id === 'kevlar') {
    if (p.owned.kevlar) return 'Kevlar already owned';
    if (p.money < item.price) return `Need $${item.price}`;
    p.money -= item.price;
    p.owned.kevlar = true;
    p.armor = 100;
    return 'Kevlar bought';
  }
  if (id === 'frag' || id === 'flash') {
    if (p.grenades[id] >= 2) return 'Carrying max grenades';
    if (p.money < item.price) return `Need $${item.price}`;
    p.money -= item.price;
    p.grenades[id] += 1;
    p.owned[id] = true;
    return `${item.label} bought`;
  }
  if (p.owned[id]) {
    p.weapon = id;
    return `${item.label} equipped`;
  }
  if (p.money < item.price) return `Need $${item.price}`;
  p.money -= item.price;
  p.owned[id] = true;
  p.weapon = id;
  return `${item.label} bought`;
}
