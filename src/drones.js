// FPV kamikaze drones: one or two arrive in every five-minute window. Each
// picks a target — you or one of the enemy soldiers — cruises in high over
// the trees with a rising buzz, then dives and detonates on contact (or when
// it hits a tree or the ground). The blast hurts everyone near it: you, the
// soldiers, and it throws the dead about. Shoot one down and it explodes in
// the air.
import * as THREE from 'three';
import { HALF, heightAt } from './world.js';

const WINDOW = 300;          // seconds: 1–2 drones in each window
const CRUISE_ALT = 22;       // metres above the ground while closing in
const CRUISE_SPEED = 24;     // m/s
const DIVE_SPEED = 34;
const DIVE_RANGE = 38;       // horizontal distance at which it starts the dive
const FUSE = 1.6;            // proximity fuse, metres
const BLAST_R = 8;           // lethal-to-harmless radius
const BLAST_DMG = 130;       // at the centre
const HIT_R = 0.5;           // generous: they're small and fast
const LIFETIME = 70;

function radial(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// a small racing quad with a warhead strapped under its nose (+Z forward)
function buildDrone() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f1c, roughness: 0.7, metalness: 0.2 });
  const olive = new THREE.MeshStandardMaterial({ color: 0x3f4632, roughness: 0.8 });
  const prop = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.2), dark));
  const arm = new THREE.BoxGeometry(0.34, 0.012, 0.025);
  for (const s of [1, -1]) {
    const a = new THREE.Mesh(arm, dark); a.rotation.y = s * Math.PI / 4; g.add(a);
  }
  const props = [];
  const disc = new THREE.CircleGeometry(0.075, 14); disc.rotateX(-Math.PI / 2);
  for (const [x, z] of [[0.12, 0.12], [-0.12, 0.12], [0.12, -0.12], [-0.12, -0.12]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 8), dark);
    m.position.set(x, 0.02, z); g.add(m);
    const p = new THREE.Mesh(disc, prop); p.position.set(x, 0.04, z); g.add(p); props.push(p);
  }
  // RPG-style warhead under the frame, pointing forward
  const war = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), olive);
  war.rotation.x = Math.PI / 2; war.position.set(0, -0.05, 0.06); g.add(war);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 10), olive);
  cone.rotation.x = Math.PI / 2; cone.position.set(0, -0.05, 0.21); g.add(cone);
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), dark);
  cam.position.set(0, 0.03, 0.11); g.add(cam);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff2a10 }));
  led.position.set(0, 0.03, -0.1); g.add(led);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(1.3);
  return { group: g, props, led };
}

export class Drones {
  constructor({ scene, camera, effects, weapons, enemies, onPlayerHit, onAlert }) {
    Object.assign(this, { scene, camera, effects, weapons, enemies, onPlayerHit, onAlert });
    this.list = [];
    this.fx = [];
    this.fireTex = radial('rgba(255,230,170,1)', 'rgba(255,90,10,0)');
    this.smokeTex = radial('rgba(255,255,255,0.7)', 'rgba(255,255,255,0)');
    this.light = new THREE.PointLight(0xffa050, 0, 40, 2);
    scene.add(this.light);
    this.reset();
  }

  reset() {
    for (const d of this.list) this.remove(d);
    this.list = [];
    this.clock = 0;
    this.windowStart = 0;
    this.planWindow();
  }

  // pick when this window's one or two drones arrive
  planWindow() {
    const n = Math.random() < 0.5 ? 1 : 2;
    this.schedule = Array.from({ length: n }, () => this.windowStart + 25 + Math.random() * (WINDOW - 45)).sort((a, b) => a - b);
  }

