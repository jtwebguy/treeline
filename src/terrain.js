import * as THREE from 'three';
import { WORLD_SIZE, sample } from './world.js';
import { loadPBR } from './assets.js';

const SEGMENTS = 300;
const TILE = 3.2; // metres per texture repeat

export function createTerrain() {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const mask = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const s = sample(x, z);
    pos.setY(i, s.h);
    uv.setXY(i, x / TILE, z / TILE);
    mask[i * 2] = s.burn;
    mask[i * 2 + 1] = s.mud;
  }
  geo.setAttribute('aMask', new THREE.BufferAttribute(mask, 2));
  geo.computeVertexNormals();

  const forest = loadPBR('forest_ground_04');
  const burned = loadPBR('burned_ground_01');
  const mud = loadPBR('brown_mud_leaves_01');

  const mat = new THREE.MeshStandardMaterial({
    map: forest.map,
    normalMap: forest.normalMap,
    roughness: 1,
    metalness: 0,
  });
  mat.normalScale.set(1.2, 1.2);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tBurn = { value: burned.map };
    shader.uniforms.tBurnN = { value: burned.normalMap };
    shader.uniforms.tMud = { value: mud.map };
    shader.uniforms.tMudN = { value: mud.normalMap };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aMask;\nvarying vec2 vMask;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMask = aMask;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D tBurn, tBurnN, tMud, tMudN;
         varying vec2 vMask;`
      )
      .replace(
        '#include <map_fragment>',
        `
        vec2 gUv = vMapUv;
        // anti-tiling: blend a rotated, larger-scale sample of the base layer
        vec2 gUv2 = mat2(0.8, -0.6, 0.6, 0.8) * gUv * 0.37 + 0.21;
        vec4 c0 = mix(texture2D(map, gUv), texture2D(map, gUv2), 0.45);
        c0.rgb = mix(c0.rgb, vec3(dot(c0.rgb, vec3(0.3, 0.59, 0.11))), 0.4) * vec3(0.9, 0.86, 0.78); // drab, late-autumn
        vec4 c1 = texture2D(tBurn, gUv * 0.85 + 0.5);
        vec4 c2 = texture2D(tMud, gUv * 0.9);
        // height-aware blend so transitions break up along texture detail
        float wb = clamp((vMask.x - 0.5) * 2.2 + (c1.r - c0.r) * 1.4 + 0.5, 0.0, 1.0);
        wb *= step(0.02, vMask.x);
        float wm = clamp((vMask.y - 0.5) * 2.5 + (0.5 - c2.g) * 0.8 + 0.5, 0.0, 1.0);
        wm *= step(0.02, vMask.y);
        vec4 gCol = mix(mix(c0, c1, wb), c2, wm);
        diffuseColor *= gCol;
        `
      )
      .replace(
        '#include <normal_fragment_maps>',
        `
        #ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 n0 = texture2D(normalMap, gUv).xyz * 2.0 - 1.0;
          vec3 n1 = texture2D(tBurnN, gUv * 0.85 + 0.5).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(tMudN, gUv * 0.9).xyz * 2.0 - 1.0;
          vec3 mapN = normalize(mix(mix(n0, n1, wb), n2, wm));
          mapN.xy *= normalScale;
          normal = normalize(tbn * mapN);
        #endif
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = mix(0.97, 0.78, wm); // wet mud is shinier`
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
