// All textures, models and the HDRI are CC0 assets streamed straight from
// Poly Haven's CDN (https://polyhaven.com). Nothing is bundled in the repo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const PH = 'https://dl.polyhaven.org/file/ph-assets';
const RES = '1k';

export const manager = new THREE.LoadingManager();
const texLoader = new THREE.TextureLoader(manager);
const gltfLoader = new GLTFLoader(manager);
const hdrLoader = new HDRLoader(manager);

export let maxAniso = 8;
export const setMaxAniso = (v) => (maxAniso = v);

function tex(url, srgb) {
  const t = texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function loadPBR(id) {
  const base = `${PH}/Textures/jpg/${RES}/${id}/${id}`;
  return {
    map: tex(`${base}_diff_${RES}.jpg`, true),
    normalMap: tex(`${base}_nor_gl_${RES}.jpg`, false),
    roughnessMap: tex(`${base}_rough_${RES}.jpg`, false),
  };
}

export function loadModel(id) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(`${PH}/Models/gltf/${RES}/${id}/${id}_${RES}.gltf`, (g) => resolve(g.scene), undefined, reject);
  });
}

export function loadHDRI(id) {
  return new Promise((resolve, reject) => {
    hdrLoader.load(`${PH}/HDRIs/hdr/${RES}/${id}_${RES}.hdr`, resolve, undefined, reject);
  });
}

export const CREDITS = [
  'forest_ground_04', 'burned_ground_01', 'brown_mud_leaves_01', 'knotted_pine_bark',
  'dead_tree_trunk', 'tree_stump_01', 'old_military_crate', 'ammo_box', 'metal_jerrycan_green',
  'old_tyre', 'boulder_01', 'dry_branches_medium_01', 'fern_02', 'kloofendal_overcast_puresky',
];
