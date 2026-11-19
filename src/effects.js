// Atmosphere: smoke columns from fresh craters, smouldering embers,
// falling ash, distant artillery flashes and synthesized sound.
import * as THREE from 'three';
import { CRATERS, heightAt, mulberry32 } from './world.js';

function smokeTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), r = mulberry32(3);
  for (let i = 0; i < 26; i++) {
    const x = S / 2 + (r() - 0.5) * 50, y = S / 2 + (r() - 0.5) * 50, rad = 18 + r() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class Effects {
  constructor(scene, { hemi, fog }) {
    this.scene = scene;
    this.hemi = hemi;
    this.fog = fog;
    this.baseFog = fog.color.clone();
    this.baseHemi = hemi.intensity;
    const r = (this.r = mulberry32(11));

    // ---- smoke columns
    const tex = smokeTexture();
    this.smokes = [];
    const sources = CRATERS.filter((c) => c.fresh).slice(0, 7);
    for (const c of sources) {
      const base = new THREE.Vector3(c.x, heightAt(c.x, c.z) + 0.3, c.z);
      const parts = [];
      for (let i = 0; i < 34; i++) {
        const mat = new THREE.SpriteMaterial({ map: tex, color: 0x2e2c2a, transparent: true, depthWrite: false, fog: true });
        const s = new THREE.Sprite(mat);
        s.userData = { life: r(), speed: 0.9 + r() * 0.6, spin: (r() - 0.5) * 0.4, drift: r() };
        scene.add(s);
        parts.push(s);
      }
      // embers + flickering light
      const light = new THREE.PointLight(0xff6a2a, 6, 14, 2);
      light.position.copy(base).add(new THREE.Vector3(0, 0.6, 0));
      scene.add(light);
      const emb = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: 0xff7a30, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      emb.position.copy(base).add(new THREE.Vector3(0, 0.25, 0));
      emb.scale.setScalar(c.r * 0.9);
      scene.add(emb);
      this.smokes.push({ base, parts, light, emb, seed: r() * 100 });
    }

    // ---- falling ash around the player
    const N = 2500;
    this.ashBox = 60;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) pos[i] = (r() - 0.5) * this.ashBox;
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.ash = new THREE.Points(ag, new THREE.PointsMaterial({
      size: 0.07, map: dotTexture(), color: 0xb9b4ad, transparent: true, depthWrite: false, opacity: 0.85,
    }));
    this.ash.frustumCulled = false;
    scene.add(this.ash);

    this.nextShell = 4;
    this.flash = 0;
    this.flashColor = new THREE.Color(0xffb070);
    this.audio = null;
  }

  // ---------------------------------------------------------- audio
  startAudio() {
    if (this.audio) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    // brown noise buffer reused for wind and explosions
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    // wind bed
    const wind = ctx.createBufferSource(); wind.buffer = buf; wind.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 500;
    const wg = ctx.createGain(); wg.gain.value = 0.25;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 250; lfo.connect(lfoG); lfoG.connect(wf.frequency);
    wind.connect(wf); wf.connect(wg); wg.connect(master); wind.start(); lfo.start();
    this.audio = { ctx, master, buf };
  }

  boom(distance) {
    if (!this.audio) return;
    const { ctx, master, buf } = this.audio;
    const t0 = ctx.currentTime + distance / 343; // sound arrives after the flash
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.max(90, 900 - distance * 0.4);
    const g = ctx.createGain();
    const vol = Math.min(1.4, 900 / (distance + 200));
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 3.5);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0, Math.random() * 2, 4);
    // low thump
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(55, t0); o.frequency.exponentialRampToValueAtTime(25, t0 + 1);
    const og = ctx.createGain(); og.gain.setValueAtTime(vol * 0.9, t0); og.gain.exponentialRampToValueAtTime(0.001, t0 + 1.4);
    o.connect(og); og.connect(master); o.start(t0); o.stop(t0 + 1.5);
  }

  // ---------------------------------------------------------- per frame
  update(dt, t, player) {
    // smoke
    for (const s of this.smokes) {
      for (const p of s.parts) {
        const u = p.userData;
        u.life += dt * 0.055 * u.speed;
        if (u.life > 1) u.life -= 1;
        const L = u.life;
        p.position.set(
          s.base.x + Math.sin(L * 3 + u.drift * 6) * (0.4 + L * 2) + L * L * 14,   // leans downwind
          s.base.y + L * 26,
          s.base.z + Math.cos(L * 2 + u.drift * 6) * (0.4 + L * 2) + L * L * 4
        );
        p.scale.setScalar(1.5 + L * 11);
        p.material.opacity = Math.sin(Math.PI * Math.min(1, L * 1.4)) * 0.55;
        p.material.rotation += u.spin * dt;
      }
      const f = 0.6 + 0.4 * Math.sin(t * 13 + s.seed) * Math.sin(t * 7.3 + s.seed * 2);
      s.light.intensity = 4 + f * 4;
      s.emb.material.opacity = 0.35 + f * 0.35;
    }

    // ash
    const pa = this.ash.geometry.attributes.position, B = this.ashBox, h = B / 2;
    for (let i = 0; i < pa.count; i++) {
      let x = pa.getX(i) + Math.sin(t * 0.5 + i) * 0.004 + dt * 0.4;
      let y = pa.getY(i) - dt * (0.35 + (i % 7) * 0.05);
      let z = pa.getZ(i) + Math.cos(t * 0.4 + i * 1.3) * 0.004;
      // wrap relative to player
      x = ((((x - player.x + h) % B) + B) % B) - h + player.x;
      y = ((((y - player.y + h) % B) + B) % B) - h + player.y;
      z = ((((z - player.z + h) % B) + B) % B) - h + player.z;
      pa.setXYZ(i, x, y, z);
    }
    pa.needsUpdate = true;

    // distant artillery
    this.nextShell -= dt;
    if (this.nextShell <= 0) {
      this.nextShell = 3 + Math.random() * 14;
      const dist = 700 + Math.random() * 3500;
      this.flash = Math.min(1.5, 2200 / dist);
      this.boom(dist);
      if (Math.random() < 0.3) { // salvo
        for (let i = 1; i < 4; i++) setTimeout(() => { this.flash = Math.max(this.flash, 0.6); this.boom(dist + Math.random() * 200); }, i * (250 + Math.random() * 400));
      }
    }
    this.flash = Math.max(0, this.flash - dt * 3.5);
    this.fog.color.copy(this.baseFog).lerp(this.flashColor, this.flash * 0.25);
    this.hemi.intensity = this.baseHemi * (1 + this.flash * 0.6);
  }
}
