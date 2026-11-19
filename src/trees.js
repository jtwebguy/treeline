// Procedural Scots pines (the dominant tree of eastern Ukrainian forests and
// treelines) in three states: living, burnt, and snapped by shellfire.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF, mulberry32, heightAt, damageAt, isBuildable } from './world.js';
import { loadPBR } from './assets.js';

export const windUniform = { value: 0 };
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

// ---------------------------------------------------------------- materials
function addWind(mat, strength = 1) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = windUniform;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.11 + instanceMatrix[3].z * 0.07;
        #else
          float ph = 0.0;
        #endif
        float hh = max(transformed.y, 0.0);
        float k = hh * hh * ${(0.00035 * strength).toFixed(6)};
        transformed.x += (sin(uTime * 1.1 + ph) + 0.35 * sin(uTime * 2.7 + ph * 1.7)) * k;
        transformed.z += cos(uTime * 0.85 + ph * 1.3) * k * 0.7;`
      );
  };
}

function makeNeedleTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry32(42);

  const needles = (x0, y0, x1, y1, len, count) => {
    const ang = Math.atan2(y1 - y0, x1 - x0);
    // stem
    g.strokeStyle = '#4a3726';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    for (let i = 0; i < count; i++) {
      const t = 0.05 + (i / count) * 0.95;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      for (const side of [-1, 1]) {
        const a = ang + side * (0.45 + r() * 0.5);
        const l = len * (0.55 + r() * 0.5) * (1 - t * 0.35);
        const h = 95 + r() * 25, s = 25 + r() * 25, li = 13 + r() * 16;
        g.strokeStyle = `hsl(${h},${s}%,${li}%)`;
        g.lineWidth = 2.6 + r() * 1.4;
        g.beginPath();
        g.moveTo(px, py);
        g.quadraticCurveTo(px + Math.cos(a) * l * 0.5, py + Math.sin(a) * l * 0.5 - 4, px + Math.cos(a) * l, py + Math.sin(a) * l);
        g.stroke();
      }
    }
  };

  // main shoot (bottom-centre up) plus side shoots
  const sx = S / 2, sy = S - 6, ex = S / 2 + 8, ey = 30;
  for (let k = 0; k < 9; k++) {
    const t = 0.12 + k * 0.09;
    const bx = sx + (ex - sx) * t, by = sy + (ey - sy) * t;
    const side = k % 2 ? 1 : -1;
    const a = -Math.PI / 2 + side * (0.55 + r() * 0.3);
    const L = 120 + r() * 70;
    needles(bx, by, bx + Math.cos(a) * L, by + Math.sin(a) * L, 85, 22);
  }
  needles(sx, sy, ex, ey, 85, 34);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- geometry
function colorize(geo, fn) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = fn(p.getX(i), p.getY(i), p.getZ(i));
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function trunkGeo(H, R, r, { bend, jagged = false, charred = 0 }) {
  const radial = 9, rows = jagged ? 6 : 9;
  const g = new THREE.CylinderGeometry(R * (jagged ? 0.8 : 0.3), R, H + 0.6, radial, rows, true);
  g.translate(0, (H + 0.6) / 2 - 0.6, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  const topY = H;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < 0.7) { const f = 1 + (0.7 - y) * 0.7; x *= f; z *= f; } // root flare
    if (jagged && y > topY - 0.01) {
      // splintered break: spikes and pulled-in fibres
      y += r() * r() * 1.6;
      const s = 0.55 + r() * 0.5; x *= s; z *= s;
    }
    const k = (y / H) ** 2;
    x += bend[0] * k; z += bend[1] * k;
    p.setXYZ(i, x, y, z);
    uv.setXY(i, uv.getX(i) * 1.5, y / 1.3);
  }
  g.computeVertexNormals();
  return colorize(g, (x, y) => {
    const h = y / H;
    // Scots pine: grey-brown plated bark below, thin orange bark up high
    let c = h > 0.5 && !jagged ? [1.25, 0.88, 0.62] : [1, 1, 1];
    if (h > 0.35 && h <= 0.5 && !jagged) { const t = (h - 0.35) / 0.15; c = [1 + 0.25 * t, 1 - 0.12 * t, 1 - 0.38 * t]; }
    const ch = charred * (1 - Math.min(1, y / (2 + charred * 10)));
    const k = 1 - ch * 0.88;
    return [c[0] * k, c[1] * k, c[2] * k];
  });
}

function branchGeo(start, dir, len, rad, dark) {
  const g = new THREE.CylinderGeometry(rad * 0.35, rad, len, 4, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  g.applyMatrix4(new THREE.Matrix4().compose(start, q, ONE));
  const c = dark ? [0.12, 0.11, 0.1] : [0.9, 0.75, 0.6];
  return colorize(g, () => c);
}

function cardCluster(out, pos, dir, size, r) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  const roll0 = r() * Math.PI;
  for (let i = 0; i < 3; i++) {
    const p = new THREE.PlaneGeometry(size * 0.85, size);
    p.translate(0, size * 0.42, 0);
    const qr = new THREE.Quaternion().setFromAxisAngle(dir, roll0 + (i * Math.PI) / 3);
    p.applyMatrix4(new THREE.Matrix4().compose(pos, qr.clone().multiply(q), ONE));
    out.push(p);
  }
}

function bendAt(bend, y, H) { const k = (y / H) ** 2; return new THREE.Vector3(bend[0] * k, y, bend[1] * k); }

function buildPine(seed, kind) {
  const r = mulberry32(seed);
  const young = kind === 'young';
  const H = kind === 'snapped' ? 2.5 + r() * 7 : young ? 1.6 + r() * 3.4 : 14 + r() * 9;
  const R = young ? 0.035 + H * 0.012 : 0.17 + r() * 0.13;
  const bend = young ? [(r() - 0.5) * 0.3, (r() - 0.5) * 0.3] : [(r() - 0.5) * 1.2, (r() - 0.5) * 1.2];
  const charred = kind === 'burnt' ? 1 : kind === 'snapped' ? r() * 0.8 : r() * 0.15;
  const wood = [trunkGeo(H, R, r, { bend, jagged: kind === 'snapped', charred })];
  const foliage = [];

  if (kind !== 'snapped') {
    // young pines keep branches almost to the ground (conical); mature ones self-prune
    const crownStart = young ? H * (0.04 + r() * 0.1) : H * (0.52 + r() * 0.14);
    const n = kind === 'burnt' ? 8 + Math.floor(r() * 7) : young ? 11 + Math.floor(r() * 5) : 22 + Math.floor(r() * 10);
    for (let i = 0; i < n; i++) {
      const rel = Math.pow(i / n, 0.85);
      const y = crownStart + (H - crownStart - 0.6) * rel + (r() - 0.5) * 0.5;
      const yaw = i * 2.39996 + r() * 0.6;
      const tilt = kind === 'burnt' ? (r() - 0.35) * 1.4 : young ? 0.15 + rel * 0.5 + (r() - 0.5) * 0.2 : 0.05 + rel * 0.75 + (r() - 0.5) * 0.25;
      const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(tilt), Math.sin(tilt), Math.sin(yaw) * Math.cos(tilt)).normalize();
      let len = young ? (0.15 + H * 0.33 * Math.pow(1 - rel, 0.9)) * (0.75 + r() * 0.4)
        : (0.9 + 2.6 * Math.pow(1 - rel, 0.6)) * (0.7 + r() * 0.45);
      if (kind === 'burnt') { if (r() < 0.35) continue; len *= 0.15 + r() * 0.55; } // broken, burnt-off limbs
      const start = bendAt(bend, y, H);
      wood.push(branchGeo(start, dir, len, young ? 0.015 + (1 - rel) * 0.015 : 0.035 + (1 - rel) * 0.05, kind === 'burnt'));

      const keep = kind === 'burnt' ? r() < 0.3 : true;
      if (!keep) continue;
      const clusters = kind === 'burnt' ? 1 : young ? 1 + Math.floor(len / 0.6) : 3 + Math.floor(len / 0.8);
      for (let k = 0; k < clusters; k++) {
        const t = 0.3 + (0.7 * (k + 1)) / clusters;
        const pos = start.clone().addScaledVector(dir, len * t);
        const cdir = dir.clone().addScaledVector(UP, 0.45).add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.5)).normalize();
        cardCluster(foliage, pos, cdir, kind === 'burnt' ? 1.0 + r() * 0.6 : young ? 0.55 + r() * 0.35 + H * 0.06 : 1.5 + r() * 0.9, r);
      }
    }
    if (kind !== 'burnt') {
      const ts = young ? 0.45 + H * 0.08 : 1;
      const top = bendAt(bend, H - 0.4 * ts, H);
      cardCluster(foliage, top, UP.clone(), 2.2 * ts, r);
      cardCluster(foliage, top.clone().add(new THREE.Vector3(0, -0.6 * ts, 0)), new THREE.Vector3(0.4, 1, 0.2).normalize(), 1.9 * ts, r);
    }
  }

  const woodGeo = mergeGeometries(wood);
  let folGeo = null;
  if (foliage.length) {
    folGeo = mergeGeometries(foliage);
    // soft "crown sphere" normals so the canopy shades as a volume
    const c = new THREE.Vector3(bend[0] * 0.6, young ? H * 0.45 : H * 0.8, bend[1] * 0.6);
    const p = folGeo.attributes.position, nrm = folGeo.attributes.normal, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(c).normalize().addScaledVector(UP, 0.6).normalize();
      nrm.setXYZ(i, v.x, v.y, v.z);
    }
  }
  return { woodGeo, folGeo, H, R };
}

// ---------------------------------------------------------------- birch
// Silver birch (Betula pendula): the other signature tree of Ukrainian
// forest belts. In late November most leaves are yellow or already gone.
function makeBirchBarkTexture() {
  const W = 256, H = 1024, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d'), r = mulberry32(9);
  g.fillStyle = '#e9e6dc'; g.fillRect(0, 0, W, H);
  // faint warm/grey mottling
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(${150 + r() * 60},${140 + r() * 50},${120 + r() * 50},${0.05 + r() * 0.08})`;
    g.fillRect(r() * W, r() * H, 10 + r() * 60, 3 + r() * 10);
  }
  // horizontal lenticels
  for (let i = 0; i < 520; i++) {
    const x = r() * W, y = r() * H, w = 6 + r() * 40;
    g.fillStyle = `rgba(40,34,30,${0.25 + r() * 0.5})`;
    g.fillRect(x, y, w, 1 + r() * 2.5);
    if (x + w > W) g.fillRect(x - W, y, w, 2);
  }
  // dark diamond-shaped scars
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y = r() * H, w = 12 + r() * 40, h = 6 + r() * 22;
    g.fillStyle = `rgba(28,24,22,${0.6 + r() * 0.35})`;
    g.beginPath(); g.moveTo(x - w / 2, y); g.lineTo(x, y - h / 2); g.lineTo(x + w / 2, y); g.lineTo(x, y + h / 2); g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

