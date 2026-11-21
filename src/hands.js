// First-person hands (models/hand_rigged.fbx): two rigged forearms + hands
// with three-joint fingers and thumbs, used for every weapon.
//
// The rig is the same mesh as the static arms that came baked into
// vm_m4.glb / vm_mosin.glb (identical UVs), so it wears their glove-and-sleeve
// texture (models/hands_basecolor.jpg + hands_normal.jpg; the FBX's own
// texture wasn't embedded). It has no animation: for each weapon the wrists
// are placed, the forearms swing to meet them and the fingers curl round the
// gun (poseHand).
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { manager } from './assets.js';

const HAND_LEN = 0.19;    // metres, wrist to middle fingertip
const FINGERS = ['index', 'middle', 'ring', 'pinky'];

let promise = null;
function loadTemplate() {
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const tex = new THREE.TextureLoader(manager);
    const map = tex.load('./models/hands_basecolor.jpg');
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
    const normalMap = tex.load('./models/hands_normal.jpg');
    new FBXLoader(manager).load('./models/hand_rigged.fbx', (fbx) => {
      // drop the exported camera/light, swap the missing-texture material
      for (const o of [...fbx.children]) if (o.isCamera || o.isLight) fbx.remove(o);
      const glove = new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5 });
      fbx.traverse((o) => {
        if (o.isMesh) { o.material = glove; o.frustumCulled = false; o.castShadow = false; }
      });
      const holder = new THREE.Group();
      holder.add(fbx);
      // scale to a real hand from the bind pose
      fbx.updateMatrixWorld(true);
      const w = fbx.getObjectByName('handL').getWorldPosition(new THREE.Vector3());
      const tip = fbx.getObjectByName('middle_03L_end').getWorldPosition(new THREE.Vector3());
      fbx.scale.multiplyScalar(HAND_LEN / w.distanceTo(tip));
      holder.updateMatrixWorld(true);
      resolve(holder);
    }, undefined, reject);
  });
  return promise;
}

// a fresh, independently posable pair of hands
export function loadHands() {
  return loadTemplate().then((t) => skeletonClone(t));
}

// Grips for the M4 (right hand round the pistol grip, index on the trigger;
// left hand cupping the handguard) and the Mosin (right hand on the wrist of
// the stock, left under the forend), in each viewmodel's own space. The
// shotgun's grip is HAND_POSE in shotgun.js.
const v = (a) => new THREE.Vector3(...a);
export const GRIP_POSES = {
  m4: {
    R: { wrist: v([0.035, -0.125, 0.065]), fingers: v([-0.42, -0.48, -0.73]), palm: v([-0.85, 0.1, 0.45]), elbow: v([0.3, -0.55, 0.78]),
         curl: { index: [0.3, 0.6, 0.5], middle: 1, ring: 1, pinky: 1, thumb: [-0.9, -0.6, -0.4] } },
    L: { wrist: v([-0.025, -0.12, -0.25]), fingers: v([0.45, 0.1, -0.88]), palm: v([0.4, 0.92, 0]), elbow: v([-0.45, -0.55, 0.7]),
         curl: { index: [1, 0.8, 0.5], middle: [1, 0.8, 0.5], ring: [1, 0.8, 0.5], pinky: [1, 0.8, 0.5], thumb: [-0.9, -0.5, -0.3] } },
  },
  mosin: {
    R: { wrist: v([0.035, -0.09, 0.095]), fingers: v([-0.6, -0.35, -0.7]), palm: v([-0.75, 0.35, 0.2]), elbow: v([0.5, -0.6, 0.6]),
         curl: { index: [0.3, 0.5, 0.4], middle: 0.9, ring: 0.9, pinky: 0.9, thumb: [-0.9, -0.6, -0.4] } },
    L: { wrist: v([-0.025, -0.112, -0.31]), fingers: v([0.45, 0.1, -0.88]), palm: v([0.4, 0.92, 0]), elbow: v([-0.45, -0.55, 0.7]),
         curl: { index: [1, 0.8, 0.5], middle: [1, 0.8, 0.5], ring: [1, 0.8, 0.5], pinky: [1, 0.8, 0.5], thumb: [-0.9, -0.5, -0.3] } },
  },
};

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// Bind-pose references for one side ('L' or 'R'), measured once.
const rigs = new WeakMap();
function rig(root, side) {
  const cached = rigs.get(root)?.[side];
  if (cached) return cached;
  root.updateMatrixWorld(true);
  const get = (n) => root.getObjectByName(n + side);
  const fore = get('forearm'), hand = get('hand');
  const hq = hand.getWorldQuaternion(new THREE.Quaternion());
  const inv = hq.clone().invert();
  const wrist = hand.getWorldPosition(new THREE.Vector3());
  // finger direction: wrist -> middle knuckle; palm normal: away from the
  // back of the hand, which is the side the thumb tip does not sit on
  const knuckle = get('middle_01').getWorldPosition(new THREE.Vector3());
  const F = knuckle.clone().sub(wrist).normalize();
  const thumbTip = get('thumb_03').getWorldPosition(new THREE.Vector3());
  const toThumb = thumbTip.sub(wrist);
  const side2 = get('index_01').getWorldPosition(new THREE.Vector3()).sub(get('pinky_01').getWorldPosition(new THREE.Vector3()));
  let N = new THREE.Vector3().crossVectors(F, side2).normalize();
  if (N.dot(toThumb) < 0) N.negate();              // the thumb sits on the palm side
  const r = {
    fore, hand, foreLen: fore.getWorldPosition(new THREE.Vector3()).distanceTo(wrist),
    handLocal0: hand.quaternion.clone(),
    F: F.applyQuaternion(inv), N: N.applyQuaternion(inv),     // in hand-bone space
    fingers: {},
  };
  // curl axis per finger bone: F × N, expressed in that bone's own frame
  const curlAxisWorld = new THREE.Vector3().crossVectors(r.F, r.N).applyQuaternion(hq).normalize();
  for (const f of [...FINGERS, 'thumb']) {
    r.fingers[f] = [1, 2, 3].map((i) => {
      const b = get(`${f}_0${i}`);
      const bq = b.getWorldQuaternion(new THREE.Quaternion()).invert();
      return { b, q0: b.quaternion.clone(), axis: curlAxisWorld.clone().applyQuaternion(bq).normalize() };
    });
  }
  if (!rigs.has(root)) rigs.set(root, {});
  rigs.get(root)[side] = r;
  return r;
}

