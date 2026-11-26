import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SHARED_ATMOS_AND_SHADOW_GLSL } from '../shaders/sharedShaderGlsl';
import { createSeededRandom, smoothstep } from './cliffMath';
import {
  FOREST_WATERFALL_CONFIG,
  computeForestCanyonTerrainHeight,
  computeForestEscarpmentZ,
  computeForestRiverCenterX,
} from './forestCanyonMath';
import { WaterfallTextureBundle } from './pbrTextures';
import { WaterfallPresetConfig } from './waterfallPresets';

export interface ForestVegetationSystem {
  readonly group: THREE.Group;
  readonly update: (elapsedSeconds: number) => void;
  readonly setShadowUniforms: (options: {
    readonly shadowMap: THREE.Texture;
    readonly shadowMatrix: THREE.Matrix4;
    readonly shadowMapSize: number;
  }) => void;
  readonly dispose: () => void;
}

const CANOPY_CARD_VERTEX_SHADER = /* glsl */ `
attribute float aCardShade;
attribute vec3 aCanopyColor;

uniform float uTime;
uniform float uWindStrength;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vCanopyColor;
varying float vCardShade;

void main() {
  vUv = uv;
  vCardShade = aCardShade;
  vCanopyColor = aCanopyColor;

  vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
  float phase = worldPos.x * 0.28 + worldPos.z * 0.24 + worldPos.y * 0.16;
  float gust = sin(uTime * 1.45 + phase) * 0.16 + sin(uTime * 3.1 + phase * 2.1) * 0.05;
  worldPos.x += gust * uWindStrength * (0.35 + aCardShade * 0.65);
  worldPos.z += cos(uTime * 1.2 + phase) * 0.09 * uWindStrength;
  worldPos.y += sin(uTime * 2.3 + phase) * 0.03 * uWindStrength;

  mat3 im = mat3(instanceMatrix);
  mat3 adjugateT = mat3(
    cross(im[1], im[2]),
    cross(im[2], im[0]),
    cross(im[0], im[1])
  );
  vWorldNormal = normalize(mat3(modelMatrix) * adjugateT * normal);
  vWorldPos = worldPos.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const CANOPY_CARD_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uLeafTex;
uniform vec3 uSunDirection;
uniform sampler2D uSunShadowMap;
uniform mat4 uSunShadowMatrix;
uniform float uShadowMapSize;
uniform float uSubsurfaceStrength;
uniform vec3 uFogCool;
uniform vec3 uFogWarm;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vCanopyColor;
varying float vCardShade;

${SHARED_ATMOS_AND_SHADOW_GLSL}

void main() {
  vec4 texSample = texture2D(uLeafTex, vUv);
  if (texSample.a < 0.42) {
    discard;
  }

  vec3 sunDir = normalize(uSunDirection);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 n = normalize(vWorldNormal);
  if (!gl_FrontFacing) {
    n = -n;
  }

  float shadow = sampleSunShadowPcf(
    vWorldPos,
    n,
    sunDir,
    uSunShadowMap,
    uSunShadowMatrix,
    uShadowMapSize
  );

  vec3 linearTex = pow(texSample.rgb, vec3(2.2));
  vec3 crownShade = mix(vec3(0.42, 0.34, 0.3), vec3(1.14, 1.08, 0.96), vCardShade);
  vec3 albedo = linearTex * vCanopyColor * crownShade;

  float wrapNdotL = clamp((dot(n, sunDir) + 0.45) / 1.45, 0.0, 1.0);
  float lit = mix(0.28, 1.0, shadow) * wrapNdotL;

  float backLight = pow(max(dot(-viewDir, sunDir), 0.0), 2.2);
  float rimGlow = pow(1.0 - abs(dot(n, viewDir)), 2.0) * 0.45;
  float translucency = (backLight * 0.9 + rimGlow * 0.45) * mix(0.35, 1.0, shadow) * (0.4 + 0.6 * vCardShade);

  vec3 skyAmbient = mix(vec3(0.06, 0.075, 0.065), vec3(0.18, 0.21, 0.19), vCardShade);
  vec3 directLight = vec3(1.55, 1.15, 0.66) * lit;
  vec3 sssColor = albedo * vec3(1.85, 1.18, 0.35) * translucency * uSubsurfaceStrength;

  vec3 color = albedo * (skyAmbient + directLight) + sssColor;

  vec3 toFrag = vWorldPos - cameraPosition;
  float dist = length(toFrag);
  vec3 rayDir = toFrag / max(dist, 0.0001);
  float heightMist = smoothstep(14.0, 44.0, vWorldPos.y) * 0.48 + exp(-max(vWorldPos.y, 0.0) * 0.028) * 0.52;
  float fogDensity = 0.0056 * (0.55 + 0.72 * heightMist);
  float fogFactor = clamp(1.0 - exp(-pow(dist * fogDensity, 1.38)), 0.0, 0.84);
  float sunAlign = max(dot(rayDir, sunDir), 0.0);
  vec3 fogColor = mix(uFogCool, uFogWarm, pow(sunAlign, 2.2) * 0.82);
  color = mix(color, fogColor, fogFactor);

  gl_FragColor = vec4(color, 1.0);
}
`;