function makeBirchLeafTexture() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), r = mulberry32(17);
  // a drooping twig with small diamond-shaped leaves, many already fallen
  const twigs = 6;
  for (let k = 0; k < twigs; k++) {
    const x0 = S / 2 + (r() - 0.5) * 40, y0 = 6;
    const x1 = x0 + (r() - 0.5) * 160, y1 = S - 10 - r() * 60;
    g.strokeStyle = '#3b2c22'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + (r() - 0.5) * 40, y0 + 40, x1, y1); g.stroke();
    for (let i = 0; i < 14; i++) {
      if (r() < 0.35) continue; // leaves already dropped
      const t = 0.2 + (i / 14) * 0.8;
      const px = x0 + (x1 - x0) * t + (r() - 0.5) * 10, py = y0 + (y1 - y0) * t;
      const sz = 7 + r() * 6, a = (r() - 0.5) * 1.6;
      const hue = 38 + r() * 22, light = 42 + r() * 18, sat = 55 + r() * 30;
      g.fillStyle = `hsl(${hue},${sat}%,${light}%)`;
      g.save(); g.translate(px, py); g.rotate(a);
      g.beginPath(); g.moveTo(0, -sz); g.quadraticCurveTo(sz * 0.8, 0, 0, sz); g.quadraticCurveTo(-sz * 0.8, 0, 0, -sz); g.fill();
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function buildBirch(seed) {
  const r = mulberry32(seed);
  const H = 9 + r() * 8, R = 0.09 + r() * 0.07;
  const lean = [(r() - 0.5) * 1.8, (r() - 0.5) * 1.8];
  const g = new THREE.CylinderGeometry(R * 0.25, R, H + 0.5, 8, 10, true);
  g.translate(0, (H + 0.5) / 2 - 0.5, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = (Math.max(0, y) / H) ** 1.6;
    x += lean[0] * k; z += lean[1] * k;
    p.setXYZ(i, x, y, z);
    uv.setXY(i, uv.getX(i), y / 2.2);
  }
  g.computeVertexNormals();
  // bottom metre turns dark and fissured on old birches
  colorize(g, (x, y) => { const d = y < 1.4 ? 0.35 + 0.65 * Math.max(0, y) / 1.4 : 1; return [d, d * 0.97, d * 0.93]; });
  const wood = [g];
  const leaves = [];
  const crownStart = H * (0.35 + r() * 0.15);
  const n = 18 + Math.floor(r() * 8);
  for (let i = 0; i < n; i++) {
    const rel = i / n;
    const y = crownStart + (H - crownStart - 0.3) * rel;
    const yaw = i * 2.39996 + r();
    const tilt = 0.5 + r() * 0.5 - rel * 0.1;               // birch limbs angle steeply upward
    const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(tilt), Math.sin(tilt), Math.sin(yaw) * Math.cos(tilt));
    const len = (0.8 + 2.4 * Math.sin(Math.PI * (0.2 + rel * 0.7))) * (0.7 + r() * 0.5);
    const start = new THREE.Vector3(lean[0] * (y / H) ** 1.6, y, lean[1] * (y / H) ** 1.6);
    const b = branchGeo(start, dir, len, 0.012 + (1 - rel) * 0.025, true);
    colorize(b, () => [0.22, 0.18, 0.16]);
    wood.push(b);
    // weeping twig curtains hang from the outer half of each limb
    const curt = 2 + Math.floor(len / 0.7);
    for (let k = 0; k < curt; k++) {
      const pos = start.clone().addScaledVector(dir, len * (0.35 + 0.65 * (k + 1) / curt));
      // the twig texture hangs from its top edge, so grow the card upward from below the limb
      const up = new THREE.Vector3((r() - 0.5) * 0.4, 1, (r() - 0.5) * 0.4).normalize();
      const sz = 1.0 + r() * 0.6;
      if (r() < 0.6) cardCluster(leaves, pos.clone().addScaledVector(up, -sz * 0.8), up, sz, r);
    }
  }
  const woodGeo = mergeGeometries(wood);
  const folGeo = leaves.length ? mergeGeometries(leaves) : null;
  if (folGeo) {
    const c = new THREE.Vector3(lean[0] * 0.5, H * 0.7, lean[1] * 0.5);
    const pp = folGeo.attributes.position, nrm = folGeo.attributes.normal, v = new THREE.Vector3();
    for (let i = 0; i < pp.count; i++) { v.set(pp.getX(i), pp.getY(i), pp.getZ(i)).sub(c).normalize().addScaledVector(UP, 0.5).normalize(); nrm.setXYZ(i, v.x, v.y, v.z); }
  }
  return { woodGeo, folGeo, H, R };
}

