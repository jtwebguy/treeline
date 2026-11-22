// Verlet ragdoll for the Character Creator soldier rig.
//
// On death the animation stops and 15 particles are placed on the joints. A
// rigid torso box (hips, chest, shoulders, thighs) and limb sticks are relaxed
// each step against gravity, the terrain and tree trunks, together with human
// joint limits so the body only folds the way a real one can:
//   - knees are hinges that bend only backwards, elbows only forwards
//     (with the upper arm's twist), neither past ~125-140 degrees
//   - hips, shoulders and neck have ranges of motion measured in the torso's
//     own frame (no leg swinging up behind the back, no head rolled onto a
//     shoulder)
//   - elbows, hands, knees and feet are kept out of the torso, and the legs
//     out of each other
// The skeleton is then posed from the particles: the hip from the torso frame,
// every limb bone by rotating its death pose onto the new joint direction.
import * as THREE from 'three';
import { heightAt } from './world.js';

const J = {
  hip: ['CC_Base_Hip', 0.13], chest: ['CC_Base_Spine02', 0.14], head: ['CC_Base_Head', 0.12],
  lua: ['CC_Base_L_Upperarm', 0.06], lfa: ['CC_Base_L_Forearm', 0.05], lh: ['CC_Base_L_Hand', 0.05],
  rua: ['CC_Base_R_Upperarm', 0.06], rfa: ['CC_Base_R_Forearm', 0.05], rh: ['CC_Base_R_Hand', 0.05],
  lth: ['CC_Base_L_Thigh', 0.09], lca: ['CC_Base_L_Calf', 0.06], lft: ['CC_Base_L_Foot', 0.07],
  rth: ['CC_Base_R_Thigh', 0.09], rca: ['CC_Base_R_Calf', 0.06], rft: ['CC_Base_R_Foot', 0.07],
};
export const RAGDOLL_BONES = [...Object.values(J).map((j) => j[0]), 'CC_Base_NeckTwist01'];
const TORSO = ['hip', 'chest', 'lua', 'rua', 'lth', 'rth'];
const STICKS = [['chest', 'head'], ['lua', 'lfa'], ['lfa', 'lh'], ['rua', 'rfa'], ['rfa', 'rh'],
  ['lth', 'lca'], ['lca', 'lft'], ['rth', 'rca'], ['rca', 'rft']];
const SOFT = [['lua', 'head', 0.4], ['rua', 'head', 0.4]];
// joints may bend but not fold flat onto themselves: [a, b, fraction of the straight length]
const MIN = [['lua', 'lh', 0.5], ['rua', 'rh', 0.5], ['lth', 'lft', 0.55], ['rth', 'rft', 0.55], ['hip', 'head', 0.85]];
// legs may not pass through each other: [a, b, metres]
const APART = [['lca', 'rca', 0.13], ['lft', 'rft', 0.12], ['lca', 'rft', 0.1], ['rca', 'lft', 0.1]];
// limb joints kept out of the torso (a capsule round the hip -> chest line)
const OUTSIDE = ['lfa', 'lh', 'rfa', 'rh', 'lca', 'lft', 'rca', 'rft'];
const TORSO_R = 0.1;
const HYPER = Math.tan(0.16);   // ~9 degrees of hyperextension allowed at knees and elbows

