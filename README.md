# Kestrel Yard — a three.js tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/gmlokie/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/gmlokie/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical first-person shooter in the Counter-Strike style,
built on three.js 0.187.0, running offline in a desktop browser from static
files. Single-player against bots; no network request, no build step.

## The game

Two teams of five fight over a dusk container yard. The Falcons attack: plant
the Spike at Site A (Crane Dock) or Site B (Warehouse), or eliminate the
Wardens. The Wardens defend. Rounds last 100 seconds; first to 5 rounds
takes the match (max 9 rounds). Money is earned per round, per kill and per
plant, and spent in the buy menu between rounds.

- **Gunplay** — hitscan weapons with head/torso/leg hitboxes (headshots deal
  4x), recoil and spread that punish firing on the move, aim-down-sights,
  crouching, acceleration-based movement and AABB collision with the map.
- **Arsenal** — P9 sidearm (free), VK-7 rifle, Hornet SMG, Longshot DMR,
  frag and flash grenades, Kevlar armour. Grenades arc, bounce and (frag)
  explode or (flash) white out anyone looking at them.
- **Tactics** — a Spike to plant (hold E in a site) and defuse, a buy menu,
  an economy, and bots that follow routes through three lanes, hold angles,
  react to gunfire they hear, rotate to the planted Spike, and plant/defuse.
- **Presentation** — an original map with lanes, corners and sightlines, dusk
  lighting with sodium lamps, a live minimap, killfeed, round timer, team
  strength pips, and fully synthesized WebAudio sound (no audio files).

## Controls

WASD move · mouse look · click fire · right mouse aim · R reload ·
G grenade · E plant Spike (hold, inside a site) · B buy menu (buy phase) ·
Ctrl crouch · Space jump · M mute.

## Play it

```sh
node serve.ts
# open http://localhost:8080 in desktop Chrome
```

Screenshot modes (deterministic, seeded): `?shot=menu|play|buy|plant&seed=1`.
Self-test: `?selftest=1` runs scripted checks and writes `window.__selftest`.

## Layout

- `game/index.html` — the page, HUD and the single import map for three.js
- `game/src/` — one module per job: `state` (the one store), `map`, `mover`,
  `weapons`, `combat`, `bots`, `audio`, `input`, `hud`, `main` (boot + the
  fixed 60 Hz simulation loop, kept apart from rendering)
- `game/vendor/three/` — three.js 0.187.0, byte for byte from npm
- `main.ts` — the entry program: copies game/ + screenshots/ to /output and
  writes dossier.json with the kit's vendored library
- `screenshots/` — real renders of this game's own code

## License

MIT — see LICENSE.
