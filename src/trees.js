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
        g.lineWidth = 2.2 + r() * 1.2;
        g.beginPath();
        g.moveTo(px, py);
        g.quadraticCurveTo(px + Math.cos(a) * l * 0.5, py + Math.sin(a) * l * 0.5 - 4, px + Math.cos(a) * l, py + Math.sin(a) * l);
        g.stroke();
      }
    }
  };

  // main shoot (bottom-centre up) plus side shoots
  const sx = S / 2, sy = S - 6, ex = S / 2 + 8, ey = 30;
  for (let k = 0; k < 7; k++) {
    const t = 0.15 + k * 0.11;
    const bx = sx + (ex - sx) * t, by = sy + (ey - sy) * t;
    const side = k % 2 ? 1 : -1;
    const a = -Math.PI / 2 + side * (0.55 + r() * 0.3);
    const L = 120 + r() * 70;
    needles(bx, by, bx + Math.cos(a) * L, by + Math.sin(a) * L, 70, 16);
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
  const H = kind === 'snapped' ? 2.5 + r() * 7 : 14 + r() * 9;
  const R = 0.17 + r() * 0.13;
  const bend = [(r() - 0.5) * 1.2, (r() - 0.5) * 1.2];
  const charred = kind === 'burnt' ? 1 : kind === 'snapped' ? r() * 0.8 : r() * 0.15;
  const wood = [trunkGeo(H, R, r, { bend, jagged: kind === 'snapped', charred })];
  const foliage = [];

  if (kind !== 'snapped') {
    const crownStart = H * (0.52 + r() * 0.14);
    const n = kind === 'burnt' ? 10 + Math.floor(r() * 6) : 16 + Math.floor(r() * 9);
    for (let i = 0; i < n; i++) {
      const rel = Math.pow(i / n, 0.85);
      const y = crownStart + (H - crownStart - 0.6) * rel + (r() - 0.5) * 0.5;
      const yaw = i * 2.39996 + r() * 0.6;
      const tilt = 0.05 + rel * 0.75 + (r() - 0.5) * 0.25;
      const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(tilt), Math.sin(tilt), Math.sin(yaw) * Math.cos(tilt)).normalize();
      let len = (0.9 + 2.6 * Math.pow(1 - rel, 0.6)) * (0.7 + r() * 0.45);
      if (kind === 'burnt') len *= 0.35 + r() * 0.7; // broken, burnt-off limbs
      const start = bendAt(bend, y, H);
      wood.push(branchGeo(start, dir, len, 0.035 + (1 - rel) * 0.05, kind === 'burnt'));

      const keep = kind === 'burnt' ? r() < 0.3 : true;
      if (!keep) continue;
      const clusters = kind === 'burnt' ? 1 : 2 + Math.floor(len / 1.1);
      for (let k = 0; k < clusters; k++) {
        const t = 0.3 + (0.7 * (k + 1)) / clusters;
        const pos = start.clone().addScaledVector(dir, len * t);
        const cdir = dir.clone().addScaledVector(UP, 0.7).add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.5)).normalize();
        cardCluster(foliage, pos, cdir, 1.0 + r() * 0.7, r);
      }
    }
    if (kind !== 'burnt') {
      const top = bendAt(bend, H - 0.4, H);
      cardCluster(foliage, top, UP.clone(), 1.6, r);
      cardCluster(foliage, top.clone().add(new THREE.Vector3(0, -0.6, 0)), new THREE.Vector3(0.4, 1, 0.2).normalize(), 1.3, r);
    }
  }

  const woodGeo = mergeGeometries(wood);
  let folGeo = null;
  if (foliage.length) {
    folGeo = mergeGeometries(foliage);
    // soft "crown sphere" normals so the canopy shades as a volume
    const c = new THREE.Vector3(bend[0] * 0.6, H * 0.8, bend[1] * 0.6);
    const p = folGeo.attributes.position, nrm = folGeo.attributes.normal, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(c).normalize().addScaledVector(UP, 0.6).normalize();
      nrm.setXYZ(i, v.x, v.y, v.z);
    }
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

  const needleMat = new THREE.MeshStandardMaterial({
    map: makeNeedleTexture(), alphaTest: 0.42, alphaToCoverage: true,
    side: THREE.DoubleSide, roughness: 0.82,
  });
  addWind(needleMat);

  const kinds = [
    ...Array.from({ length: 7 }, (_, i) => ({ kind: 'healthy', seed: 100 + i })),
    ...Array.from({ length: 4 }, (_, i) => ({ kind: 'burnt', seed: 200 + i })),
    ...Array.from({ length: 5 }, (_, i) => ({ kind: 'snapped', seed: 300 + i })),
  ].map((v) => ({ ...v, ...buildPine(v.seed, v.kind), items: [] }));
  const byKind = (k) => kinds.filter((v) => v.kind === k);
  const logs = [0, 1, 2].map((i) => ({ geo: logGeo(400 + i), items: [] }));

  const colliders = [];
  const snappedSpots = [];
  const r = mulberry32(2024);
  const SPACING = 6.2;
  const LIMIT = HALF - 6;

  for (let gx = -LIMIT; gx < LIMIT; gx += SPACING) {
    for (let gz = -LIMIT; gz < LIMIT; gz += SPACING) {
      const x = gx + (r() - 0.5) * SPACING * 0.9;
      const z = gz + (r() - 0.5) * SPACING * 0.9;
      const dmg = damageAt(x, z);
      if (r() < 0.32 + dmg * 0.25) continue;      // gaps; shelled areas thinner
      if (!isBuildable(x, z)) continue;

      const roll = r();
      const kind = roll < dmg * 0.42 ? 'snapped' : roll < dmg * 0.95 ? 'burnt' : 'healthy';
      const pool = byKind(kind);
      const v = pool[Math.floor(r() * pool.length)];
      const s = 0.85 + r() * 0.3;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, heightAt(x, z), z),
        new THREE.Quaternion().setFromAxisAngle(UP, r() * Math.PI * 2),
        new THREE.Vector3(s, s * (0.9 + r() * 0.2), s)
      );
      const col = new THREE.Color();
      if (kind === 'healthy') col.setHSL(0.25 + r() * 0.05, 0.25 + r() * 0.25, 0.55 + r() * 0.2).multiplyScalar(1.5);
      else col.setRGB(0.55, 0.36, 0.2); // scorched brown needles
      v.items.push({ m, col });
      colliders.push({ x, z, r: v.R * s + 0.15 });

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

  const group = new THREE.Group();
  const white = new THREE.Color(1, 1, 1);
  const instanced = (geo, mat, items, useCol) => {
    if (!items.length) return;
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((it, i) => { im.setMatrixAt(i, it.m); if (useCol) im.setColorAt(i, it.col || white); });
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  };
  for (const v of kinds) {
    instanced(v.woodGeo, barkMat, v.items, false);
    if (v.folGeo) instanced(v.folGeo, needleMat, v.items, true);
  }
  for (const L of logs) instanced(L.geo, barkMat, L.items, false);

  return { group, colliders, snappedSpots, count: colliders.length };
}
