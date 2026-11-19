import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { manager, loadHDRI, setMaxAniso } from './assets.js';
import { createTerrain } from './terrain.js';
import { createForest, windUniform } from './trees.js';
import { createProps } from './props.js';
import { Effects } from './effects.js';
import { Weapons } from './weapons.js';
import { HALF, TRENCH, heightAt } from './world.js';

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.autoClear = false; // world pass, then the weapon pass on top
document.body.prepend(renderer.domElement);
setMaxAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const FOG = 0x7f8483;
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.FogExp2(FOG, 0.0145);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 700);

// ------------------------------------------------------------------ lighting
const hemi = new THREE.HemisphereLight(0xc3c9cc, 0x3a3226, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xe2ddd2, 1.5);   // diffuse overcast sun
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -55;
sun.shadow.camera.right = sun.shadow.camera.top = 55;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 4;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();

loadHDRI('kloofendal_overcast_puresky').then((hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;
  scene.environmentIntensity = 0.45;
  scene.background = hdr;
  scene.backgroundIntensity = 0.55;
  scene.backgroundBlurriness = 0.15;
  weapons.vmScene.environment = hdr;
  weapons.vmScene.environmentIntensity = 0.5;
}).catch(() => {});

// ------------------------------------------------------------------ world
const ui = {
  overlay: document.getElementById('overlay'),
  bar: document.getElementById('bar'),
  status: document.getElementById('status'),
  start: document.getElementById('start'),
  hud: document.getElementById('hud'),
  weapon: document.getElementById('weapon'),
  ammo: document.getElementById('ammo'),
  scope: document.getElementById('scope'),
  dot: document.getElementById('dot'),
};
const failures = [];

scene.add(createTerrain());
const forest = createForest();
scene.add(forest.group);
const effects = new Effects(scene, { hemi, fog: scene.fog });
const weapons = new Weapons({ camera, scene, renderer, effects, colliders: forest.colliders, ui });
createProps(forest.snappedSpots, (id) => failures.push(id)).then((g) => scene.add(g));

manager.onProgress = (url, done, total) => {
  ui.bar.style.width = `${Math.round((done / total) * 100)}%`;
  ui.status.textContent = `Streaming assets from Poly Haven… ${done}/${total}`;
};
manager.onError = (url) => failures.push(url.split('/').pop());
manager.onLoad = () => {
  ui.bar.style.width = '100%';
  ui.status.textContent = failures.length
    ? `Ready (${failures.length} asset${failures.length > 1 ? 's' : ''} failed to load)`
    : `Ready — ${forest.count.toLocaleString()} trees (${forest.counts.birch} birch, ${forest.counts.young} young pines, ${forest.clumps.length} thickets)`;
  ui.start.disabled = false;
  ui.start.textContent = 'Enter the forest';
};

// ------------------------------------------------------------------ player
const controls = new PointerLockControls(camera, document.body);
const EYE = 1.68;
const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), onGround: false, bob: 0 };
{
  // spawn inside the trench, facing north toward no-man's land
  const [x, z] = TRENCH[Math.floor(TRENCH.length * 0.45)];
  player.pos.set(x, heightAt(x, z), z);
  camera.position.set(x, player.pos.y + EYE, z);
  camera.lookAt(x, player.pos.y + EYE + 1.5, z - 20);
}

const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });

// Playing does not depend on pointer lock: if the browser refuses the lock
// (iframes, some embedded browsers) you can still drag with the mouse to look.
let playing = false;
const setPlaying = (on) => {
  playing = on;
  ui.overlay.classList.toggle('hidden', on);
  ui.hud.classList.toggle('hidden', !on);
  if (!on) ui.start.textContent = 'Resume';
};
ui.start.addEventListener('click', () => {
  effects.startAudio();
  setPlaying(true);
  try { const p = controls.lock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* drag-look fallback */ }
});
let lockedOnce = false;
controls.addEventListener('lock', () => { lockedOnce = true; setPlaying(true); });
controls.addEventListener('unlock', () => setPlaying(false));
addEventListener('keydown', (e) => { if (e.code === 'Escape' && playing && !controls.isLocked) setPlaying(false); });

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
let dragging = false;
// Mouse: left fires, right aims. Without pointer lock, left-drag looks and F fires.
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!playing) return;
  if (controls.isLocked || e.button === 2) weapons.onMouseDown(e.button);
  else if (e.button === 0) dragging = true;
});
addEventListener('mouseup', (e) => { dragging = false; weapons.onMouseUp(e.button); });
addEventListener('wheel', () => { if (playing) weapons.cycle(); });
addEventListener('keydown', (e) => {
  if (!playing) return;
  weapons.onKey(e.code);
  if (e.code === 'KeyF') weapons.onMouseDown(0);
});
addEventListener('keyup', (e) => { if (e.code === 'KeyF') weapons.onMouseUp(0); });
addEventListener('mousemove', (e) => {
  if (playing && (controls.isLocked || dragging)) weapons.onMouseMove(e.movementX, e.movementY);
  if (!dragging) return;
  euler.setFromQuaternion(camera.quaternion);
  euler.y -= e.movementX * 0.003;
  euler.x = THREE.MathUtils.clamp(euler.x - e.movementY * 0.003, -1.5, 1.5);
  camera.quaternion.setFromEuler(euler);
});

