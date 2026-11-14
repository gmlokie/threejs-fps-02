// Kestrel Yard — the map. One original dusk container yard: 64 x 44 metres,
// perimeter walls, a crane gantry over Site A (west), a warehouse block behind
// Site B (east), three lanes (A / mid / B) threaded with containers, and
// seeded waypoints for the bots. This file owns the pure data — colliders,
// sites, spawns, waypoints and the ray tests — and a mesh builder the renderer
// calls with three.js passed in, so the simulation never touches the GPU.
import { PALETTE } from './palette.js';

// An axis-aligned box collider: centre (x, z), footprint (w, d), height h.
function box(x, z, w, d, h) {
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h };
}

const WALL_H = 6;
const colliders = [
  // Perimeter walls.
  box(0, -22.5, 66, 1, WALL_H), box(0, 22.5, 66, 1, WALL_H),
  box(-32.5, 0, 1, 46, WALL_H), box(32.5, 0, 1, 46, WALL_H),
  // Site A crane legs + the warehouse block behind Site B.
  box(-26, -8, 1.2, 1.2, 7), box(-18, -8, 1.2, 1.2, 7),
  box(26, -16, 10, 4, 5),
  // Mid lane containers.
  box(0, 2, 6, 2, 2.6), box(-5, -4, 4, 2, 2.6), box(5, -6, 4, 2, 2.6),
  box(0, -12, 3, 3, 1.0),
  // A lane containers.
  box(-14, 6, 5, 2, 2.6), box(-20, 2, 2, 4, 2.6), box(-12, -12, 4, 2, 2.6),
  // B lane containers.
  box(14, 6, 5, 2, 2.6), box(20, 2, 2, 4, 2.6), box(12, -12, 4, 2, 2.6),
  // Low crates near both spawns (jumpable cover, 1.0 m high).
  box(-2, 12, 3, 2, 1.0), box(6, 12, 3, 2, 1.0),
  box(-6, -16, 3, 2, 1.0), box(4, -16, 3, 2, 1.0),
];

// Waypoints: three Falcon attack lanes and Warden hold spots. Each lane is a
// list of {x, z} from the Falcon spawn toward a site; Wardens hold near the
// sites and mid, then rotate.
const lanes = [
  [ // A lane (west, crane side)
    { x: -8, z: 18 }, { x: -14, z: 10 }, { x: -18, z: 2 }, { x: -22, z: -4 }, { x: -22, z: -8 },
  ],
  [ // Mid lane
    { x: 0, z: 18 }, { x: 0, z: 10 }, { x: -3, z: 2 }, { x: 2, z: -6 }, { x: 0, z: -12 },
  ],
  [ // B lane (east, warehouse side)
    { x: 8, z: 18 }, { x: 14, z: 10 }, { x: 18, z: 2 }, { x: 22, z: -4 }, { x: 22, z: -8 },
  ],
];

const wardenHolds = [
  { x: -18, z: -13 }, { x: 0, z: -14 }, { x: 18, z: -13 },
  { x: -8, z: -8 }, { x: 8, z: -8 },
];

export const MAP = {
  bounds: { minX: -32, maxX: 32, minZ: -22, maxZ: 22 },
  colliders,
  sites: [
    { id: 'A', letter: 'A', x: -22, z: -8, r: 5 },
    { id: 'B', letter: 'B', x: 22, z: -8, r: 5 },
  ],
  spawns: {
    falcons: [
      { x: -12, z: 18, yaw: 0 }, { x: -6, z: 18, yaw: 0 }, { x: 0, z: 18, yaw: 0 },
      { x: 6, z: 18, yaw: 0 }, { x: 12, z: 18, yaw: 0 },
    ],
    wardens: [
      { x: -12, z: -18, yaw: Math.PI }, { x: -6, z: -18, yaw: Math.PI }, { x: 0, z: -18, yaw: Math.PI },
      { x: 6, z: -18, yaw: Math.PI }, { x: 12, z: -18, yaw: Math.PI },
    ],
  },
  lanes,
  wardenHolds,
  lamps: [
    { x: -8, z: 0 }, { x: 8, z: 0 }, { x: 0, z: -14 }, { x: -24, z: 10 }, { x: 24, z: 10 },
  ],
};