// Ranges of motion of a limb's direction in the torso frame, as limits on
// its components: out = away from the body's midline, up, fwd = the way the
// body faces. A thigh or upper arm hanging straight down is (0, -1, 0).
const ROM = {
  hip: { out: [-0.3, 0.75], up: [-1, 0.5], fwd: [-0.4, 1] },        // ~20 deg adduction, 50 abduction, 25 extension, 120 flexion
  shoulder: { out: [-0.5, 1], up: [-1, 1], fwd: [-0.55, 1] },       // can't reach far across or behind the body
  neck: { out: [-0.5, 0.5], up: [0.62, 1], fwd: [-0.4, 0.75] },     // ~50 deg any way, less backwards
};
// [upper joint, middle joint, end joint, ROM of the upper limb, hinge: which
// way the end swings relative to the limb's front, allowed sideways play]
const LIMBS = [
  ['lth', 'lca', 'lft', 'hip', -1, 0.3], ['rth', 'rca', 'rft', 'hip', -1, 0.3],    // knees bend backwards, ~17 deg play
  ['lua', 'lfa', 'lh', 'shoulder', 1, 1.75], ['rua', 'rfa', 'rh', 'shoulder', 1, 1.75], // elbows forwards, upper-arm twist ~100 deg
];
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
const _fq = new THREE.Quaternion(), _fqi = new THREE.Quaternion(), _sq = new THREE.Quaternion();
const _t = new THREE.Vector3(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

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
    // the way the body faces (the model looks down its local +Z), in the torso frame
    this.fwd = root.getWorldDirection(new THREE.Vector3()).applyQuaternion(this.frame0.clone().invert());
    this.fwd.y = 0; this.fwd.normalize();
    this.out = new THREE.Vector3(1, 0, 0);    // torso-frame +X runs left thigh -> right thigh
    this.drive = DRIVE.filter(([n]) => bones[n]).map(([n, k]) => {
      const b = bones[n], bp = b.getWorldPosition(new THREE.Vector3());
      return { b, k, q0: b.getWorldQuaternion(new THREE.Quaternion()), d0: this.p[k].pos.clone().sub(bp).normalize() };
    });
    // each limb's front, so a hinge keeps a consistent side when raised overhead
    this.fronts = LIMBS.map(() => this.fwd.clone().applyQuaternion(this.frame0));
    this.t = 0; this.stillT = 0; this.asleep = false; this.drag = 0.995;
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
    this.asleep = false; this.stillT = 0; this.t = Math.min(this.t, 1);
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
    const h0 = this.p.hip.pos.clone(), c0 = this.p.chest.pos.clone();
    // a body comes to rest: after the first second the air drag rises
    // steeply, so limbs that are still being argued over by the joint limits
    // settle instead of vibrating
    this.drag = THREE.MathUtils.lerp(0.995, 0.86, THREE.MathUtils.smoothstep(this.t, 1, 2.6));
    for (let s = 0; s < steps; s++) this.step();
    // sleep once the trunk has been still for a while (judged by the hips and
    // chest: a twitching hand must not keep the whole body awake), and in any
    // case a few seconds after the last hit
    const moved = Math.max(h0.distanceTo(this.p.hip.pos), c0.distanceTo(this.p.chest.pos)) / Math.max(dt, 1e-4);
    this.stillT = moved < 0.12 ? this.stillT + dt : 0;
    if ((this.t > 1.5 && this.stillT > 0.5) || this.t > 6) this.asleep = true;
    this.pose();
  }

  step() {
    let maxV = 0, e0 = 0;
    const ps = Object.values(this.p);
    for (const p of ps) {
      _v.subVectors(p.pos, p.prev).multiplyScalar(this.drag);
      p.prev.copy(p.pos);
      p.pos.add(_v); p.pos.y -= G * H * H;
      _v.y -= G * H * H;
      e0 += _v.lengthSq();
      maxV = Math.max(maxV, _v.length());
    }
    for (let it = 0; it < ITER; it++) {
      for (const [a, b, rest, k] of this.cons) this.solve(this.p[a], this.p[b], rest, k, false);
      for (const [a, b, min] of this.mins) this.solve(this.p[a], this.p[b], min, 0.5, true);
      for (const [a, b, min] of APART) this.solve(this.p[a], this.p[b], min, 0.5, true);
      this.limits();
      this.collide();
    }
    // Constraints and joint limits only move joints back into place: they can
    // take energy out of the body but must never add it. When the limits fight
    // the sticks they do (each correction becomes velocity in the Verlet
    // step), and that was what made corpses jitter, slide and fly. So if the
    // solve left the body moving faster than it went in, scale it back.
    let e1 = 0;
    for (const p of ps) e1 += _v.subVectors(p.pos, p.prev).lengthSq();
    if (e1 > e0 && e1 > 1e-12) {
      const k = Math.sqrt(0.97 * e0 / e1);
      for (const p of ps) p.prev.lerp(p.pos, 1 - k);
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

  // ---------------------------------------------------------------- joint limits
  limits() {
    const P = this.p;
    this.frame(_fq); _fqi.copy(_fq).invert();
    LIMBS.forEach(([up, mid, end, rom, bend, play], i) => {
      const side = up[0] === 'l' ? -1 : 1;
      this.range(P[up], P[mid], ROM[rom], side);
      this.hinge(P[up], P[mid], P[end], bend, play, this.fronts[i]);
    });
    this.range(P.chest, P.head, ROM.neck, 0);
    this.keepOut();
  }

  // clamp the direction a -> b to a range of motion in the torso frame; b moves
  range(A, B, rom, side) {
    _t.subVectors(B.pos, A.pos);
    const len = _t.length();
    if (len < 1e-5) return;
    _t.divideScalar(len).applyQuaternion(_fqi);                // torso-frame direction
    const fsign = this.fwd.z < 0 ? -1 : 1;
    const out = side ? _t.x * side : _t.x, up = _t.y, fwd = _t.z * fsign;
    const v = [out, up, fwd], lim = [rom.out, rom.up, rom.fwd];
    if (v.every((x, i) => x >= lim[i][0] && x <= lim[i][1])) return;
    // Clamp the components, then restore unit length by scaling only the ones
    // that were not clamped. (Clamping and then normalising all three pushed a
    // clamped component back out of range, so every call nudged the joint
    // round the edge of its range: knees orbited the hip forever.)
    const fixed = [false, false, false];
    for (let pass = 0; pass < 3; pass++) {
      let fixedSq = 0, freeSq = 0;
      for (let i = 0; i < 3; i++) {
        const c = Math.min(lim[i][1], Math.max(lim[i][0], v[i]));
        if (c !== v[i]) { v[i] = c; fixed[i] = true; }
        if (fixed[i]) fixedSq += v[i] * v[i]; else freeSq += v[i] * v[i];
      }
      if (fixedSq >= 1 || freeSq < 1e-8) break;
      const k = Math.sqrt((1 - fixedSq) / freeSq);
      for (let i = 0; i < 3; i++) if (!fixed[i]) v[i] *= k;
      if (v.every((x, i) => x >= lim[i][0] - 1e-6 && x <= lim[i][1] + 1e-6)) break;
    }
    _t.set(side ? v[0] * side : v[0], v[1], v[2] * fsign).normalize().applyQuaternion(_fq);
    _a.copy(A.pos).addScaledVector(_t, len);
    B.pos.lerp(_a, 0.8);
  }

  // A (upper) - B (middle) - C (end): C may only swing to one side of the limb.
  // The limb's front is the body's front carried along by the limb's swing
  // away from hanging straight down; bend -1 = end swings behind (knee), +1 =
  // in front (elbow); play = radians it may stray sideways from that plane.
  // last: this limb's front from the previous call, reused near the singularity
  hinge(A, B, C, bend, play, last) {
    _t.subVectors(B.pos, A.pos).normalize();                      // upper limb direction
    _s.subVectors(C.pos, B.pos);
    const ls = _s.length();
    if (ls < 1e-5) return;
    _s.divideScalar(ls);
    // limb front in world space
    _a.copy(DOWN).applyQuaternion(_fq);
    if (_a.dot(_t) > -0.6) {
      _sq.setFromUnitVectors(_a, _t);
      _b.copy(this.fwd).applyQuaternion(_fq).applyQuaternion(_sq);
    } else {
      // limb raised overhead: the swing from hanging down is ill-defined there
      // (an arm straight up flipped its elbow front from one substep to the
      // next and the elbow snapped round), so carry the last front along
      _b.copy(last);
    }
    _b.addScaledVector(_t, -_b.dot(_t));
    if (_b.lengthSq() < 1e-8) return;
    _b.normalize();
    last.copy(_b);
    _b.multiplyScalar(bend);                                     // the way the end should swing
    // sideways deviation of the lower limb from straight
    const along = _s.dot(_t);
    _c.copy(_s).addScaledVector(_t, -along);
    const dl = _c.length();
    if (dl < 1e-4) return;                                       // straight: nothing to bend
    _c.divideScalar(dl);
    const cosA = _c.dot(_b);
    if (cosA >= Math.cos(play)) return;
    // Outside the allowed wedge: move to the nearest allowed bend. Allowed is
    // the wedge itself (nearest point: its edge, or straight if the bend is
    // more than 90 degrees past it) plus a few degrees of hyperextension any
    // way (a body lying flat rests with its hip a little higher than its knee
    // and foot; without that slack the hinge pushed the foot into the ground,
    // the ground pushed it back, and legs twitched forever). Taking the nearest
    // point keeps the correction small and continuous. (Before, a slightly
    // over-straightened knee was swung all the way round to a full bend: the
    // foot jumped tens of centimetres in one substep and the Verlet step turned
    // that into tens of metres per second, which is what launched bodies.)
    if (dl <= Math.abs(along) * HYPER) return;
    const ang = Math.acos(Math.max(-1, cosA)) - play;            // how far outside the wedge
    const toWedge = ang < Math.PI / 2 ? dl * Math.sin(ang) : dl;  // distance to the wedge
    const allow = Math.abs(along) * HYPER;
    if (dl - allow < toWedge) {
      _s.copy(_t).multiplyScalar(along).addScaledVector(_c, allow).normalize();
    } else {
      _a.copy(_c).addScaledVector(_b, -cosA);
      if (_a.lengthSq() < 1e-8) _a.crossVectors(_t, _b);
      _a.normalize();
      _c.copy(_b).multiplyScalar(Math.cos(play)).addScaledVector(_a, Math.sin(play));   // wedge edge
      _s.copy(_t).multiplyScalar(along).addScaledVector(_c, ang < Math.PI / 2 ? dl * Math.cos(ang) : 0).normalize();
    }
    this.moveEnd(B, C, ls);
  }

  // move C toward B + _s * ls, but never into the ground: where a limit and
  // the ground disagree the ground wins. Otherwise the limit pushed a foot into
  // the ground, the ground pushed it straight back up, and the sideways part of
  // every push was left over, so feet crept and legs twitched without end.
  moveEnd(B, C, ls) {
    _a.copy(B.pos).addScaledVector(_s, ls);
    const gy = heightAt(_a.x, _a.z) + C.r;
    if (_a.y < gy) _a.y = gy;
    C.pos.lerp(_a, 0.6);
  }

  // keep limb joints out of the torso capsule (hip -> chest)
  keepOut() {
    const P = this.p, h = P.hip.pos, c = P.chest.pos;
    _t.subVectors(c, h);
    const L2 = _t.lengthSq();
    for (const k of OUTSIDE) {
      const p = P[k];
      const u = Math.min(1, Math.max(0, _a.subVectors(p.pos, h).dot(_t) / L2));
      _b.copy(h).addScaledVector(_t, u);
      _a.subVectors(p.pos, _b);
      const d = _a.length(), min = TORSO_R + p.r;
      if (d < min && d > 1e-5) p.pos.copy(_b).addScaledVector(_a, min / d);
    }
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
