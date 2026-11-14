// Kestrel Yard — movement. Acceleration-based FPS movement with AABB
// collision against the map: run, crouch, jump and gravity, axis-separated so
// a player slides along walls instead of sticking. Pure functions over the
// match state; the renderer never moves a player itself.
import { MAP, insideColliderXZ } from './map.js';

export const PLAYER_RADIUS = 0.34;
export const PLAYER_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.15;
export const WALK_SPEED = 5.4;
export const CROUCH_SPEED = 2.7;
export const ADS_SPEED = 3.1;
export const ACCEL = 42;
export const FRICTION = 11;
export const JUMP_SPEED = 5.6;
export const GRAVITY = 14.5;

// Forward / right vectors from a yaw (yaw 0 faces -z, north).
export function forwardOf(yaw) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}
export function rightOf(yaw) {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

// One movement step for a player. input: {f, s, jump, crouch, ads} with f/s
// in [-1, 1]. dt is fixed (1/60 in the sim loop).
export function movePlayer(m, p, input, dt) {
  if (!p.alive) return;
  const fwd = forwardOf(p.yaw);
  const rgt = rightOf(p.yaw);
  let wishX = fwd.x * input.f + rgt.x * input.s;
  let wishZ = fwd.z * input.f + rgt.z * input.s;
  const len = Math.hypot(wishX, wishZ);
  if (len > 1) {
    wishX /= len;
    wishZ /= len;
  }
  const crouching = !!input.crouch;
  p.crouch = crouching;
  const speed = crouching ? CROUCH_SPEED : input.ads ? ADS_SPEED : WALK_SPEED;
  const targetX = wishX * speed;
  const targetZ = wishZ * speed;
  // Accelerate toward the wish velocity; friction when no input.
  const k = len > 0.05 ? ACCEL * dt : FRICTION * dt;
  p.vel.x += (targetX - p.vel.x) * Math.min(1, k);
  p.vel.z += (targetZ - p.vel.z) * Math.min(1, k);
  // Jump.
  if (input.jump && p.onGround) {
    p.vel.y = JUMP_SPEED;
    p.onGround = false;
  }
  p.vel.y -= GRAVITY * dt;

  // Integrate X, then Z, pushing out of any collider the player's vertical
  // span overlaps. Standing on a low crate works because the vertical check
  // ignores boxes whose top is at or below the player's feet.
  stepAxis(m, p, 'x', p.vel.x * dt);
  stepAxis(m, p, 'z', p.vel.z * dt);
  // Vertical: land on the ground or on a box top.
  p.pos.y += p.vel.y * dt;
  const h = crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
  if (p.pos.y <= 0) {
    p.pos.y = 0;
    p.vel.y = 0;
    p.onGround = true;
  } else {
    const top = groundTopAt(p.pos.x, p.pos.z, p.pos.y + h);
    if (p.vel.y <= 0 && top !== null && p.pos.y <= top + 0.05) {
      p.pos.y = top;
      p.vel.y = 0;
      p.onGround = true;
    } else if (p.vel.y > 0) {
      p.onGround = false;
    }
  }
  // Keep inside the yard even if a collider is missed.
  p.pos.x = Math.max(MAP.bounds.minX + PLAYER_RADIUS, Math.min(MAP.bounds.maxX - PLAYER_RADIUS, p.pos.x));
  p.pos.z = Math.max(MAP.bounds.minZ + PLAYER_RADIUS, Math.min(MAP.bounds.maxZ - PLAYER_RADIUS, p.pos.z));
}

function stepAxis(m, p, axis, delta) {
  if (delta === 0) return;
  p.pos[axis] += delta;
  const h = p.crouch ? CROUCH_HEIGHT : PLAYER_HEIGHT;
  const b = insideColliderXZ(p.pos.x, p.pos.z, PLAYER_RADIUS);
  // Feet more than 0.35 m below a box top means the box is a wall; feet
  // higher than that step up onto it (so a jump lands on low crates).
  if (b && p.pos.y < b.h - 0.35 && p.pos.y + h > 0.05) {
    // Push back out along this axis.
    if (axis === 'x') {
      p.pos.x = delta > 0 ? b.minX - PLAYER_RADIUS : b.maxX + PLAYER_RADIUS;
      p.vel.x = 0;
    } else {
      p.pos.z = delta > 0 ? b.minZ - PLAYER_RADIUS : b.maxZ + PLAYER_RADIUS;
      p.vel.z = 0;
    }
  }
}

// Highest box top under (x, z) that the player's feet could stand on, or null.
export function groundTopAt(x, z, headY) {
  let top = null;
  for (const b of MAP.colliders) {
    if (x > b.minX - PLAYER_RADIUS && x < b.maxX + PLAYER_RADIUS && z > b.minZ - PLAYER_RADIUS && z < b.maxZ + PLAYER_RADIUS) {
      if (b.h > 0.4 && b.h < headY && (top === null || b.h > top)) top = b.h;
    }
  }
  return top;
}

// Eye height for the camera / ray origin.
export function eyeHeight(p) {
  return p.pos.y + (p.crouch ? 1.05 : 1.62);
}
