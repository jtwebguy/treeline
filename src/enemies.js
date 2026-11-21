// Enemy infantry: animated soldiers with M4A1s who patrol no-man's land,
// spot the player, advance, take cover and return fire.
//
// Model: models/soldier_m4.glb — one skinned soldier with the rifle bound to
// the skeleton and seven clips: Idle, Walk, Run, Duck, Prone, Fire, Reload.
// The rifle borrows its textured materials from the player's vm_m4.glb.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { manager } from './assets.js';
import { HALF, heightAt, mulberry32 } from './world.js';
import { Ragdoll, RAGDOLL_BONES } from './ragdoll.js';
import { Drops } from './drops.js';
import { loadShotgun, boneMesh, BONE_MUZZLE } from './shotgun.js';

const loader = new GLTFLoader(manager);
const D2R = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

// tuning
const WALK_SPEED = 1.15, RUN_SPEED = 3.9;
const SIGHT = 95;               // metres; the fog hides anything further
const MAG = 30;
const BURST_INTERVAL = 0.11;
const PLAYER_HIT_DAMAGE = 14;
// shotgunners: pump-action, close range
const SG_MAG = 6, SG_INTERVAL = 0.85, SG_RANGE = 26, SG_DAMAGE = 42;
const SHOTGUN_SHARE = 0.3;

// hitbox capsules between bones (radius in metres)
const SEGMENTS = [
  ['CC_Base_Head', 'CC_Base_Spine02', 0.2],
  ['CC_Base_Spine02', 'CC_Base_Hip', 0.22],
  ['CC_Base_Hip', 'CC_Base_L_Calf', 0.13], ['CC_Base_L_Calf', 'CC_Base_L_Foot', 0.1],
  ['CC_Base_Hip', 'CC_Base_R_Calf', 0.13], ['CC_Base_R_Calf', 'CC_Base_R_Foot', 0.1],
  ['CC_Base_L_Upperarm', 'CC_Base_L_Hand', 0.08], ['CC_Base_R_Upperarm', 'CC_Base_R_Hand', 0.08],
];
const BONES = [...new Set(SEGMENTS.flatMap(([a, b]) => [a, b]).concat(['Weapon_Root'], RAGDOLL_BONES))];

// closest distance between ray (o + d t, t in [0,tMax]) and segment a-b; returns {dist, t}
const _u = new THREE.Vector3(), _w = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
function raySegment(o, d, tMax, a, b) {
  _u.subVectors(b, a); _w.subVectors(o, a);
  const A = d.dot(d), B = d.dot(_u), C = _u.dot(_u), D = d.dot(_w), E = _u.dot(_w);
  const den = A * C - B * B;
  let t = den > 1e-8 ? (B * E - C * D) / den : 0;
  t = THREE.MathUtils.clamp(t, 0, tMax);
  let s = C > 1e-8 ? (B * t + E) / C : 0;
  s = THREE.MathUtils.clamp(s, 0, 1);
  // re-project t for the clamped s
  _q.copy(a).addScaledVector(_u, s);
  t = THREE.MathUtils.clamp(_p.subVectors(_q, o).dot(d) / A, 0, tMax);
  _p.copy(o).addScaledVector(d, t);
  return { dist: _p.distanceTo(_q), t };
}

