import * as THREE from 'three';
import {
  SCENE_CONFIG,
  computeEscarpmentLineZ,
  computeOpenVolcanicTerrainHeight,
  computeRiverCenterX,
  createSeededRandom,
  generateBasaltColumnLayout,
  smoothstep,
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

function createTriplanarVolcanicTerrainMaterial(
  uniforms: TerrainShaderUniforms,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    roughness: 0.85,
    metalness: 0.04,
    envMapIntensity: 1.15,
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

        float rockScale = 0.095;
        float mossScale = 0.115;
        float sandScale = 0.16;

        vec3 basaltCol = sampleTriplanarColor(uBasaltAlbedo, tPos, triWeights, rockScale) * 1.42;
        vec3 basaltRma = sampleTriplanarColor(uBasaltRma, tPos, triWeights, rockScale);
        vec3 mossCol = texture2D(uMossAlbedo, tPos.xz * mossScale).rgb;
        vec3 mossRma = texture2D(uMossRma, tPos.xz * mossScale).rgb;
        vec3 sandCol = texture2D(uSandAlbedo, tPos.xz * sandScale).rgb * vec3(0.46, 0.49, 0.54);
        vec3 sandRma = texture2D(uSandRma, tPos.xz * sandScale).rgb;

        float macroNoise = texture2D(uNoiseTex, tPos.xz * 0.018).r;
        float patchNoise = texture2D(uNoiseTex, tPos.xz * 0.055 + vec2(0.31, 0.67)).a;

        float slopeUp = smoothstep(0.56, 0.84, tNorm.y);
        float sandMask = slopeUp * (1.0 - smoothstep(0.75, 3.2, tPos.y + (macroNoise - 0.5) * 1.1));
        float outsideWaterfall = smoothstep(5.4, 11.5, length(vec2(tPos.x * 0.72, tPos.z - uPlungeZ)));
        float mossElevation = smoothstep(1.3, 4.2, tPos.y) * (1.0 - smoothstep(42.0, 62.0, tPos.y));
        float rawMoss = slopeUp * mossElevation * outsideWaterfall * smoothstep(0.28, 0.68, patchNoise + (mossRma.b - basaltRma.b) * 0.32);

        vec3 groundAlbedo = mix(basaltCol, sandCol, sandMask);
        groundAlbedo = mix(groundAlbedo, mossCol, rawMoss);

        float cavityAo = mix(mix(basaltRma.r, sandRma.r, sandMask), mossRma.r, rawMoss);
        groundAlbedo *= (0.48 + 0.52 * cavityAo);

        float macroTint = 0.84 + 0.32 * macroNoise;
        groundAlbedo *= macroTint;

        float highSnowMask = smoothstep(38.0, 56.0, tPos.y + macroNoise * 8.0) * smoothstep(0.45, 0.8, tNorm.y);
        groundAlbedo = mix(groundAlbedo, vec3(0.62, 0.66, 0.72), highSnowMask * 0.65);

        float poolWet = 1.0 - smoothstep(0.05, 2.2, tPos.y);
        float fallDist = length(vec2(tPos.x * 0.65, tPos.z - uPlungeZ));
        float sprayWet = (1.0 - smoothstep(4.5, 16.5, fallDist)) * (1.0 - smoothstep(uCrestHeight + 0.5, uCrestHeight + 3.5, tPos.y));
        float terrainWetness = clamp(max(poolWet, sprayWet * 0.94), 0.0, 1.0);

        float trickle = smoothstep(0.66, 0.90, texture2D(uNoiseTex, vec2((tPos.x + tPos.z) * 0.28, tPos.y * 0.05 + uTime * 0.16)).b) * sprayWet * (1.0 - abs(tNorm.y));
        groundAlbedo *= mix(1.0, 0.58, terrainWetness * (1.0 - rawMoss * 0.72));
        groundAlbedo += vec3(0.035, 0.045, 0.055) * trickle;

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

        float rMacro = texture2D(uNoiseTex, rPos.xz * 0.018).r;
        float rPatch = texture2D(uNoiseTex, rPos.xz * 0.055 + vec2(0.31, 0.67)).a;
        float rSlope = smoothstep(0.56, 0.84, rNorm.y);
        float rSand = rSlope * (1.0 - smoothstep(0.75, 3.2, rPos.y + (rMacro - 0.5) * 1.1));
        float rOutside = smoothstep(5.4, 11.5, length(vec2(rPos.x * 0.72, rPos.z - uPlungeZ)));
        float rMoss = rSlope * smoothstep(1.3, 4.2, rPos.y) * rOutside * smoothstep(0.32, 0.68, rPatch);

        float basaltRough = sampleTriplanarColor(uBasaltRma, rPos, rTriW, 0.095).g;
        float sandRough = texture2D(uSandRma, rPos.xz * 0.16).g;
        float mossRough = texture2D(uMossRma, rPos.xz * 0.115).g;

        float surfaceRough = mix(mix(basaltRough, sandRough, rSand), mossRough, rMoss);

        float rPoolWet = 1.0 - smoothstep(0.05, 2.3, rPos.y);
        float rFallDist = length(vec2(rPos.x * 0.65, rPos.z - uPlungeZ));
        float rSprayWet = (1.0 - smoothstep(4.5, 16.5, rFallDist)) * (1.0 - smoothstep(uCrestHeight + 0.5, uCrestHeight + 3.5, rPos.y));
        float rWetness = clamp(max(rPoolWet, rSprayWet * 0.94), 0.0, 1.0);

        roughnessFactor = mix(surfaceRough, 0.12, rWetness * (1.0 - rMoss * 0.75));
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

        float nMacro = texture2D(uNoiseTex, nPos.xz * 0.018).r;
        float nPatch = texture2D(uNoiseTex, nPos.xz * 0.055 + vec2(0.31, 0.67)).a;
        float nSlope = smoothstep(0.56, 0.84, nNorm.y);
        float nSand = nSlope * (1.0 - smoothstep(0.75, 3.2, nPos.y + (nMacro - 0.5) * 1.1));
        float nOutside = smoothstep(5.4, 11.5, length(vec2(nPos.x * 0.72, nPos.z - uPlungeZ)));
        float nMoss = nSlope * smoothstep(1.3, 4.2, nPos.y) * nOutside * smoothstep(0.32, 0.68, nPatch);

        vec3 basaltPerturb = sampleTriplanarNormalOffset(uBasaltNormal, nPos, nTriW, 0.095);
        vec3 sandTn = texture2D(uSandNormal, nPos.xz * 0.16).xyz * 2.0 - 1.0;
        vec3 mossTn = texture2D(uMossNormal, nPos.xz * 0.115).xyz * 2.0 - 1.0;
        vec3 sandPerturb = vec3(sandTn.x, 0.0, sandTn.y);
        vec3 mossPerturb = vec3(mossTn.x, 0.0, mossTn.y);

        vec3 combinedPerturb = mix(mix(basaltPerturb, sandPerturb, nSand), mossPerturb, nMoss);
        vec3 perturbedWorldNormal = normalize(nNorm + combinedPerturb * 0.85);
        normal = normalize((viewMatrix * vec4(perturbedWorldNormal, 0.0)).xyz);
        `,
      );
  };

  material.customProgramCacheKey = () => 'aaa-triplanar-volcanic-terrain-v1';
  return material;
}

function createBasaltRockMaterial(options: {
  readonly textures: WaterfallTextureBundle;
  readonly noiseTexture: THREE.DataTexture;
  readonly timeUniform: { value: number };
  readonly mossStrength: number;
}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: options.textures.basalt.albedoMap,
    normalMap: options.textures.basalt.normalMap,
    normalScale: new THREE.Vector2(1.65, 1.65),
    roughnessMap: options.textures.basalt.rmaMap,
    roughness: 0.88,
    metalness: 0.06,
    envMapIntensity: 1.75,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = options.timeUniform;
    shader.uniforms.uNoiseTex = { value: options.noiseTexture };
    shader.uniforms.uMossAlbedo = { value: options.textures.moss.albedoMap };
    shader.uniforms.uMossStrength = { value: options.mossStrength };
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

        mat3 rockNormMat = mat3(modelMatrix);
        #ifdef USE_INSTANCING
          rockNormMat = rockNormMat * mat3(instanceMatrix);
        #endif
        vRockWorldNormal = normalize(rockNormMat * objectNormal);
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
        uniform float uMossStrength;
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

        float rkNoise = texture2D(uNoiseTex, rkPos.xz * 0.08 + vec2(rkPos.y * 0.03)).r;
        vec3 mossCap = texture2D(uMossAlbedo, rkPos.xz * 0.16).rgb;
        float capMask = smoothstep(0.55, 0.85, rkNorm.y) * smoothstep(1.2, 4.0, rkPos.y) * smoothstep(0.30, 0.68, rkNoise) * uMossStrength;
        diffuseColor.rgb = mix(diffuseColor.rgb, mossCap, capMask);

        float rkPoolWet = 1.0 - smoothstep(0.05, 2.2, rkPos.y);
        float rkFallDist = length(vec2(rkPos.x * 0.65, rkPos.z - uPlungeZ));
        float rkSprayWet = (1.0 - smoothstep(4.5, 16.5, rkFallDist)) * (1.0 - smoothstep(uCrestHeight + 0.5, uCrestHeight + 3.5, rkPos.y));
        float rkWet = clamp(max(rkPoolWet, rkSprayWet * 0.94), 0.0, 1.0);
        diffuseColor.rgb = diffuseColor.rgb * 1.45 * mix(1.0, 0.62, rkWet * (1.0 - capMask * 0.75));
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        vec3 rrPos = vRockWorldPos;
        vec3 rrNorm = normalize(vRockWorldNormal);
        float rrPoolWet = 1.0 - smoothstep(0.05, 2.3, rrPos.y);
        float rrFallDist = length(vec2(rrPos.x * 0.65, rrPos.z - uPlungeZ));
        float rrSprayWet = (1.0 - smoothstep(4.5, 16.5, rrFallDist)) * (1.0 - smoothstep(uCrestHeight + 0.5, uCrestHeight + 3.5, rrPos.y));
        float rrWet = clamp(max(rrPoolWet, rrSprayWet * 0.94), 0.0, 1.0);
        float rrCap = smoothstep(0.55, 0.85, rrNorm.y) * smoothstep(1.2, 4.0, rrPos.y) * uMossStrength;
        roughnessFactor = mix(roughnessFactor, 0.94, rrCap * 0.8);
        roughnessFactor = mix(roughnessFactor, 0.11, rrWet * (1.0 - rrCap * 0.8));
        `,
      );
  };

  material.customProgramCacheKey = () => `aaa-basalt-rock-v1-${options.mossStrength.toFixed(2)}`;
  return material;
}

function createFracturedHexColumnGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(1, 1.05, 1, 6, 10, false);
  const posAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;
  if (!posAttr || !uvAttr) {
    return geometry;
  }

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const angle = Math.atan2(z, x);

    const jointWave = Math.sin(y * 18.0) * 0.022;
    const facetJitter = Math.sin(angle * 3.0 + y * 5.0) * 0.028;
    const radialScale = 1 + jointWave + facetJitter;

    if (Math.abs(y) < 0.49) {
      posAttr.setXYZ(i, x * radialScale, y, z * radialScale);
    } else if (y > 0.49) {
      const topSlope = x * 0.04 + z * 0.03;
      posAttr.setXYZ(i, x * 0.96, y + topSlope, z * 0.96);
    }

    uvAttr.setXY(i, uvAttr.getX(i) * 1.5, uvAttr.getY(i) * 3.5);
  }

  geometry.computeVertexNormals();
  return geometry;
}

function createOpenVolcanicTerrainGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(280, 280, 180, 180);
  geometry.rotateX(-Math.PI / 2);

  const posAttr = geometry.attributes.position;
  if (!posAttr) {
    return geometry;
  }

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const y = computeOpenVolcanicTerrainHeight({ x, z });
    posAttr.setY(i, y);
  }

  geometry.computeVertexNormals();
  return geometry;
}

