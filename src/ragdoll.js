// Verlet ragdoll for the Character Creator soldier rig.
//
// On death the animation stops and 15 particles are placed on the joints. A
// rigid torso box (hips, chest, shoulders, thighs), limb sticks and a few soft
// limits are relaxed each step against gravity, the terrain and tree trunks.
// The skeleton is then posed from the particles: the hip from the torso frame,
// every limb bone by rotating its death pose onto the new joint direction.
import * as THREE from 'three';
import { heightAt } from './world.js';

const J = {
  hip: ['CC_Base_Hip', 0.13], chest: ['CC_Base_Spine02', 0.14], head: ['CC_Base_Head', 0.12],
  lua: ['CC_Base_L_Upperarm', 0.06], lfa: ['CC_Base_L_Forearm', 0.05], lh: ['CC_Base_L_Hand', 0.05],
  rua: ['CC_Base_R_Upperarm', 0.06], rfa: ['CC_Base_R_Forearm', 0.05], rh: ['CC_Base_R_Hand', 0.05],
  lth: ['CC_Base_L_Thigh', 0.09], lca: ['CC_Base_L_Calf', 0.06], lft: ['CC_Base_L_Foot', 0.05],
  rth: ['CC_Base_R_Thigh', 0.09], rca: ['CC_Base_R_Calf', 0.06], rft: ['CC_Base_R_Foot', 0.05],
};
export const RAGDOLL_BONES = [...Object.values(J).map((j) => j[0]), 'CC_Base_NeckTwist01'];
const TORSO = ['hip', 'chest', 'lua', 'rua', 'lth', 'rth'];
const STICKS = [['chest', 'head'], ['lua', 'lfa'], ['lfa', 'lh'], ['rua', 'rfa'], ['rfa', 'rh'],
  ['lth', 'lca'], ['lca', 'lft'], ['rth', 'rca'], ['rca', 'rft']];
const SOFT = [['lua', 'head', 0.4], ['rua', 'head', 0.4]];
// joints may bend but not fold flat onto themselves: [a, b, fraction of the straight length]
const MIN = [['lua', 'lh', 0.45], ['rua', 'rh', 0.45], ['lth', 'lft', 0.55], ['rth', 'rft', 0.55], ['hip', 'head', 0.85]];
// bone -> joint particle it should point at (parents before children)
const DRIVE = [
  ['CC_Base_NeckTwist01', 'head'],
  ['CC_Base_L_Upperarm', 'lfa'], ['CC_Base_L_Forearm', 'lh'],
  ['CC_Base_R_Upperarm', 'rfa'], ['CC_Base_R_Forearm', 'rh'],
  ['CC_Base_L_Thigh', 'lca'], ['CC_Base_L_Calf', 'lft'],
  ['CC_Base_R_Thigh', 'rca'], ['CC_Base_R_Calf', 'rft'],
];

const G = 9.8, H = 1 / 90, ITER = 6;
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

export class Ragdoll {
  // root: the soldier's scene root; bones: name -> Bone; trees(x, z, cb) visits nearby tree circles
  constructor(root, bones, trees, vel) {
    this.root = root; this.bones = bones; this.trees = trees;
    root.updateMatrixWorld(true);
    this.p = {};
    for (const [k, [name, r]] of Object.entries(J)) {
      const pos = bones[name].getWorldPosition(new THREE.Vector3());
      this.p[k] = { pos, prev: pos.clone().addScaledVector(vel || _v.set(0, 0, 0), -H), r };
    }
    const len = (a, b) => this.p[a].pos.distanceTo(this.p[b].pos);
    this.cons = [];
    for (let i = 0; i < TORSO.length; i++) for (let j = i + 1; j < TORSO.length; j++) this.cons.push([TORSO[i], TORSO[j], len(TORSO[i], TORSO[j]), 1]);
    for (const [a, b] of STICKS) this.cons.push([a, b, len(a, b), 1]);
    for (const [a, b, k] of SOFT) this.cons.push([a, b, len(a, b), k]);
    this.mins = MIN.map(([a, b, f]) => {
      const straight = a === 'hip' ? len('hip', 'chest') + len('chest', 'head')
        : len(a, a[0] + (a[1] === 'u' ? 'fa' : 'ca')) + len(a[0] + (a[1] === 'u' ? 'fa' : 'ca'), b);
      return [a, b, Math.min(len(a, b), straight * f)];
    });

    // death pose references
    this.hip = bones.CC_Base_Hip;
    this.hipQ0 = this.hip.getWorldQuaternion(new THREE.Quaternion());
    this.frame0 = this.frame(new THREE.Quaternion());
    this.drive = DRIVE.filter(([n]) => bones[n]).map(([n, k]) => {
      const b = bones[n], bp = b.getWorldPosition(new THREE.Vector3());
      return { b, k, q0: b.getWorldQuaternion(new THREE.Quaternion()), d0: this.p[k].pos.clone().sub(bp).normalize() };
    });
    this.t = 0; this.stillT = 0; this.asleep = false;
    this.center = this.p.hip.pos;
  }

