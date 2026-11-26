import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  SCENE_CONFIG,
  computeEscarpmentLineZ,
  computeOpenVolcanicTerrainHeight,
  computeRiverCenterX,
  createSeededRandom,
  generateBasaltColumnLayout,
  smoothstep,
  warpTerrainCoordinate,
} from './cliffMath';
import { WaterfallTextureBundle } from './pbrTextures';

export interface CliffSystem {
  readonly group: THREE.Group;
  readonly update: (elapsedSeconds: number) => void;
  readonly dispose: () => void;
}

interface TerrainShaderUniforms {
  readonly uTime: { value: number };
  readonly uNoiseTex: { value: THREE.Texture };
  readonly uBasaltAlbedo: { value: THREE.Texture };
  readonly uBasaltNormal: { value: THREE.Texture };
  readonly uBasaltRma: { value: THREE.Texture };
  readonly uMossAlbedo: { value: THREE.Texture };
  readonly uMossNormal: { value: THREE.Texture };
  readonly uMossRma: { value: THREE.Texture };
  readonly uSandAlbedo: { value: THREE.Texture };
  readonly uSandNormal: { value: THREE.Texture };
  readonly uSandRma: { value: THREE.Texture };
}

interface RockPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly rx: number;
  readonly ry: number;
  readonly rz: number;
}