function logGeo(seed) {
  const r = mulberry32(seed);
  const L = 5 + r() * 6, R = 0.15 + r() * 0.1;
  const g = new THREE.CylinderGeometry(R * 0.45, R, L, 8, 6, true);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i);
    if (y < -L / 2 + 0.01) { p.setX(i, p.getX(i) * (0.6 + r() * 0.5)); p.setZ(i, p.getZ(i) * (0.6 + r() * 0.5)); y -= r() * 0.6; p.setY(i, y); }
    uv.setXY(i, uv.getX(i) * 1.5, y / 1.3);
  }
  g.rotateZ(Math.PI / 2);
  g.computeVertexNormals();
  return colorize(g, () => (r() < 0.5 ? [0.3, 0.27, 0.24] : [0.75, 0.68, 0.6]));
}

// ---------------------------------------------------------------- forest
export function createForest() {
  const bark = loadPBR('knotted_pine_bark');
  const barkMat = new THREE.MeshStandardMaterial({
    map: bark.map, normalMap: bark.normalMap, roughnessMap: bark.roughnessMap,
    vertexColors: true, roughness: 1,
  });
  addWind(barkMat);
  const birchBarkMat = new THREE.MeshStandardMaterial({ map: makeBirchBarkTexture(), vertexColors: true, roughness: 0.9 });
  addWind(birchBarkMat, 1.4);

  const needleMat = new THREE.MeshStandardMaterial({
    map: makeNeedleTexture(), alphaTest: 0.42, alphaToCoverage: true,
    side: THREE.DoubleSide, roughness: 0.82,
  });
  addWind(needleMat);
  const leafMat = new THREE.MeshStandardMaterial({
    map: makeBirchLeafTexture(), alphaTest: 0.4, alphaToCoverage: true,
    side: THREE.DoubleSide, roughness: 0.75,
  });
  addWind(leafMat, 1.8);

  const kinds = [
    ...Array.from({ length: 7 }, (_, i) => ({ kind: 'healthy', seed: 100 + i })),
    ...Array.from({ length: 4 }, (_, i) => ({ kind: 'burnt', seed: 200 + i })),
    ...Array.from({ length: 5 }, (_, i) => ({ kind: 'snapped', seed: 300 + i })),
    ...Array.from({ length: 6 }, (_, i) => ({ kind: 'young', seed: 500 + i })),
  ].map((v) => ({ ...v, ...buildPine(v.seed, v.kind), items: [], wood: barkMat, fol: needleMat }));
  for (let i = 0; i < 5; i++) kinds.push({ kind: 'birch', seed: 600 + i, ...buildBirch(600 + i), items: [], wood: birchBarkMat, fol: leafMat });
  const byKind = (k) => kinds.filter((v) => v.kind === k);
  const logs = [0, 1, 2].map((i) => ({ geo: logGeo(400 + i), items: [] }));

  const colliders = [];
  const snappedSpots = [];
  const r = mulberry32(2024);
  const LIMIT = HALF - 6;

  // spatial hash so clumps and saplings don't spawn inside existing trunks
  const CELL = 4, occ = new Map();
  const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const free = (x, z, d) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
      for (const c of occ.get(`${cx + i},${cz + j}`) || []) if (Math.hypot(c.x - x, c.z - z) < d) return false;
    return true;
  };

  const plant = (x, z, kind, scale = 1) => {
    const pool = byKind(kind);
    const v = pool[Math.floor(r() * pool.length)];
    const s = (0.85 + r() * 0.3) * scale;
    const y = heightAt(x, z);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(UP, r() * Math.PI * 2),
      new THREE.Vector3(s, s * (0.9 + r() * 0.2), s)
    );
    const col = new THREE.Color();
    if (kind === 'healthy' || kind === 'young') col.setHSL(0.25 + r() * 0.05, 0.25 + r() * 0.25, 0.55 + r() * 0.2).multiplyScalar(kind === 'young' ? 1.7 : 1.5);
    else if (kind === 'birch') col.setHSL(0.1 + r() * 0.06, 0.5 + r() * 0.3, 0.6 + r() * 0.25).multiplyScalar(1.4); // yellow → amber
    else col.setRGB(0.55, 0.36, 0.2); // scorched brown needles
    v.items.push({ m, col });
    const c = { x, z, r: v.R * s + 0.15, base: y - 0.5, h: v.H * s + 0.5 };
    if (v.H * s > 2.2) colliders.push(c); // you can push through small saplings
    (occ.get(key(x, z)) || occ.set(key(x, z), []).get(key(x, z))).push(c);
    return v;
  };

  // 1. the main stand
  const SPACING = 6.2;
  for (let gx = -LIMIT; gx < LIMIT; gx += SPACING) {
    for (let gz = -LIMIT; gz < LIMIT; gz += SPACING) {
      const x = gx + (r() - 0.5) * SPACING * 0.9;
      const z = gz + (r() - 0.5) * SPACING * 0.9;
      const dmg = damageAt(x, z);
      if (r() < 0.32 + dmg * 0.25) continue;      // gaps; shelled areas thinner
      if (!isBuildable(x, z)) continue;

      const roll = r();
      let kind = roll < dmg * 0.32 ? 'snapped' : roll < dmg * 0.7 ? 'burnt' : 'healthy';
      if (kind === 'healthy' && r() < 0.12) kind = 'birch';
      plant(x, z, kind);

      if (kind === 'snapped') {
        snappedSpots.push({ x, z });
        if (r() < 0.75) {
          // the broken-off top lying on the ground nearby
          const a = r() * Math.PI * 2, d = 3 + r() * 4;
          const lx = x + Math.cos(a) * d, lz = z + Math.sin(a) * d;
          const L = logs[Math.floor(r() * logs.length)];
          L.items.push({
            m: new THREE.Matrix4().compose(
              new THREE.Vector3(lx, heightAt(lx, lz) + 0.12, lz),
              new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.15, a + Math.PI / 2, (r() - 0.5) * 0.15)),
              ONE
            ),
          });
        }
      }
    }
  }

  // 2. thickets: tight clumps of trees, saplings and birch scattered through the forest
  const clumps = [];
  for (let i = 0; i < 34; i++) {
    const cx = (r() - 0.5) * LIMIT * 2, cz = (r() - 0.5) * LIMIT * 2;
    if (!isBuildable(cx, cz, 2) || damageAt(cx, cz) > 0.75) continue;
    const rad = 7 + r() * 11;
    clumps.push({ x: cx, z: cz, r: rad });
    const count = Math.floor(rad * rad * 0.2);
    for (let k = 0; k < count; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (Math.abs(x) > LIMIT || Math.abs(z) > LIMIT || !isBuildable(x, z)) continue;
      const roll = r();
      const kind = roll < 0.42 ? 'young' : roll < 0.62 ? 'birch' : roll < 0.95 ? 'healthy' : 'burnt';
      const minD = kind === 'young' ? 1.1 : 1.8;
      if (!free(x, z, minD)) continue;
      plant(x, z, kind, kind === 'young' ? 0.8 + r() * 0.7 : 1);
    }
  }

  // 3. sporadic young pines: natural regeneration in gaps and along the edges of shell scars
  for (let i = 0; i < 1400; i++) {
    const x = (r() - 0.5) * LIMIT * 2, z = (r() - 0.5) * LIMIT * 2;
    if (!isBuildable(x, z, 1.4) || !free(x, z, 2.2)) continue;
    // more saplings where the canopy has opened up
    if (r() > 0.25 + damageAt(x, z) * 0.6) continue;
    if (r() < 0.12) plant(x, z, 'birch', 0.35 + r() * 0.3);       // birch saplings colonise burnt ground
    else plant(x, z, 'young', 0.6 + r() * 0.9);
  }

  const group = new THREE.Group();
  const white = new THREE.Color(1, 1, 1);
  const instanced = (geo, mat, items, useCol, shadow = true) => {
    if (!items.length) return;
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((it, i) => { im.setMatrixAt(i, it.m); if (useCol) im.setColorAt(i, it.col || white); });
    im.castShadow = shadow; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  };
  for (const v of kinds) {
    instanced(v.woodGeo, v.wood, v.items, false, v.kind !== 'young');
    if (v.folGeo) instanced(v.folGeo, v.fol, v.items, true, v.kind !== 'young');
  }
  for (const L of logs) instanced(L.geo, barkMat, L.items, false);

  const counts = {};
  for (const v of kinds) counts[v.kind] = (counts[v.kind] || 0) + v.items.length;
  return { group, colliders, snappedSpots, clumps, counts, count: Object.values(counts).reduce((a, b) => a + b, 0) };
}
