import * as THREE from 'three';
import {
  SCENE_CONFIG,
  clamp,
  createSeededRandom,
  generateBasaltColumnLayout,
  smoothstep,
} from './cliffMath';

export interface CliffSystem {
  readonly group: THREE.Group;
  readonly update: (elapsedSeconds: number) => void;
  readonly dispose: () => void;
}

interface BasaltShaderUniforms {
  readonly uTime: { value: number };
  readonly uNoiseTex: { value: THREE.DataTexture };
}

function createProceduralRockMaps(): {
  readonly bumpMap: THREE.DataTexture;
  readonly roughnessMap: THREE.DataTexture;
} {
  const size = 256;
  const bumpData = new Uint8Array(size * size * 4);
  const roughData = new Uint8Array(size * size * 4);
  const rand = createSeededRandom(90210);

  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = rand();
  }

  const sampleGrid = (coords: { readonly gx: number; readonly gy: number }): number => {
    const wrappedX = ((coords.gx % size) + size) % size;
    const wrappedY = ((coords.gy % size) + size) % size;
    return grid[wrappedY * size + wrappedX] ?? 0.5;
  };

  const smoothNoise = (input: {
    readonly x: number;
    readonly y: number;
    readonly freq: number;
  }): number => {
    const sx = input.x * input.freq;
    const sy = input.y * input.freq;
    const ix = Math.floor(sx);
    const iy = Math.floor(sy);
    const fx = sx - ix;
    const fy = sy - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    const a = sampleGrid({ gx: ix, gy: iy });
    const b = sampleGrid({ gx: ix + 1, gy: iy });
    const c = sampleGrid({ gx: ix, gy: iy + 1 });
    const d = sampleGrid({ gx: ix + 1, gy: iy + 1 });

    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;

      const coarse = smoothNoise({ x: u, y: v, freq: 8 });
      const mid = smoothNoise({ x: u, y: v, freq: 20 });
      const fine = smoothNoise({ x: u, y: v, freq: 52 });
      const verticalGrain = smoothNoise({ x: u * 2.4, y: v * 0.45, freq: 28 });
      const fracture = Math.abs(smoothNoise({ x: u * 0.6, y: v * 2.8, freq: 12 }) - 0.5) * 2.0;

      const heightVal = clamp({
        value: coarse * 0.35 + mid * 0.25 + fine * 0.2 + verticalGrain * 0.14 + fracture * 0.12,
        min: 0,
        max: 1,
      });

      const roughVal = clamp({
        value: 0.45 + (1 - heightVal) * 0.45 + (fine - 0.5) * 0.12,
        min: 0.25,
        max: 0.95,
      });

      const idx = (y * size + x) * 4;
      const bByte = Math.floor(heightVal * 255);
      const rByte = Math.floor(roughVal * 255);

      bumpData[idx] = bByte;
      bumpData[idx + 1] = bByte;
      bumpData[idx + 2] = bByte;
      bumpData[idx + 3] = 255;

      roughData[idx] = rByte;
      roughData[idx + 1] = rByte;
      roughData[idx + 2] = rByte;
      roughData[idx + 3] = 255;
    }
  }

  const bumpMap = new THREE.DataTexture(bumpData, size, size, THREE.RGBAFormat);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(2.5, 5.0);
  bumpMap.generateMipmaps = true;
  bumpMap.minFilter = THREE.LinearMipmapLinearFilter;
  bumpMap.needsUpdate = true;

  const roughnessMap = new THREE.DataTexture(roughData, size, size, THREE.RGBAFormat);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(2.5, 5.0);
  roughnessMap.generateMipmaps = true;
  roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
  roughnessMap.needsUpdate = true;

  return { bumpMap, roughnessMap };
}