function createAutumnLeafClusterTexture(anisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = createSeededRandom(314159);

  if (ctx) {
    ctx.clearRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(54, 34, 22, 0.92)';
    ctx.lineCap = 'round';
    for (let t = 0; t < 7; t++) {
      const startX = size * (0.44 + (rand() - 0.5) * 0.18);
      const startY = size * (0.86 + (rand() - 0.5) * 0.08);
      const angle = -Math.PI * 0.5 + (rand() - 0.5) * 1.45;
      const len = size * (0.34 + rand() * 0.34);
      ctx.lineWidth = 3.5 + rand() * 2.5;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(
        startX + Math.cos(angle + 0.15) * len * 0.5,
        startY + Math.sin(angle + 0.15) * len * 0.5,
        startX + Math.cos(angle) * len,
        startY + Math.sin(angle) * len,
      );
      ctx.stroke();
    }

    const drawMapleLeaf = (leaf: {
      readonly cx: number;
      readonly cy: number;
      readonly radius: number;
      readonly rotation: number;
      readonly brightness: number;
      readonly warmShift: number;
    }): void => {
      ctx.save();
      ctx.translate(leaf.cx, leaf.cy);
      ctx.rotate(leaf.rotation);

      const r = Math.min(255, Math.round(235 * leaf.brightness));
      const g = Math.min(255, Math.round((214 - leaf.warmShift * 42) * leaf.brightness));
      const b = Math.min(255, Math.round((152 - leaf.warmShift * 48) * leaf.brightness));

      const grad = ctx.createRadialGradient(0, -leaf.radius * 0.15, 2, 0, 0, leaf.radius * 1.05);
      grad.addColorStop(
        0,
        `rgb(${Math.min(255, r + 24)}, ${Math.min(255, g + 18)}, ${Math.min(255, b + 10)})`,
      );
      grad.addColorStop(0.75, `rgb(${r}, ${g}, ${b})`);
      grad.addColorStop(
        1,
        `rgb(${Math.round(r * 0.72)}, ${Math.round(g * 0.65)}, ${Math.round(b * 0.58)})`,
      );

      ctx.fillStyle = grad;
      ctx.beginPath();
      const lobes = 5;
      const lobeAngles = [-1.42, -0.76, 0, 0.76, 1.42];
      const lobeLengths = [0.68, 0.92, 1.06, 0.92, 0.68];
      ctx.moveTo(0, leaf.radius * 0.34);

      for (let i = 0; i < lobes; i++) {
        const a = (lobeAngles[i] ?? 0) - Math.PI * 0.5;
        const len = leaf.radius * (lobeLengths[i] ?? 0.85);
        const sideL = a - 0.24;
        const sideR = a + 0.24;
        ctx.lineTo(Math.cos(sideL) * len * 0.56, Math.sin(sideL) * len * 0.56);
        ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        ctx.lineTo(Math.cos(sideR) * len * 0.56, Math.sin(sideR) * len * 0.56);
      }
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = `rgba(${Math.round(r * 0.52)}, ${Math.round(g * 0.44)}, ${Math.round(b * 0.32)}, 0.55)`;
      ctx.lineWidth = 1.4;
      for (let i = 0; i < lobes; i++) {
        const a = (lobeAngles[i] ?? 0) - Math.PI * 0.5;
        const len = leaf.radius * (lobeLengths[i] ?? 0.85) * 0.82;
        ctx.beginPath();
        ctx.moveTo(0, leaf.radius * 0.12);
        ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        ctx.stroke();
      }

      ctx.restore();
    };

    const leafCount = 58;
    for (let i = 0; i < leafCount; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * size * 0.36;
      const cx = size * 0.5 + Math.cos(angle) * dist;
      const cy = size * 0.5 + Math.sin(angle) * dist * 0.95;
      const radius = 26 + rand() * 28;
      const brightness = 0.68 + (i / leafCount) * 0.36;
      drawMapleLeaf({
        cx,
        cy,
        radius,
        rotation: angle + Math.PI * 0.5 + (rand() - 0.5) * 0.9,
        brightness,
        warmShift: rand(),
      });
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createConiferBoughTexture(anisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = createSeededRandom(271828);

  if (ctx) {
    ctx.clearRect(0, 0, size, size);

    const drawSprig = (sprig: {
      readonly x0: number;
      readonly y0: number;
      readonly angle: number;
      readonly length: number;
      readonly needleLen: number;
      readonly shade: number;
    }): void => {
      const cosA = Math.cos(sprig.angle);
      const sinA = Math.sin(sprig.angle);
      const x1 = sprig.x0 + cosA * sprig.length;
      const y1 = sprig.y0 + sinA * sprig.length;

      ctx.strokeStyle = 'rgba(54, 42, 30, 0.92)';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(sprig.x0, sprig.y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      const steps = Math.floor(sprig.length * 0.55);
      for (let s = 2; s < steps; s++) {
        const t = s / steps;
        const bx = sprig.x0 + cosA * sprig.length * t;
        const by = sprig.y0 + sinA * sprig.length * t;
        const taper = 1.0 - t * 0.48;

        for (const side of [-1, 1]) {
          const nAngle = sprig.angle + side * (0.62 + (rand() - 0.5) * 0.32);
          const nLen = sprig.needleLen * taper * (0.72 + rand() * 0.55);
          const r = Math.round((46 + rand() * 24) * sprig.shade);
          const g = Math.round((86 + rand() * 38) * sprig.shade);
          const b = Math.round((52 + rand() * 18) * sprig.shade);
          ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.lineWidth = 2.0 + rand() * 1.4;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(nAngle) * nLen, by + Math.sin(nAngle) * nLen);
          ctx.stroke();
        }
      }
    };

    drawSprig({
      x0: size * 0.5,
      y0: size * 0.94,
      angle: -Math.PI * 0.5,
      length: size * 0.82,
      needleLen: 34,
      shade: 0.92,
    });

    const subBranches = 16;
    for (let i = 0; i < subBranches; i++) {
      const t = 0.14 + (i / subBranches) * 0.74;
      const side = i % 2 === 0 ? -1 : 1;
      const originY = size * (0.9 - t * 0.72);
      const originX = size * 0.5 + side * (4 + rand() * 8);
      const spread = side * (0.48 + (1 - t) * 0.52 + (rand() - 0.5) * 0.16);
      const len = size * (0.24 + (1 - t) * 0.24) * (0.82 + rand() * 0.34);
      drawSprig({
        x0: originX,
        y0: originY,
        angle: -Math.PI * 0.5 + spread,
        length: len,
        needleLen: 22 + (1 - t) * 14,
        shade: 0.76 + t * 0.42,
      });
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function appendTaperedTube(options: {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly radiusStart: number;
  readonly radiusEnd: number;
  readonly radialSegments: number;
  readonly vScale: number;
}): void {
  const dir = new THREE.Vector3().subVectors(options.end, options.start);
  const len = dir.length();
  if (len < 0.001) {
    return;
  }
  dir.divideScalar(len);

  const refAxis = Math.abs(dir.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(dir, refAxis).normalize();
  const bitangent = new THREE.Vector3().crossVectors(dir, tangent).normalize();

  const baseVertex = options.positions.length / 3;
  const rings = 3;

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const center = new THREE.Vector3().lerpVectors(options.start, options.end, t);
    const radius = options.radiusStart + (options.radiusEnd - options.radiusStart) * t;

    for (let s = 0; s <= options.radialSegments; s++) {
      const u = s / options.radialSegments;
      const theta = u * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const nx = tangent.x * cosT + bitangent.x * sinT;
      const ny = tangent.y * cosT + bitangent.y * sinT;
      const nz = tangent.z * cosT + bitangent.z * sinT;

      options.positions.push(
        center.x + nx * radius,
        center.y + ny * radius,
        center.z + nz * radius,
      );
      options.normals.push(nx, ny, nz);
      options.uvs.push(u * 1.4, t * len * options.vScale);
    }
  }

  const stride = options.radialSegments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < options.radialSegments; s++) {
      const a = baseVertex + r * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      options.indices.push(a, c, b, b, c, d);
    }
  }
}

function appendCuppedFoliageCard(options: {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly shades: number[];
  readonly indices: number[];
  readonly center: THREE.Vector3;
  readonly width: number;
  readonly height: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  readonly shade: number;
}): void {
  const quat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(options.pitch, options.yaw, options.roll, 'YXZ'),
  );
  const hw = options.width * 0.5;
  const hh = options.height * 0.5;
  const cup = Math.min(hw, hh) * 0.24;

  const localPts = [
    new THREE.Vector3(-hw, -hh, -cup),
    new THREE.Vector3(0, -hh, cup * 0.5),
    new THREE.Vector3(hw, -hh, -cup),
    new THREE.Vector3(-hw, hh, -cup * 0.6),
    new THREE.Vector3(0, hh, cup * 0.7),
    new THREE.Vector3(hw, hh, -cup * 0.6),
  ];
  const localUvs: readonly (readonly [number, number])[] = [
    [0, 0],
    [0.5, 0],
    [1, 0],
    [0, 1],
    [0.5, 1],
    [1, 1],
  ];

  const baseIdx = options.positions.length / 3;
  const cardNorm = new THREE.Vector3(0, 0.35, 1).normalize().applyQuaternion(quat);

  for (let i = 0; i < localPts.length; i++) {
    const p = localPts[i];
    const uv = localUvs[i];
    if (!p || !uv) {
      continue;
    }
    const wp = p.clone().applyQuaternion(quat).add(options.center);
    options.positions.push(wp.x, wp.y, wp.z);
    options.normals.push(cardNorm.x, cardNorm.y, cardNorm.z);
    options.uvs.push(uv[0], uv[1]);
    options.shades.push(options.shade);
  }

  options.indices.push(
    baseIdx,
    baseIdx + 1,
    baseIdx + 3,
    baseIdx + 1,
    baseIdx + 4,
    baseIdx + 3,
    baseIdx + 1,
    baseIdx + 2,
    baseIdx + 4,
    baseIdx + 2,
    baseIdx + 5,
    baseIdx + 4,
  );
}

function createDeciduousTreeArchetype(seed: number): {
  readonly woodGeo: THREE.BufferGeometry;
  readonly foliageGeo: THREE.BufferGeometry;
} {
  const rand = createSeededRandom(seed);
  const wPos: number[] = [];
  const wNorm: number[] = [];
  const wUv: number[] = [];
  const wIdx: number[] = [];

  const fPos: number[] = [];
  const fNorm: number[] = [];
  const fUv: number[] = [];
  const fShade: number[] = [];
  const fIdx: number[] = [];

  const trunkPts = [
    new THREE.Vector3(0, -0.05, 0),
    new THREE.Vector3((rand() - 0.5) * 0.04, 0.22, (rand() - 0.5) * 0.04),
    new THREE.Vector3((rand() - 0.5) * 0.06, 0.48, (rand() - 0.5) * 0.06),
    new THREE.Vector3((rand() - 0.5) * 0.07, 0.76, (rand() - 0.5) * 0.07),
  ];
  const trunkRadii = [0.054, 0.036, 0.026, 0.014];

  for (let i = 0; i < trunkPts.length - 1; i++) {
    const p0 = trunkPts[i];
    const p1 = trunkPts[i + 1];
    const r0 = trunkRadii[i] ?? 0.03;
    const r1 = trunkRadii[i + 1] ?? 0.015;
    if (!p0 || !p1) {
      continue;
    }
    appendTaperedTube({
      positions: wPos,
      normals: wNorm,
      uvs: wUv,
      indices: wIdx,
      start: p0,
      end: p1,
      radiusStart: r0,
      radiusEnd: r1,
      radialSegments: 6,
      vScale: 4.5,
    });
  }

  const crownAnchors: Array<{ readonly pos: THREE.Vector3; readonly heightFactor: number }> = [];
  const primaryBranchCount = 8;

  for (let b = 0; b < primaryBranchCount; b++) {
    const tHeight = 0.34 + (b / (primaryBranchCount - 1)) * 0.44;
    const yaw = (b / primaryBranchCount) * Math.PI * 2 + (rand() - 0.5) * 0.45;
    const spread = 0.22 + (1 - Math.abs(tHeight - 0.56) * 1.4) * 0.16 + rand() * 0.08;
    const rise = 0.15 + rand() * 0.15;

    const start = new THREE.Vector3(0, tHeight, 0);
    const mid = new THREE.Vector3(
      Math.cos(yaw) * spread * 0.55,
      tHeight + rise * 0.55,
      Math.sin(yaw) * spread * 0.55,
    );
    const tip = new THREE.Vector3(
      Math.cos(yaw + (rand() - 0.5) * 0.25) * spread,
      tHeight + rise,
      Math.sin(yaw + (rand() - 0.5) * 0.25) * spread,
    );

    appendTaperedTube({
      positions: wPos,
      normals: wNorm,
      uvs: wUv,
      indices: wIdx,
      start,
      end: mid,
      radiusStart: 0.018 * (1 - tHeight * 0.35),
      radiusEnd: 0.011,
      radialSegments: 5,
      vScale: 5.0,
    });
    appendTaperedTube({
      positions: wPos,
      normals: wNorm,
      uvs: wUv,
      indices: wIdx,
      start: mid,
      end: tip,
      radiusStart: 0.011,
      radiusEnd: 0.005,
      radialSegments: 4,
      vScale: 5.0,
    });

    crownAnchors.push({ pos: mid, heightFactor: tHeight });
    crownAnchors.push({ pos: tip, heightFactor: Math.min(1, tHeight + 0.18) });

    for (let sub = 0; sub < 2; sub++) {
      const subYaw = yaw + (sub === 0 ? -0.6 : 0.6) + (rand() - 0.5) * 0.35;
      const subLen = 0.11 + rand() * 0.1;
      const subTip = new THREE.Vector3(
        mid.x + Math.cos(subYaw) * subLen,
        mid.y + 0.07 + rand() * 0.09,
        mid.z + Math.sin(subYaw) * subLen,
      );
      appendTaperedTube({
        positions: wPos,
        normals: wNorm,
        uvs: wUv,
        indices: wIdx,
        start: mid,
        end: subTip,
        radiusStart: 0.008,
        radiusEnd: 0.003,
        radialSegments: 4,
        vScale: 5.0,
      });
      crownAnchors.push({ pos: subTip, heightFactor: Math.min(1, subTip.y) });
    }
  }

  crownAnchors.push({ pos: new THREE.Vector3(0, 0.88, 0), heightFactor: 0.96 });
  crownAnchors.push({ pos: new THREE.Vector3(0.06, 0.96, -0.04), heightFactor: 1.0 });
  crownAnchors.push({ pos: new THREE.Vector3(-0.07, 0.93, 0.05), heightFactor: 0.98 });

  for (const anchor of crownAnchors) {
    const cardsPerCluster = 3;
    for (let c = 0; c < cardsPerCluster; c++) {
      const offset = new THREE.Vector3(
        (rand() - 0.5) * 0.16,
        (rand() - 0.5) * 0.12,
        (rand() - 0.5) * 0.16,
      );
      const cardCenter = anchor.pos.clone().add(offset);
      const cardSize = 0.24 + rand() * 0.14;
      const shade = Math.min(1, Math.max(0.18, anchor.heightFactor * 0.85 + rand() * 0.22));
      appendCuppedFoliageCard({
        positions: fPos,
        normals: fNorm,
        uvs: fUv,
        shades: fShade,
        indices: fIdx,
        center: cardCenter,
        width: cardSize,
        height: cardSize * (0.9 + rand() * 0.22),
        yaw: (c / cardsPerCluster) * Math.PI + rand() * 0.9,
        pitch: (rand() - 0.5) * 0.85,
        roll: (rand() - 0.5) * 0.65,
        shade,
      });
    }
  }

  const woodGeo = new THREE.BufferGeometry();
  woodGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  woodGeo.setAttribute('normal', new THREE.Float32BufferAttribute(wNorm, 3));
  woodGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wUv, 2));
  woodGeo.setIndex(wIdx);

  const foliageGeo = new THREE.BufferGeometry();
  foliageGeo.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
  foliageGeo.setAttribute('normal', new THREE.Float32BufferAttribute(fNorm, 3));
  foliageGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fUv, 2));
  foliageGeo.setAttribute('aCardShade', new THREE.Float32BufferAttribute(fShade, 1));
  foliageGeo.setIndex(fIdx);

  return { woodGeo, foliageGeo };
}