export class Enemies {
  constructor({ scene, colliders, weapons, effects, onPlayerHit }) {
    this.scene = scene; this.weapons = weapons; this.effects = effects;
    this.onPlayerHit = onPlayerHit;
    this.list = [];
    this.wave = 0;
    this.waveTimer = 0;
    this.rng = mulberry32(4242);
    this.ready = false;
    this.drops = new Drops(scene);

    // tree collision + line-of-sight grid
    this.colliders = colliders;
    this.CELL = 8; this.grid = new Map();
    for (const c of colliders) {
      const k = `${Math.floor(c.x / this.CELL)},${Math.floor(c.z / this.CELL)}`;
      (this.grid.get(k) || this.grid.set(k, []).get(k)).push(c);
    }

    // shared muzzle flash light + sprites
    this.flashLight = new THREE.PointLight(0xffa040, 0, 16, 2);
    scene.add(this.flashLight);
    this.flashTex = weapons.flashTex;

    const soldier = new Promise((res, rej) => loader.load('./models/soldier_m4.glb', res, undefined, rej));
    const rifle = new Promise((res) => loader.load('./models/vm_m4.glb', res, undefined, () => res(null)));
    const shotgun = loadShotgun().catch((e) => { console.warn('shotgun failed to load', e); return null; });
    Promise.all([soldier, rifle, shotgun]).then(([g, vm, sg]) => {
      this.shotgun = sg;
      const mats = {};
      if (vm) vm.scene.traverse((o) => { if (o.isMesh) mats[o.material.name] = o.material; });
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.frustumCulled = false;        // skinned bounds don't follow the animation
        if (o.material.name === 'M_M4A1' && mats.M4A1) o.material = mats.M4A1;
        if (o.material.name === 'M_556' && mats['556']) o.material = mats['556'];
        if (o.material.name !== 'M4A1' && o.material.name !== '556') o.material.envMapIntensity = 0.5;
      });
      this.template = g.scene;
      // Clips may carry tracks for the armature object itself (its export scale is
      // 0.01, some clips key it at 1): only bones should be animated.
      const armature = g.scene.getObjectByName('Soldier');
      for (const c of g.animations) c.tracks = c.tracks.filter((t) => !armature || !t.name.startsWith(armature.name + '.'));
      this.clips = Object.fromEntries(g.animations.map((c) => [c.name, c]));
      this.prepareMuzzle(g.scene);
      this.prepareRifleProp(g.scene);
      this.ready = true;
      this.startWave();
    }).catch((e) => console.warn('enemy model failed to load', e));
  }

  // Find the muzzle in Weapon_Root's local space from the bind pose: the rifle
  // vertex furthest from the grip is the muzzle crown.
  prepareMuzzle(root) {
    root.updateMatrixWorld(true);
    let gun = null;
    root.traverse((o) => { if (o.isSkinnedMesh && o.material.name === 'M4A1') gun = o; });
    if (!gun) root.traverse((o) => { if (o.isSkinnedMesh && !gun && /M4A1/.test(o.name)) gun = o; });
    this.muzzleLocal = new THREE.Vector3(0, 0, 0.6);
    if (!gun) return;
    const sk = gun.skeleton, bi = sk.bones.findIndex((b) => b.name === 'Weapon_Root');
    if (bi < 0) return;
    const inv = sk.boneInverses[bi], pos = gun.geometry.attributes.position;
    const v = new THREE.Vector3(), best = new THREE.Vector3(); let bd = -1;
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(gun.bindMatrix).applyMatrix4(inv);
      const d = v.lengthSq();
      if (d > bd) { bd = d; best.copy(v); }
    }
    this.muzzleLocal.copy(best);
  }

  // Static copy of the rifle in Weapon_Root space (the bind pose), used for the
  // gun a dead soldier drops: same geometry and materials, no skinning.
  prepareRifleProp(root) {
    root.updateMatrixWorld(true);
    this.rifleParts = [];
    root.traverse((o) => {
      if (!o.isSkinnedMesh || !/^(M4A1|556)$/.test(o.material.name)) return;
      const sk = o.skeleton, bi = sk.bones.findIndex((b) => b.name === 'Weapon_Root');
      if (bi < 0) return;
      const m = new THREE.Matrix4().multiplyMatrices(sk.boneInverses[bi], o.bindMatrix);
      const g = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) if (o.geometry.attributes[k]) g.setAttribute(k, o.geometry.attributes[k].clone());
      if (o.geometry.index) g.setIndex(o.geometry.index.clone());
      g.applyMatrix4(m);
      g.computeBoundingSphere();
      this.rifleParts.push({ geometry: g, material: o.material });
    });
  }

  rifleProp() {
    const grp = new THREE.Group();
    for (const p of this.rifleParts) grp.add(new THREE.Mesh(p.geometry, p.material));
    return grp;
  }

  // visit tree circles around x, z (ragdoll collisions)
  treesNear(x, z, cb) {
    const cx = Math.floor(x / this.CELL), cz = Math.floor(z / this.CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const c of this.grid.get(`${cx + i},${cz + j}`) || []) cb(c);
  }

  // ------------------------------------------------------------------ waves
  startWave() {
    this.wave++;
    const n = Math.min(14, 6 + this.wave * 2);
    const ppos = this.playerPos || new THREE.Vector3(0, 0, 20);
    for (let i = 0; i < n; i++) {
      let x, z, tries = 0;
      do {
        x = (this.rng() - 0.5) * 230;
        z = -35 - this.rng() * 105;
        tries++;
      } while (tries < 30 && (Math.hypot(x - ppos.x, z - ppos.z) < 65 || this.blocked(x, z)));
      // a share of each wave carries pump shotguns
      const sg = this.shotgun && (i < Math.max(1, Math.round(n * SHOTGUN_SHARE)));
      this.spawn(x, z, sg ? 'shotgun' : 'm4');
    }
    this.updateHud();
  }

  reset() {
    for (const e of this.list) { this.scene.remove(e.root); this.scene.remove(e.flash); }
    this.list = [];
    this.drops.clear();
    this.wave = 0;
    this.waveTimer = 0;
    if (this.ready) this.startWave();
  }

  blocked(x, z) {
    const cx = Math.floor(x / this.CELL), cz = Math.floor(z / this.CELL);
    for (const c of this.grid.get(`${cx},${cz}`) || []) if (Math.hypot(x - c.x, z - c.z) < c.r + 0.6) return true;
    return false;
  }

  spawn(x, z, weapon = 'm4') {
    const root = SkeletonUtils.clone(this.template);
    const y = heightAt(x, z);
    root.position.set(x, y, z);
    root.rotation.y = (this.rng() - 0.5) * 1.5;   // the model faces +z: roughly toward the trench
    this.scene.add(root);
    const bones = {};
    const gunMeshes = [];
    root.traverse((o) => {
      if (o.isBone && BONES.includes(o.name)) bones[o.name] = o;
      if (o.isSkinnedMesh && /^(M4A1|556)$/.test(o.material.name)) gunMeshes.push(o);
    });
    let gun = null;
    if (weapon === 'shotgun' && bones.Weapon_Root) {
      for (const m of gunMeshes) m.visible = false;
      gun = boneMesh(this.shotgun);
      bones.Weapon_Root.add(gun);
    }
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    for (const [name, clip] of Object.entries(this.clips)) {
      const a = mixer.clipAction(clip);
      if (name === 'Reload') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      actions[name] = a;
    }
    const e = {
      root, mixer, actions, bones, anim: null,
      hp: 100, dead: false, deadT: 0,
      state: 'patrol', stance: 'stand',
      aware: 0, lastSeen: null, seeT: 0, losT: this.rng() * 0.3,
      target: null, waitT: this.rng() * 3,
      weapon, gun, gunMeshes, ragdoll: null,
      mag: weapon === 'shotgun' ? SG_MAG : MAG, burst: 0, shotT: 0, engageT: 0, coverT: 0,
      yaw: root.rotation.y, wantYaw: root.rotation.y, skill: 0.75 + this.rng() * 0.5,
      flash: null, flashT: 0,
    };
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.flashTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: false,
    }));
    fl.scale.setScalar(0.45);
    this.scene.add(fl);
    e.flash = fl;
    this.play(e, 'Idle', 0);
    actions.Idle.time = this.rng() * clipDur(this.clips.Idle);
    this.list.push(e);
    return e;
  }

  play(e, name, fade = 0.25, timeScale = 1) {
    const a = e.actions[name];
    if (!a) return;
    a.timeScale = timeScale;
    if (e.anim === name) return;
    const prev = e.actions[e.anim];
    a.reset().play();
    if (prev && fade > 0) prev.crossFadeTo(a, fade, false);
    else if (prev) prev.stop();
    e.anim = name;
  }

  // ------------------------------------------------------------------ queries
  boneWorld(e, name, out) { return e.bones[name] ? e.bones[name].getWorldPosition(out) : out.copy(e.root.position); }

  headPos(e, out) {
    this.boneWorld(e, 'CC_Base_Head', out);
    const s = this.boneWorld(e, 'CC_Base_Spine02', new THREE.Vector3());
    return out.addScaledVector(out.clone().sub(s).normalize(), 0.08);
  }

  muzzle(e, out, dir) {
    const b = e.bones.Weapon_Root;
    if (!b) return out.copy(e.root.position).add(new THREE.Vector3(0, 1.3, 0));
    out.copy(e.weapon === 'shotgun' ? BONE_MUZZLE : this.muzzleLocal).applyMatrix4(b.matrixWorld);
    if (dir) dir.copy(out).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
    return out;
  }

  // ray vs every living soldier's limb capsules; returns nearest hit
  raycast(o, d, maxT) {
    let best = null;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), h = new THREE.Vector3();
    for (const e of this.list) {
      if (e.dead && !e.ragdoll) continue;
      // cheap reject: distance from ray to the soldier's root (a corpse's hips)
      const toRoot = _w.subVectors(e.ragdoll ? e.ragdoll.center : e.root.position, o);
      const along = toRoot.dot(d);
      if (along < 0 || along > maxT + 3) continue;
      if (toRoot.addScaledVector(d, -along).lengthSq() > 9) continue;
      e.root.updateMatrixWorld(true);
      // head sphere first (headshots)
      this.headPos(e, h);
      const r0 = raySegment(o, d, maxT, h, h);
      if (r0.dist < 0.13 && (!best || r0.t < best.t)) best = { e, t: r0.t, head: true };
      for (const [n1, n2, r] of SEGMENTS) {
        this.boneWorld(e, n1, a); this.boneWorld(e, n2, b);
        const q = raySegment(o, d, maxT, a, b);
        if (q.dist < r && (!best || q.t < best.t - 0.05)) best = { e, t: q.t, head: false };
      }
    }
    return best;
  }

  // segment from a to b blocked by trees or terrain?
  lineBlocked(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.5) return false;
    const steps = Math.ceil(len / 1.5);
    const seen = new Set();
    for (let i = 1; i < steps; i++) {
      const t = i / steps, x = a.x + dx * t, z = a.z + dz * t, y = a.y + (b.y - a.y) * t;
      if (y < heightAt(x, z) + 0.05) return true;
      const k = `${Math.floor(x / this.CELL)},${Math.floor(z / this.CELL)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      for (const c of this.grid.get(k) || []) {
        // distance from circle centre to the 2-D segment
        const s = THREE.MathUtils.clamp(((c.x - a.x) * dx + (c.z - a.z) * dz) / (len * len), 0, 1);
        const px = a.x + dx * s - c.x, pz = a.z + dz * s - c.z;
        if (px * px + pz * pz < (c.r * 0.85) ** 2) {
          const yy = a.y + (b.y - a.y) * s;
          if (yy > c.base && yy < c.base + c.h) return true;
        }
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ damage
  // Returns 'kill', 'hit' or 'corpse'. point: where the round struck; force:
  // how hard it shoves the body (m/s on the struck joint).
  damage(e, amount, fromDir, head, point, force = 3) {
    if (e.dead) {
      if (e.ragdoll) e.ragdoll.impulse(point, fromDir, force * 0.8);
      return 'corpse';
    }
    e.hp -= amount * (head ? 3 : 1);
    e.aware = 1;
    e.lastSeen = this.playerPos ? this.playerPos.clone() : null;
    if (e.hp <= 0) { this.kill(e, fromDir, point, force); return 'kill'; }
    // getting shot: dive for cover
    if (e.stance === 'stand' && this.rng() < 0.6) { e.stance = this.rng() < 0.5 ? 'duck' : 'prone'; e.coverT = 2 + this.rng() * 2; e.burst = 0; }
    return 'hit';
  }

  kill(e, fromDir, point, force = 3) {
    e.dead = true; e.deadT = 0;
    e.flash.material.opacity = 0;
    e.flashT = 0;
    e.root.updateMatrixWorld(true);
    const dir = fromDir ? fromDir.clone() : new THREE.Vector3(0, 0, -1);

    // body velocity at the moment of death (running soldiers keep momentum)
    const facing = new THREE.Vector3(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    const vel = facing.clone().multiplyScalar(e.anim === 'Run' ? RUN_SPEED * 0.8 : e.anim === 'Walk' ? WALK_SPEED * 0.6 : 0);
    e.ragdoll = new Ragdoll(e.root, e.bones, (x, z, cb) => this.treesNear(x, z, cb), vel);
    e.ragdoll.impulse(point, dir, force);
    // buckle the knees so a standing body folds instead of toppling like a plank
    if (e.stance !== 'prone') {
      const kn = facing.clone().multiplyScalar(0.9 + this.rng() * 0.6).add(new THREE.Vector3(0, -0.4, 0));
      e.ragdoll.kick('lca', kn); e.ragdoll.kick('rca', kn.clone().multiplyScalar(0.7 + this.rng() * 0.6));
      e.ragdoll.kick('hip', new THREE.Vector3(0, -0.6, 0));
    }
    for (const a of Object.values(e.actions)) a.stop();

    this.dropWeapon(e, dir);
    this.updateHud();
    if (this.living() === 0) this.waveTimer = 8;
  }

  // the gun leaves the dead man's hands and tumbles to the ground
  dropWeapon(e, dir) {
    const bone = e.bones.Weapon_Root;
    if (!bone) return;
    let obj;
    if (e.weapon === 'shotgun' && e.gun) { obj = e.gun; this.scene.attach(obj); }
    else {
      if (!this.rifleParts || !this.rifleParts.length) return;
      for (const m of e.gunMeshes) m.visible = false;
      obj = this.rifleProp();
      bone.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
      this.scene.add(obj);
    }
    e.gun = null;
    const v = new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(0.8 + this.rng() * 1.4);
    v.y = 1.2 + this.rng() * 1.5;
    v.x += (this.rng() - 0.5) * 1.2; v.z += (this.rng() - 0.5) * 1.2;
    const ammo = e.weapon === 'shotgun' ? Math.max(2, e.mag) + 4 + Math.floor(this.rng() * 5) : Math.max(8, e.mag) + Math.floor(this.rng() * 20);
    this.drops.spawn(obj, e.weapon, ammo, v);
  }

  living() { return this.list.reduce((n, e) => n + (e.dead ? 0 : 1), 0); }

  updateHud() {
    const el = document.getElementById('hostiles');
    if (el) el.textContent = this.ready ? `Wave ${this.wave} · ${this.living()} hostile${this.living() === 1 ? '' : 's'}` : '';
  }

  // Player fired: everyone within earshot hears roughly where from.
  onPlayerShot(pos) {
    for (const e of this.list) {
      if (e.dead) continue;
      const d = e.root.position.distanceTo(pos);
      if (d < 140) {
        e.aware = Math.max(e.aware, d < 70 ? 1 : 0.6);
        if (!e.lastSeen || d < 70) e.lastSeen = pos.clone().add(new THREE.Vector3((this.rng() - 0.5) * 10, 0, (this.rng() - 0.5) * 10));
      }
    }
  }

  // ------------------------------------------------------------------ audio
  gunshot(dist, shotgun) {
    const w = this.weapons;
    if (!this.effects.audio) return;
    const t0 = this.effects.audio.ctx.currentTime + dist / 343;
    const vol = Math.min(0.9, 22 / Math.max(8, dist));
    if (shotgun) {
      w.noiseBurst(t0, 0.1, Math.max(400, 1300 - dist * 8), vol * 0.9, 'bandpass', 0.8);
      w.noiseBurst(t0, 0.45, 200, vol * 1.2, 'lowpass', 0.9);
      w.noiseBurst(t0 + 0.32, 0.05, 1800, vol * 0.25);     // racking the pump
      w.noiseBurst(t0 + 0.48, 0.05, 1500, vol * 0.25);
      return;
    }
    w.noiseBurst(t0, 0.08, Math.max(500, 1800 - dist * 8), vol * 0.8, 'bandpass', 0.7);
    w.noiseBurst(t0, 0.3, 300, vol, 'lowpass', 0.8);
  }

  crack() {   // supersonic snap of a near miss
    if (!this.effects.audio) return;
    this.weapons.noiseBurst(this.effects.audio.ctx.currentTime, 0.025, 4200, 0.35, 'highpass');
  }

  // ------------------------------------------------------------------ AI
  update(dt, t, player) {
    this.playerPos = player.pos;
    if (!this.ready) return;
    if (this.waveTimer > 0) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        for (const e of this.list) { this.scene.remove(e.root); this.scene.remove(e.flash); }
        this.list = [];
        this.startWave();
      }
    }
    this.drops.update(dt);
    const eye = player.eye;
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 500);
    const tmp = new THREE.Vector3(), head = new THREE.Vector3();

    for (const e of this.list) {
      const dist = e.root.position.distanceTo(player.pos);
      if (e.dead) {
        e.deadT += dt;
        if (e.ragdoll) e.ragdoll.update(dt);
        continue;
      }
      e.mixer.update(dt);
      if (e.flashT > 0) { e.flashT -= dt; e.flash.material.opacity = e.flashT > 0 ? 1 : 0; }
      if (!player.alive) { this.idle(e, dt); continue; }

      // ---- perception (throttled)
      e.losT -= dt;
      if (e.losT <= 0) {
        e.losT = 0.25;
        this.headPos(e, head);
        const facing = new THREE.Vector3(Math.sin(e.yaw), 0, Math.cos(e.yaw));
        const toP = tmp.subVectors(eye, head); const d = toP.length(); toP.divideScalar(d);
        const inFront = facing.dot(toP) > -0.2 || e.aware > 0.5;
        const vis = d < SIGHT && inFront && !this.lineBlocked(head, eye);
        e.canSee = vis;
        if (vis) {
          // detection builds faster up close, when the player moves fast or stands tall
          const conspic = (player.crouch ? 0.55 : 1) * (player.sprinting ? 1.6 : player.moving ? 1.1 : 0.75);
          e.aware = Math.min(1, e.aware + 0.25 * conspic * (1.6 - d / SIGHT) * (e.aware > 0.1 ? 2 : 1));
          if (e.aware >= 1) e.lastSeen = player.pos.clone();
        } else e.aware = Math.max(0, e.aware - 0.02);
      }

      if (e.aware >= 1 && e.lastSeen) this.combat(e, dt, dist, player);
      else if (e.aware > 0.5 && e.lastSeen) this.investigate(e, dt);
      else this.patrol(e, dt);

      // body orientation
      if (!Number.isFinite(e.wantYaw)) e.wantYaw = e.yaw;
      let dy = e.wantYaw - e.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      e.yaw += dy * Math.min(1, dt * (e.state === 'combat' ? 6 : 3));
      e.root.rotation.y = e.yaw;
    }

    // muzzle flash sprites follow the rifles
    for (const e of this.list) if (!e.dead && e.flashT > 0) this.muzzle(e, e.flash.position);
  }

  idle(e, dt) { if (e.stance !== 'prone') this.play(e, 'Idle'); }

  moveTo(e, dt, target, speed) {
    const p = e.root.position;
    const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.8) return true;
    e.wantYaw = Math.atan2(dx, dz);
    // walk the way the body faces so feet don't skate sideways
    const f = Math.max(0, Math.cos(e.wantYaw - e.yaw));
    const step = Math.min(d, speed * dt * f);
    p.x += Math.sin(e.yaw) * step; p.z += Math.cos(e.yaw) * step;
    // trees
    const cx = Math.floor(p.x / this.CELL), cz = Math.floor(p.z / this.CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const c of this.grid.get(`${cx + i},${cz + j}`) || []) {
        const ex = p.x - c.x, ez = p.z - c.z, dd = Math.hypot(ex, ez), min = c.r + 0.35;
        if (dd < min && dd > 1e-4) { p.x = c.x + (ex / dd) * min; p.z = c.z + (ez / dd) * min; }
      }
    }
    const lim = HALF - 6;
    p.x = THREE.MathUtils.clamp(p.x, -lim, lim); p.z = THREE.MathUtils.clamp(p.z, -lim, lim);
    p.y = heightAt(p.x, p.z);
    return false;
  }

  patrol(e, dt) {
    e.state = 'patrol';
    if (e.stance !== 'stand') e.stance = 'stand';
    if (e.waitT > 0) { e.waitT -= dt; this.play(e, 'Idle', 0.4); return; }
    if (!e.target) {
      const p = e.root.position;
      e.target = new THREE.Vector3(p.x + (this.rng() - 0.5) * 40, 0, THREE.MathUtils.clamp(p.z + (this.rng() - 0.5) * 30, -150, -25));
    }
    this.play(e, 'Walk', 0.35, 1.0);
    if (this.moveTo(e, dt, e.target, WALK_SPEED)) { e.target = null; e.waitT = 2 + this.rng() * 5; }
  }

  investigate(e, dt) {
    e.state = 'investigate';
    e.stance = 'stand';
    this.play(e, 'Walk', 0.3, 1.15);
    if (this.moveTo(e, dt, e.lastSeen, WALK_SPEED * 1.2)) { e.aware = 0.3; e.target = null; }
  }

  combat(e, dt, dist, player) {
    e.state = 'combat';
    e.engageT += dt;
    const p = e.root.position;
    const sg = e.weapon === 'shotgun';

    // reloading takes priority
    if (e.reloading > 0) {
      e.reloading -= dt;
      if (e.stance === 'prone') this.play(e, 'Prone', 0.3);
      else this.play(e, 'Reload', 0.2);
      if (e.reloading <= 0) e.mag = sg ? SG_MAG : MAG;
      e.wantYaw = Math.atan2(e.lastSeen.x - p.x, e.lastSeen.z - p.z);
      return;
    }

    // relocating to a new firing position
    if (e.moveTarget) {
      e.stance = 'stand';
      this.play(e, 'Run', 0.2, 1.0);
      e.moveT = (e.moveT || 0) + dt;
      if (this.moveTo(e, dt, e.moveTarget, RUN_SPEED) || e.moveT > 4.5) {
        e.moveT = 0;
        e.moveTarget = null;
        e.stance = sg ? 'stand' : dist > 55 && this.rng() < 0.4 ? 'prone' : 'stand';
      }
      return;
    }

    // too far: close the distance (shotgunners rush in much closer)
    if (dist > (sg ? SG_RANGE : 75)) {
      const dir = new THREE.Vector3().subVectors(player.pos, p).setY(0).normalize();
      const side = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar((this.rng() - 0.5) * (sg ? 10 : 30));
      const run = sg ? Math.min(dist - 8, 14 + this.rng() * 10) : 20 + this.rng() * 15;
      e.moveTarget = p.clone().addScaledVector(dir, run).add(side);
      return;
    }

    e.wantYaw = Math.atan2(e.lastSeen.x - p.x, e.lastSeen.z - p.z);

    // cover: crouched pause between bursts
    if (e.coverT > 0) {
      e.coverT -= dt;
      this.play(e, e.stance === 'prone' ? 'Prone' : 'Duck', 0.25);
      return;
    }

    // firing
    if (e.burst <= 0) {
      // choose what to do next
      const r = this.rng();
      if (r < 0.15 && dist > 25) {
        const dir = new THREE.Vector3().subVectors(player.pos, p).setY(0).normalize();
        const side = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar((this.rng() < 0.5 ? -1 : 1) * (8 + this.rng() * 10));
        e.moveTarget = p.clone().add(side).addScaledVector(dir, this.rng() * 8);
        return;
      }
      if (r < (sg ? 0.25 : 0.4) && e.stance !== 'prone') { e.stance = 'duck'; e.coverT = 0.8 + this.rng() * 1.6; e.burst = sg ? 2 : 3 + Math.floor(this.rng() * 4); return; }
      e.burst = sg ? 2 + Math.floor(this.rng() * 3) : 3 + Math.floor(this.rng() * 5);
      e.shotT = sg ? 0.45 : 0.35;     // shoulder the gun before the first round
      if (e.stance === 'duck') e.stance = 'stand';
    }

    this.play(e, e.stance === 'prone' ? 'Prone' : 'Fire', 0.15, e.stance === 'prone' ? 1 : sg ? 1 : 2.4);
    e.shotT -= dt;
    if (e.shotT <= 0 && e.canSee !== false) {
      e.shotT = (sg ? SG_INTERVAL : BURST_INTERVAL) * (0.9 + this.rng() * 0.4);
      e.burst--;
      this.fire(e, dist, player);
      if (e.burst <= 0) { e.coverT = 0.6 + this.rng() * 1.4; if (e.stance === 'stand' && this.rng() < 0.5) e.stance = 'duck'; }
      if (e.mag <= 0) { e.reloading = sg ? 4.2 : 3.0; e.burst = 0; this.play(e, e.stance === 'prone' ? 'Prone' : 'Reload', 0.2); }
    } else if (e.canSee === false && e.shotT <= 0) {
      // lost sight: wait a moment then go look
      e.burst = 0;
      if (this.rng() < 0.01) e.aware = 0.7;
    }
  }

  fire(e, dist, player) {
    e.mag--;
    e.flashT = 0.05;
    e.flash.material.rotation = this.rng() * Math.PI;
    this.muzzle(e, e.flash.position);
    this.flashLight.position.copy(e.flash.position);
    this.flashLight.intensity = 18;
    const sg = e.weapon === 'shotgun';
    this.gunshot(dist, sg);
    // hit chance: distance, the player's stance and motion, how long they've been engaged
    let p = sg ? THREE.MathUtils.clamp(0.95 - dist / 32, 0.02, 0.8) * e.skill
      : THREE.MathUtils.clamp(0.5 - dist / 170, 0.05, 0.45) * e.skill;
    if (player.crouch) p *= 0.6;
    if (player.moving) p *= player.sprinting ? 0.5 : 0.75;
    if (e.stance === 'prone') p *= 1.2;
    p *= Math.min(1, 0.35 + e.engageT / 6);
    if (this.rng() < p) {
      const dmg = sg ? SG_DAMAGE * THREE.MathUtils.clamp(1.15 - dist / 30, 0.15, 1) : PLAYER_HIT_DAMAGE;
      setTimeout(() => this.onPlayerHit(dmg * (0.8 + this.rng() * 0.5), e.root.position.clone()), (dist / 900) * 1000);
    } else if (dist < (sg ? 40 : 130) && this.rng() < 0.5) {
      setTimeout(() => this.crack(), (dist / 900) * 1000);
    }
  }
}

function clipDur(c) { return c ? c.duration : 1; }