function createBasaltMaterial(options: {
  readonly bumpMap: THREE.DataTexture;
  readonly roughnessMap: THREE.DataTexture;
  readonly uniforms: BasaltShaderUniforms;
  readonly mossStrength: number;
}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x212429),
    roughness: 0.84,
    metalness: 0.06,
    bumpMap: options.bumpMap,
    bumpScale: 0.24,
    roughnessMap: options.roughnessMap,
    envMapIntensity: 1.2,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = options.uniforms.uTime;
    shader.uniforms.uNoiseTex = options.uniforms.uNoiseTex;
    shader.uniforms.uMossStrength = { value: options.mossStrength };
    shader.uniforms.uCrestHeight = { value: SCENE_CONFIG.crestHeight };
    shader.uniforms.uPlungeZ = { value: SCENE_CONFIG.plungeCenterZ };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vBasaltWorldPos;
        varying vec3 vBasaltWorldNormal;
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 basaltWorldPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          basaltWorldPos = instanceMatrix * basaltWorldPos;
        #endif
        basaltWorldPos = modelMatrix * basaltWorldPos;
        vBasaltWorldPos = basaltWorldPos.xyz;

        mat3 basaltNormalMat = mat3(modelMatrix);
        #ifdef USE_INSTANCING
          basaltNormalMat = basaltNormalMat * mat3(instanceMatrix);
        #endif
        vBasaltWorldNormal = normalize(basaltNormalMat * objectNormal);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform sampler2D uNoiseTex;
        uniform float uMossStrength;
        uniform float uCrestHeight;
        uniform float uPlungeZ;
        varying vec3 vBasaltWorldPos;
        varying vec3 vBasaltWorldNormal;
        `,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        vec3 bPos = vBasaltWorldPos;
        vec3 bNorm = normalize(vBasaltWorldNormal);

        vec4 rockSampleA = texture2D(uNoiseTex, bPos.xz * 0.045 + vec2(bPos.y * 0.02));
        vec4 rockSampleB = texture2D(uNoiseTex, vec2((bPos.x + bPos.z) * 0.09, bPos.y * 0.16));
        float strata = sin(bPos.y * 2.1 + rockSampleA.r * 4.2) * 0.5 + 0.5;

        vec3 darkBasalt = vec3(0.055, 0.062, 0.072);
        vec3 charcoalBasalt = vec3(0.12, 0.128, 0.142);
        vec3 volcanicMineral = vec3(0.175, 0.15, 0.135);

        vec3 basaltAlbedo = mix(darkBasalt, charcoalBasalt, rockSampleA.r * 0.7 + rockSampleB.b * 0.3);
        basaltAlbedo = mix(basaltAlbedo, volcanicMineral, strata * 0.24 * rockSampleB.b);

        float poolWet = 1.0 - smoothstep(0.15, 3.4, bPos.y);
        float fallDist = length(vec2(bPos.x * 0.72, bPos.z - uPlungeZ * 0.55));
        float sprayWet = (1.0 - smoothstep(3.8, 13.0, fallDist)) * (1.0 - smoothstep(uCrestHeight + 0.6, uCrestHeight + 3.8, bPos.y));
        float basaltWetness = clamp(max(poolWet, sprayWet * 0.96), 0.0, 1.0);

        float trickleNoise = texture2D(uNoiseTex, vec2((bPos.x + bPos.z) * 0.32, bPos.y * 0.045 + uTime * 0.18)).b;
        float trickleMask = smoothstep(0.65, 0.9, trickleNoise) * sprayWet * (1.0 - abs(bNorm.y));

        float mossNoise = texture2D(uNoiseTex, bPos.xz * 0.07 + vec2(0.37, 0.91)).a;
        float upwardFacing = smoothstep(0.42, 0.78, bNorm.y);
        float aboveImpact = smoothstep(1.8, 4.5, bPos.y);
        float outsideTorrent = smoothstep(3.2, 5.2, abs(bPos.x) + max(0.0, bPos.z + 2.5) * 0.2);
        float mossFactor = upwardFacing * aboveImpact * outsideTorrent * smoothstep(0.36, 0.70, mossNoise) * uMossStrength;

        vec3 mossDark = vec3(0.08, 0.14, 0.05);
        vec3 mossBright = vec3(0.20, 0.28, 0.09);
        vec3 mossColor = mix(mossDark, mossBright, rockSampleB.r);

        basaltAlbedo = mix(basaltAlbedo, mossColor, mossFactor);
        basaltAlbedo *= mix(1.0, 0.35, basaltWetness * (1.0 - mossFactor * 0.75));
        basaltAlbedo += vec3(0.045, 0.055, 0.065) * trickleMask;

        diffuseColor.rgb = basaltAlbedo;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        vec3 rPos = vBasaltWorldPos;
        vec3 rNorm = normalize(vBasaltWorldNormal);
        float rPoolWet = 1.0 - smoothstep(0.15, 3.6, rPos.y);
        float rFallDist = length(vec2(rPos.x * 0.72, rPos.z - uPlungeZ * 0.55));
        float rSprayWet = (1.0 - smoothstep(3.8, 13.2, rFallDist)) * (1.0 - smoothstep(uCrestHeight + 0.6, uCrestHeight + 3.8, rPos.y));
        float rWetness = clamp(max(rPoolWet, rSprayWet * 0.96), 0.0, 1.0);
        float rTrickle = smoothstep(0.65, 0.9, texture2D(uNoiseTex, vec2((rPos.x + rPos.z) * 0.32, rPos.y * 0.045 + uTime * 0.18)).b) * rSprayWet;
        float rMoss = smoothstep(0.45, 0.78, rNorm.y) * smoothstep(1.8, 4.5, rPos.y) * smoothstep(0.38, 0.70, texture2D(uNoiseTex, rPos.xz * 0.07 + vec2(0.37, 0.91)).a) * uMossStrength;

        roughnessFactor = mix(roughnessFactor, 0.94, rMoss);
        roughnessFactor = mix(roughnessFactor, 0.11, rWetness * (1.0 - rMoss * 0.8));
        roughnessFactor = mix(roughnessFactor, 0.05, rTrickle * 0.85);
        `,
      );
  };

  material.customProgramCacheKey = () => `icelandic-basalt-v2-${options.mossStrength.toFixed(2)}`;
  return material;
}

function createFracturedHexColumnGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(1, 1.04, 1, 6, 8, false);
  const posAttr = geometry.attributes.position;
  if (!posAttr) {
    return geometry;
  }

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const angle = Math.atan2(z, x);

    const jointWave = Math.sin(y * 16.0) * 0.018;
    const facetJitter = Math.sin(angle * 3.0 + y * 5.0) * 0.025;
    const radialScale = 1 + jointWave + facetJitter;

    if (Math.abs(y) < 0.49) {
      posAttr.setXYZ(i, x * radialScale, y, z * radialScale);
    } else if (y > 0.49) {
      const topSlope = x * 0.03 + z * 0.02;
      posAttr.setXYZ(i, x * 0.97, y + topSlope, z * 0.97);
    }
  }

  geometry.computeVertexNormals();
  return geometry;
}

function createBasaltTerrainGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(180, 180, 128, 128);
  geometry.rotateX(-Math.PI / 2);

  const posAttr = geometry.attributes.position;
  if (!posAttr) {
    return geometry;
  }

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);

    const distToPlunge = Math.hypot(x * 0.88, z - 4.2);
    const poolBasin = -3.4 * (1 - smoothstep({ edge0: 5.5, edge1: 15.5, value: distToPlunge }));

    const outflowMask =
      smoothstep({ edge0: 3.0, edge1: 12.0, value: z }) *
      (1 -
        smoothstep({
          edge0: 4.5,
          edge1: 13.5,
          value: Math.abs(x + Math.sin(z * 0.11) * 2.2),
        }));
    const outflowBed = -1.65 * outflowMask;

    const backCliffMask = 1 - smoothstep({ edge0: -7.0, edge1: -1.5, value: z });
    const riverNotch =
      1 -
      smoothstep({
        edge0: 3.1,
        edge1: 6.8,
        value: Math.abs(x - Math.sin(z * 0.08) * 1.1),
      });
    const upperPlateau =
      backCliffMask *
      (SCENE_CONFIG.crestHeight +
        2.8 -
        riverNotch * 3.1 +
        Math.sin(x * 0.12) * Math.cos(z * 0.1) * 2.1);

    const canyonWallWidth = 10.5 + smoothstep({ edge0: -2, edge1: 35, value: z }) * 9.5;
    const canyonWalls =
      smoothstep({ edge0: canyonWallWidth, edge1: canyonWallWidth + 14.0, value: Math.abs(x) }) *
      (16.5 + Math.sin(z * 0.16 + x * 0.09) * 3.6) *
      (1 - smoothstep({ edge0: 26, edge1: 64, value: z }) * 0.55);

    const distantRidgeMask = 1 - smoothstep({ edge0: -72, edge1: -22, value: z });
    const ridgePeaks =
      distantRidgeMask *
      (14.0 +
        Math.abs(Math.sin(x * 0.055 + 0.6)) * 22.0 +
        Math.cos(x * 0.11 - z * 0.05) * 8.5 +
        Math.sin(x * 0.24 + z * 0.19) * 2.8);

    const microRough =
      Math.sin(x * 0.45 + z * 0.35) * 0.45 +
      Math.cos(x * 1.1 - z * 0.9) * 0.22 +
      Math.sin(x * 2.1 + z * 1.7) * 0.09;

    const shorelineSlope =
      smoothstep({ edge0: 7.5, edge1: 18.0, value: distToPlunge }) *
      smoothstep({ edge0: -4, edge1: 42, value: z }) *
      (1 - outflowMask) *
      2.6;

    const baseElevation =
      Math.min(poolBasin, outflowBed) +
      shorelineSlope +
      Math.max(upperPlateau, canyonWalls) +
      ridgePeaks +
      microRough;

    posAttr.setY(i, baseElevation);
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

    const n1 = Math.sin(x * 2.6 + phaseA) * Math.cos(y * 2.3 + phaseB) * 0.18;
    const n2 = Math.cos(z * 3.4 - phaseA) * Math.sin(x * 3.1 + z * 1.8) * 0.1;
    const scale = 1 + n1 + n2;
    const flattenY = y < 0 ? 0.62 : 0.84;

    posAttr.setXYZ(i, x * scale, y * scale * flattenY, z * scale);
  }

  geometry.computeVertexNormals();
  return geometry;
}