// tree collision grid
const CELL = 8, grid = new Map();
for (const c of forest.colliders) {
  const k = `${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`;
  (grid.get(k) || grid.set(k, []).get(k)).push(c);
}
function collide(p) {
  const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    for (const c of grid.get(`${cx + i},${cz + j}`) || []) {
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + 0.3;
      if (d < min && d > 1e-4) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; }
    }
  }
}

const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();
function updatePlayer(dt) {
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  right.crossVectors(fwd, camera.up).normalize();
  wish.set(0, 0, 0);
  if (keys.KeyW || keys.ArrowUp) wish.add(fwd);
  if (keys.KeyS || keys.ArrowDown) wish.sub(fwd);
  if (keys.KeyD || keys.ArrowRight) wish.add(right);
  if (keys.KeyA || keys.ArrowLeft) wish.sub(right);
  const crouch = keys.KeyC || keys.ControlLeft;
  const sprinting = !crouch && !weapons.aiming && (keys.ShiftLeft || keys.ShiftRight) && (keys.KeyW || keys.ArrowUp);
  const speed = (crouch ? 1.8 : sprinting ? 6.8 : 3.6) * (weapons.aiming ? 0.55 : 1);
  player.sprinting = sprinting;
  if (wish.lengthSq()) wish.normalize().multiplyScalar(speed);

  const accel = player.onGround ? 12 : 2;
  player.vel.x += (wish.x - player.vel.x) * Math.min(1, accel * dt);
  player.vel.z += (wish.z - player.vel.z) * Math.min(1, accel * dt);
  player.vel.y -= 22 * dt;
  if (player.onGround && keys.Space) { player.vel.y = 6.2; player.onGround = false; }

  player.pos.addScaledVector(player.vel, dt);
  collide(player.pos);
  const lim = HALF - 4;
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, -lim, lim);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, -lim, lim);

  const g = heightAt(player.pos.x, player.pos.z);
  if (player.pos.y <= g) { player.pos.y = g; player.vel.y = 0; player.onGround = true; }
  else if (player.pos.y - g > 0.15) player.onGround = false;

  const moving = player.onGround ? Math.hypot(player.vel.x, player.vel.z) : 0;
  player.bob += moving * dt * 1.9;
  const eye = crouch ? 1.05 : EYE;
  const targetY = player.pos.y + eye + Math.sin(player.bob * 2) * 0.035 * Math.min(1, moving / 3);
  camera.position.set(player.pos.x, THREE.MathUtils.lerp(camera.position.y, targetY, Math.min(1, dt * 18)), player.pos.z);

  // keep the shadow frustum centred on the player
  sun.target.position.copy(player.pos);
  sun.position.copy(player.pos).addScaledVector(SUN_DIR, 120);
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Timer();
const fpsEl = document.getElementById('fps');
let frames = 0, fpsT = 0;
renderer.setAnimationLoop(() => {
  clock.update();
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.getElapsed();
  windUniform.value = t;
  controls.pointerSpeed = camera.fov / 70; // slower look while zoomed
  if (playing) updatePlayer(dt);
  else { sun.target.position.copy(player.pos); sun.position.copy(player.pos).addScaledVector(SUN_DIR, 120); }
  effects.update(dt, t, camera.position);
  weapons.update(dt, t, {
    moving: playing && player.onGround && Math.hypot(player.vel.x, player.vel.z) > 0.5,
    sprinting: playing && player.sprinting,
    aspect: camera.aspect,
  });
  renderer.clear();
  renderer.render(scene, camera);
  if (playing) weapons.render();
  frames++; fpsT += dt;
  if (fpsT > 0.5) { fpsEl.textContent = `${Math.round(frames / fpsT)} fps`; frames = 0; fpsT = 0; }
});

window.game = { scene, camera, player, renderer, forest, weapons };  // handy for debugging in the console

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