function createConiferArchetype(seed: number): {
  readonly trunkGeo: THREE.BufferGeometry;
  readonly boughGeo: THREE.BufferGeometry;
} {
  const rand = createSeededRandom(seed);
  const wPos: number[] = [];
  const wNorm: number[] = [];
  const wUv: number[] = [];
  const wIdx: number[] = [];

  appendTaperedTube({
    positions: wPos,
    normals: wNorm,
    uvs: wUv,
    indices: wIdx,
    start: new THREE.Vector3(0, -0.04, 0),
    end: new THREE.Vector3(0, 0.94, 0),
    radiusStart: 0.046,
    radiusEnd: 0.006,
    radialSegments: 6,
    vScale: 6.0,
  });

  const fPos: number[] = [];
  const fNorm: number[] = [];
  const fUv: number[] = [];
  const fShade: number[] = [];
  const fIdx: number[] = [];

  const tierCount = 11;
  for (let t = 0; t < tierCount; t++) {
    const ratio = t / (tierCount - 1);
    const y = 0.2 + ratio * 0.76;
    const boughsInTier = ratio > 0.78 ? 3 : 4;
    const tierRadius = 0.24 * (1 - ratio * 0.78) + 0.03;

    for (let b = 0; b < boughsInTier; b++) {
      const yaw = (b / boughsInTier) * Math.PI * 2 + t * 0.92 + (rand() - 0.5) * 0.3;
      const dist = tierRadius * (0.45 + rand() * 0.25);
      const center = new THREE.Vector3(
        Math.cos(yaw) * dist,
        y - 0.025 * (1 - ratio),
        Math.sin(yaw) * dist,
      );
      const width = tierRadius * (1.28 + rand() * 0.34);
      const height = 0.14 + (1 - ratio) * 0.16;
      appendCuppedFoliageCard({
        positions: fPos,
        normals: fNorm,
        uvs: fUv,
        shades: fShade,
        indices: fIdx,
        center,
        width,
        height,
        yaw: yaw + Math.PI * 0.5,
        pitch: 0.52 + (1 - ratio) * 0.38 + (rand() - 0.5) * 0.18,
        roll: (rand() - 0.5) * 0.22,
        shade: 0.25 + ratio * 0.75,
      });
    }
  }

  for (let s = 0; s < 3; s++) {
    appendCuppedFoliageCard({
      positions: fPos,
      normals: fNorm,
      uvs: fUv,
      shades: fShade,
      indices: fIdx,
      center: new THREE.Vector3(0, 0.94, 0),
      width: 0.12,
      height: 0.18,
      yaw: (s / 3) * Math.PI,
      pitch: 0.08,
      roll: 0,
      shade: 1.0,
    });
  }

  const trunkGeo = new THREE.BufferGeometry();
  trunkGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  trunkGeo.setAttribute('normal', new THREE.Float32BufferAttribute(wNorm, 3));
  trunkGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wUv, 2));
  trunkGeo.setIndex(wIdx);

  const boughGeo = new THREE.BufferGeometry();
  boughGeo.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
  boughGeo.setAttribute('normal', new THREE.Float32BufferAttribute(fNorm, 3));
  boughGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fUv, 2));
  boughGeo.setAttribute('aCardShade', new THREE.Float32BufferAttribute(fShade, 1));
  boughGeo.setIndex(fIdx);

  return { trunkGeo, boughGeo };
}