function createBoulderGeometry(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.DodecahedronGeometry(1, 2);
  const posAttr = geometry.attributes.position;
  if (!posAttr) {
    return geometry;
  }

  const phaseA = seed * 1.7;
  const phaseB = seed * 2.9;

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);

    const n1 = Math.sin(x * 2.6 + phaseA) * Math.cos(y * 2.3 + phaseB) * 0.2;
    const n2 = Math.cos(z * 3.4 - phaseA) * Math.sin(x * 3.1 + z * 1.8) * 0.11;
    const scale = 1 + n1 + n2;
    const flattenY = y < 0 ? 0.58 : 0.82;

    posAttr.setXYZ(i, x * scale, y * scale * flattenY, z * scale);
  }

  geometry.computeVertexNormals();
  return geometry;
}

export function createIcelandicCliff(options: {
  readonly noiseTexture: THREE.DataTexture;
  readonly textures: WaterfallTextureBundle;
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
  const columnMaterial = createBasaltRockMaterial({
    textures: options.textures,
    noiseTexture: options.noiseTexture,
    timeUniform,
    mossStrength: 0.72,
  });
  const boulderMaterial = createBasaltRockMaterial({
    textures: options.textures,
    noiseTexture: options.noiseTexture,
    timeUniform,
    mossStrength: 0.58,
  });

  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: THREE.Material[] = [terrainMaterial, columnMaterial, boulderMaterial];

  const terrainGeometry = createOpenVolcanicTerrainGeometry();
  geometriesToDispose.push(terrainGeometry);
  const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  group.add(terrainMesh);

  const columnGeometry = createFracturedHexColumnGeometry();
  geometriesToDispose.push(columnGeometry);

  const placements = generateBasaltColumnLayout({
    seed: 202611,
    cliffClusterCount: 145,
    ledgeOutcropCount: 54,
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

  const boulderGeometry = createBoulderGeometry(7);
  geometriesToDispose.push(boulderGeometry);
  const rand = createSeededRandom(55123);

  interface BoulderSpec {
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

  const boulderSpecs: BoulderSpec[] = [];

  for (let i = 0; i < 85; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = -9.0 + rand() * 58.0;
    const riverCenter = computeRiverCenterX(z);
    const riverHalfWidth =
      7.4 +
      Math.exp(-Math.pow((z - (SCENE_CONFIG.plungeCenterZ + 4)) / 10, 2)) * 5.2 +
      smoothstep({ edge0: 14, edge1: 95, value: z }) * 8.5;

    const offsetFromBank = (rand() - 0.12) * 26.0;
    const x = riverCenter + side * (riverHalfWidth + offsetFromBank);

    if (z < computeEscarpmentLineZ(x) + 3.0) {
      continue;
    }

    const groundY = computeOpenVolcanicTerrainHeight({ x, z });
    const radius = 0.48 + Math.pow(rand(), 1.75) * 2.1;

    boulderSpecs.push({
      x,
      y: groundY + radius * 0.25,
      z,
      sx: radius * (0.9 + rand() * 0.55),
      sy: radius * (0.5 + rand() * 0.42),
      sz: radius * (0.85 + rand() * 0.55),
      rx: rand() * Math.PI,
      ry: rand() * Math.PI,
      rz: rand() * Math.PI,
    });
  }

  const bouldersInstanced = new THREE.InstancedMesh(
    boulderGeometry,
    boulderMaterial,
    boulderSpecs.length,
  );
  bouldersInstanced.castShadow = true;
  bouldersInstanced.receiveShadow = true;

  for (let i = 0; i < boulderSpecs.length; i++) {
    const spec = boulderSpecs[i];
    if (!spec) {
      continue;
    }
    dummy.position.set(spec.x, spec.y, spec.z);
    dummy.rotation.set(spec.rx, spec.ry, spec.rz);
    dummy.scale.set(spec.sx, spec.sy, spec.sz);
    dummy.updateMatrix();
    bouldersInstanced.setMatrixAt(i, dummy.matrix);
  }
  bouldersInstanced.instanceMatrix.needsUpdate = true;
  group.add(bouldersInstanced);

  return {
    group,
    update: (elapsedSeconds: number) => {
      timeUniform.value = elapsedSeconds;
    },
    dispose: () => {
      for (const geo of geometriesToDispose) {
        geo.dispose();
      }
      for (const mat of materialsToDispose) {
        mat.dispose();
      }
    },
  };
}