  // ---------------------------------------------------------------- targets
  candidates() {
    const out = [];
    if (this.player && this.player.alive) out.push({ kind: 'player' });
    if (this.enemies && this.enemies.ready) for (const e of this.enemies.list) if (!e.dead) out.push({ kind: 'enemy', e });
    return out;
  }
  pickTarget(from) {
    const c = this.candidates();
    if (!c.length) return null;
    const enemies = c.filter((t) => t.kind === 'enemy');
    const player = c.find((t) => t.kind === 'player');
    if (from) {   // retarget: whoever is nearest the drone
      let best = null, bd = Infinity;
      for (const t of c) { const d = this.targetPos(t, new THREE.Vector3()).distanceTo(from); if (d < bd) { bd = d; best = t; } }
      return best;
    }
    if (player && (!enemies.length || Math.random() < 0.5)) return player;
    return enemies[Math.floor(Math.random() * enemies.length)];
  }
  targetPos(t, out) {
    if (t.kind === 'player') { out.copy(this.camera.position); out.y -= 0.45; return out; }
    const e = t.e;
    out.copy(e.root.position);
    out.y += e.stance === 'prone' ? 0.3 : e.stance === 'duck' ? 0.8 : 1.1;
    return out;
  }
  targetAlive(t) { return t && (t.kind === 'player' ? this.player.alive : !t.e.dead); }

  // ---------------------------------------------------------------- spawn
  spawn(target = this.pickTarget()) {
    if (!target) return null;
    const tp = this.targetPos(target, new THREE.Vector3());
    const a = Math.random() * Math.PI * 2, R = 130 + Math.random() * 40, lim = HALF - 6;
    const x = THREE.MathUtils.clamp(tp.x + Math.cos(a) * R, -lim, lim);
    const z = THREE.MathUtils.clamp(tp.z + Math.sin(a) * R, -lim, lim);
    const { group, props, led } = buildDrone();
    group.position.set(x, heightAt(x, z) + CRUISE_ALT + Math.random() * 6, z);
    this.scene.add(group);
    const d = { group, props, led, target, vel: new THREE.Vector3(), phase: 'cruise', age: 0, sound: null };
    d.vel.subVectors(tp, group.position).setY(0).normalize().multiplyScalar(CRUISE_SPEED);
    this.startBuzz(d);
    this.list.push(d);
    if (this.onAlert && target.kind === 'player') setTimeout(() => this.list.includes(d) && this.onAlert('Drone inbound'), 2500);
    return d;
  }

  remove(d) {
    this.scene.remove(d.group);
    d.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    if (d.sound) {
      const { ctx } = this.effects.audio, t = ctx.currentTime;
      d.sound.gain.gain.cancelScheduledValues(t);
      d.sound.gain.gain.setTargetAtTime(0, t, 0.02);
      for (const o of d.sound.osc) o.stop(t + 0.1);
      d.sound = null;
    }
  }