// Pose one hand in the holder's parent space.
//   wrist: wrist position; fingers: direction the fingers point; palm: palm normal
//   elbow: direction from the wrist back toward the elbow
//   curl: {index, middle, ring, pinky, thumb} radians per joint
export function poseHand(holder, side, { wrist, fingers, palm, elbow, curl = {} }) {
  const root = holder.children[0];
  const r = rig(root, side);
  holder.updateMatrixWorld(true);
  const toWorld = (v) => v.clone().applyMatrix4(holder.parent ? holder.parent.matrixWorld : new THREE.Matrix4());
  const pq = holder.parent ? holder.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();

  // desired hand world rotation: map the bind (F, N) frame onto (fingers, palm)
  const F1 = fingers.clone().normalize().applyQuaternion(pq);
  const N1 = palm.clone().applyQuaternion(pq);
  N1.addScaledVector(F1, -N1.dot(F1)).normalize();
  const basis = (f, n) => _m.makeBasis(f, n, _c.crossVectors(f, n)).clone();
  const qDesired = new THREE.Quaternion().setFromRotationMatrix(basis(F1, N1))
    .multiply(new THREE.Quaternion().setFromRotationMatrix(basis(r.F, r.N)).invert());

  // forearm: keep its bind relation to the hand, then swing +Y along elbow->wrist
  const qFore = qDesired.clone().multiply(r.handLocal0.clone().invert());
  const yNow = _a.set(0, 1, 0).applyQuaternion(qFore);
  const yWant = elbow.clone().negate().normalize().applyQuaternion(pq);
  qFore.premultiply(_q.setFromUnitVectors(yNow, yWant));
  const wristW = toWorld(wrist);
  const foreW = wristW.clone().addScaledVector(yWant, -r.foreLen);

  const fp = r.fore.parent;
  fp.updateMatrixWorld(true);
  r.fore.position.copy(fp.worldToLocal(foreW));
  r.fore.quaternion.copy(fp.getWorldQuaternion(_q2).invert().multiply(qFore));
  r.fore.updateMatrixWorld(true);
  r.hand.quaternion.copy(qFore.clone().invert().multiply(qDesired));
  r.hand.updateMatrixWorld(true);

  curlFingers(holder, side, { index: 0.25, middle: 0.25, ring: 0.25, pinky: 0.25, thumb: 0.25, ...curl });
}

// Bend each finger's three joints from the rest pose toward the palm (radians;
// one number for all three joints or [base, middle, tip]; negative opens).
export function curlFingers(holder, side, curl = {}) {
  const root = holder.children[0];
  const r = rig(root, side);
  for (const f of [...FINGERS, 'thumb']) {
    const c = curl[f] ?? 0;
    const per = Array.isArray(c) ? c : [c, c, c];
    r.fingers[f].forEach((j, i) => j.b.quaternion.copy(j.q0).multiply(_q.setFromAxisAngle(j.axis, per[i])));
  }
  root.updateMatrixWorld(true);
}