function normalizeGroundedPlantGeometry(rawGeometry: THREE.BufferGeometry): THREE.BufferGeometry {
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
  const scale = 1.6 / maxExtent;

  cloned.translate(-center.x, -box.min.y, -center.z);
  cloned.scale(scale, scale, scale);
  cloned.computeBoundingSphere();
  return cloned;
}

interface PlantPlacement {
  readonly matrix: THREE.Matrix4;
  readonly color: THREE.Color;
}

function loadPhotogrammetryFoliageSet(options: {
  readonly modelUrl: string;
  readonly alphaUrl: string;
  readonly placements: readonly PlantPlacement[];
  readonly group: THREE.Group;
  readonly anisotropy: number;
  readonly isDisposed: () => boolean;
  readonly disposables: {
    readonly geometries: THREE.BufferGeometry[];
    readonly materials: THREE.Material[];
    readonly textures: THREE.Texture[];
  };
  readonly onLoaded: () => void;
}): void {
  const texLoader = new THREE.TextureLoader();
  const alphaMap = texLoader.load(options.alphaUrl);
  alphaMap.colorSpace = THREE.NoColorSpace;
  alphaMap.anisotropy = options.anisotropy;
  alphaMap.flipY = false;
  options.disposables.textures.push(alphaMap);

  const gltfLoader = new GLTFLoader();
  gltfLoader.load(
    options.modelUrl,
    (gltf) => {
      if (options.isDisposed()) {
        return;
      }

      const sourceMeshes: THREE.Mesh[] = [];
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          sourceMeshes.push(child);
        }
      });

      const firstMesh = sourceMeshes[0];
      if (!firstMesh) {
        return;
      }

      const rawMat = Array.isArray(firstMesh.material) ? firstMesh.material[0] : firstMesh.material;
      const material =
        rawMat instanceof THREE.MeshStandardMaterial
          ? rawMat.clone()
          : new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.02 });

      material.color.setRGB(1, 1, 1);
      material.alphaMap = alphaMap;
      material.alphaTest = 0.42;
      material.transparent = false;
      material.side = THREE.DoubleSide;
      material.roughness = 0.74;
      material.metalness = 0.02;
      material.envMapIntensity = 1.15;
      if (material.map) {
        material.map.anisotropy = options.anisotropy;
      }
      if (material.normalMap) {
        material.normalMap.anisotropy = options.anisotropy;
      }
      options.disposables.materials.push(material);

      const variantCount = Math.min(sourceMeshes.length, 3);
      const buckets: PlantPlacement[][] = Array.from({ length: variantCount }, () => []);
      for (let i = 0; i < options.placements.length; i++) {
        const placement = options.placements[i];
        const bucket = buckets[i % variantCount];
        if (placement && bucket) {
          bucket.push(placement);
        }
      }

      for (let v = 0; v < variantCount; v++) {
        const mesh = sourceMeshes[v];
        const bucket = buckets[v];
        if (!mesh || !bucket || bucket.length === 0) {
          continue;
        }
        const geo = normalizeGroundedPlantGeometry(mesh.geometry);
        options.disposables.geometries.push(geo);

        const instanced = new THREE.InstancedMesh(geo, material, bucket.length);
        instanced.castShadow = true;
        instanced.receiveShadow = true;

        for (let i = 0; i < bucket.length; i++) {
          const item = bucket[i];
          if (!item) {
            continue;
          }
          instanced.setMatrixAt(i, item.matrix);
          instanced.setColorAt(i, item.color);
        }
        instanced.instanceMatrix.needsUpdate = true;
        if (instanced.instanceColor) {
          instanced.instanceColor.needsUpdate = true;
        }
        options.group.add(instanced);
      }

      options.onLoaded();
    },
    undefined,
    () => {
      return;
    },
  );
}

