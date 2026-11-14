// Kestrel Yard — input. Keyboard, mouse look with pointer lock, and the
// polled input object the fixed-step loop reads. Keys: WASD move, mouse look,
// click fire, right mouse aim, R reload, G grenade, E plant (hold), B buy,
// Ctrl crouch, Space jump, M mute, 1-6 buy, Esc release. The loop reads
// poll() once per step, so a key pressed between steps is never lost.
const keys = new Set();
let mouseDX = 0;
let mouseDY = 0;
let firing = false;
let aiming = false;
let locked = false;
const pressed = new Set(); // edge-triggered keys, consumed by poll()

export function bindInput(canvas, callbacks) {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyM') callbacks.onMute?.();
    if (e.code === 'KeyB') callbacks.onBuy?.();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    firing = false;
    aiming = false;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) firing = true;
    if (e.button === 2) aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) aiming = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    mouseDX += e.movementX || 0;
    mouseDY += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      firing = false;
      aiming = false;
    }
  });
  canvas.addEventListener('click', () => {
    if (!locked && callbacks.onLockRequest?.()) canvas.requestPointerLock();
  });
}

export function isLocked() {
  return locked;
}

// Read the current input state for one sim step. Edge keys are consumed.
export function pollInput() {
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const out = {
    f, s,
    jump: keys.has('Space'),
    crouch: keys.has('ControlLeft') || keys.has('ControlRight'),
    ads: aiming,
    fire: firing,
    reload: pressed.has('KeyR'),
    grenade: pressed.has('KeyG'),
    use: keys.has('KeyE'),
    buy: pressed.has('KeyB'),
    mute: pressed.has('KeyM'),
    lookDX: mouseDX,
    lookDY: mouseDY,
    digit: null,
  };
  for (let d = 1; d <= 6; d++) {
    if (pressed.has('Digit' + d)) out.digit = d;
  }
  mouseDX = 0;
  mouseDY = 0;
  pressed.clear();
  return out;
}

// Synthetic input for scripted play (self-test, staged shots): a plain object
// with the same fields pollInput returns.
export function scriptedInput(over = {}) {
  return {
    f: 0, s: 0, jump: false, crouch: false, ads: false, fire: false,
    reload: false, grenade: false, use: false, buy: false, mute: false,
    lookDX: 0, lookDY: 0, digit: null, ...over,
  };
}
