// Weapons dropped by dead soldiers. Each drop is a static copy of the gun in
// the soldier's Weapon_Root space (centimetres, +Y toward the muzzle, +Z up),
// placed at the bone's world transform when the soldier dies. It tumbles to
// the ground, settles on its side and can be picked up with E.
import * as THREE from 'three';
import { heightAt } from './world.js';

const MAX_DROPS = 24;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const BUTT = new THREE.Vector3(0, -28, 4), MUZ = new THREE.Vector3(0, 60, 7), MID = new THREE.Vector3(0, 18, 5);

export class Drops {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }

  // obj: an Object3D already in world space (scene child). kind: 'm4' | 'shotgun'
  spawn(obj, kind, ammo, vel) {
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; } });
    const d = {
      obj, kind, ammo,
      vel: vel ? vel.clone() : new THREE.Vector3(),
      spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6),
      landed: false, settleT: 0, from: null, to: null, restY: 0, age: 0,
    };
    this.list.push(d);
    while (this.list.length > MAX_DROPS) this.remove(this.list[0]);
    return d;
  }

  remove(d) {
    const i = this.list.indexOf(d);
    if (i >= 0) this.list.splice(i, 1);
    this.scene.remove(d.obj);
  }

  clear() { for (const d of [...this.list]) this.remove(d); }

  center(d, out) { return out.copy(MID).applyMatrix4(d.obj.matrixWorld); }

  // nearest drop within reach of the player's feet
  nearest(pos, reach = 1.9) {
    let best = null, bd = reach;
    for (const d of this.list) {
      if (d.age < 0.4) continue;
      this.center(d, _a);
      const h = Math.hypot(_a.x - pos.x, _a.z - pos.z);
      if (h < bd && Math.abs(_a.y - pos.y) < 1.6) { bd = h; best = d; }
    }
    return best;
  }

  update(dt) {
    for (const d of this.list) {
      d.age += dt;
      const o = d.obj;
      if (!d.landed) {
        d.vel.y -= 9.8 * dt;
        o.position.addScaledVector(d.vel, dt);
        const ang = d.spin.length();
        if (ang > 1e-4) { _q.setFromAxisAngle(_a.copy(d.spin).divideScalar(ang), ang * dt); o.quaternion.premultiply(_q); }
        o.updateMatrixWorld();
        // either end of the gun touching the ground lands it
        _a.copy(BUTT).applyMatrix4(o.matrixWorld); _b.copy(MUZ).applyMatrix4(o.matrixWorld);
        if (_a.y < heightAt(_a.x, _a.z) + 0.02 || _b.y < heightAt(_b.x, _b.z) + 0.02 || d.age > 4) this.land(d);
      } else if (d.settleT < 1) {
        d.settleT = Math.min(1, d.settleT + dt * 3.5);
        const k = 1 - (1 - d.settleT) ** 3;
        o.quaternion.slerpQuaternions(d.from, d.to, k);
        o.position.y = THREE.MathUtils.lerp(d.fromY, d.restY, k);
        o.updateMatrixWorld();
      }
    }
  }

  // lie the gun on its side: barrel level along its current heading
  land(d) {
    const o = d.obj;
    d.landed = true;
    d.from = o.quaternion.clone();
    d.fromY = o.position.y;
    const e = o.matrixWorld.elements;
    const barrel = new THREE.Vector3(e[4], 0, e[6]);                 // local +Y, flattened
    if (barrel.lengthSq() < 1e-8) barrel.set(1, 0, 0);
    barrel.normalize();
    const side = new THREE.Vector3(0, e[1] >= 0 ? 1 : -1, 0);       // local +X up or down, whichever is closer
    const up = new THREE.Vector3().crossVectors(side, barrel);        // local +Z = X × Y
    _m.makeBasis(side, barrel, up);
    d.to = new THREE.Quaternion().setFromRotationMatrix(_m);
    // on its side the barrel and top axes are level, so the origin sits at the
    // same height as the gun's middle: ~3.5 cm (half the receiver width) up
    this.center(d, _a);
    d.restY = heightAt(_a.x, _a.z) + 0.035;
  }
}