function createTriplanarVolcanicTerrainMaterial(
  uniforms: TerrainShaderUniforms,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    roughness: 0.85,
    metalness: 0.04,
    envMapIntensity: 1.25,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uNoiseTex = uniforms.uNoiseTex;
    shader.uniforms.uBasaltAlbedo = uniforms.uBasaltAlbedo;
    shader.uniforms.uBasaltNormal = uniforms.uBasaltNormal;
    shader.uniforms.uBasaltRma = uniforms.uBasaltRma;
    shader.uniforms.uMossAlbedo = uniforms.uMossAlbedo;
    shader.uniforms.uMossNormal = uniforms.uMossNormal;
    shader.uniforms.uMossRma = uniforms.uMossRma;
    shader.uniforms.uSandAlbedo = uniforms.uSandAlbedo;
    shader.uniforms.uSandNormal = uniforms.uSandNormal;
    shader.uniforms.uSandRma = uniforms.uSandRma;
    shader.uniforms.uCrestHeight = { value: SCENE_CONFIG.crestHeight };
    shader.uniforms.uPlungeZ = { value: SCENE_CONFIG.plungeCenterZ };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNormal;
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 terrainWorldPos = modelMatrix * vec4(transformed, 1.0);
        vTerrainWorldPos = terrainWorldPos.xyz;
        vTerrainWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform sampler2D uNoiseTex;
        uniform sampler2D uBasaltAlbedo;
        uniform sampler2D uBasaltNormal;
        uniform sampler2D uBasaltRma;
        uniform sampler2D uMossAlbedo;
        uniform sampler2D uMossNormal;
        uniform sampler2D uMossRma;
        uniform sampler2D uSandAlbedo;
        uniform sampler2D uSandNormal;
        uniform sampler2D uSandRma;
        uniform float uCrestHeight;
        uniform float uPlungeZ;

        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNormal;

        vec3 sampleTriplanarColor(sampler2D tex, vec3 pos, vec3 weights, float scale) {
          vec3 cx = texture2D(tex, pos.zy * scale).rgb;
          vec3 cy = texture2D(tex, pos.xz * scale).rgb;
          vec3 cz = texture2D(tex, pos.xy * scale).rgb;
          return cx * weights.x + cy * weights.y + cz * weights.z;
        }

        vec3 sampleTriplanarNormalOffset(sampler2D tex, vec3 pos, vec3 weights, float scale) {
          vec3 nx = texture2D(tex, pos.zy * scale).xyz * 2.0 - 1.0;
          vec3 ny = texture2D(tex, pos.xz * scale).xyz * 2.0 - 1.0;
          vec3 nz = texture2D(tex, pos.xy * scale).xyz * 2.0 - 1.0;
          vec3 wx = vec3(0.0, nx.y, nx.x) * weights.x;
          vec3 wy = vec3(ny.x, 0.0, ny.y) * weights.y;
          vec3 wz = vec3(nz.x, nz.y, 0.0) * weights.z;
          return wx + wy + wz;
        }
        `,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        vec3 tPos = vTerrainWorldPos;
        vec3 tNorm = normalize(vTerrainWorldNormal);
        vec3 triWeights = pow(abs(tNorm), vec3(4.0));
        triWeights /= max(triWeights.x + triWeights.y + triWeights.z, 0.0001);

        float rockScale = 0.11;
        float mossScale = 0.14;
        float sandScale = 0.22;

        vec3 basaltRaw = sampleTriplanarColor(uBasaltAlbedo, tPos, triWeights, rockScale);
        vec3 basaltCol = basaltRaw * vec3(0.74, 0.78, 0.85);
        vec3 basaltRma = sampleTriplanarColor(uBasaltRma, tPos, triWeights, rockScale);

        vec3 mossCol = texture2D(uMossAlbedo, tPos.xz * mossScale).rgb * 0.92;
        vec3 mossRma = texture2D(uMossRma, tPos.xz * mossScale).rgb;

        vec3 sandRaw = texture2D(uSandAlbedo, tPos.xz * sandScale).rgb;
        float sandLuma = dot(sandRaw, vec3(0.299, 0.587, 0.114));
        vec3 sandCol = mix(vec3(sandLuma), sandRaw, 0.22) * vec3(0.18, 0.20, 0.23);
        vec3 sandRma = texture2D(uSandRma, tPos.xz * sandScale).rgb;

        float macroNoise = texture2D(uNoiseTex, tPos.xz * 0.017).r;
        float patchNoise = texture2D(uNoiseTex, tPos.xz * 0.052 + vec2(0.31, 0.67)).a;

        float slopeUp = smoothstep(0.55, 0.84, tNorm.y);
        float sandMask = slopeUp * (1.0 - smoothstep(0.7, 3.1, tPos.y + (macroNoise - 0.5) * 1.1));
        float outsideWaterfall = smoothstep(5.8, 12.2, length(vec2(tPos.x * 0.72, tPos.z - uPlungeZ)));
        float mossElevation = smoothstep(1.2, 4.0, tPos.y) * (1.0 - smoothstep(40.0, 58.0, tPos.y));
        float rawMossInput = slopeUp * mossElevation * outsideWaterfall * (0.45 + 0.55 * patchNoise);
        float heightCreviceMoss = clamp((mossRma.b + rawMossInput - basaltRma.r) * 5.2, 0.0, 1.0) * smoothstep(0.18, 0.42, rawMossInput);

        vec3 groundAlbedo = mix(basaltCol, sandCol, sandMask);
        groundAlbedo = mix(groundAlbedo, mossCol, heightCreviceMoss);

        float cavityAo = mix(mix(basaltRma.r, sandRma.r, sandMask), mossRma.r, heightCreviceMoss);
        groundAlbedo *= (0.46 + 0.54 * cavityAo);
        groundAlbedo *= (0.82 + 0.34 * macroNoise);

        float highSnowMask = smoothstep(38.0, 56.0, tPos.y + macroNoise * 7.5) * smoothstep(0.45, 0.8, tNorm.y);
        groundAlbedo = mix(groundAlbedo, vec3(0.52, 0.58, 0.66), highSnowMask * 0.55);

        float poolWet = 1.0 - smoothstep(0.05, 2.2, tPos.y);
        float fallDist = length(vec2(tPos.x * 0.65, tPos.z - uPlungeZ));
        float sprayWet = (1.0 - smoothstep(4.5, 16.5, fallDist)) * (1.0 - smoothstep(uCrestHeight + 0.5, uCrestHeight + 3.5, tPos.y));
        float terrainWetness = clamp(max(poolWet, sprayWet * 0.94), 0.0, 1.0);

        float trickle = smoothstep(0.68, 0.90, texture2D(uNoiseTex, vec2((tPos.x + tPos.z) * 0.28, tPos.y * 0.05 + uTime * 0.16)).b) * sprayWet * (1.0 - abs(tNorm.y));
        groundAlbedo *= mix(1.0, 0.52, terrainWetness * (1.0 - heightCreviceMoss * 0.72));
        groundAlbedo += vec3(0.018, 0.024, 0.032) * trickle;

        diffuseColor.rgb = groundAlbedo;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        vec3 rPos = vTerrainWorldPos;
        vec3 rNorm = normalize(vTerrainWorldNormal);
        vec3 rTriW = pow(abs(rNorm), vec3(4.0));
        rTriW /= max(rTriW.x + rTriW.y + rTriW.z, 0.0001);

        float rMacro = texture2D(uNoiseTex, rPos.xz * 0.017).r;
        float rPatch = texture2D(uNoiseTex, rPos.xz * 0.052 + vec2(0.31, 0.67)).a;
        float rSlope = smoothstep(0.55, 0.84, rNorm.y);
        float rSand = rSlope * (1.0 - smoothstep(0.7, 3.1, rPos.y + (rMacro - 0.5) * 1.1));
        float rOutside = smoothstep(5.8, 12.2, length(vec2(rPos.x * 0.72, rPos.z - uPlungeZ)));
        float rMoss = rSlope * smoothstep(1.2, 4.0, rPos.y) * rOutside * smoothstep(0.28, 0.66, rPatch);

        float basaltRough = sampleTriplanarColor(uBasaltRma, rPos, rTriW, 0.11).g;
        float sandRough = texture2D(uSandRma, rPos.xz * 0.22).g;
        float mossRough = texture2D(uMossRma, rPos.xz * 0.14).g;

        float surfaceRough = mix(mix(basaltRough, sandRough, rSand), mossRough, rMoss);

        float rPoolWet = 1.0 - smoothstep(0.05, 2.3, rPos.y);
        float rFallDist = length(vec2(rPos.x * 0.65, rPos.z - uPlungeZ));
        float rSprayWet = (1.0 - smoothstep(4.5, 16.5, rFallDist)) * (1.0 - smoothstep(uCrestHeight + 0.5, uCrestHeight + 3.5, rPos.y));
        float rWetness = clamp(max(rPoolWet, rSprayWet * 0.94), 0.0, 1.0);

        roughnessFactor = mix(surfaceRough, 0.11, rWetness * (1.0 - rMoss * 0.78));
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        #include <normal_fragment_maps>
        vec3 nPos = vTerrainWorldPos;
        vec3 nNorm = normalize(vTerrainWorldNormal);
        vec3 nTriW = pow(abs(nNorm), vec3(4.0));
        nTriW /= max(nTriW.x + nTriW.y + nTriW.z, 0.0001);

        float nMacro = texture2D(uNoiseTex, nPos.xz * 0.017).r;
        float nPatch = texture2D(uNoiseTex, nPos.xz * 0.052 + vec2(0.31, 0.67)).a;
        float nSlope = smoothstep(0.55, 0.84, nNorm.y);
        float nSand = nSlope * (1.0 - smoothstep(0.7, 3.1, nPos.y + (nMacro - 0.5) * 1.1));
        float nOutside = smoothstep(5.8, 12.2, length(vec2(nPos.x * 0.72, nPos.z - uPlungeZ)));
        float nMoss = nSlope * smoothstep(1.2, 4.0, nPos.y) * nOutside * smoothstep(0.28, 0.66, nPatch);

        vec3 basaltPerturb = sampleTriplanarNormalOffset(uBasaltNormal, nPos, nTriW, 0.11);
        vec3 sandTn = texture2D(uSandNormal, nPos.xz * 0.22).xyz * 2.0 - 1.0;
        vec3 mossTn = texture2D(uMossNormal, nPos.xz * 0.14).xyz * 2.0 - 1.0;
        vec3 sandPerturb = vec3(sandTn.x, 0.0, sandTn.y);
        vec3 mossPerturb = vec3(mossTn.x, 0.0, mossTn.y);

        vec3 combinedPerturb = mix(mix(basaltPerturb, sandPerturb, nSand), mossPerturb, nMoss);
        vec3 perturbedWorldNormal = normalize(nNorm + combinedPerturb * 0.95);
        normal = normalize((viewMatrix * vec4(perturbedWorldNormal, 0.0)).xyz);
        `,
      );
  };

  material.customProgramCacheKey = () => 'aaa-triplanar-volcanic-terrain-v2';
  return material;
}