// Slab-method ray vs one AABB. Returns the distance along the ray, or Infinity.
export function rayVsBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [ox, dx, b.minX, b.maxX], [oy, dy, 0, b.h], [oz, dz, b.minZ, b.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Nearest wall hit along a ray (origin + dir * t, t <= maxDist), or Infinity.
export function rayHitWall(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = Infinity;
  for (const b of colliders) {
    const t = rayVsBox(ox, oy, oz, dx, dy, dz, b);
    if (t < best && t <= maxDist) best = t;
  }
  return best;
}

// True when the segment between two points is blocked by any collider.
export function segmentBlocked(x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return false;
  const t = rayHitWall(x0, y0, z0, dx / len, dy / len, dz / len, len);
  return t !== Infinity;
}

// Which site (if any) contains a ground position.
export function siteAt(x, z) {
  for (const s of MAP.sites) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d <= s.r) return s;
  }
  return null;
}

// Point-in-collider test for the XZ plane, ignoring height.
export function insideColliderXZ(x, z, pad = 0) {
  for (const b of colliders) {
    if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) return b;
  }
  return null;
}

// --- Visuals ----------------------------------------------------------------
// Build the yard's meshes into a three.js scene. Cosmetic only: the sim reads
// the data above, never these meshes. Materials are flat Lambert in the
// palette so the scene reads at a glance in the dusk light.
export function buildMapMeshes(scene, THREE) {
  const mat = (color) => new THREE.MeshLambertMaterial({ color });
  const groundMat = mat(PALETTE.ground);
  const wallMat = mat(PALETTE.wall);
  const contMats = [mat(PALETTE.containerA), mat(PALETTE.containerB), mat(PALETTE.containerC)];
  const crateMat = mat(PALETTE.crate);
  const craneMat = mat(PALETTE.crane);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(66, 46), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = false;
  scene.add(ground);

  // Yard centre line and site rings, flat on the ground.
  const lineGeo = new THREE.PlaneGeometry(64, 0.25);
  const line = new THREE.Mesh(lineGeo, mat(PALETTE.groundLine));
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, 0.02, 0);
  scene.add(line);

  for (const s of MAP.sites) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.25, s.r, 48),
      new THREE.MeshBasicMaterial({ color: s.id === 'A' ? PALETTE.siteA : PALETTE.siteB, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.03, s.z);
    scene.add(ring);
    // Site letter board: a floating pale panel with the letter, lit by lamps.
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 0.2), new THREE.MeshBasicMaterial({ color: 0xd8c98a }));
    board.position.set(s.x, 4.5, s.z - 5.5);
    scene.add(board);
  }

  // Colliders as boxes. Perimeter walls get the wall material, the crane legs
  // and beam get crane orange, low crates get crate tan, the rest cycle the
  // three container tones by index so the yard is not one flat colour.
  colliders.forEach((b, i) => {
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    let material = contMats[i % 3];
    if (b.h >= WALL_H) material = wallMat;
    else if (b.h <= 1.2) material = crateMat;
    if (i === 4 || i === 5) material = craneMat; // crane legs
    if (i === 6) material = wallMat; // warehouse block
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, b.h, d), material);
    mesh.position.set((b.minX + b.maxX) / 2, b.h / 2, (b.minZ + b.maxZ) / 2);
    scene.add(mesh);
  });

  // Crane beam across Site A, high over the legs.
  const beam = new THREE.Mesh(new THREE.BoxGeometry(10.5, 1.1, 1.4), craneMat);
  beam.position.set(-22, 7.2, -8);
  scene.add(beam);
  const beam2 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 9), craneMat);
  beam2.position.set(-22, 7.2, -8);
  scene.add(beam2);

  // Sodium lamp poles with a warm emissive head.
  const poleMat = mat(0x3a3630);
  const headMat = new THREE.MeshBasicMaterial({ color: PALETTE.lamp });
  for (const l of MAP.lamps) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6), poleMat);
    pole.position.set(l.x, 2.7, l.z);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), headMat);
    head.position.set(l.x, 5.5, l.z);
    scene.add(head);
  }
}