  // ---------------------------------------------------------------- audio
  startBuzz(d) {
    const A = this.effects.audio;
    if (!A) return;
    const { ctx, master } = A;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600; f.Q.value = 2;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const osc = [0, 7, -5].map((det) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = 190 + det * 3; o.connect(f); o.start(); return o;
    });
    f.connect(gain);
    if (pan) { gain.connect(pan); pan.connect(master); } else gain.connect(master);
    d.sound = { osc, gain, pan, filter: f };
  }
  updateBuzz(d) {
    if (!d.sound && this.effects.audio) this.startBuzz(d);
    if (!d.sound) return;
    const { ctx } = this.effects.audio, t = ctx.currentTime;
    const rel = d.group.position.clone().sub(this.camera.position);
    const dist = rel.length();
    // the motors scream harder in the dive; a crude doppler from closing speed
    const closing = -d.vel.dot(rel) / Math.max(dist, 0.1);
    const base = (d.phase === 'dive' ? 260 : 190) * (343 / (343 - THREE.MathUtils.clamp(closing, -60, 60)));
    d.sound.osc.forEach((o, i) => o.frequency.setTargetAtTime(base * [1, 1.012, 0.988][i], t, 0.08));
    d.sound.gain.gain.setTargetAtTime(Math.min(0.22, 7 / (dist + 12)), t, 0.1);
    d.sound.filter.frequency.setTargetAtTime(THREE.MathUtils.clamp(5000 / (1 + dist * 0.05), 500, 3500), t, 0.1);
    if (d.sound.pan) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      d.sound.pan.pan.setTargetAtTime(THREE.MathUtils.clamp(rel.normalize().dot(right), -1, 1) * 0.8, t, 0.05);
    }
  }

  // ---------------------------------------------------------------- shots
  // ray vs every drone; returns { d, t } for the nearest
  raycast(o, dir, maxT) {
    let best = null;
    const w = new THREE.Vector3();
    for (const d of this.list) {
      w.subVectors(d.group.position, o);
      const t = w.dot(dir);
      if (t < 0 || t > maxT) continue;
      if (w.addScaledVector(dir, -t).lengthSq() < HIT_R * HIT_R && (!best || t < best.t)) best = { d, t };
    }
    return best;
  }
  shootDown(d) { this.explode(d, true); }

  // ---------------------------------------------------------------- blast
  explode(d, inAir = false) {
    if (!this.list.includes(d)) return;     // already gone (e.g. several pellets)
    const p = d.group.position.clone();
    this.remove(d);
    this.list.splice(this.list.indexOf(d), 1);
    const R = inAir ? BLAST_R * 0.7 : BLAST_R;     // an airburst high up does less

    // the player
    if (this.player && this.player.alive) {
      const dist = this.camera.position.distanceTo(p);
      if (dist < R) this.onPlayerHit(BLAST_DMG * Math.pow(1 - dist / R, 1.4), p);
      // a near blast flashes the sky and rattles the gun
      if (dist < 40 && this.weapons) this.weapons.recoil = Math.max(this.weapons.recoil, 0.6 * (1 - dist / 40));
    }
    // soldiers, living and dead
    if (this.enemies) {
      const c = new THREE.Vector3();
      for (const e of this.enemies.list) {
        if (e.dead && !e.ragdoll) continue;
        c.copy(e.ragdoll ? e.ragdoll.center : e.root.position); c.y += e.ragdoll ? 0 : 0.9;
        const dist = c.distanceTo(p);
        if (dist >= R) continue;
        const k = 1 - dist / R;
        const dir = c.clone().sub(p).setY(0).normalize(); dir.y = 0.6; dir.normalize();
        this.enemies.damage(e, BLAST_DMG * Math.pow(k, 1.4), dir, false, c.clone(), 4 + k * 10);
      }
    }

    // visuals
    this.light.position.copy(p).y += 1;
    this.light.intensity = 140;
    const camD = this.camera.position.distanceTo(p);
    this.effects.flash = Math.max(this.effects.flash, Math.min(1.2, 30 / (camD + 10)));
    const rnd = (s) => (Math.random() - 0.5) * s;
    for (let i = 0; i < 12; i++) this.particle(this.fireTex, 0xffffff, p, new THREE.Vector3(rnd(6), 1 + Math.random() * 4, rnd(6)), 0.35 + Math.random() * 0.25, 0.6, 3.5, THREE.AdditiveBlending, 0);
    for (let i = 0; i < 16; i++) this.particle(this.smokeTex, 0x2b2926, p, new THREE.Vector3(rnd(3), 1.2 + Math.random() * 2, rnd(3)), 2.5 + Math.random() * 2, 1, 6, THREE.NormalBlending, -0.2);
    if (!inAir) for (let i = 0; i < 26; i++) this.particle(this.smokeTex, 0x3c3226, p, new THREE.Vector3(rnd(14), 5 + Math.random() * 9, rnd(14)), 1 + Math.random() * 0.6, 0.25, 0.4, THREE.NormalBlending, 1);

    // sound: the sharp crack close up, then effects' rolling boom
    this.effects.boom(Math.max(30, camD * 3));
    if (this.weapons && this.effects.audio) {
      const t0 = this.effects.audio.ctx.currentTime + camD / 343, v = Math.min(1.6, 40 / (camD + 10));
      this.weapons.noiseBurst(t0, 0.25, 1200, v, 'bandpass', 0.8);
      this.weapons.noiseBurst(t0, 0.9, 140, v * 1.2, 'lowpass', 1);
    }
  }

  // sprite particle: grows from s0 to s1, gravity g (negative rises)
  particle(map, color, p, v, life, s0, s1, blending, g) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, depthWrite: false, blending, fog: true }));
    s.position.copy(p);
    s.scale.setScalar(s0);
    s.material.rotation = Math.random() * 6;
    s.userData = { v, life: 0, max: life, s0, s1, g, a0: blending === THREE.AdditiveBlending ? 1 : 0.85 };
    this.scene.add(s);
    this.fx.push(s);
  }

  // ---------------------------------------------------------------- update
  update(dt, player) {
    this.player = player;
    this.clock += dt;
    if (this.clock >= this.windowStart + WINDOW) { this.windowStart += WINDOW; this.planWindow(); }
    while (this.schedule.length && this.clock >= this.schedule[0]) { this.schedule.shift(); this.spawn(); }

    const tp = new THREE.Vector3(), want = new THREE.Vector3();
    for (const d of [...this.list]) {
      d.age += dt;
      if (!this.targetAlive(d.target)) d.target = this.pickTarget(d.group.position);
      const pos = d.group.position;
      if (!d.target || d.age > LIFETIME) { this.explode(d, true); continue; }
      this.targetPos(d.target, tp);
      const horiz = Math.hypot(tp.x - pos.x, tp.z - pos.z);
      if (d.phase === 'cruise') {
        want.set(tp.x - pos.x, 0, tp.z - pos.z).normalize().multiplyScalar(CRUISE_SPEED);
        const alt = heightAt(pos.x, pos.z) + CRUISE_ALT;
        want.y = THREE.MathUtils.clamp((alt - pos.y) * 1.5, -6, 6);
        d.vel.lerp(want, Math.min(1, dt * 1.5));
        if (horiz < DIVE_RANGE) d.phase = 'dive';
      } else {
        // lead the target a little and swing in hard
        want.subVectors(tp, pos).normalize().multiplyScalar(DIVE_SPEED);
        d.vel.lerp(want, Math.min(1, dt * 3.2));
      }
      pos.addScaledVector(d.vel, dt);
      // gentle wobble
      pos.y += Math.sin(d.age * 9) * 0.01;

      // orientation: nose along the velocity, banked into turns
      d.group.lookAt(want.copy(pos).add(d.vel));
      for (const p of d.props) p.rotation.y += dt * 90;
      d.led.visible = (d.age * 4) % 1 < 0.5;
      this.updateBuzz(d);

      // fuses: proximity, ground, trees
      if (pos.distanceTo(tp) < FUSE) { this.explode(d); continue; }
      if (pos.y < heightAt(pos.x, pos.z) + 0.25) { this.explode(d); continue; }
      let tree = false;
      if (this.enemies && this.enemies.grid) this.enemies.treesNear(pos.x, pos.z, (c) => {
        if (!tree && Math.hypot(pos.x - c.x, pos.z - c.z) < c.r + 0.15 && pos.y > c.base && pos.y < c.base + c.h * 0.8) tree = true;
      });
      if (tree && d.phase === 'dive') { this.explode(d); continue; }
    }

    // blast particles
    this.light.intensity = Math.max(0, this.light.intensity - dt * 600);
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const s = this.fx[i], u = s.userData;
      u.life += dt;
      const k = u.life / u.max;
      u.v.y -= u.g * 9.8 * dt;
      u.v.multiplyScalar(1 - Math.min(1, dt * 1.5));
      s.position.addScaledVector(u.v, dt);
      s.scale.setScalar(THREE.MathUtils.lerp(u.s0, u.s1, Math.sqrt(k)));
      s.material.opacity = u.a0 * (1 - k);
      if (k >= 1) { this.scene.remove(s); s.material.dispose(); this.fx.splice(i, 1); }
    }
  }
}
