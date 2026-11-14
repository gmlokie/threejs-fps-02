// Kestrel Yard — HUD. All DOM: health and ammo, timer and score, team pips,
// killfeed, banners, the buy menu, the minimap, the plant bar, the flash
// white-out and the menu overlay. The renderer owns the canvas; this module
// owns every pixel of interface around it, reading the match state only.
import { MAP } from './map.js';
import { BUY_MENU, WEAPONS } from './weapons.js';
import { CSS } from './palette.js';

let el = {};
let minimap = null;
let mctx = null;

export function initHud() {
  const ids = ['timer', 'round-label', 'score-f', 'score-w', 'pips-f', 'pips-w',
    'health-num', 'health-bar', 'money', 'ammo-mag', 'ammo-reserve', 'weapon-name',
    'grenade-line', 'killfeed', 'banner', 'banner-title', 'banner-sub', 'buy-menu',
    'buy-list', 'buy-money', 'plant-wrap', 'plant-label', 'plant-fill', 'flash-overlay',
    'menu-overlay', 'menu-title', 'crosshair', 'hint', 'damage-vignette', 'spike-note'];
  el = {};
  for (const id of ids) el[id] = document.getElementById(id);
  minimap = document.getElementById('minimap');
  if (minimap) mctx = minimap.getContext('2d');
}