export function createIcelandicCliff(noiseTexture: THREE.DataTexture): CliffSystem {
  const group = new THREE.Group();
  const uniforms: BasaltShaderUniforms = {
    uTime: { value: 0 },
    uNoiseTex: { value: noiseTexture },
  };

  const { bumpMap, roughnessMap } = createProceduralRockMaps();
  const columnMaterial = createBasaltMaterial({
    bumpMap,
    roughnessMap,
    uniforms,
    mossStrength: 0.78,
  });
  const terrainMaterial = createBasaltMaterial({
    bumpMap,
    roughnessMap,
    uniforms,
    mossStrength: 1.0,
  });
  const boulderMaterial = createBasaltMaterial({
    bumpMap,
    roughnessMap,
    uniforms,
    mossStrength: 0.52,
  });

  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: THREE.Material[] = [columnMaterial, terrainMaterial, boulderMaterial];

  const terrainGeometry = createBasaltTerrainGeometry();
  geometriesToDispose.push(terrainGeometry);
  const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  group.add(terrainMesh);

  const columnGeometry = createFracturedHexColumnGeometry();
  geometriesToDispose.push(columnGeometry);

  const placements = generateBasaltColumnLayout({
    seed: 202611,
    ringColumnCount: 165,
    hangingColumnCount: 54,
    outerWallCount: 130,
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

  const grottoBackGeometry = new THREE.CylinderGeometry(
    8.6,
    9.8,
    22,
    24,
    6,
    true,
    -Math.PI * 0.42,
    Math.PI * 0.84,
  );
  const grottoBackPos = grottoBackGeometry.attributes.position;
  if (grottoBackPos) {
    for (let i = 0; i < grottoBackPos.count; i++) {
      const gx = grottoBackPos.getX(i);
      const gy = grottoBackPos.getY(i);
      const gz = grottoBackPos.getZ(i);
      const rough = Math.sin(gx * 0.7 + gy * 0.5) * 0.55 + Math.cos(gy * 1.1) * 0.35;
      grottoBackPos.setXYZ(i, gx + rough * 0.45, gy, gz + rough * 0.5);
    }
    grottoBackGeometry.computeVertexNormals();
  }
  geometriesToDispose.push(grottoBackGeometry);
  const grottoBackMaterial = createBasaltMaterial({
    bumpMap,
    roughnessMap,
    uniforms,
    mossStrength: 0.15,
  });
  grottoBackMaterial.side = THREE.BackSide;
  materialsToDispose.push(grottoBackMaterial);
  const grottoBackMesh = new THREE.Mesh(grottoBackGeometry, grottoBackMaterial);
  grottoBackMesh.position.set(0, 9.4, 1.5);
  grottoBackMesh.rotation.y = Math.PI;
  grottoBackMesh.receiveShadow = true;
  group.add(grottoBackMesh);

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

  const boulderSpecs: BoulderSpec[] = [
    { x: -7.8, y: 0.55, z: 9.8, sx: 2.3, sy: 1.5, sz: 1.9, rx: 0.1, ry: 0.8, rz: -0.1 },
    { x: -5.4, y: 0.15, z: 12.6, sx: 1.4, sy: 0.9, sz: 1.3, rx: -0.1, ry: 1.9, rz: 0.1 },
    { x: 7.4, y: 0.45, z: 10.4, sx: 2.1, sy: 1.4, sz: 1.8, rx: 0.15, ry: -0.6, rz: 0.08 },
    { x: 5.1, y: 0.1, z: 14.2, sx: 1.5, sy: 0.85, sz: 1.25, rx: -0.05, ry: 2.3, rz: -0.1 },
    { x: -9.8, y: 1.0, z: 4.5, sx: 2.7, sy: 1.9, sz: 2.2, rx: 0.06, ry: 0.4, rz: 0.12 },
    { x: 9.6, y: 0.9, z: 5.2, sx: 2.6, sy: 1.7, sz: 2.1, rx: -0.08, ry: 1.5, rz: -0.06 },
    { x: -3.2, y: -0.15, z: 15.8, sx: 1.1, sy: 0.55, sz: 0.95, rx: 0.1, ry: 1.1, rz: 0.0 },
    { x: 2.9, y: -0.1, z: 17.5, sx: 1.25, sy: 0.6, sz: 1.05, rx: -0.1, ry: 2.7, rz: 0.05 },
  ];

  for (let i = 0; i < 62; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = 1.5 + rand() * 24.0;
    const riverHalfWidth = 4.8 + Math.exp(-Math.pow((z - 4.0) / 7.5, 2)) * 4.2;
    const x = side * (riverHalfWidth + rand() * 8.5);
    const radius = 0.45 + Math.pow(rand(), 1.6) * 1.85;
    const y =
      -0.3 +
      smoothstep({ edge0: riverHalfWidth, edge1: riverHalfWidth + 6, value: Math.abs(x) }) * 1.6;

    boulderSpecs.push({
      x,
      y,
      z,
      sx: radius * (0.85 + rand() * 0.5),
      sy: radius * (0.55 + rand() * 0.4),
      sz: radius * (0.85 + rand() * 0.5),
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
      uniforms.uTime.value = elapsedSeconds;
    },
    dispose: () => {
      for (const geo of geometriesToDispose) {
        geo.dispose();
      }
      for (const mat of materialsToDispose) {
        mat.dispose();
      }
      bumpMap.dispose();
      roughnessMap.dispose();
    },
  };
}