function createBasaltColumnMaterial(options: {
  readonly textures: WaterfallTextureBundle;
  readonly noiseTexture: THREE.DataTexture;
  readonly timeUniform: { value: number };
}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: options.textures.basalt.albedoMap,
    normalMap: options.textures.basalt.normalMap,
    normalScale: new THREE.Vector2(1.5, 1.5),
    roughnessMap: options.textures.basalt.rmaMap,
    roughness: 0.85,
    metalness: 0.06,
    envMapIntensity: 1.6,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = options.timeUniform;
    shader.uniforms.uNoiseTex = { value: options.noiseTexture };
    shader.uniforms.uMossAlbedo = { value: options.textures.moss.albedoMap };
    shader.uniforms.uCrestHeight = { value: SCENE_CONFIG.crestHeight };
    shader.uniforms.uPlungeZ = { value: SCENE_CONFIG.plungeCenterZ };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vRockWorldPos;
        varying vec3 vRockWorldNormal;
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 rockWPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          rockWPos = instanceMatrix * rockWPos;
        #endif
        rockWPos = modelMatrix * rockWPos;
        vRockWorldPos = rockWPos.xyz;

        vec3 instWorldNormal = objectNormal;
        #ifdef USE_INSTANCING
          mat3 im = mat3(instanceMatrix);
          mat3 adjugateT = mat3(
            cross(im[1], im[2]),
            cross(im[2], im[0]),
            cross(im[0], im[1])
          );
          instWorldNormal = adjugateT * objectNormal;
        #endif
        vRockWorldNormal = normalize(mat3(modelMatrix) * instWorldNormal);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform sampler2D uNoiseTex;
        uniform sampler2D uMossAlbedo;
        uniform float uCrestHeight;
        uniform float uPlungeZ;
        varying vec3 vRockWorldPos;
        varying vec3 vRockWorldNormal;
        `,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>
        vec3 rkPos = vRockWorldPos;
        vec3 rkNorm = normalize(vRockWorldNormal);

        diffuseColor.rgb *= vec3(0.68, 0.72, 0.78);
        float rkNoise = texture2D(uNoiseTex, rkPos.xz * 0.09 + vec2(rkPos.y * 0.025)).r;
        vec3 mossCap = texture2D(uMossAlbedo, rkPos.xz * 0.16).rgb;
        float capMask = smoothstep(0.72, 0.92, rkNorm.y) * smoothstep(2.0, 5.0, rkPos.y) * smoothstep(0.25, 0.65, rkNoise);
        diffuseColor.rgb = mix(diffuseColor.rgb, mossCap, capMask);

        float rkPoolWet = 1.0 - smoothstep(0.05, 2.4, rkPos.y);
        float rkFallDist = length(vec2(rkPos.x * 0.65, rkPos.z - uPlungeZ));
        float rkSprayWet = (1.0 - smoothstep(4.5, 16.5, rkFallDist)) * (1.0 - smoothstep(uCrestHeight + 0.5, uCrestHeight + 3.5, rkPos.y));
        float rkWet = clamp(max(rkPoolWet, rkSprayWet * 0.95), 0.0, 1.0);
        diffuseColor.rgb *= mix(1.0, 0.54, rkWet * (1.0 - capMask * 0.8));
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        vec3 rrPos = vRockWorldPos;
        vec3 rrNorm = normalize(vRockWorldNormal);
        float rrPoolWet = 1.0 - smoothstep(0.05, 2.4, rrPos.y);
        float rrFallDist = length(vec2(rrPos.x * 0.65, rrPos.z - uPlungeZ));
        float rrSprayWet = (1.0 - smoothstep(4.5, 16.5, rrFallDist)) * (1.0 - smoothstep(uCrestHeight + 0.5, uCrestHeight + 3.5, rrPos.y));
        float rrWet = clamp(max(rrPoolWet, rrSprayWet * 0.95), 0.0, 1.0);
        float rrCap = smoothstep(0.72, 0.92, rrNorm.y) * smoothstep(2.0, 5.0, rrPos.y);
        roughnessFactor = mix(roughnessFactor, 0.94, rrCap * 0.85);
        roughnessFactor = mix(roughnessFactor, 0.12, rrWet * (1.0 - rrCap * 0.85));
        `,
      );
  };

  material.customProgramCacheKey = () => 'aaa-basalt-column-cofactor-v2';
  return material;
}

function createBeveledHexColumnGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const sides = 6;
  const bevelAngle = (6 * Math.PI) / 180;
  const yRings = 6;

  interface RingVertex {
    readonly x: number;
    readonly z: number;
    readonly nx: number;
    readonly nz: number;
    readonly u: number;
  }

  const ringProfile: RingVertex[] = [];
  for (let s = 0; s < sides; s++) {
    const faceMidAngle = (s / sides) * Math.PI * 2 + Math.PI / sides;
    const cornerA = (s / sides) * Math.PI * 2;
    const cornerB = ((s + 1) / sides) * Math.PI * 2;

    const aBevel = cornerA + bevelAngle;
    const bBevel = cornerB - bevelAngle;

    const faceNx = Math.cos(faceMidAngle);
    const faceNz = Math.sin(faceMidAngle);

    ringProfile.push({
      x: Math.cos(aBevel),
      z: Math.sin(aBevel),
      nx: faceNx,
      nz: faceNz,
      u: (s + 0.08) / sides,
    });
    ringProfile.push({
      x: Math.cos(bBevel),
      z: Math.sin(bBevel),
      nx: faceNx,
      nz: faceNz,
      u: (s + 0.92) / sides,
    });
  }

  const pushTri = (tri: {
    readonly ax: number;
    readonly ay: number;
    readonly az: number;
    readonly anx: number;
    readonly any: number;
    readonly anz: number;
    readonly au: number;
    readonly av: number;
    readonly bx: number;
    readonly by: number;
    readonly bz: number;
    readonly bnx: number;
    readonly bny: number;
    readonly bnz: number;
    readonly bu: number;
    readonly bv: number;
    readonly cx: number;
    readonly cy: number;
    readonly cz: number;
    readonly cnx: number;
    readonly cny: number;
    readonly cnz: number;
    readonly cu: number;
    readonly cv: number;
  }): void => {
    positions.push(tri.ax, tri.ay, tri.az, tri.bx, tri.by, tri.bz, tri.cx, tri.cy, tri.cz);
    normals.push(tri.anx, tri.any, tri.anz, tri.bnx, tri.bny, tri.bnz, tri.cnx, tri.cny, tri.cnz);
    uvs.push(tri.au, tri.av, tri.bu, tri.bv, tri.cu, tri.cv);
  };

  for (let r = 0; r < yRings; r++) {
    const t0 = r / yRings;
    const t1 = (r + 1) / yRings;
    const y0 = t0 - 0.5;
    const y1 = t1 - 0.5;
    const taper0 = 1.03 - t0 * 0.04;
    const taper1 = 1.03 - t1 * 0.04;

    for (let i = 0; i < ringProfile.length; i++) {
      const curr = ringProfile[i];
      const next = ringProfile[(i + 1) % ringProfile.length];
      if (!curr || !next) {
        continue;
      }

      const isChamfer = i % 2 === 1;
      const uNext = next.u < curr.u ? next.u + 1 : next.u;

      const cnx = isChamfer ? curr.nx : curr.nx;
      const cnz = isChamfer ? curr.nz : curr.nz;
      const nnx = isChamfer ? next.nx : curr.nx;
      const nnz = isChamfer ? next.nz : curr.nz;

      pushTri({
        ax: curr.x * taper0,
        ay: y0,
        az: curr.z * taper0,
        anx: cnx,
        any: 0,
        anz: cnz,
        au: curr.u * 2.2,
        av: t0 * 5.0,
        bx: next.x * taper0,
        by: y0,
        bz: next.z * taper0,
        bnx: nnx,
        bny: 0,
        bnz: nnz,
        bu: uNext * 2.2,
        bv: t0 * 5.0,
        cx: next.x * taper1,
        cy: y1,
        cz: next.z * taper1,
        cnx: nnx,
        cny: 0,
        cnz: nnz,
        cu: uNext * 2.2,
        cv: t1 * 5.0,
      });

      pushTri({
        ax: curr.x * taper0,
        ay: y0,
        az: curr.z * taper0,
        anx: cnx,
        any: 0,
        anz: cnz,
        au: curr.u * 2.2,
        av: t0 * 5.0,
        bx: next.x * taper1,
        by: y1,
        bz: next.z * taper1,
        bnx: nnx,
        bny: 0,
        bnz: nnz,
        bu: uNext * 2.2,
        bv: t1 * 5.0,
        cx: curr.x * taper1,
        cy: y1,
        cz: curr.z * taper1,
        cnx: cnx,
        cny: 0,
        cnz: cnz,
        cu: curr.u * 2.2,
        cv: t1 * 5.0,
      });
    }
  }

  for (let i = 0; i < ringProfile.length; i++) {
    const curr = ringProfile[i];
    const next = ringProfile[(i + 1) % ringProfile.length];
    if (!curr || !next) {
      continue;
    }

    pushTri({
      ax: 0,
      ay: 0.485,
      az: 0,
      anx: 0,
      any: 1,
      anz: 0,
      au: 0.5,
      av: 0.5,
      bx: next.x * 0.99,
      by: 0.5,
      bz: next.z * 0.99,
      bnx: 0,
      bny: 1,
      bnz: 0,
      bu: next.x * 0.5 + 0.5,
      bv: next.z * 0.5 + 0.5,
      cx: curr.x * 0.99,
      cy: 0.5,
      cz: curr.z * 0.99,
      cnx: 0,
      cny: 1,
      cnz: 0,
      cu: curr.x * 0.5 + 0.5,
      cv: curr.z * 0.5 + 0.5,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

function createWarpedVolcanicTerrainGeometry(): THREE.BufferGeometry {
  const segments = 192;
  const geometry = new THREE.PlaneGeometry(2, 2, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const posAttr = geometry.attributes.position;
  if (!posAttr) {
    return geometry;
  }

  for (let i = 0; i < posAttr.count; i++) {
    const nx = posAttr.getX(i);
    const nz = posAttr.getZ(i);
    const x = warpTerrainCoordinate(nx);
    const z = warpTerrainCoordinate(nz) - 8.0;
    const y = computeOpenVolcanicTerrainHeight({ x, z });
    posAttr.setXYZ(i, x, y, z);
  }

  geometry.computeVertexNormals();
  return geometry;
}

function normalizeRockGeometry(rawGeometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const cloned = rawGeometry.clone();
  cloned.computeBoundingBox();
  const box = cloned.boundingBox;
  if (!box) {
    return cloned;
  }
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const maxExtent = Math.max(size.x, size.y, size.z, 0.001);
  const scale = 2.0 / maxExtent;

  cloned.translate(-center.x, -box.min.y - size.y * 0.18, -center.z);
  cloned.scale(scale, scale, scale);
  cloned.computeBoundingSphere();
  return cloned;
}

function buildRockPlacements(): {
  readonly heroBoulders: RockPlacement[];
  readonly mediumRocks: RockPlacement[];
  readonly screeRocks: RockPlacement[];
} {
  const rand = createSeededRandom(55123);

  const heroBoulders: RockPlacement[] = [
    {
      x: -3.2,
      y: SCENE_CONFIG.crestHeight - 0.55,
      z: SCENE_CONFIG.crestZ - 0.35,
      sx: 1.5,
      sy: 1.1,
      sz: 1.35,
      rx: 0.1,
      ry: 0.6,
      rz: -0.08,
    },
    {
      x: 0.4,
      y: SCENE_CONFIG.crestHeight - 0.65,
      z: SCENE_CONFIG.crestZ - 0.55,
      sx: 1.35,
      sy: 0.95,
      sz: 1.25,
      rx: -0.05,
      ry: 2.1,
      rz: 0.1,
    },
    {
      x: 3.6,
      y: SCENE_CONFIG.crestHeight - 0.5,
      z: SCENE_CONFIG.crestZ - 0.3,
      sx: 1.55,
      sy: 1.15,
      sz: 1.4,
      rx: 0.08,
      ry: 4.1,
      rz: -0.06,
    },
    {
      x: -5.4,
      y: SCENE_CONFIG.crestHeight - 0.25,
      z: SCENE_CONFIG.crestZ - 0.6,
      sx: 2.1,
      sy: 1.6,
      sz: 1.9,
      rx: 0.05,
      ry: 1.2,
      rz: 0.04,
    },
    {
      x: 5.5,
      y: SCENE_CONFIG.crestHeight - 0.2,
      z: SCENE_CONFIG.crestZ - 0.55,
      sx: 2.2,
      sy: 1.7,
      sz: 2.0,
      rx: -0.06,
      ry: 3.4,
      rz: -0.05,
    },
    { x: 7.4, y: -0.25, z: 12.6, sx: 2.2, sy: 1.35, sz: 1.85, rx: 0.05, ry: 1.1, rz: -0.08 },
    { x: -8.6, y: 0.1, z: 10.2, sx: 2.5, sy: 1.5, sz: 2.1, rx: -0.06, ry: 2.4, rz: 0.05 },
    { x: 10.2, y: 0.55, z: 4.5, sx: 2.9, sy: 1.95, sz: 2.4, rx: 0.04, ry: 0.4, rz: -0.04 },
    { x: -10.8, y: 0.75, z: 3.4, sx: 3.1, sy: 2.1, sz: 2.5, rx: -0.05, ry: 3.9, rz: 0.06 },
    { x: 9.4, y: -0.15, z: 18.8, sx: 1.75, sy: 1.05, sz: 1.5, rx: 0.08, ry: 5.1, rz: -0.05 },
    { x: 4.8, y: -0.45, z: 15.2, sx: 1.3, sy: 0.78, sz: 1.15, rx: 0.03, ry: 2.8, rz: 0.04 },
  ];

  const mediumRocks: RockPlacement[] = [];
  const screeRocks: RockPlacement[] = [];

  for (let i = 0; i < 65; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (6.2 + rand() * 24.0);
    const cliffZ = computeEscarpmentLineZ(x);
    const z = cliffZ + 1.5 + rand() * 11.5;
    const groundY = computeOpenVolcanicTerrainHeight({ x, z });
    const s = 0.85 + Math.pow(rand(), 1.4) * 2.4;

    mediumRocks.push({
      x,
      y: groundY - s * 0.18,
      z,
      sx: s * (0.9 + rand() * 0.45),
      sy: s * (0.65 + rand() * 0.4),
      sz: s * (0.9 + rand() * 0.45),
      rx: (rand() - 0.5) * 0.5,
      ry: rand() * Math.PI * 2,
      rz: (rand() - 0.5) * 0.5,
    });
  }

  for (let i = 0; i < 110; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = -9.5 + rand() * 48.0;
    const riverCenter = computeRiverCenterX(z);
    const riverHalfWidth =
      7.8 +
      Math.exp(-Math.pow((z - (SCENE_CONFIG.plungeCenterZ + 4)) / 10, 2)) * 5.6 +
      smoothstep({ edge0: 14, edge1: 95, value: z }) * 9.5;

    const bankOffset = (rand() - 0.22) * 22.0;
    const x = riverCenter + side * (riverHalfWidth + bankOffset);
    if (z < computeEscarpmentLineZ(x) + 2.5) {
      continue;
    }

    const groundY = computeOpenVolcanicTerrainHeight({ x, z });
    const s = 0.32 + Math.pow(rand(), 1.8) * 1.45;
    screeRocks.push({
      x,
      y: groundY - s * 0.12,
      z,
      sx: s * (0.9 + rand() * 0.5),
      sy: s * (0.52 + rand() * 0.35),
      sz: s * (0.9 + rand() * 0.5),
      rx: (rand() - 0.5) * 0.7,
      ry: rand() * Math.PI * 2,
      rz: (rand() - 0.5) * 0.7,
    });
  }

  return { heroBoulders, mediumRocks, screeRocks };
}

function loadPhotogrammetryRockInstances(options: {
  readonly url: string;
  readonly placements: readonly RockPlacement[];
  readonly group: THREE.Group;
  readonly anisotropy: number;
  readonly disposables: {
    readonly geometries: THREE.BufferGeometry[];
    readonly materials: THREE.Material[];
  };
  readonly onLoaded: () => void;
}): void {
  const loader = new GLTFLoader();
  loader.load(
    options.url,
    (gltf) => {
      let sourceMesh: THREE.Mesh | null = null;
      gltf.scene.traverse((child) => {
        if (!sourceMesh && child instanceof THREE.Mesh) {
          sourceMesh = child;
        }
      });

      if (!sourceMesh) {
        return;
      }

      const foundMesh: THREE.Mesh = sourceMesh;
      const geometry = normalizeRockGeometry(foundMesh.geometry);
      options.disposables.geometries.push(geometry);

      const rawMat = Array.isArray(foundMesh.material) ? foundMesh.material[0] : foundMesh.material;
      let material: THREE.MeshStandardMaterial;

      if (rawMat instanceof THREE.MeshStandardMaterial) {
        material = rawMat.clone();
        material.color.setRGB(0.46, 0.5, 0.56);
        material.roughness = 0.62;
        material.metalness = 0.04;
        material.envMapIntensity = 1.45;
        if (material.map) {
          material.map.anisotropy = options.anisotropy;
        }
        if (material.normalMap) {
          material.normalMap.anisotropy = options.anisotropy;
          material.normalScale.set(1.35, 1.35);
        }
      } else {
        material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(0x22262c),
          roughness: 0.72,
          metalness: 0.05,
        });
      }
      options.disposables.materials.push(material);

      const instanced = new THREE.InstancedMesh(geometry, material, options.placements.length);
      instanced.castShadow = true;
      instanced.receiveShadow = true;

      const dummy = new THREE.Object3D();
      for (let i = 0; i < options.placements.length; i++) {
        const spec = options.placements[i];
        if (!spec) {
          continue;
        }
        dummy.position.set(spec.x, spec.y, spec.z);
        dummy.rotation.set(spec.rx, spec.ry, spec.rz);
        dummy.scale.set(spec.sx, spec.sy, spec.sz);
        dummy.updateMatrix();
        instanced.setMatrixAt(i, dummy.matrix);
      }
      instanced.instanceMatrix.needsUpdate = true;
      options.group.add(instanced);
      options.onLoaded();
    },
    undefined,
    () => {
      return;
    },
  );
}

export function createIcelandicCliff(options: {
  readonly noiseTexture: THREE.DataTexture;
  readonly textures: WaterfallTextureBundle;
  readonly anisotropy: number;
  readonly onStaticGeometryChanged: () => void;
}): CliffSystem {
  const group = new THREE.Group();
  const timeUniform = { value: 0 };

  const terrainUniforms: TerrainShaderUniforms = {
    uTime: timeUniform,
    uNoiseTex: { value: options.noiseTexture },
    uBasaltAlbedo: { value: options.textures.basalt.albedoMap },
    uBasaltNormal: { value: options.textures.basalt.normalMap },
    uBasaltRma: { value: options.textures.basalt.rmaMap },
    uMossAlbedo: { value: options.textures.moss.albedoMap },
    uMossNormal: { value: options.textures.moss.normalMap },
    uMossRma: { value: options.textures.moss.rmaMap },
    uSandAlbedo: { value: options.textures.volcanicSand.albedoMap },
    uSandNormal: { value: options.textures.volcanicSand.normalMap },
    uSandRma: { value: options.textures.volcanicSand.rmaMap },
  };

  const terrainMaterial = createTriplanarVolcanicTerrainMaterial(terrainUniforms);
  const columnMaterial = createBasaltColumnMaterial({
    textures: options.textures,
    noiseTexture: options.noiseTexture,
    timeUniform,
  });

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [terrainMaterial, columnMaterial];
  const disposables = { geometries, materials };

  const terrainGeometry = createWarpedVolcanicTerrainGeometry();
  disposables.geometries.push(terrainGeometry);
  const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  group.add(terrainMesh);

  const columnGeometry = createBeveledHexColumnGeometry();
  disposables.geometries.push(columnGeometry);

  const placements = generateBasaltColumnLayout({
    seed: 202611,
    hexRadius: 0.82,
    rowsDeep: 4,
    halfSpanX: 28,
  });

  const columnInstanced = new THREE.InstancedMesh(
    columnGeometry,
    columnMaterial,
    placements.length,
  );
  columnInstanced.castShadow = true;
  columnInstanced.receiveShadow = true;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < placements.length; i++) {
    const column = placements[i];
    if (!column) {
      continue;
    }
    dummy.position.set(column.x, column.y, column.z);
    dummy.rotation.set(column.tiltX, column.rotationY, column.tiltZ);
    dummy.scale.set(column.radius, column.height, column.radius);
    dummy.updateMatrix();
    columnInstanced.setMatrixAt(i, dummy.matrix);
  }
  columnInstanced.instanceMatrix.needsUpdate = true;
  group.add(columnInstanced);

  const rockGroups = buildRockPlacements();
  loadPhotogrammetryRockInstances({
    url: '/models/boulder_01/boulder_01_1k.gltf',
    placements: rockGroups.heroBoulders,
    group,
    anisotropy: options.anisotropy,
    disposables,
    onLoaded: options.onStaticGeometryChanged,
  });
  loadPhotogrammetryRockInstances({
    url: '/models/moon_rock_01/moon_rock_01_1k.gltf',
    placements: rockGroups.mediumRocks,
    group,
    anisotropy: options.anisotropy,
    disposables,
    onLoaded: options.onStaticGeometryChanged,
  });
  loadPhotogrammetryRockInstances({
    url: '/models/moon_rock_02/moon_rock_02_1k.gltf',
    placements: rockGroups.screeRocks,
    group,
    anisotropy: options.anisotropy,
    disposables,
    onLoaded: options.onStaticGeometryChanged,
  });

  return {
    group,
    update: (elapsedSeconds: number) => {
      timeUniform.value = elapsedSeconds;
    },
    dispose: () => {
      for (const geo of disposables.geometries) {
        geo.dispose();
      }
      for (const mat of disposables.materials) {
        mat.dispose();
      }
    },
  };
}
