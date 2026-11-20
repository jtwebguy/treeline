// First-person weapons: M4A1 (automatic) and Mosin-Nagant M91/30 with PU scope.
// Viewmodels are drawn in their own scene/camera so they never clip into trees.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { manager } from './assets.js';
import { heightAt } from './world.js';

const loader = new GLTFLoader(manager);
const D2R = Math.PI / 180;

// Viewmodel files are authored with the origin at the rear sight / scope
// eyepiece and the sight line along -Z, so "aim down sights" = put origin
// straight in front of the eye.
const DEFS = {
  m4: {
    name: 'M4A1', file: './models/vm_m4.glb',
    hip: new THREE.Vector3(0.085, -0.075, -0.2), hipYaw: 3 * D2R,
    ads: new THREE.Vector3(0, 0, -0.14), adsFov: 52,
    muzzle: new THREE.Vector3(0, -0.062, -0.57),
    auto: true, interval: 60 / 750, mag: 30, reserve: 150, reload: 2.3,
    kick: 0.9, camKick: 0.006, spread: 0.0025, hipSpread: 0.018, damage: 34,
    sound: 'rifle',
  },
  mosin: {
    name: 'Mosin M91/30 · PU', file: './models/vm_mosin.glb',
    hip: new THREE.Vector3(0.085, -0.08, -0.21), hipYaw: 3 * D2R,
    ads: new THREE.Vector3(0, 0, -0.07), adsFov: 70 / 3.5, scoped: true,
    muzzle: new THREE.Vector3(0.016, -0.045, -0.79),
    auto: false, interval: 1.35, mag: 5, reserve: 40, reload: 3.4, perRound: 0.55,
    kick: 2.2, camKick: 0.03, spread: 0.0003, hipSpread: 0.03, damage: 120,
    sound: 'sniper',
  },
};

function flashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.25, 'rgba(255,190,90,0.9)');
  grd.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  // star spikes
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,220,150,0.8)';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.random() * 0.3;
    g.lineWidth = 6; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Weapons {
  constructor({ camera, scene, renderer, effects, colliders, ui }) {
    this.camera = camera; this.scene = scene; this.renderer = renderer;
    this.effects = effects; this.colliders = colliders; this.ui = ui;
    this.baseFov = camera.fov;

    // viewmodel scene
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(62, camera.aspect, 0.01, 10);
    this.vmScene.add(new THREE.HemisphereLight(0xc3c9cc, 0x3a3226, 1.1));
    const key = new THREE.DirectionalLight(0xe2ddd2, 1.6);
    key.position.set(-0.6, 1, 0.4); this.vmScene.add(key);
    this.vmFlash = new THREE.PointLight(0xffa040, 0, 3, 2);
    this.vmScene.add(this.vmFlash);
    this.rig = new THREE.Group();            // sway / bob / recoil
    this.vmScene.add(this.rig);

    this.flashTex = flashTexture();
    this.worldFlash = new THREE.PointLight(0xffa040, 0, 18, 2);
    scene.add(this.worldFlash);

    this.state = {};
    this.models = {};
    for (const [id, def] of Object.entries(DEFS)) {
      this.state[id] = { mag: def.mag, reserve: def.reserve };
      loader.load(def.file, (g) => {
        const root = new THREE.Group();
        g.scene.traverse((o) => {
          if (o.isMesh) {
            o.frustumCulled = false;
            o.material.envMapIntensity = 0.6;
          }
        });
        root.add(g.scene);
        const flash = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.flashTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0,
        }));
        flash.position.copy(def.muzzle).add(new THREE.Vector3(0, 0, -0.06));
        flash.scale.setScalar(id === 'mosin' ? 0.35 : 0.22);
        root.add(flash);
        root.userData.flash = flash;
        root.visible = false;
        this.rig.add(root);
        this.models[id] = root;
        if (!this.current) this.equip(id, true);
        else if (id === this.current) { root.visible = true; }
      });
    }

    this.current = null;
    this.ads = 0;            // 0 hip .. 1 aimed
    this.aiming = false;
    this.trigger = false;
    this.cooldown = 0;
    this.reloading = 0;
    this.switching = 0;
    this.recoil = 0;         // viewmodel kick
    this.bob = 0;
    this.sway = new THREE.Vector2();
    this.swayTarget = new THREE.Vector2();
    this.impacts = [];
    this.pendingSwitch = null;
    this.current = 'm4';

    // impact puff material
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    this.puffTex = new THREE.CanvasTexture(c);

    this.updateHud();
  }

  // ------------------------------------------------------------ input
  onMouseDown(button) {
    if (button === 0) { this.trigger = true; if (!DEFS[this.current].auto) this.tryFire(); }
    if (button === 2) this.aiming = true;
  }
  onMouseUp(button) {
    if (button === 0) this.trigger = false;
    if (button === 2) this.aiming = false;
  }
  onMouseMove(dx, dy) { this.swayTarget.x += dx * 0.00012; this.swayTarget.y += dy * 0.00012; }
  onKey(code) {
    if (code === 'Digit1') this.requestSwitch('m4');
    if (code === 'Digit2') this.requestSwitch('mosin');
    if (code === 'KeyR') this.startReload();
  }
  cycle() { this.requestSwitch(this.current === 'm4' ? 'mosin' : 'm4'); }

  requestSwitch(id) {
    if (id === this.current || this.switching > 0) return;
    this.pendingSwitch = id;
    this.switching = 0.5;   // lower, swap at midpoint, raise
    this.reloading = 0;
    this.click(0.15);
  }

  equip(id, instant) {
    for (const [k, m] of Object.entries(this.models)) m.visible = k === id;
    this.current = id;
    this.updateHud();
  }

  // ------------------------------------------------------------ firing
  tryFire() {
    const def = DEFS[this.current], st = this.state[this.current];
    if (this.cooldown > 0 || this.reloading > 0 || this.switching > 0 || !this.models[this.current]) return;
    if (st.mag <= 0) { this.click(0.4); this.cooldown = 0.25; if (st.reserve > 0) this.startReload(); return; }
    st.mag--;
    this.cooldown = def.interval;
    this.recoil = Math.min(1.6, this.recoil + def.kick * 0.35);

    // camera recoil: the player has to pull it back down
    const e = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(this.camera.quaternion);
    e.x = Math.min(1.5, e.x + def.camKick * (this.ads > 0.5 ? 0.7 : 1));
    e.y += (Math.random() - 0.5) * def.camKick * 0.6;
    this.camera.quaternion.setFromEuler(e);

    // flash
    const m = this.models[this.current];
    m.userData.flash.material.opacity = 1;
    m.userData.flash.material.rotation = Math.random() * Math.PI;
    this.flashT = 0.05;
    this.worldFlash.position.copy(this.camera.position);
    this.worldFlash.intensity = 25;
    this.vmFlash.position.set(def.hip.x, def.hip.y, def.muzzle.z * 0.6);
    this.vmFlash.intensity = 2;

    this.shot(def.sound);
    if (this.enemies) this.enemies.onPlayerShot(this.camera.position);
    this.hitscan(def);
    this.updateHud();
    if (this.current === 'mosin' && st.mag > 0) setTimeout(() => this.boltSound(), 380);
  }

  hitscan(def) {
    const spread = THREE.MathUtils.lerp(def.hipSpread, def.spread, this.ads);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    const o = this.camera.position;
    let hit = null, kind = 'ground';
    // trees: 2D ray vs circles
    let best = 600;
    const dx = dir.x, dz = dir.z, len2 = dx * dx + dz * dz;
    if (len2 > 1e-6) {
      for (const c of this.colliders) {
        const ox = c.x - o.x, oz = c.z - o.z;
        const t = (ox * dx + oz * dz) / len2;
        if (t <= 0 || t >= best) continue;
        const px = ox - dx * t, pz = oz - dz * t;
        const rr = (c.r - 0.1) ** 2;
        if (px * px + pz * pz < rr) {
          const y = o.y + dir.y * t;
          if (y > c.base && y < c.base + c.h) { best = t; kind = 'tree'; }
        }
      }
    }
    // ground: march
    const step = 0.3;
    for (let t = 0.5; t < Math.min(best, 500); t += step) {
      const x = o.x + dir.x * t, y = o.y + dir.y * t, z = o.z + dir.z * t;
      if (y < heightAt(x, z)) { best = t; kind = 'ground'; break; }
    }
    // soldiers: limb capsules from the live animated skeleton
    if (this.enemies) {
      const eh = this.enemies.raycast(o, dir, Math.min(best, 500));
      if (eh && eh.t < best) {
        const killed = this.enemies.damage(eh.e, def.damage, dir, eh.head);
        this.spawnImpact(o.clone().addScaledVector(dir, eh.t), 'flesh', eh.t);
        this.hitMarker(killed || eh.head);
        return;
      }
    }
    if (best < 500) {
      hit = o.clone().addScaledVector(dir, best);
      this.spawnImpact(hit, kind, best);
    }
  }

  hitMarker(strong) {
    const el = this.ui && this.ui.hit;
    if (!el) return;
    el.classList.remove('on', 'kill'); void el.offsetWidth;
    el.classList.add('on'); if (strong) el.classList.add('kill');
    this.click(0.25, 5200);
  }

  spawnImpact(p, kind, dist) {
    const color = kind === 'tree' ? 0x8a6a4a : kind === 'flesh' ? 0x5a1d17 : 0x6d5d4c;
    for (let i = 0; i < (kind === 'tree' ? 4 : 6); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, color, transparent: true, depthWrite: false, opacity: 0.8 }));
      s.position.copy(p);
      s.userData = {
        v: new THREE.Vector3((Math.random() - 0.5) * 1.5, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 1.5),
        life: 0, max: 0.7 + Math.random() * 0.6,
      };
      s.scale.setScalar(0.15);
      this.scene.add(s);
      this.impacts.push(s);
    }
    // impact sound arrives later at distance
    if (this.effects.audio && dist > 15) {
      const { ctx } = this.effects.audio;
      const t0 = ctx.currentTime + dist / 343;
      this.noiseBurst(t0, 0.06, 2500, Math.min(0.25, 6 / dist));
    }
  }

  startReload() {
    const def = DEFS[this.current], st = this.state[this.current];
    if (this.reloading > 0 || st.mag >= def.mag || st.reserve <= 0 || this.switching > 0) return;
    const rounds = Math.min(def.mag - st.mag, st.reserve);
    this.reloading = def.perRound ? 0.8 + rounds * def.perRound : def.reload;
    this.reloadTotal = this.reloading;
    // sound cues through the reload
    if (def.perRound) {
      this.boltSound();
      for (let i = 0; i < rounds; i++) setTimeout(() => this.click(0.25, 1800), (0.5 + i * def.perRound) * 1000);
      setTimeout(() => this.boltSound(), (this.reloading - 0.3) * 1000);
    } else {
      setTimeout(() => this.click(0.4, 900), 400);
      setTimeout(() => this.click(0.5, 1300), 1400);
      setTimeout(() => this.click(0.6, 600), 2000);
    }
  }

  finishReload() {
    const def = DEFS[this.current], st = this.state[this.current];
    const n = Math.min(def.mag - st.mag, st.reserve);
    st.mag += n; st.reserve -= n;
    this.updateHud();
  }

  // ------------------------------------------------------------ audio
  ensureNoise() {
    if (this.noise || !this.effects.audio) return;
    const { ctx } = this.effects.audio;
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = b;
    // forest reverb tail
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.5, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const c = ir.getChannelData(ch);
      for (let i = 0; i < c.length; i++) c[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / c.length, 3.2) * 0.6;
    }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    const rg = ctx.createGain(); rg.gain.value = 0.55;
    this.reverb.connect(rg); rg.connect(this.effects.audio.master);
  }

  noiseBurst(t0, dur, freq, vol, type = 'bandpass', wet = 0) {
    this.ensureNoise();
    if (!this.noise) return;
    const { ctx, master } = this.effects.audio;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    if (wet && this.reverb) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.reverb); }
    src.start(t0, Math.random(), dur + 0.05);
  }

  shot(kind) {
    if (!this.effects.audio) return;
    const t = this.effects.audio.ctx.currentTime;
    if (kind === 'rifle') {
      this.noiseBurst(t, 0.09, 1800, 0.9, 'bandpass', 0.5);
      this.noiseBurst(t, 0.25, 350, 0.9, 'lowpass', 0.6);
    } else {
      this.noiseBurst(t, 0.12, 1400, 1.2, 'bandpass', 0.9);
      this.noiseBurst(t, 0.6, 220, 1.3, 'lowpass', 1.0);
    }
  }

  click(vol = 0.3, freq = 3000) {
    if (!this.effects.audio) return;
    this.noiseBurst(this.effects.audio.ctx.currentTime, 0.03, freq, vol, 'bandpass');
  }

  boltSound() {
    if (!this.effects.audio) return;
    const t = this.effects.audio.ctx.currentTime;
    this.noiseBurst(t, 0.05, 2200, 0.35); this.noiseBurst(t + 0.18, 0.07, 1500, 0.35);
    this.noiseBurst(t + 0.38, 0.06, 1900, 0.35); this.noiseBurst(t + 0.52, 0.04, 2600, 0.3);
  }

  // ------------------------------------------------------------ HUD
  updateHud() {
    const def = DEFS[this.current], st = this.state[this.current];
    if (!this.ui) return;
    this.ui.weapon.textContent = def.name;
    this.ui.ammo.innerHTML = `${st.mag}<small> / ${st.reserve}</small>`;
  }

  // ------------------------------------------------------------ frame
  update(dt, t, { moving, sprinting, aspect }) {
    const def = DEFS[this.current];
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.reloading > 0) { this.reloading -= dt; if (this.reloading <= 0) { this.reloading = 0; this.finishReload(); } }
    if (this.switching > 0) {
      const before = this.switching;
      this.switching = Math.max(0, this.switching - dt);
      if (before > 0.25 && this.switching <= 0.25 && this.pendingSwitch) { this.equip(this.pendingSwitch); this.pendingSwitch = null; }
    }
    if (this.trigger && def.auto) this.tryFire();

    const wantAds = this.aiming && !sprinting && this.reloading === 0 && this.switching === 0;
    this.ads = THREE.MathUtils.damp(this.ads, wantAds ? 1 : 0, def.scoped ? 9 : 12, dt);

    // camera FOV
    const fov = THREE.MathUtils.lerp(this.baseFov, def.adsFov, this.ads);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.vmCamera.aspect = aspect; this.vmCamera.updateProjectionMatrix();

    // scope overlay: hide the rifle once the eye is at the scope
    const scoped = def.scoped && this.ads > 0.85;
    this.ui.scope.classList.toggle('on', scoped);
    this.ui.dot.style.opacity = this.ads > 0.3 ? 0 : 1;
    for (const [k, m] of Object.entries(this.models)) m.visible = k === this.current && !scoped;

    // procedural motion
    this.swayTarget.multiplyScalar(Math.exp(-dt * 6));
    this.sway.lerp(this.swayTarget, 1 - Math.exp(-dt * 10));
    this.recoil = THREE.MathUtils.damp(this.recoil, 0, 9, dt);
    this.bob += dt * (moving ? (sprinting ? 13 : 8.5) : 1.4);
    const bobAmt = (moving ? (sprinting ? 1 : 0.5) : 0.12) * (1 - this.ads * 0.9);

    const m = this.models[this.current];
    if (m) {
      const pos = def.hip.clone().lerp(def.ads, this.ads);
      pos.x += Math.sin(this.bob) * 0.006 * bobAmt - this.sway.x * (1 - this.ads * 0.7);
      pos.y += Math.abs(Math.cos(this.bob)) * 0.006 * bobAmt + this.sway.y * (1 - this.ads * 0.7);
      pos.z += this.recoil * 0.035;
      // lower while switching / reloading / sprinting
      const sw = this.switching > 0 ? Math.sin((this.switching / 0.5) * Math.PI) : 0;
      const rl = this.reloading > 0 ? Math.sin(Math.min(1, (this.reloadTotal - this.reloading) / 0.35) * Math.PI / 2) * Math.min(1, this.reloading / 0.35) : 0;
      pos.y -= sw * 0.25 + rl * 0.06;
      pos.x -= rl * 0.02;
      const sprintPose = THREE.MathUtils.damp(this._sprint || 0, sprinting ? 1 : 0, 8, dt); this._sprint = sprintPose;
      pos.y -= sprintPose * 0.04; pos.x += sprintPose * 0.03;

      // bolt-action cycle after each Mosin shot: roll the rifle while working the bolt
      let boltRoll = 0;
      if (this.current === 'mosin' && this.cooldown > 0.2) {
        const k = 1 - (this.cooldown - 0.2) / (def.interval - 0.2);
        boltRoll = Math.sin(Math.min(1, Math.max(0, k)) * Math.PI) * (1 - this.ads);
      }
      m.position.copy(pos);
      m.rotation.set(this.recoil * 0.06 + sw * 0.6 + rl * 0.3 - sprintPose * 0.25,
        def.hipYaw * (1 - this.ads) + sprintPose * 0.5,
        rl * 0.5 + boltRoll * 0.35, 'YXZ');

      const f = m.userData.flash;
      if (this.flashT > 0) { this.flashT -= dt; f.material.opacity = Math.max(0, this.flashT / 0.05); }
      else f.material.opacity = 0;
    }
    this.worldFlash.intensity = Math.max(0, this.worldFlash.intensity - dt * 600);
    this.vmFlash.intensity = Math.max(0, this.vmFlash.intensity - dt * 50);

    // impacts
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const s = this.impacts[i], u = s.userData;
      u.life += dt;
      u.v.y -= dt * 3;
      s.position.addScaledVector(u.v, dt);
      s.scale.setScalar(0.15 + u.life * 1.2);
      s.material.opacity = 0.8 * (1 - u.life / u.max);
      if (u.life >= u.max) { this.scene.remove(s); s.material.dispose(); this.impacts.splice(i, 1); }
    }
  }

  render() {
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }
}
