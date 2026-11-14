// Kestrel Yard — palette. One place owns every colour so the dusk look stays
// consistent between the 3D scene, the HUD and the minimap. Dusk navy sky,
// sodium orange lamps and crane, warm tan containers, two team accents.
export const PALETTE = {
  skyTop: 0x232f45,
  skyBottom: 0x3a2f33,
  fog: 0x2a2f3d,
  ground: 0x5a4c3e,
  groundLine: 0x5a4f42,
  wall: 0x5c5348,
  wallDark: 0x453d33,
  containerA: 0x8a6b45,
  containerB: 0x6e5a3c,
  containerC: 0x7a5f3d,
  crate: 0x9a7b4f,
  crane: 0xe8a13a,
  craneDark: 0xb97a22,
  lamp: 0xffc46b,
  siteA: 0xe8a13a,
  siteB: 0x4ec9b0,
  falcon: 0xe8a13a,
  warden: 0x2fb8a6,
  falconDark: 0x8a5f1e,
  wardenDark: 0x1d7a6e,
  botSkin: 0x3a2f28,
  botVest: 0x4a5548,
  hudInk: '#e8e4da',
  hudMuted: '#9a958a',
  hudPanel: 'rgba(16, 20, 28, 0.82)',
  hudLine: 'rgba(232, 228, 218, 0.16)',
  accent: '#e8a13a',
  danger: '#e85a3a',
  ok: '#4ec9b0',
};

// CSS hex strings for the same accents, for HUD text.
export const CSS = {
  falcon: '#e8a13a',
  warden: '#2fb8a6',
  ink: '#e8e4da',
  muted: '#9a958a',
  accent: '#e8a13a',
  danger: '#e85a3a',
  ok: '#4ec9b0',
};

// A small helper: shade a hex colour toward black by f (0..1) for side faces.
export function shade(hex, f) {
  const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((hex & 255) * f)));
  return (r << 16) | (g << 8) | b;
}