function computeForestSlope(coords: { readonly x: number; readonly z: number }): number {
  const eps = 0.65;
  const hC = computeForestCanyonTerrainHeight(coords);
  const hR = computeForestCanyonTerrainHeight({ x: coords.x + eps, z: coords.z });
  const hF = computeForestCanyonTerrainHeight({ x: coords.x, z: coords.z + eps });
  return Math.hypot((hR - hC) / eps, (hF - hC) / eps);
}

const AUTUMN_CANOPY_PALETTE: readonly (readonly [number, number, number])[] = [
  [1.0, 0.72, 0.08],
  [0.98, 0.56, 0.06],
  [0.94, 0.36, 0.05],
  [0.82, 0.22, 0.06],
  [0.96, 0.82, 0.14],
  [0.64, 0.68, 0.14],
  [0.34, 0.52, 0.14],
];

const SHRUB_AUTUMN_PALETTE: readonly number[] = [
  0xffcb38, 0xf28b22, 0xd9561a, 0xa8be2c, 0x5c8f2b, 0x3b6e28, 0xe8ad2a,
];

const FERN_PALETTE: readonly number[] = [0x4c852d, 0x3a6e24, 0x6c9632, 0x899a2e, 0x2f5c20];

export function createForestVegetation(options: {
  readonly preset: WaterfallPresetConfig;
  readonly textures: WaterfallTextureBundle;
  readonly anisotropy: number;
  readonly isSoftwareGpu: boolean;
  readonly fallbackShadowTexture: THREE.Texture;
  readonly onStaticGeometryChanged: () => void;
}): ForestVegetationSystem {
  const group = new THREE.Group();
  const rand = createSeededRandom(62041);
  let disposed = false;

  const disposables: {
    readonly geometries: THREE.BufferGeometry[];
    readonly materials: THREE.Material[];
    readonly textures: THREE.Texture[];
  } = {
    geometries: [],
    materials: [],
    textures: [],
  };

  const sunDir = new THREE.Vector3(
    options.preset.sunDirection.x,
    options.preset.sunDirection.y,
    options.preset.sunDirection.z,
  ).normalize();

  const fogCool = new THREE.Vector3(
    options.preset.fogLinearCool[0],
    options.preset.fogLinearCool[1],
    options.preset.fogLinearCool[2],
  );
  const fogWarm = new THREE.Vector3(
    options.preset.fogLinearWarm[0],
    options.preset.fogLinearWarm[1],
    options.preset.fogLinearWarm[2],
  );

  const barkMat = new THREE.MeshStandardMaterial({
    map: options.textures.forestBark.albedoMap,
    normalMap: options.textures.forestBark.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: options.textures.forestBark.rmaMap,
    color: new THREE.Color(0x524236),
    roughness: 0.92,
    metalness: 0.02,
  });
  disposables.materials.push(barkMat);

  const mapleTex = createAutumnLeafClusterTexture(options.anisotropy);
  const coniferTex = createConiferBoughTexture(options.anisotropy);
  disposables.textures.push(mapleTex, coniferTex);

  const autumnCanopyUniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: 1.0 },
    uLeafTex: { value: mapleTex },
    uSunDirection: { value: sunDir },
    uSunShadowMap: { value: options.fallbackShadowTexture },
    uSunShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMapSize: { value: 1024 },
    uSubsurfaceStrength: { value: 1.15 },
    uFogCool: { value: fogCool },
    uFogWarm: { value: fogWarm },
  };
  const autumnCanopyMat = new THREE.ShaderMaterial({
    vertexShader: CANOPY_CARD_VERTEX_SHADER,
    fragmentShader: CANOPY_CARD_FRAGMENT_SHADER,
    uniforms: autumnCanopyUniforms,
    side: THREE.DoubleSide,
  });

  const coniferCanopyUniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: 0.45 },
    uLeafTex: { value: coniferTex },
    uSunDirection: { value: sunDir },
    uSunShadowMap: { value: options.fallbackShadowTexture },
    uSunShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMapSize: { value: 1024 },
    uSubsurfaceStrength: { value: 0.42 },
    uFogCool: { value: fogCool },
    uFogWarm: { value: fogWarm },
  };
  const coniferCanopyMat = new THREE.ShaderMaterial({
    vertexShader: CANOPY_CARD_VERTEX_SHADER,
    fragmentShader: CANOPY_CARD_FRAGMENT_SHADER,
    uniforms: coniferCanopyUniforms,
    side: THREE.DoubleSide,
  });
  const autumnDepthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: mapleTex,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });
  const coniferDepthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: coniferTex,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });
  disposables.materials.push(autumnCanopyMat, coniferCanopyMat, autumnDepthMat, coniferDepthMat);

  const deciduousArchetype = createDeciduousTreeArchetype(91237);
  const coniferArchetype = createConiferArchetype(44209);
  disposables.geometries.push(
    deciduousArchetype.woodGeo,
    deciduousArchetype.foliageGeo,
    coniferArchetype.trunkGeo,
    coniferArchetype.boughGeo,
  );

  const dummy = new THREE.Object3D();
  const deciduousMatrices: THREE.Matrix4[] = [];
  const deciduousColors: number[] = [];

  interface HeroAutumnSpec {
    readonly x: number;
    readonly z: number;
    readonly h: number;
    readonly w: number;
    readonly rgb: readonly [number, number, number];
  }

  const heroAutumnSpecs: readonly HeroAutumnSpec[] = [
    { x: -12.6, z: -13.2, h: 16.5, w: 12.2, rgb: [1.0, 0.76, 0.08] },
    { x: -16.8, z: -15.4, h: 19.2, w: 13.8, rgb: [0.98, 0.52, 0.06] },
    { x: -15.2, z: -6.8, h: 14.5, w: 11.4, rgb: [0.94, 0.64, 0.1] },
    { x: 11.4, z: -13.4, h: 18.8, w: 13.4, rgb: [1.0, 0.68, 0.07] },
    { x: 15.8, z: -15.2, h: 17.6, w: 12.6, rgb: [0.92, 0.42, 0.06] },
    { x: 14.8, z: -5.8, h: 13.8, w: 10.6, rgb: [0.74, 0.72, 0.14] },
    { x: -19.8, z: 3.4, h: 15.4, w: 11.8, rgb: [0.96, 0.44, 0.06] },
    { x: 18.6, z: 4.8, h: 14.6, w: 11.5, rgb: [0.98, 0.72, 0.1] },
  ];

  for (const spec of heroAutumnSpecs) {
    const gy = computeForestCanyonTerrainHeight({ x: spec.x, z: spec.z });
    dummy.position.set(spec.x, gy - 0.85, spec.z);
    dummy.rotation.set((rand() - 0.5) * 0.08, rand() * Math.PI * 2, (rand() - 0.5) * 0.08);
    dummy.scale.set(spec.w, spec.h, spec.w);
    dummy.updateMatrix();
    deciduousMatrices.push(dummy.matrix.clone());
    deciduousColors.push(spec.rgb[0], spec.rgb[1], spec.rgb[2]);
  }

  const deciduousTarget = options.isSoftwareGpu ? 52 : 96;
  for (
    let attempt = 0;
    attempt < deciduousTarget * 8 && deciduousMatrices.length < deciduousTarget;
    attempt++
  ) {
    const side = attempt % 2 === 0 ? -1 : 1;
    const x = side * (11.5 + rand() * 38.0);
    const z = -22 + rand() * 58.0;

    if (Math.hypot(x - 8.6, z - 46.8) < 16.5) {
      continue;
    }

    const riverCenter = computeForestRiverCenterX(z);
    if (Math.abs(x - riverCenter) < 10.8 && z > computeForestEscarpmentZ(x)) {
      continue;
    }

    const y = computeForestCanyonTerrainHeight({ x, z });
    if (y < 3.2 || y > 38) {
      continue;
    }
    const slope = computeForestSlope({ x, z });
    if (slope > 1.05) {
      continue;
    }

    const h = 10.2 + rand() * 9.8;
    const w = h * (0.68 + rand() * 0.24);
    dummy.position.set(x, y - 0.75, z);
    dummy.rotation.set((rand() - 0.5) * 0.1, rand() * Math.PI * 2, (rand() - 0.5) * 0.1);
    dummy.scale.set(w, h, w);
    dummy.updateMatrix();
    deciduousMatrices.push(dummy.matrix.clone());

    const paletteIdx = Math.floor(rand() * AUTUMN_CANOPY_PALETTE.length);
    const swatch = AUTUMN_CANOPY_PALETTE[paletteIdx] ?? [0.98, 0.62, 0.08];
    const jitter = 0.88 + rand() * 0.24;
    deciduousColors.push(swatch[0] * jitter, swatch[1] * jitter, swatch[2] * jitter);
  }

  const decTrunks = new THREE.InstancedMesh(
    deciduousArchetype.woodGeo,
    barkMat,
    deciduousMatrices.length,
  );
  decTrunks.castShadow = true;
  decTrunks.receiveShadow = true;

  const decCanopies = new THREE.InstancedMesh(
    deciduousArchetype.foliageGeo,
    autumnCanopyMat,
    deciduousMatrices.length,
  );
  decCanopies.castShadow = true;
  decCanopies.receiveShadow = true;
  decCanopies.customDepthMaterial = autumnDepthMat;
  decCanopies.frustumCulled = false;

  for (let i = 0; i < deciduousMatrices.length; i++) {
    const m = deciduousMatrices[i];
    if (!m) {
      continue;
    }
    decTrunks.setMatrixAt(i, m);
    decCanopies.setMatrixAt(i, m);
  }
  decTrunks.instanceMatrix.needsUpdate = true;
  decCanopies.instanceMatrix.needsUpdate = true;
  deciduousArchetype.foliageGeo.setAttribute(
    'aCanopyColor',
    new THREE.InstancedBufferAttribute(new Float32Array(deciduousColors), 3),
  );
  group.add(decTrunks);
  group.add(decCanopies);

  const coniferTarget = options.isSoftwareGpu ? 58 : 112;
  const coniferMatrices: THREE.Matrix4[] = [];
  const coniferColors: number[] = [];

  for (
    let attempt = 0;
    attempt < coniferTarget * 7 && coniferMatrices.length < coniferTarget;
    attempt++
  ) {
    const isCrestRim = attempt % 3 !== 0;
    const x = isCrestRim ? (rand() - 0.5) * 96.0 : (rand() > 0.5 ? 1 : -1) * (18.5 + rand() * 44.0);
    const z = isCrestRim ? -22.5 - rand() * 38.0 : -18.0 + rand() * 52.0;

    if (Math.abs(x) < 4.2 && z > -25.0) {
      continue;
    }
    if (Math.hypot(x - 8.6, z - 46.8) < 18.0) {
      continue;
    }

    const y = computeForestCanyonTerrainHeight({ x, z });
    if (y < 14.0 || y > 54.0) {
      continue;
    }

    const slope = computeForestSlope({ x, z });
    if (slope > 1.0) {
      continue;
    }

    const h = 14.0 + rand() * 14.5;
    const w = h * (0.48 + rand() * 0.2);
    dummy.position.set(x, y - 0.8, z);
    dummy.rotation.set((rand() - 0.5) * 0.06, rand() * Math.PI * 2, (rand() - 0.5) * 0.06);
    dummy.scale.set(w, h, w);
    dummy.updateMatrix();
    coniferMatrices.push(dummy.matrix.clone());

    const shade = 0.62 + rand() * 0.42;
    coniferColors.push(0.45 * shade, 0.72 * shade, 0.44 * shade);
  }

  const conTrunks = new THREE.InstancedMesh(
    coniferArchetype.trunkGeo,
    barkMat,
    coniferMatrices.length,
  );
  conTrunks.castShadow = true;
  conTrunks.receiveShadow = true;

  const conBoughs = new THREE.InstancedMesh(
    coniferArchetype.boughGeo,
    coniferCanopyMat,
    coniferMatrices.length,
  );
  conBoughs.castShadow = true;
  conBoughs.receiveShadow = true;
  conBoughs.customDepthMaterial = coniferDepthMat;
  conBoughs.frustumCulled = false;

  for (let i = 0; i < coniferMatrices.length; i++) {
    const m = coniferMatrices[i];
    if (!m) {
      continue;
    }
    conTrunks.setMatrixAt(i, m);
    conBoughs.setMatrixAt(i, m);
  }
  conTrunks.instanceMatrix.needsUpdate = true;
  conBoughs.instanceMatrix.needsUpdate = true;
  coniferArchetype.boughGeo.setAttribute(
    'aCanopyColor',
    new THREE.InstancedBufferAttribute(new Float32Array(coniferColors), 3),
  );
  group.add(conTrunks);
  group.add(conBoughs);

  const shrubPlacements: PlantPlacement[] = [];

  const foregroundShrubClusters = [
    { x: -11.4, z: 24.5, s: 3.1, hex: 0xf4a825 },
    { x: -9.8, z: 28.4, s: 3.0, hex: 0xffc838 },
    { x: 13.8, z: 25.4, s: 3.2, hex: 0x9ec42a },
    { x: 12.2, z: 21.8, s: 3.3, hex: 0xf08c20 },
    { x: 11.4, z: 16.4, s: 3.0, hex: 0x528829 },
    { x: -10.6, z: 18.6, s: 3.1, hex: 0xd9661e },
    { x: -10.4, z: 12.2, s: 3.2, hex: 0x4b7d26 },
    { x: -8.8, z: 4.5, s: 2.8, hex: 0xf0b228 },
    { x: 8.8, z: 3.8, s: 2.9, hex: 0x6ea02b },
    { x: -7.8, z: -7.5, s: 2.7, hex: 0xe69820 },
    { x: 7.4, z: -7.2, s: 2.8, hex: 0x82ab2b },
    { x: -9.8, z: -11.4, s: 3.1, hex: 0xffbc2c },
    { x: 9.6, z: -11.2, s: 3.2, hex: 0x5d9029 },
  ];

  for (const cluster of foregroundShrubClusters) {
    const gy = computeForestCanyonTerrainHeight({ x: cluster.x, z: cluster.z });
    if (gy < 0.15) {
      continue;
    }
    dummy.position.set(cluster.x, gy - 0.18, cluster.z);
    dummy.rotation.set((rand() - 0.5) * 0.2, rand() * Math.PI * 2, (rand() - 0.5) * 0.2);
    dummy.scale.set(cluster.s, cluster.s * (0.85 + rand() * 0.35), cluster.s);
    dummy.updateMatrix();
    shrubPlacements.push({
      matrix: dummy.matrix.clone(),
      color: new THREE.Color(cluster.hex),
    });
  }

  const shrubTarget = options.isSoftwareGpu ? 65 : 135;
  for (
    let attempt = 0;
    attempt < shrubTarget * 6 && shrubPlacements.length < shrubTarget;
    attempt++
  ) {
    const x = (rand() - 0.5) * 54.0;
    const z = -16.0 + rand() * 54.0;

    if (Math.hypot(x, z - FOREST_WATERFALL_CONFIG.plungeCenterZ) < 6.4) {
      continue;
    }
    const riverCenter = computeForestRiverCenterX(z);
    const riverHalfWidth =
      5.8 +
      Math.exp(-Math.pow((z - (FOREST_WATERFALL_CONFIG.plungeCenterZ + 4.5)) / 9.2, 2)) * 4.8 +
      smoothstep({ edge0: 12, edge1: 86, value: z }) * 8.6;
    if (Math.abs(x - riverCenter) < riverHalfWidth - 0.2 && z > computeForestEscarpmentZ(x)) {
      continue;
    }

    const y = computeForestCanyonTerrainHeight({ x, z });
    if (y < 0.35 || y > 24.0) {
      continue;
    }
    const slope = computeForestSlope({ x, z });
    if (slope > 1.25) {
      continue;
    }

    const s = 1.25 + rand() * 1.9;
    dummy.position.set(x, y - 0.16, z);
    dummy.rotation.set((rand() - 0.5) * 0.28, rand() * Math.PI * 2, (rand() - 0.5) * 0.28);
    dummy.scale.set(s, s * (0.78 + rand() * 0.42), s);
    dummy.updateMatrix();

    const hex = SHRUB_AUTUMN_PALETTE[Math.floor(rand() * SHRUB_AUTUMN_PALETTE.length)] ?? 0x6ea02b;
    shrubPlacements.push({
      matrix: dummy.matrix.clone(),
      color: new THREE.Color(hex),
    });
  }

  const fernPlacements: PlantPlacement[] = [];
  const fernTarget = options.isSoftwareGpu ? 95 : 220;
  for (let attempt = 0; attempt < fernTarget * 6 && fernPlacements.length < fernTarget; attempt++) {
    const x = (rand() - 0.5) * 56.0;
    const z = -17.0 + rand() * 58.0;

    if (Math.hypot(x * 0.8, z - FOREST_WATERFALL_CONFIG.plungeCenterZ) < 5.6) {
      continue;
    }
    const riverCenter = computeForestRiverCenterX(z);
    const riverHalfWidth =
      5.8 +
      Math.exp(-Math.pow((z - (FOREST_WATERFALL_CONFIG.plungeCenterZ + 4.5)) / 9.2, 2)) * 4.8 +
      smoothstep({ edge0: 12, edge1: 86, value: z }) * 8.6;
    if (Math.abs(x - riverCenter) < riverHalfWidth + 0.1 && z > computeForestEscarpmentZ(x)) {
      continue;
    }

    const y = computeForestCanyonTerrainHeight({ x, z });
    if (y < 0.35 || y > 24.0) {
      continue;
    }
    const slope = computeForestSlope({ x, z });
    if (slope > 1.2) {
      continue;
    }

    const s = 0.85 + rand() * 1.35;
    dummy.position.set(x, y - 0.08, z);
    dummy.rotation.set((rand() - 0.5) * 0.32, rand() * Math.PI * 2, (rand() - 0.5) * 0.32);
    dummy.scale.set(s, s * (0.85 + rand() * 0.35), s);
    dummy.updateMatrix();

    const hex = FERN_PALETTE[Math.floor(rand() * FERN_PALETTE.length)] ?? 0x4c852d;
    fernPlacements.push({
      matrix: dummy.matrix.clone(),
      color: new THREE.Color(hex),
    });
  }

  const isDisposed = () => disposed;
  loadPhotogrammetryFoliageSet({
    modelUrl: '/models/shrub_02/shrub_02_1k.gltf',
    alphaUrl: '/models/shrub_02/textures/shrub_02_alpha_1k.png',
    placements: shrubPlacements,
    group,
    anisotropy: options.anisotropy,
    isDisposed,
    disposables,
    onLoaded: options.onStaticGeometryChanged,
  });
  loadPhotogrammetryFoliageSet({
    modelUrl: '/models/fern_02/fern_02_1k.gltf',
    alphaUrl: '/models/fern_02/textures/fern_02_alpha_1k.png',
    placements: fernPlacements,
    group,
    anisotropy: options.anisotropy,
    isDisposed,
    disposables,
    onLoaded: options.onStaticGeometryChanged,
  });

  return {
    group,
    update: (elapsedSeconds: number) => {
      autumnCanopyUniforms.uTime.value = elapsedSeconds;
      coniferCanopyUniforms.uTime.value = elapsedSeconds;
    },
    setShadowUniforms: (shadowOptions) => {
      autumnCanopyUniforms.uSunShadowMap.value = shadowOptions.shadowMap;
      autumnCanopyUniforms.uSunShadowMatrix.value.copy(shadowOptions.shadowMatrix);
      autumnCanopyUniforms.uShadowMapSize.value = shadowOptions.shadowMapSize;
      coniferCanopyUniforms.uSunShadowMap.value = shadowOptions.shadowMap;
      coniferCanopyUniforms.uSunShadowMatrix.value.copy(shadowOptions.shadowMatrix);
      coniferCanopyUniforms.uShadowMapSize.value = shadowOptions.shadowMapSize;
    },
    dispose: () => {
      disposed = true;
      for (const geo of disposables.geometries) {
        geo.dispose();
      }
      for (const mat of disposables.materials) {
        mat.dispose();
      }
      for (const tex of disposables.textures) {
        tex.dispose();
      }
    },
  };
}