  // world orientation of the torso, from the hip->chest and left->right thigh axes
  frame(out) {
    const P = this.p;
    _x.subVectors(P.rth.pos, P.lth.pos).normalize();
    _y.subVectors(P.chest.pos, P.hip.pos);
    _y.addScaledVector(_x, -_y.dot(_x)).normalize();
    _z.crossVectors(_x, _y);
    return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
  }

  // push the body: everything a little, the joint nearest the hit a lot
  impulse(point, dir, force) {
    this.asleep = false; this.stillT = 0; this.t = Math.min(this.t, 6);
    let best = null, bd = Infinity;
    for (const p of Object.values(this.p)) {
      const d = point ? p.pos.distanceToSquared(point) : 0;
      if (d < bd) { bd = d; best = p; }
      p.prev.addScaledVector(dir, -force * 0.25 * H);
    }
    if (best) best.prev.addScaledVector(dir, -force * H);
  }

  // extra velocity on one joint (e.g. buckle the knees)
  kick(key, v) { this.p[key].prev.addScaledVector(v, -H); }

  update(dt) {
    if (this.asleep) return;
    this.t += dt;
    const steps = Math.min(4, Math.ceil(dt / H));
    let moved = 0;
    for (let s = 0; s < steps; s++) moved = Math.max(moved, this.step());
    // sleep once the body has been still for a while
    this.stillT = moved < 0.15 * H ? this.stillT + dt : 0;
    if ((this.t > 1.5 && this.stillT > 0.6) || this.t > 12) this.asleep = true;
    this.pose();
  }

  step() {
    let maxV = 0;
    for (const p of Object.values(this.p)) {
      _v.subVectors(p.pos, p.prev).multiplyScalar(0.995);
      p.prev.copy(p.pos);
      p.pos.add(_v); p.pos.y -= G * H * H;
      maxV = Math.max(maxV, _v.length());
    }
    for (let it = 0; it < ITER; it++) {
      for (const [a, b, rest, k] of this.cons) this.solve(this.p[a], this.p[b], rest, k, false);
      for (const [a, b, min] of this.mins) this.solve(this.p[a], this.p[b], min, 0.5, true);
      this.collide();
    }
    return maxV;
  }

  solve(A, B, rest, k, minOnly) {
    _d.subVectors(B.pos, A.pos);
    const l = _d.length();
    if (l < 1e-6 || (minOnly && l >= rest)) return;
    const c = ((l - rest) / l) * 0.5 * k;
    A.pos.addScaledVector(_d, c); B.pos.addScaledVector(_d, -c);
  }

  collide() {
    for (const p of Object.values(this.p)) {
      const g = heightAt(p.pos.x, p.pos.z) + p.r;
      if (p.pos.y < g) {
        p.pos.y = g;
        // ground friction: bleed off sliding, no bounce
        p.prev.y = Math.max(p.prev.y, g);
        p.prev.x = p.pos.x - (p.pos.x - p.prev.x) * 0.55;
        p.prev.z = p.pos.z - (p.pos.z - p.prev.z) * 0.55;
      }
      if (this.trees) this.trees(p.pos.x, p.pos.z, (c) => {
        if (p.pos.y < c.base || p.pos.y > c.base + c.h) return;
        const dx = p.pos.x - c.x, dz = p.pos.z - c.z, d = Math.hypot(dx, dz), min = c.r + p.r;
        if (d < min && d > 1e-4) { p.pos.x = c.x + (dx / d) * min; p.pos.z = c.z + (dz / d) * min; }
      });
    }
  }

  // drive the skeleton from the particles
  pose() {
    // hip: position + rotation of the torso frame relative to the death pose
    const hip = this.hip, parent = hip.parent;
    this.frame(_q);
    _q.multiply(_pq.copy(this.frame0).invert()).multiply(this.hipQ0);
    parent.getWorldQuaternion(_pq);
    hip.quaternion.copy(_pq.invert().multiply(_q));
    hip.position.copy(parent.worldToLocal(_v.copy(this.p.hip.pos)));
    hip.updateMatrixWorld(true);
    // limbs: swing each bone's death pose onto its joint's new direction
    for (const r of this.drive) {
      r.b.getWorldPosition(_v);
      _d.subVectors(this.p[r.k].pos, _v);
      if (_d.lengthSq() < 1e-8) continue;
      _q.setFromUnitVectors(r.d0, _d.normalize()).multiply(r.q0);
      r.b.parent.getWorldQuaternion(_pq);
      r.b.quaternion.copy(_pq.invert().multiply(_q));
      r.b.updateMatrixWorld(true);
    }
  }
}