function fmtTime(t) {
  // Ceil with a small epsilon: 780 accumulated 1/60 steps leave the timer a
  // hair above the whole second and ceil would show one second too many.
  const s = Math.max(0, Math.ceil(t - 0.001));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function pips(container, alive, total, color) {
  if (!container) return;
  let html = '';
  for (let i = 0; i < total; i++) {
    html += `<span style="color:${i < alive ? color : '#4a4a52'}">●</span>`;
  }
  container.innerHTML = html;
}

export function updateHud(m, me, opts = {}) {
  if (!el.timer) return;
  const aliveF = m.players.filter((p) => p.team === 'falcons' && p.alive).length;
  const aliveW = m.players.filter((p) => p.team === 'wardens' && p.alive).length;
  el.timer.textContent = m.phase === 'matchEnd' ? '—' : fmtTime(m.roundTime);
  el['round-label'].textContent = `ROUND ${m.round} / 9`;
  el['score-f'].textContent = m.score.falcons;
  el['score-w'].textContent = m.score.wardens;
  pips(el['pips-f'], aliveF, 5, CSS.falcon);
  pips(el['pips-w'], aliveW, 5, CSS.warden);

  el['health-num'].textContent = Math.max(0, Math.round(me.hp));
  el['health-bar'].style.width = `${Math.max(0, me.hp)}%`;
  el['health-bar'].style.background = me.hp > 50 ? CSS.accent : CSS.danger;
  el.money.textContent = `$${me.money}`;
  const w = WEAPONS[me.weapon];
  const ammo = me.ammo[me.weapon];
  el['ammo-mag'].textContent = ammo.mag;
  el['ammo-reserve'].textContent = ammo.reserve;
  el['weapon-name'].textContent = w.name;
  el['grenade-line'].textContent = `FRAG x${me.grenades.frag}  FLASH x${me.grenades.flash}  [G]`;
  el['crosshair'].style.setProperty('--gap', `${6 + (opts.spread || 0) * 900}px`);
  const menuUp = el['menu-overlay'] && el['menu-overlay'].style.display !== 'none';
  el['crosshair'].style.opacity = me.alive && m.phase !== 'matchEnd' && !menuUp ? '1' : '0';

  // Killfeed (latest last).
  el.killfeed.innerHTML = m.killfeed.map((k) => `<div style="color:${k.team === 'falcons' ? CSS.falcon : CSS.warden}">${k.text}</div>`).join('');

  // Banner for round / match end.
  if (m.banner && m.time - m.banner.t < 4) {
    el.banner.style.display = 'block';
    el['banner-title'].textContent = m.banner.title;
    el['banner-sub'].textContent = m.banner.sub || '';
  } else {
    el.banner.style.display = 'none';
  }

  // Plant progress bar.
  const planting = me.planting > 0;
  const defusing = me.defusing > 0;
  if (planting || defusing) {
    el['plant-wrap'].style.display = 'block';
    el['plant-label'].textContent = planting ? 'PLANTING SPIKE' : 'DEFUSING SPIKE';
    el['plant-fill'].style.width = `${((planting ? me.planting / 3.5 : me.defusing / 5) * 100).toFixed(0)}%`;
  } else {
    el['plant-wrap'].style.display = 'none';
  }

  // Flash white-out and damage vignette.
  const flash = me.flash > 0 && m.time < me.blindUntil ? me.flash : 0;
  el['flash-overlay'].style.opacity = flash.toFixed(2);
  el['damage-vignette'].style.opacity = me.alive && me.hp < 45 ? String((45 - me.hp) / 45 * 0.8) : '0';

  // Spike carrier note.
  el['spike-note'].textContent = me.hasSpike ? 'YOU CARRY THE SPIKE — plant at Site A or B' : '';

  // Hint line: contextual, one line at a time.
  let hint = '';
  if (m.phase === 'buy') hint = 'Buy phase — press B for equipment';
  else if (me.hasSpike) hint = 'Hold E inside a site to plant the Spike';
  else if (m.spike.state === 'planted') hint = m.spike.site ? `Spike planted at Site ${m.spike.site} — ${Math.ceil(m.spike.fuse)}s to detonation` : '';
  el.hint.textContent = hint;

  drawMinimap(m, me);
}

function drawMinimap(m, me) {
  if (!mctx) return;
  const W = minimap.width;
  const H = minimap.height;
  const sx = (x) => ((x - MAP.bounds.minX) / (MAP.bounds.maxX - MAP.bounds.minX)) * W;
  const sy = (z) => ((z - MAP.bounds.minZ) / (MAP.bounds.maxZ - MAP.bounds.minZ)) * H;
  mctx.clearRect(0, 0, W, H);
  mctx.fillStyle = 'rgba(10, 14, 20, 0.85)';
  mctx.fillRect(0, 0, W, H);
  // Container blocks.
  mctx.fillStyle = '#5c5348';
  for (const b of MAP.colliders) {
    if (b.h >= 6) continue;
    mctx.fillRect(sx(b.minX), sy(b.minZ), Math.max(2, sx(b.maxX) - sx(b.minX)), Math.max(2, sy(b.maxZ) - sy(b.minZ)));
  }
  // Sites.
  mctx.font = 'bold 11px sans-serif';
  mctx.textAlign = 'center';
  mctx.textBaseline = 'middle';
  for (const s of MAP.sites) {
    mctx.fillStyle = s.id === 'A' ? CSS.falcon : CSS.warden;
    mctx.beginPath();
    mctx.arc(sx(s.x), sy(s.z), 7, 0, Math.PI * 2);
    mctx.fill();
    mctx.fillStyle = '#10141c';
    mctx.fillText(s.letter, sx(s.x), sy(s.z));
  }
  // Spike marker when planted/dropped.
  if ((m.spike.state === 'planted' || m.spike.state === 'dropped') && m.spike.pos) {
    mctx.fillStyle = '#ff5a3a';
    mctx.beginPath();
    mctx.arc(sx(m.spike.pos.x), sy(m.spike.pos.z), 4, 0, Math.PI * 2);
    mctx.fill();
  }
  // Players.
  for (const p of m.players) {
    if (!p.alive) continue;
    mctx.fillStyle = p.team === 'falcons' ? CSS.falcon : CSS.warden;
    mctx.beginPath();
    mctx.arc(sx(p.pos.x), sy(p.pos.z), p.id === me.id ? 4 : 2.5, 0, Math.PI * 2);
    mctx.fill();
    if (p.id === me.id) {
      mctx.strokeStyle = '#ffffff';
      mctx.lineWidth = 1.5;
      mctx.beginPath();
      mctx.arc(sx(p.pos.x), sy(p.pos.z), 6, 0, Math.PI * 2);
      mctx.stroke();
    }
  }
}

// Buy menu: rebuild the item rows with owned / short states.
export function renderBuyMenu(m, me) {
  if (!el['buy-list']) return;
  el['buy-money'].textContent = `$${me.money}`;
  el['buy-list'].innerHTML = BUY_MENU.map((item, i) => {
    let right;
    if (item.id === 'kevlar') right = me.owned.kevlar ? 'OWNED' : `$${item.price}`;
    else if (item.id === 'frag' || item.id === 'flash') right = me.grenades[item.id] > 0 ? 'OWNED' : `$${item.price}`;
    else if (me.owned[item.id]) right = me.weapon === item.id ? 'EQUIPPED' : 'OWNED';
    else right = `$${item.price}`;
    const short = !me.owned[item.id] && item.id !== 'frag' && item.id !== 'flash' && item.id !== 'kevlar' && me.money < item.price;
    const short2 = (item.id === 'frag' || item.id === 'flash' || item.id === 'kevlar') && me.money < item.price && !(item.id === 'frag' && me.grenades.frag > 0) && !(item.id === 'flash' && me.grenades.flash > 0) && !(item.id === 'kevlar' && me.owned.kevlar);
    const cls = short || short2 ? 'short' : '';
    return `<div class="buy-row ${cls}"><span class="buy-key">${i + 1}</span><span class="buy-name">${item.label}</span><span class="buy-price">${right}${short || short2 ? ' — short' : ''}</span></div>`;
  }).join('');
}

export function setBuyOpen(open) {
  if (el['buy-menu']) el['buy-menu'].style.display = open ? 'block' : 'none';
}

export function setMenuOpen(open, title) {
  if (!el['menu-overlay']) return;
  el['menu-overlay'].style.display = open ? 'flex' : 'none';
  if (title && el['menu-title']) el['menu-title'].textContent = title;
}
