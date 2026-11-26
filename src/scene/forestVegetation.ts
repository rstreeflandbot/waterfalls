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
import { ForestTextureSets } from './pbrTextures';
import { WaterfallPresetConfig } from './waterfallPresets';

export interface ForestVegetationSystem {
  readonly group: THREE.Group;
  readonly ready: Promise<void>;
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
  float gust = sin(uTime * 1.45 + phase) * 0.12 + sin(uTime * 3.1 + phase * 2.1) * 0.04;
  worldPos.x += gust * uWindStrength * (0.25 + aCardShade * 0.75);
  worldPos.z += cos(uTime * 1.2 + phase) * 0.07 * uWindStrength;
  worldPos.y += sin(uTime * 2.3 + phase) * 0.025 * uWindStrength;

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
  float mipBoost = 1.0 + clamp(length(fwidth(vUv)) * 18.0, 0.0, 0.68);
  if (texSample.a * mipBoost < 0.30) {
    discard;
  }

  vec3 sunDir = normalize(uSunDirection);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 n = normalize(vWorldNormal);

  float shadow = sampleSunShadowPcf(
    vWorldPos,
    n,
    sunDir,
    uSunShadowMap,
    uSunShadowMatrix,
    uShadowMapSize
  );

  float slotNarrow = 1.0 - smoothstep(6.5, 24.0, abs(vWorldPos.x));
  float depthInGorge = 1.0 - smoothstep(1.5, 23.0, vWorldPos.y);
  float backWallPocket = 1.0 - smoothstep(-19.0, 8.0, vWorldPos.z);
  float gorgeSkyAo = mix(1.0, 0.22, depthInGorge * (0.55 * slotNarrow + 0.45 * backWallPocket));

  vec3 linearTex = pow(texSample.rgb, vec3(2.2));
  vec3 crownShade = mix(vec3(0.18, 0.14, 0.12), vec3(1.18, 1.12, 1.02), vCardShade);
  vec3 albedo = linearTex * vCanopyColor * crownShade;

  float wrapNdotL = clamp((dot(n, sunDir) + 0.42) / 1.42, 0.0, 1.0);
  float lit = mix(0.14, 1.0, shadow) * wrapNdotL;

  float backLight = pow(max(dot(-viewDir, sunDir), 0.0), 2.3);
  float rimGlow = pow(1.0 - abs(dot(n, viewDir)), 2.2) * 0.42;
  float translucency = (backLight * 1.15 + rimGlow * 0.45) * mix(0.24, 1.0, shadow) * (0.28 + 0.72 * vCardShade);

  vec3 skyAmbient = mix(vec3(0.05, 0.065, 0.07), vec3(0.24, 0.28, 0.31), vCardShade) * gorgeSkyAo;
  vec3 directLight = vec3(2.4, 1.85, 1.05) * lit;
  vec3 sssColor = albedo * vec3(2.35, 1.42, 0.32) * translucency * uSubsurfaceStrength;

  vec3 color = albedo * (skyAmbient + directLight) + sssColor;

  vec3 toFrag = vWorldPos - cameraPosition;
  float dist = length(toFrag);
  vec3 rayDir = toFrag / max(dist, 0.0001);
  float rimMist = smoothstep(22.0, 48.0, vWorldPos.y) * 0.58 + exp(-max(vWorldPos.y, 0.0) * 0.032) * 0.28;
  float fogDensity = 0.0024 * (0.55 + rimMist);
  float fogFactor = clamp(1.0 - exp(-pow(dist * fogDensity, 1.35)), 0.0, 0.74);
  float sunAlign = max(dot(rayDir, sunDir), 0.0);
  vec3 fogColor = mix(uFogCool, uFogWarm, pow(sunAlign, 2.2) * 0.78);
  color = mix(color, fogColor, fogFactor);

  gl_FragColor = vec4(color, 1.0);
}
`;

const FOREST_GRASS_VERTEX_SHADER = /* glsl */ `
attribute vec3 aBladeTint;

uniform float uTime;
uniform vec2 uPlungeCenter;

varying float vHeightT;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vBladeTint;

void main() {
  vHeightT = uv.y;
  vBladeTint = aBladeTint;

  vec4 instOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 awayFromFalls = instOrigin.xz - uPlungeCenter;
  float distToFalls = max(length(awayFromFalls), 0.1);
  vec2 radialDir = awayFromFalls / distToFalls;
  float downdraft = exp(-distToFalls * 0.05) * 0.28;

  float gust = sin(uTime * 1.9 + instOrigin.x * 0.34 + instOrigin.z * 0.27) * 0.12;
  float flutter = sin(uTime * 4.8 + instOrigin.x * 1.3 - instOrigin.z * 0.95) * 0.035;
  float bendAmount = uv.y * uv.y;

  vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
  worldPos.x += (radialDir.x * downdraft + gust + flutter) * bendAmount;
  worldPos.z += (radialDir.y * downdraft + gust * 0.7) * bendAmount;
  worldPos.y -= abs(downdraft + gust) * 0.11 * bendAmount;

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

const FOREST_GRASS_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uSunDirection;
uniform sampler2D uSunShadowMap;
uniform mat4 uSunShadowMatrix;
uniform float uShadowMapSize;
uniform vec3 uFogCool;
uniform vec3 uFogWarm;

varying float vHeightT;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vBladeTint;

${SHARED_ATMOS_AND_SHADOW_GLSL}

void main() {
  vec3 sunDir = normalize(uSunDirection);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 n = normalize(vWorldNormal);
  if (!gl_FrontFacing) {
    n = -n;
  }
  vec3 litNormal = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.45));

  float shadow = sampleSunShadowPcf(
    vWorldPos,
    litNormal,
    sunDir,
    uSunShadowMap,
    uSunShadowMatrix,
    uShadowMapSize
  );

  float slotNarrow = 1.0 - smoothstep(6.5, 24.0, abs(vWorldPos.x));
  float depthInGorge = 1.0 - smoothstep(1.5, 23.0, vWorldPos.y);
  float backWallPocket = 1.0 - smoothstep(-19.0, 8.0, vWorldPos.z);
  float gorgeSkyAo = mix(1.0, 0.18, depthInGorge * (0.55 * slotNarrow + 0.45 * backWallPocket));

  vec3 rootColor = vec3(0.008, 0.024, 0.006) * vBladeTint;
  vec3 tipColor = vec3(0.085, 0.165, 0.028) * vBladeTint;
  vec3 albedo = mix(rootColor, tipColor, smoothstep(0.0, 1.0, vHeightT));

  float sunFacing = clamp((dot(litNormal, sunDir) + 0.32) / 1.32, 0.0, 1.0) * shadow;
  float sss = pow(max(dot(-viewDir, sunDir), 0.0), 2.5) * shadow * vHeightT;

  vec3 skyAmbient = vec3(0.14, 0.18, 0.16) * (0.35 + 0.65 * vHeightT) * gorgeSkyAo;
  vec3 directSun = vec3(2.2, 1.72, 0.98) * sunFacing;
  vec3 translucency = albedo * vec3(1.8, 1.55, 0.35) * sss * 1.1;

  vec3 color = albedo * (skyAmbient + directSun) + translucency;

  vec3 toFrag = vWorldPos - cameraPosition;
  float dist = length(toFrag);
  vec3 rayDir = toFrag / max(dist, 0.0001);
  float fogFactor = clamp(1.0 - exp(-pow(dist * 0.0022, 1.35)), 0.0, 0.52);
  float sunAlign = max(dot(rayDir, sunDir), 0.0);
  vec3 fogColor = mix(uFogCool, uFogWarm, pow(sunAlign, 2.2) * 0.55);
  color = mix(color, fogColor, fogFactor);

  gl_FragColor = vec4(color, 1.0);
}
`;

function dilateTransparentRgb(options: {
  readonly ctx: CanvasRenderingContext2D;
  readonly size: number;
  readonly passes: number;
  readonly fallbackRgb: readonly [number, number, number];
}): void {
  const { ctx, size, passes, fallbackRgb } = options;
  const img = ctx.getImageData(0, 0, size, size);
  const data = img.data;
  const count = size * size;
  let valid = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    const a = data[i * 4 + 3] ?? 0;
    valid[i] = a > 18 ? 1 : 0;
  }

  for (let pass = 0; pass < passes; pass++) {
    const nextData = new Uint8ClampedArray(data);
    const nextValid = new Uint8Array(valid);

    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const idx = y * size + x;
        if (valid[idx] === 1) {
          continue;
        }
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let hits = 0;

        const neighbors = [idx - 1, idx + 1, idx - size, idx + size];
        for (const nIdx of neighbors) {
          if (valid[nIdx] === 1) {
            const p = nIdx * 4;
            sumR += data[p] ?? 0;
            sumG += data[p + 1] ?? 0;
            sumB += data[p + 2] ?? 0;
            hits++;
          }
        }
        if (hits > 0) {
          const p = idx * 4;
          nextData[p] = Math.round(sumR / hits);
          nextData[p + 1] = Math.round(sumG / hits);
          nextData[p + 2] = Math.round(sumB / hits);
          nextValid[idx] = 1;
        }
      }
    }

    data.set(nextData);
    valid = nextValid;
  }

  for (let i = 0; i < count; i++) {
    if (valid[i] === 0) {
      const p = i * 4;
      data[p] = fallbackRgb[0];
      data[p + 1] = fallbackRgb[1];
      data[p + 2] = fallbackRgb[2];
    }
  }
  ctx.putImageData(img, 0, 0);
}

function createAutumnBoughAtlasTexture(options: {
  readonly size: number;
  readonly anisotropy: number;
}): THREE.CanvasTexture {
  const { size } = options;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = createSeededRandom(314159);
  const scale = size / 1024;

  if (ctx) {
    ctx.clearRect(0, 0, size, size);

    interface TwigTip {
      readonly x: number;
      readonly y: number;
      readonly angle: number;
    }

    const tips: TwigTip[] = [];
    const drawTwig = (twig: {
      readonly x0: number;
      readonly y0: number;
      readonly angle: number;
      readonly length: number;
      readonly width: number;
      readonly depth: number;
    }): void => {
      const x1 = twig.x0 + Math.cos(twig.angle) * twig.length;
      const y1 = twig.y0 + Math.sin(twig.angle) * twig.length;
      const midX = (twig.x0 + x1) * 0.5 + (rand() - 0.5) * twig.length * 0.16;
      const midY = (twig.y0 + y1) * 0.5 + (rand() - 0.5) * twig.length * 0.16;

      ctx.strokeStyle = 'rgba(42, 28, 18, 0.96)';
      ctx.lineWidth = twig.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(twig.x0, twig.y0);
      ctx.quadraticCurveTo(midX, midY, x1, y1);
      ctx.stroke();

      tips.push({ x: midX, y: midY, angle: twig.angle });
      tips.push({ x: x1, y: y1, angle: twig.angle });

      if (twig.depth > 0) {
        const branches = twig.depth === 2 ? 4 : 3;
        for (let b = 0; b < branches; b++) {
          const t = 0.35 + (b / Math.max(branches - 1, 1)) * 0.62;
          const ox = twig.x0 + (x1 - twig.x0) * t;
          const oy = twig.y0 + (y1 - twig.y0) * t;
          const side = b % 2 === 0 ? -1 : 1;
          const nextAngle = twig.angle + side * (0.42 + rand() * 0.45);
          drawTwig({
            x0: ox,
            y0: oy,
            angle: nextAngle,
            length: twig.length * (0.48 + rand() * 0.24),
            width: Math.max(1.4 * scale, twig.width * 0.58),
            depth: twig.depth - 1,
          });
        }
      }
    };

    drawTwig({
      x0: size * 0.5,
      y0: size * 0.94,
      angle: -Math.PI * 0.5 + (rand() - 0.5) * 0.14,
      length: size * 0.62,
      width: 6.5 * scale,
      depth: 2,
    });

    const drawFineDeciduousLeaf = (leaf: {
      readonly cx: number;
      readonly cy: number;
      readonly len: number;
      readonly wid: number;
      readonly rot: number;
      readonly shade: number;
      readonly warmShift: number;
    }): void => {
      ctx.save();
      ctx.translate(leaf.cx, leaf.cy);
      ctx.rotate(leaf.rot);

      const r = Math.min(255, Math.round(248 * leaf.shade));
      const g = Math.min(255, Math.round((238 - leaf.warmShift * 34) * leaf.shade));
      const b = Math.min(255, Math.round((192 - leaf.warmShift * 42) * leaf.shade));

      const grad = ctx.createLinearGradient(0, leaf.len * 0.45, 0, -leaf.len * 0.55);
      grad.addColorStop(
        0,
        `rgb(${Math.round(r * 0.72)}, ${Math.round(g * 0.68)}, ${Math.round(b * 0.62)})`,
      );
      grad.addColorStop(0.55, `rgb(${r}, ${g}, ${b})`);
      grad.addColorStop(
        1,
        `rgb(${Math.min(255, r + 14)}, ${Math.min(255, g + 10)}, ${Math.min(255, b + 6)})`,
      );

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, leaf.len * 0.45);
      ctx.bezierCurveTo(
        -leaf.wid * 0.92,
        leaf.len * 0.22,
        -leaf.wid * 0.85,
        -leaf.len * 0.22,
        -leaf.wid * 0.34,
        -leaf.len * 0.36,
      );
      ctx.lineTo(-leaf.wid * 0.52, -leaf.len * 0.42);
      ctx.lineTo(0, -leaf.len * 0.72);
      ctx.lineTo(leaf.wid * 0.52, -leaf.len * 0.42);
      ctx.lineTo(leaf.wid * 0.34, -leaf.len * 0.36);
      ctx.bezierCurveTo(
        leaf.wid * 0.85,
        -leaf.len * 0.22,
        leaf.wid * 0.92,
        leaf.len * 0.22,
        0,
        leaf.len * 0.45,
      );
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = `rgba(${Math.round(r * 0.48)}, ${Math.round(g * 0.4)}, ${Math.round(b * 0.28)}, 0.5)`;
      ctx.lineWidth = Math.max(0.9, 1.1 * scale);
      ctx.beginPath();
      ctx.moveTo(0, leaf.len * 0.42);
      ctx.lineTo(0, -leaf.len * 0.58);
      ctx.stroke();

      ctx.restore();
    };

    const totalLeaves = 225;
    for (let i = 0; i < totalLeaves; i++) {
      const anchor = tips[i % tips.length] ?? { x: size * 0.5, y: size * 0.5, angle: -Math.PI / 2 };
      const scatterR = (16 + rand() * 88) * scale;
      const scatterA = rand() * Math.PI * 2;
      const cx = Math.min(
        size - 28 * scale,
        Math.max(28 * scale, anchor.x + Math.cos(scatterA) * scatterR),
      );
      const cy = Math.min(
        size - 28 * scale,
        Math.max(28 * scale, anchor.y + Math.sin(scatterA) * scatterR),
      );
      const len = (24 + rand() * 26) * scale;
      const wid = len * (0.62 + rand() * 0.34);
      const shade = 0.62 + (i / totalLeaves) * 0.42;

      drawFineDeciduousLeaf({
        cx,
        cy,
        len,
        wid,
        rot: anchor.angle + Math.PI * 0.5 + (rand() - 0.5) * 1.9,
        shade,
        warmShift: rand(),
      });
    }

    dilateTransparentRgb({
      ctx,
      size,
      passes: 2,
      fallbackRgb: [224, 198, 132],
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = options.anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createConiferSprigAtlasTexture(options: {
  readonly size: number;
  readonly anisotropy: number;
}): THREE.CanvasTexture {
  const { size } = options;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = createSeededRandom(271828);
  const scale = size / 1024;

  if (ctx) {
    ctx.clearRect(0, 0, size, size);

    const drawNeedleSprig = (sprig: {
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

      ctx.strokeStyle = 'rgba(54, 42, 30, 0.96)';
      ctx.lineWidth = Math.max(1.8, 3.8 * scale);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sprig.x0, sprig.y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      const steps = Math.max(18, Math.floor(sprig.length * 0.36));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const bx = sprig.x0 + cosA * sprig.length * t;
        const by = sprig.y0 + sinA * sprig.length * t;
        const taper = 1.0 - t * 0.52;

        for (const side of [-1, 1]) {
          for (let layer = 0; layer < 2; layer++) {
            const nAngle = sprig.angle + side * (0.48 + layer * 0.24 + (rand() - 0.5) * 0.24);
            const nLen = sprig.needleLen * taper * (0.68 + rand() * 0.52);
            const shadeMix = sprig.shade * (layer === 0 ? 0.82 : 1.08);
            const r = Math.min(255, Math.round((78 + rand() * 24) * shadeMix));
            const g = Math.min(255, Math.round((132 + rand() * 34) * shadeMix));
            const b = Math.min(255, Math.round((86 + rand() * 20) * shadeMix));
            ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.lineWidth = (2.8 + rand() * 1.8) * scale;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(nAngle) * nLen, by + Math.sin(nAngle) * nLen);
            ctx.stroke();
          }
        }
      }
    };

    drawNeedleSprig({
      x0: size * 0.5,
      y0: size * 0.95,
      angle: -Math.PI * 0.5,
      length: size * 0.86,
      needleLen: 46 * scale,
      shade: 0.95,
    });

    const lateralBranches = 22;
    for (let i = 0; i < lateralBranches; i++) {
      const t = 0.08 + (i / lateralBranches) * 0.82;
      const side = i % 2 === 0 ? -1 : 1;
      const originY = size * (0.93 - t * 0.78);
      const originX = size * 0.5 + side * (4 + rand() * 10) * scale;
      const spread = side * (0.46 + (1 - t) * 0.58 + (rand() - 0.5) * 0.16);
      const len = size * (0.18 + (1 - t) * 0.28) * (0.82 + rand() * 0.32);
      drawNeedleSprig({
        x0: originX,
        y0: originY,
        angle: -Math.PI * 0.5 + spread,
        length: len,
        needleLen: (22 + (1 - t) * 18) * scale,
        shade: 0.78 + t * 0.34,
      });

      if (t < 0.7) {
        const subX = originX + Math.cos(-Math.PI * 0.5 + spread) * len * 0.55;
        const subY = originY + Math.sin(-Math.PI * 0.5 + spread) * len * 0.55;
        drawNeedleSprig({
          x0: subX,
          y0: subY,
          angle: -Math.PI * 0.5 + spread + side * 0.35,
          length: len * 0.52,
          needleLen: 20 * scale,
          shade: 0.85 + t * 0.28,
        });
      }
    }

    dilateTransparentRgb({
      ctx,
      size,
      passes: 2,
      fallbackRgb: [72, 118, 78],
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = options.anisotropy;
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

function appendVolumetricFoliageCard(options: {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly shades: number[];
  readonly indices: number[];
  readonly center: THREE.Vector3;
  readonly crownCenter: THREE.Vector3;
  readonly lobeCenter: THREE.Vector3;
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
  const cup = Math.min(hw, hh) * 0.26;

  const localPts = [
    new THREE.Vector3(-hw, -hh, -cup),
    new THREE.Vector3(0, -hh, cup * 0.45),
    new THREE.Vector3(hw, -hh, -cup),
    new THREE.Vector3(-hw, hh, -cup * 0.55),
    new THREE.Vector3(0, hh, cup * 0.65),
    new THREE.Vector3(hw, hh, -cup * 0.55),
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

    const fromCrown = wp.clone().sub(options.crownCenter);
    if (fromCrown.lengthSq() > 0.0001) {
      fromCrown.normalize();
    } else {
      fromCrown.set(0, 1, 0);
    }
    const fromLobe = wp.clone().sub(options.lobeCenter);
    if (fromLobe.lengthSq() > 0.0001) {
      fromLobe.normalize();
    } else {
      fromLobe.set(0, 1, 0);
    }

    const proxyNormal = fromCrown
      .multiplyScalar(0.38)
      .addScaledVector(fromLobe, 0.52)
      .addScaledVector(cardNorm, 0.16)
      .normalize();

    options.positions.push(wp.x, wp.y, wp.z);
    options.normals.push(proxyNormal.x, proxyNormal.y, proxyNormal.z);
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

interface TreeArchetype {
  readonly woodGeo: THREE.BufferGeometry;
  readonly foliageGeo: THREE.BufferGeometry;
}

function createDeciduousArchetype(options: {
  readonly seed: number;
  readonly leanX: number;
  readonly crownSpread: number;
  readonly lobeCount: number;
  readonly trunkRadius: number;
}): TreeArchetype {
  const rand = createSeededRandom(options.seed);
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
    new THREE.Vector3(0, -0.28, 0),
    new THREE.Vector3(options.leanX * 0.24, 0.18, (rand() - 0.5) * 0.03),
    new THREE.Vector3(options.leanX * 0.58 + (rand() - 0.5) * 0.04, 0.44, (rand() - 0.5) * 0.05),
    new THREE.Vector3(options.leanX * 0.88 + (rand() - 0.5) * 0.05, 0.72, (rand() - 0.5) * 0.05),
  ];
  const trunkRadii = [
    options.trunkRadius * 1.45,
    options.trunkRadius,
    options.trunkRadius * 0.7,
    options.trunkRadius * 0.34,
  ];

  for (let i = 0; i < trunkPts.length - 1; i++) {
    const p0 = trunkPts[i];
    const p1 = trunkPts[i + 1];
    const r0 = trunkRadii[i] ?? 0.024;
    const r1 = trunkRadii[i + 1] ?? 0.012;
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
      vScale: 5.5,
    });
  }

  const crownCenter = new THREE.Vector3(options.leanX * 0.8, 0.64, 0);
  const lobes: Array<{
    readonly center: THREE.Vector3;
    readonly radius: number;
    readonly heightT: number;
  }> = [];

  for (let b = 0; b < options.lobeCount; b++) {
    const tHeight = 0.36 + (b / Math.max(options.lobeCount - 1, 1)) * 0.42;
    const yaw = (b / options.lobeCount) * Math.PI * 2 + (rand() - 0.5) * 0.55;
    const spread = options.crownSpread * (0.62 + (1 - Math.abs(tHeight - 0.58) * 1.5) * 0.48);
    const rise = 0.14 + rand() * 0.16;

    const originX = options.leanX * tHeight;
    const start = new THREE.Vector3(originX, tHeight, 0);
    const mid = new THREE.Vector3(
      originX + Math.cos(yaw) * spread * 0.52,
      tHeight + rise * 0.55,
      Math.sin(yaw) * spread * 0.52,
    );
    const tip = new THREE.Vector3(
      originX + Math.cos(yaw + (rand() - 0.5) * 0.3) * spread,
      tHeight + rise,
      Math.sin(yaw + (rand() - 0.5) * 0.3) * spread,
    );

    appendTaperedTube({
      positions: wPos,
      normals: wNorm,
      uvs: wUv,
      indices: wIdx,
      start,
      end: mid,
      radiusStart: options.trunkRadius * 0.45,
      radiusEnd: options.trunkRadius * 0.25,
      radialSegments: 5,
      vScale: 5.5,
    });
    appendTaperedTube({
      positions: wPos,
      normals: wNorm,
      uvs: wUv,
      indices: wIdx,
      start: mid,
      end: tip,
      radiusStart: options.trunkRadius * 0.25,
      radiusEnd: options.trunkRadius * 0.1,
      radialSegments: 4,
      vScale: 5.5,
    });

    lobes.push({
      center: tip,
      radius: 0.12 + rand() * 0.07,
      heightT: Math.min(1, tip.y),
    });

    if (b % 2 === 0) {
      const subYaw = yaw + (rand() > 0.5 ? 0.65 : -0.65);
      const subTip = new THREE.Vector3(
        mid.x + Math.cos(subYaw) * spread * 0.48,
        mid.y + 0.08 + rand() * 0.08,
        mid.z + Math.sin(subYaw) * spread * 0.48,
      );
      appendTaperedTube({
        positions: wPos,
        normals: wNorm,
        uvs: wUv,
        indices: wIdx,
        start: mid,
        end: subTip,
        radiusStart: options.trunkRadius * 0.2,
        radiusEnd: options.trunkRadius * 0.08,
        radialSegments: 4,
        vScale: 5.5,
      });
      lobes.push({
        center: subTip,
        radius: 0.1 + rand() * 0.06,
        heightT: Math.min(1, subTip.y),
      });
    }
  }

  lobes.push({
    center: new THREE.Vector3(options.leanX * 0.92, 0.9, 0),
    radius: 0.15,
    heightT: 0.96,
  });

  for (const lobe of lobes) {
    const cardsInLobe = 9;
    for (let c = 0; c < cardsInLobe; c++) {
      const phi = Math.acos(1 - 2 * ((c + 0.5) / cardsInLobe));
      const theta = c * 2.39996 + rand() * 0.6;
      const dist = lobe.radius * (0.35 + rand() * 0.72);
      const offset = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * dist,
        Math.cos(phi) * dist * 0.78,
        Math.sin(phi) * Math.sin(theta) * dist,
      );
      const cardCenter = lobe.center.clone().add(offset);
      const cardSize = 0.095 + rand() * 0.055;
      const radialFactor = Math.min(1, dist / Math.max(lobe.radius, 0.01));
      const shade = Math.min(
        1,
        Math.max(0.14, lobe.heightT * 0.68 + radialFactor * 0.34 + (offset.y > 0 ? 0.14 : -0.1)),
      );

      appendVolumetricFoliageCard({
        positions: fPos,
        normals: fNorm,
        uvs: fUv,
        shades: fShade,
        indices: fIdx,
        center: cardCenter,
        crownCenter,
        lobeCenter: lobe.center,
        width: cardSize,
        height: cardSize * (0.9 + rand() * 0.22),
        yaw: theta + rand() * 0.8,
        pitch: (rand() - 0.5) * 0.95,
        roll: (rand() - 0.5) * 0.75,
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

function createDouglasFirArchetype(seed: number): TreeArchetype {
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
    start: new THREE.Vector3(0, -0.24, 0),
    end: new THREE.Vector3(0, 0.96, 0),
    radiusStart: 0.024,
    radiusEnd: 0.003,
    radialSegments: 6,
    vScale: 7.5,
  });

  const fPos: number[] = [];
  const fNorm: number[] = [];
  const fUv: number[] = [];
  const fShade: number[] = [];
  const fIdx: number[] = [];

  const crownCenter = new THREE.Vector3(0, 0.58, 0);
  const tierCount = 18;
  for (let t = 0; t < tierCount; t++) {
    const ratio = t / (tierCount - 1);
    const y = 0.2 + ratio * 0.76;
    const boughsInTier = ratio > 0.8 ? 3 : 4;
    const tierRadius = 0.145 * (1 - ratio * 0.8) + 0.018;

    for (let b = 0; b < boughsInTier; b++) {
      const yaw = (b / boughsInTier) * Math.PI * 2 + t * 1.15 + (rand() - 0.5) * 0.35;
      const dist = tierRadius * (0.48 + rand() * 0.28);
      const center = new THREE.Vector3(
        Math.cos(yaw) * dist,
        y - 0.015 * (1 - ratio),
        Math.sin(yaw) * dist,
      );
      const width = tierRadius * (1.1 + rand() * 0.28);
      const height = 0.068 + (1 - ratio) * 0.065;
      appendVolumetricFoliageCard({
        positions: fPos,
        normals: fNorm,
        uvs: fUv,
        shades: fShade,
        indices: fIdx,
        center,
        crownCenter,
        lobeCenter: new THREE.Vector3(0, y, 0),
        width,
        height,
        yaw: yaw + Math.PI * 0.5,
        pitch: 0.52 + (1 - ratio) * 0.32 + (rand() - 0.5) * 0.18,
        roll: (rand() - 0.5) * 0.22,
        shade: 0.2 + ratio * 0.8,
      });
    }
  }

  for (let s = 0; s < 3; s++) {
    appendVolumetricFoliageCard({
      positions: fPos,
      normals: fNorm,
      uvs: fUv,
      shades: fShade,
      indices: fIdx,
      center: new THREE.Vector3(0, 0.96, 0),
      crownCenter,
      lobeCenter: new THREE.Vector3(0, 0.92, 0),
      width: 0.055,
      height: 0.09,
      yaw: (s / 3) * Math.PI,
      pitch: 0.08,
      roll: 0,
      shade: 1.0,
    });
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

function createForestGrassTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const bladeCount = 3;
  let vertexOffset = 0;

  for (let b = 0; b < bladeCount; b++) {
    const yaw = (b / bladeCount) * Math.PI * 2 + 0.35;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const heightScale = 0.78 + (b % 2) * 0.24;
    const lean = 0.18 + b * 0.04;
    const baseOffsetX = cosY * 0.06;
    const baseOffsetZ = sinY * 0.06;

    const rawPts: readonly (readonly [number, number, number, number, number])[] = [
      [-0.042, 0.0, 0.0, 0, 0],
      [0.042, 0.0, 0.0, 1, 0],
      [-0.032, 0.24 * heightScale, 0.045 * lean, 0, 0.35],
      [0.032, 0.24 * heightScale, 0.045 * lean, 1, 0.35],
      [-0.016, 0.5 * heightScale, 0.14 * lean, 0, 0.7],
      [0.016, 0.5 * heightScale, 0.14 * lean, 1, 0.7],
      [0.0, 0.74 * heightScale, 0.28 * lean, 0.5, 1.0],
    ];

    for (const pt of rawPts) {
      const lx = pt[0];
      const ly = pt[1];
      const lz = pt[2];
      const wx = lx * cosY - lz * sinY + baseOffsetX;
      const wz = lx * sinY + lz * cosY + baseOffsetZ;
      positions.push(wx, ly, wz);
      uvs.push(pt[3], pt[4]);
    }

    indices.push(
      vertexOffset,
      vertexOffset + 1,
      vertexOffset + 2,
      vertexOffset + 1,
      vertexOffset + 3,
      vertexOffset + 2,
      vertexOffset + 2,
      vertexOffset + 3,
      vertexOffset + 4,
      vertexOffset + 3,
      vertexOffset + 5,
      vertexOffset + 4,
      vertexOffset + 4,
      vertexOffset + 5,
      vertexOffset + 6,
    );
    vertexOffset += 7;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
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
  readonly label: string;
  readonly placements: readonly PlantPlacement[];
  readonly group: THREE.Group;
  readonly anisotropy: number;
  readonly sunDir: THREE.Vector3;
  readonly isAutumnHueRemap: boolean;
  readonly isDisposed: () => boolean;
  readonly disposables: {
    readonly geometries: THREE.BufferGeometry[];
    readonly materials: THREE.Material[];
    readonly textures: THREE.Texture[];
  };
  readonly onLoaded: () => void;
  readonly onAssetLoaded?: (label: string) => void;
}): Promise<void> {
  const texLoader = new THREE.TextureLoader();
  let resolveAlpha: () => void = () => {};
  const alphaReady = new Promise<void>((resolve) => {
    resolveAlpha = resolve;
  });

  const alphaMap = texLoader.load(
    options.alphaUrl,
    () => resolveAlpha(),
    undefined,
    () => resolveAlpha(),
  );
  alphaMap.colorSpace = THREE.NoColorSpace;
  alphaMap.anisotropy = options.anisotropy;
  alphaMap.flipY = false;
  options.disposables.textures.push(alphaMap);

  const gltfReady = new Promise<void>((resolve) => {
    const gltfLoader = new GLTFLoader();
    gltfLoader.load(
      options.modelUrl,
      (gltf) => {
        if (options.isDisposed()) {
          resolve();
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
          resolve();
          return;
        }

        const rawMat = Array.isArray(firstMesh.material)
          ? firstMesh.material[0]
          : firstMesh.material;
        const material =
          rawMat instanceof THREE.MeshStandardMaterial
            ? rawMat.clone()
            : new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.02 });

        material.color.setRGB(1, 1, 1);
        material.alphaMap = alphaMap;
        material.alphaTest = 0.42;
        material.transparent = false;
        material.side = THREE.DoubleSide;
        material.roughness = 0.68;
        material.metalness = 0.02;
        material.envMapIntensity = 0.85;
        if (material.map) {
          material.map.anisotropy = options.anisotropy;
        }
        if (material.normalMap) {
          material.normalMap.anisotropy = options.anisotropy;
        }

        material.onBeforeCompile = (shader) => {
          shader.uniforms.uSunDir = { value: options.sunDir };
          shader.uniforms.uHueRemap = { value: options.isAutumnHueRemap ? 1.0 : 0.0 };

          shader.vertexShader = shader.vertexShader
            .replace(
              '#include <common>',
              /* glsl */ `
              #include <common>
              varying vec3 vPlantWPos;
              `,
            )
            .replace(
              '#include <worldpos_vertex>',
              /* glsl */ `
              #include <worldpos_vertex>
              vec4 plantLPos = vec4(transformed, 1.0);
              #ifdef USE_INSTANCING
                plantLPos = instanceMatrix * plantLPos;
              #endif
              vPlantWPos = (modelMatrix * plantLPos).xyz;
              `,
            );

          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              /* glsl */ `
              #include <common>
              uniform vec3 uSunDir;
              uniform float uHueRemap;
              varying vec3 vPlantWPos;
              `,
            )
            .replace(
              '#include <color_fragment>',
              /* glsl */ `
              #ifdef USE_INSTANCING_COLOR
                if (uHueRemap > 0.5) {
                  float leafLuma = dot(diffuseColor.rgb, vec3(0.22, 0.68, 0.10));
                  vec3 remapped = vColor.rgb * clamp(leafLuma * 2.55, 0.12, 1.45);
                  diffuseColor.rgb = mix(diffuseColor.rgb * 0.85, remapped, 0.88);
                } else {
                  diffuseColor.rgb *= vColor.rgb;
                }
              #endif
              `,
            )
            .replace(
              '#include <aomap_fragment>',
              /* glsl */ `
              #include <aomap_fragment>
              float pSlotNarrow = 1.0 - smoothstep(6.5, 24.0, abs(vPlantWPos.x));
              float pDepthInGorge = 1.0 - smoothstep(1.5, 23.0, vPlantWPos.y);
              float pBackWall = 1.0 - smoothstep(-19.0, 8.0, vPlantWPos.z);
              float pGorgeAo = mix(1.0, 0.22, pDepthInGorge * (0.55 * pSlotNarrow + 0.45 * pBackWall));
              reflectedLight.indirectDiffuse *= pGorgeAo;
              vec3 pViewDir = normalize(cameraPosition - vPlantWPos);
              float pBacklight = pow(max(dot(-pViewDir, normalize(uSunDir)), 0.0), 2.5);
              reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.4, 1.0, 0.35) * pBacklight * 0.45 * pGorgeAo;
              `,
            );
        };
        material.customProgramCacheKey = () =>
          options.isAutumnHueRemap ? 'forest-shrub-hueremap-v2' : 'forest-fern-gorgeao-v2';

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
        resolve();
      },
      undefined,
      () => {
        resolve();
      },
    );
  });

  return Promise.all([alphaReady, gltfReady]).then(() => {
    options.onAssetLoaded?.(options.label);
  });
}

function computeForestSlope(coords: { readonly x: number; readonly z: number }): number {
  const eps = 0.65;
  const hC = computeForestCanyonTerrainHeight(coords);
  const hR = computeForestCanyonTerrainHeight({ x: coords.x + eps, z: coords.z });
  const hF = computeForestCanyonTerrainHeight({ x: coords.x, z: coords.z + eps });
  return Math.hypot((hR - hC) / eps, (hF - hC) / eps);
}

const AUTUMN_CANOPY_PALETTE: readonly (readonly [number, number, number])[] = [
  [1.0, 0.78, 0.04],
  [1.0, 0.56, 0.03],
  [0.96, 0.34, 0.03],
  [0.78, 0.18, 0.04],
  [0.94, 0.86, 0.08],
  [0.54, 0.68, 0.08],
  [0.24, 0.52, 0.1],
];

const SHRUB_AUTUMN_PALETTE: readonly number[] = [
  0xffbe24, 0xf27d18, 0xd84814, 0x9ab822, 0x3b7622, 0x265418, 0xe89e1c,
];

const FERN_PALETTE: readonly number[] = [0x4c852d, 0x3a6e24, 0x6c9632, 0x2f5c20, 0x588c28];

interface TreeInstanceSpec {
  readonly matrix: THREE.Matrix4;
  readonly rgb: readonly [number, number, number];
}

function addInstancedArchetype(options: {
  readonly archetype: TreeArchetype;
  readonly specs: readonly TreeInstanceSpec[];
  readonly barkMat: THREE.Material;
  readonly canopyMat: THREE.Material;
  readonly depthMat: THREE.Material;
  readonly group: THREE.Group;
}): void {
  if (options.specs.length === 0) {
    return;
  }

  const trunks = new THREE.InstancedMesh(
    options.archetype.woodGeo,
    options.barkMat,
    options.specs.length,
  );
  trunks.castShadow = true;
  trunks.receiveShadow = true;

  const canopies = new THREE.InstancedMesh(
    options.archetype.foliageGeo,
    options.canopyMat,
    options.specs.length,
  );
  canopies.castShadow = true;
  canopies.receiveShadow = true;
  canopies.customDepthMaterial = options.depthMat;
  canopies.frustumCulled = false;

  const colors = new Float32Array(options.specs.length * 3);
  for (let i = 0; i < options.specs.length; i++) {
    const spec = options.specs[i];
    if (!spec) {
      continue;
    }
    trunks.setMatrixAt(i, spec.matrix);
    canopies.setMatrixAt(i, spec.matrix);
    colors[i * 3] = spec.rgb[0];
    colors[i * 3 + 1] = spec.rgb[1];
    colors[i * 3 + 2] = spec.rgb[2];
  }

  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  options.archetype.foliageGeo.setAttribute(
    'aCanopyColor',
    new THREE.InstancedBufferAttribute(colors, 3),
  );
  options.group.add(trunks);
  options.group.add(canopies);
}

export function createForestVegetation(options: {
  readonly preset: WaterfallPresetConfig;
  readonly forestTextures: ForestTextureSets;
  readonly anisotropy: number;
  readonly isSoftwareGpu: boolean;
  readonly isMobileGpu: boolean;
  readonly fallbackShadowTexture: THREE.Texture;
  readonly onStaticGeometryChanged: () => void;
  readonly onAssetLoaded?: (label: string) => void;
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
    map: options.forestTextures.forestBark.albedoMap,
    normalMap: options.forestTextures.forestBark.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: options.forestTextures.forestBark.rmaMap,
    color: new THREE.Color(0x46392e),
    roughness: 0.92,
    metalness: 0.02,
    envMapIntensity: 0.55,
  });
  disposables.materials.push(barkMat);

  const atlasSize = options.isSoftwareGpu || options.isMobileGpu ? 512 : 1024;
  const mapleTex = createAutumnBoughAtlasTexture({
    size: atlasSize,
    anisotropy: options.anisotropy,
  });
  const coniferTex = createConiferSprigAtlasTexture({
    size: atlasSize,
    anisotropy: options.anisotropy,
  });
  disposables.textures.push(mapleTex, coniferTex);

  const autumnCanopyUniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: 0.85 },
    uLeafTex: { value: mapleTex },
    uSunDirection: { value: sunDir },
    uSunShadowMap: { value: options.fallbackShadowTexture },
    uSunShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMapSize: { value: 1024 },
    uSubsurfaceStrength: { value: 1.25 },
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
    uWindStrength: { value: 0.38 },
    uLeafTex: { value: coniferTex },
    uSunDirection: { value: sunDir },
    uSunShadowMap: { value: options.fallbackShadowTexture },
    uSunShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMapSize: { value: 1024 },
    uSubsurfaceStrength: { value: 0.35 },
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
    alphaTest: 0.32,
    side: THREE.DoubleSide,
  });
  const coniferDepthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: coniferTex,
    alphaTest: 0.32,
    side: THREE.DoubleSide,
  });
  disposables.materials.push(autumnCanopyMat, coniferCanopyMat, autumnDepthMat, coniferDepthMat);

  const heroMapleArchetype = createDeciduousArchetype({
    seed: 91237,
    leanX: 0.08,
    crownSpread: 0.36,
    lobeCount: 7,
    trunkRadius: 0.028,
  });
  const leaningVineArchetype = createDeciduousArchetype({
    seed: 51823,
    leanX: 0.28,
    crownSpread: 0.34,
    lobeCount: 6,
    trunkRadius: 0.022,
  });
  const midAlderArchetype = createDeciduousArchetype({
    seed: 73911,
    leanX: -0.1,
    crownSpread: 0.31,
    lobeCount: 6,
    trunkRadius: 0.025,
  });
  const douglasFirArchetype = createDouglasFirArchetype(44209);

  disposables.geometries.push(
    heroMapleArchetype.woodGeo,
    heroMapleArchetype.foliageGeo,
    leaningVineArchetype.woodGeo,
    leaningVineArchetype.foliageGeo,
    midAlderArchetype.woodGeo,
    midAlderArchetype.foliageGeo,
    douglasFirArchetype.woodGeo,
    douglasFirArchetype.foliageGeo,
  );

  const dummy = new THREE.Object3D();
  const heroMapleSpecs: TreeInstanceSpec[] = [];
  const leaningVineSpecs: TreeInstanceSpec[] = [];
  const midAlderSpecs: TreeInstanceSpec[] = [];

  interface HeroPlacement {
    readonly x: number;
    readonly z: number;
    readonly scale: number;
    readonly yaw: number;
    readonly rgb: readonly [number, number, number];
  }

  const iconicHeroMaples: readonly HeroPlacement[] = [
    { x: -13.2, z: -13.6, scale: 16.5, yaw: 0.5, rgb: [1.0, 0.78, 0.04] },
    { x: -17.4, z: -15.2, scale: 19.2, yaw: 2.1, rgb: [1.0, 0.54, 0.03] },
    { x: 11.2, z: -13.4, scale: 19.6, yaw: 3.4, rgb: [1.0, 0.72, 0.04] },
    { x: 16.0, z: -15.6, scale: 18.2, yaw: 1.2, rgb: [0.96, 0.42, 0.03] },
    { x: -19.2, z: -4.8, scale: 15.6, yaw: 4.5, rgb: [0.98, 0.46, 0.04] },
    { x: 18.4, z: -3.2, scale: 16.2, yaw: 5.1, rgb: [0.96, 0.76, 0.05] },
  ];

  for (const spec of iconicHeroMaples) {
    const gy = computeForestCanyonTerrainHeight({ x: spec.x, z: spec.z });
    dummy.position.set(spec.x, gy - 0.9, spec.z);
    dummy.rotation.set((rand() - 0.5) * 0.06, spec.yaw, (rand() - 0.5) * 0.06);
    dummy.scale.set(spec.scale, spec.scale, spec.scale);
    dummy.updateMatrix();
    heroMapleSpecs.push({ matrix: dummy.matrix.clone(), rgb: spec.rgb });
  }

  const leaningGorgeMaples: readonly HeroPlacement[] = [
    { x: -10.8, z: -8.6, scale: 10.8, yaw: 0.15, rgb: [1.0, 0.72, 0.04] },
    { x: 10.6, z: -8.8, scale: 11.2, yaw: Math.PI - 0.2, rgb: [0.98, 0.68, 0.04] },
    { x: -12.6, z: -1.4, scale: 11.6, yaw: 0.35, rgb: [0.96, 0.48, 0.04] },
    { x: 12.2, z: 0.8, scale: 10.8, yaw: Math.PI + 0.25, rgb: [0.84, 0.78, 0.08] },
    { x: -14.2, z: 7.4, scale: 11.8, yaw: 0.25, rgb: [0.98, 0.58, 0.04] },
    { x: 13.8, z: 8.6, scale: 11.4, yaw: Math.PI - 0.3, rgb: [0.94, 0.72, 0.06] },
  ];

  for (const spec of leaningGorgeMaples) {
    const gy = computeForestCanyonTerrainHeight({ x: spec.x, z: spec.z });
    dummy.position.set(spec.x, gy - 0.8, spec.z);
    dummy.rotation.set((rand() - 0.5) * 0.1, spec.yaw, (rand() - 0.5) * 0.1);
    dummy.scale.set(spec.scale, spec.scale, spec.scale);
    dummy.updateMatrix();
    leaningVineSpecs.push({ matrix: dummy.matrix.clone(), rgb: spec.rgb });
  }

  const deciduousTotal = options.isSoftwareGpu ? 46 : 86;
  for (
    let attempt = 0;
    attempt < deciduousTotal * 8 &&
    heroMapleSpecs.length + leaningVineSpecs.length + midAlderSpecs.length < deciduousTotal;
    attempt++
  ) {
    const side = attempt % 2 === 0 ? -1 : 1;
    const x = side * (12.0 + rand() * 38.0);
    const z = -22 + rand() * 58.0;

    if (Math.hypot(x - 8.6, z - 46.8) < 16.5) {
      continue;
    }

    const riverCenter = computeForestRiverCenterX(z);
    if (Math.abs(x - riverCenter) < 10.8 && z > computeForestEscarpmentZ(x)) {
      continue;
    }

    const y = computeForestCanyonTerrainHeight({ x, z });
    if (y < 3.5 || y > 38) {
      continue;
    }
    const slope = computeForestSlope({ x, z });
    if (slope > 1.15) {
      continue;
    }

    const scale = 11.0 + rand() * 8.5;
    dummy.position.set(x, y - 0.85, z);
    dummy.rotation.set((rand() - 0.5) * 0.08, rand() * Math.PI * 2, (rand() - 0.5) * 0.08);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();

    const swatch = AUTUMN_CANOPY_PALETTE[Math.floor(rand() * AUTUMN_CANOPY_PALETTE.length)] ?? [
      0.98, 0.62, 0.04,
    ];
    const jitter = 0.88 + rand() * 0.22;
    const rgb: readonly [number, number, number] = [
      swatch[0] * jitter,
      swatch[1] * jitter,
      swatch[2] * jitter,
    ];

    const bucketRoll = attempt % 3;
    if (bucketRoll === 0) {
      heroMapleSpecs.push({ matrix: dummy.matrix.clone(), rgb });
    } else if (bucketRoll === 1) {
      leaningVineSpecs.push({ matrix: dummy.matrix.clone(), rgb });
    } else {
      midAlderSpecs.push({ matrix: dummy.matrix.clone(), rgb });
    }
  }

  addInstancedArchetype({
    archetype: heroMapleArchetype,
    specs: heroMapleSpecs,
    barkMat,
    canopyMat: autumnCanopyMat,
    depthMat: autumnDepthMat,
    group,
  });
  addInstancedArchetype({
    archetype: leaningVineArchetype,
    specs: leaningVineSpecs,
    barkMat,
    canopyMat: autumnCanopyMat,
    depthMat: autumnDepthMat,
    group,
  });
  addInstancedArchetype({
    archetype: midAlderArchetype,
    specs: midAlderSpecs,
    barkMat,
    canopyMat: autumnCanopyMat,
    depthMat: autumnDepthMat,
    group,
  });

  const coniferTarget = options.isSoftwareGpu ? 64 : 132;
  const coniferSpecs: TreeInstanceSpec[] = [];

  const skyNotchRimXs = [-14, -10.5, -7.2, -4.4, 3.8, 6.8, 10.2, 13.8, -18, 18];
  for (const rx of skyNotchRimXs) {
    const rz = -21.5 - rand() * 14.0;
    const ry = computeForestCanyonTerrainHeight({ x: rx, z: rz });
    const h = 22.0 + rand() * 11.0;
    dummy.position.set(rx, ry - 1.2, rz);
    dummy.rotation.set((rand() - 0.5) * 0.04, rand() * Math.PI * 2, (rand() - 0.5) * 0.04);
    dummy.scale.set(h, h, h);
    dummy.updateMatrix();
    const shade = 0.55 + rand() * 0.35;
    coniferSpecs.push({
      matrix: dummy.matrix.clone(),
      rgb: [0.36 * shade, 0.58 * shade, 0.38 * shade],
    });
  }

  for (
    let attempt = 0;
    attempt < coniferTarget * 7 && coniferSpecs.length < coniferTarget;
    attempt++
  ) {
    const isCrestRim = attempt % 4 !== 0;
    const x = isCrestRim ? (rand() - 0.5) * 96.0 : (rand() > 0.5 ? 1 : -1) * (20.0 + rand() * 44.0);
    const z = isCrestRim ? -21.5 - rand() * 48.0 : -18.0 + rand() * 48.0;

    if (Math.abs(x) < 2.6 && z > -26.0) {
      continue;
    }
    if (Math.hypot(x - 8.6, z - 46.8) < 19.0) {
      continue;
    }

    const y = computeForestCanyonTerrainHeight({ x, z });
    if (y < 18.0 || y > 62.0) {
      continue;
    }

    const slope = computeForestSlope({ x, z });
    if (slope > 1.15) {
      continue;
    }

    const h = 20.0 + rand() * 16.0;
    dummy.position.set(x, y - 1.2, z);
    dummy.rotation.set((rand() - 0.5) * 0.05, rand() * Math.PI * 2, (rand() - 0.5) * 0.05);
    dummy.scale.set(h, h, h);
    dummy.updateMatrix();

    const shade = 0.48 + rand() * 0.42;
    coniferSpecs.push({
      matrix: dummy.matrix.clone(),
      rgb: [0.34 * shade, 0.56 * shade, 0.36 * shade],
    });
  }

  addInstancedArchetype({
    archetype: douglasFirArchetype,
    specs: coniferSpecs,
    barkMat,
    canopyMat: coniferCanopyMat,
    depthMat: coniferDepthMat,
    group,
  });

  const shrubPlacements: PlantPlacement[] = [];
  const foregroundShrubClusters = [
    { x: -11.4, z: 24.5, s: 2.9, hex: 0xffbe24 },
    { x: -9.8, z: 28.4, s: 2.8, hex: 0xf27d18 },
    { x: 13.6, z: 25.4, s: 3.1, hex: 0x9ab822 },
    { x: 12.0, z: 21.8, s: 3.2, hex: 0xffbe24 },
    { x: 11.2, z: 16.4, s: 2.8, hex: 0x3b7622 },
    { x: -10.6, z: 18.6, s: 2.9, hex: 0xd84814 },
    { x: -10.2, z: 12.2, s: 3.0, hex: 0x265418 },
    { x: -8.8, z: 4.5, s: 2.6, hex: 0xe89e1c },
    { x: 8.8, z: 3.8, s: 2.7, hex: 0x3b7622 },
    { x: -8.6, z: -7.5, s: 2.5, hex: 0xf27d18 },
    { x: 8.4, z: -7.2, s: 2.6, hex: 0x9ab822 },
    { x: -10.2, z: -11.4, s: 2.8, hex: 0xffbe24 },
    { x: 10.0, z: -11.2, s: 2.9, hex: 0x3b7622 },
    { x: 14.5, z: 31.5, s: 3.2, hex: 0xffbe24 },
    { x: 11.5, z: 33.0, s: 2.9, hex: 0x9ab822 },
    { x: -8.5, z: 32.5, s: 3.0, hex: 0xf27d18 },
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

  const shrubTarget = options.isSoftwareGpu ? 105 : 220;
  for (
    let attempt = 0;
    attempt < shrubTarget * 7 && shrubPlacements.length < shrubTarget;
    attempt++
  ) {
    const x = (rand() - 0.5) * 60.0;
    const z = -18.0 + rand() * 58.0;

    if (Math.hypot(x, z - FOREST_WATERFALL_CONFIG.plungeCenterZ) < 5.6) {
      continue;
    }
    const riverCenter = computeForestRiverCenterX(z);
    const riverHalfWidth =
      5.8 +
      Math.exp(-Math.pow((z - (FOREST_WATERFALL_CONFIG.plungeCenterZ + 4.5)) / 9.2, 2)) * 4.8 +
      smoothstep({ edge0: 12, edge1: 86, value: z }) * 8.6;
    if (Math.abs(x - riverCenter) < riverHalfWidth - 0.3 && z > computeForestEscarpmentZ(x)) {
      continue;
    }

    const y = computeForestCanyonTerrainHeight({ x, z });
    if (y < 0.25 || y > 26.0) {
      continue;
    }
    const slope = computeForestSlope({ x, z });
    if (slope > 1.75) {
      continue;
    }

    const s = 1.25 + rand() * 1.95;
    dummy.position.set(x, y - 0.18, z);
    dummy.rotation.set((rand() - 0.5) * 0.34, rand() * Math.PI * 2, (rand() - 0.5) * 0.34);
    dummy.scale.set(s, s * (0.8 + rand() * 0.4), s);
    dummy.updateMatrix();

    const hex = SHRUB_AUTUMN_PALETTE[Math.floor(rand() * SHRUB_AUTUMN_PALETTE.length)] ?? 0x3b7622;
    shrubPlacements.push({
      matrix: dummy.matrix.clone(),
      color: new THREE.Color(hex),
    });
  }

  const fernPlacements: PlantPlacement[] = [];
  const fernTarget = options.isSoftwareGpu ? 180 : 480;
  for (let attempt = 0; attempt < fernTarget * 7 && fernPlacements.length < fernTarget; attempt++) {
    const x = (rand() - 0.5) * 62.0;
    const z = -18.0 + rand() * 62.0;

    if (Math.hypot(x * 0.8, z - FOREST_WATERFALL_CONFIG.plungeCenterZ) < 4.8) {
      continue;
    }
    const riverCenter = computeForestRiverCenterX(z);
    const riverHalfWidth =
      5.8 +
      Math.exp(-Math.pow((z - (FOREST_WATERFALL_CONFIG.plungeCenterZ + 4.5)) / 9.2, 2)) * 4.8 +
      smoothstep({ edge0: 12, edge1: 86, value: z }) * 8.6;
    if (Math.abs(x - riverCenter) < riverHalfWidth && z > computeForestEscarpmentZ(x)) {
      continue;
    }

    const y = computeForestCanyonTerrainHeight({ x, z });
    if (y < 0.25 || y > 25.0) {
      continue;
    }
    const slope = computeForestSlope({ x, z });
    if (slope > 2.35) {
      continue;
    }

    const wallOutTilt = slope > 0.75 ? Math.sign(-x) * Math.min(0.62, slope * 0.28) : 0;
    const s = 0.9 + rand() * 1.5;
    dummy.position.set(x, y - 0.1, z);
    dummy.rotation.set(
      (rand() - 0.5) * 0.32,
      rand() * Math.PI * 2,
      wallOutTilt + (rand() - 0.5) * 0.24,
    );
    dummy.scale.set(s, s * (0.85 + rand() * 0.38), s);
    dummy.updateMatrix();

    const hex = FERN_PALETTE[Math.floor(rand() * FERN_PALETTE.length)] ?? 0x4c852d;
    fernPlacements.push({
      matrix: dummy.matrix.clone(),
      color: new THREE.Color(hex),
    });
  }

  const grassTuftGeo = createForestGrassTuftGeometry();
  disposables.geometries.push(grassTuftGeo);
  const forestGrassUniforms = {
    uTime: { value: 0 },
    uPlungeCenter: { value: new THREE.Vector2(0, FOREST_WATERFALL_CONFIG.plungeCenterZ) },
    uSunDirection: { value: sunDir },
    uSunShadowMap: { value: options.fallbackShadowTexture },
    uSunShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMapSize: { value: 1024 },
    uFogCool: { value: fogCool },
    uFogWarm: { value: fogWarm },
  };
  const forestGrassMat = new THREE.ShaderMaterial({
    vertexShader: FOREST_GRASS_VERTEX_SHADER,
    fragmentShader: FOREST_GRASS_FRAGMENT_SHADER,
    uniforms: forestGrassUniforms,
    side: THREE.DoubleSide,
  });
  disposables.materials.push(forestGrassMat);

  const grassTarget = options.isSoftwareGpu ? 2000 : options.isMobileGpu ? 3400 : 5800;
  const grassMatrices: THREE.Matrix4[] = [];
  const grassTints: number[] = [];

  for (
    let attempt = 0;
    attempt < grassTarget * 4 && grassMatrices.length < grassTarget;
    attempt++
  ) {
    const x = (rand() - 0.5) * 78.0;
    const z = -22.0 + rand() * 68.0;

    if (Math.hypot(x * 0.78, z - FOREST_WATERFALL_CONFIG.plungeCenterZ) < 5.2) {
      continue;
    }
    const riverCenter = computeForestRiverCenterX(z);
    const riverHalfWidth =
      5.8 +
      Math.exp(-Math.pow((z - (FOREST_WATERFALL_CONFIG.plungeCenterZ + 4.5)) / 9.2, 2)) * 4.8 +
      smoothstep({ edge0: 12, edge1: 86, value: z }) * 8.6;
    if (Math.abs(x - riverCenter) < riverHalfWidth + 0.15 && z > computeForestEscarpmentZ(x)) {
      continue;
    }

    const y = computeForestCanyonTerrainHeight({ x, z });
    if (y < 0.28 || y > 29.0) {
      continue;
    }
    const slope = computeForestSlope({ x, z });
    if (slope > 1.45) {
      continue;
    }

    const scale = 0.6 + rand() * 1.05;
    dummy.position.set(x, y - 0.06, z);
    dummy.rotation.set((rand() - 0.5) * 0.32, rand() * Math.PI * 2, (rand() - 0.5) * 0.32);
    dummy.scale.set(scale, scale * (0.78 + rand() * 0.42), scale);
    dummy.updateMatrix();
    grassMatrices.push(dummy.matrix.clone());

    const warmth = rand();
    if (warmth > 0.85) {
      grassTints.push(1.32 + rand() * 0.28, 0.96 + rand() * 0.22, 0.36 + rand() * 0.14);
    } else if (warmth > 0.45) {
      grassTints.push(0.74 + rand() * 0.26, 1.02 + rand() * 0.24, 0.46 + rand() * 0.16);
    } else {
      grassTints.push(0.46 + rand() * 0.2, 0.86 + rand() * 0.22, 0.42 + rand() * 0.14);
    }
  }

  const grassInstanced = new THREE.InstancedMesh(
    grassTuftGeo,
    forestGrassMat,
    grassMatrices.length,
  );
  grassInstanced.frustumCulled = false;
  for (let i = 0; i < grassMatrices.length; i++) {
    const m = grassMatrices[i];
    if (m) {
      grassInstanced.setMatrixAt(i, m);
    }
  }
  grassInstanced.instanceMatrix.needsUpdate = true;
  grassTuftGeo.setAttribute(
    'aBladeTint',
    new THREE.InstancedBufferAttribute(new Float32Array(grassTints), 3),
  );
  group.add(grassInstanced);

  const isDisposed = () => disposed;
  const foliageLoadPromises = [
    loadPhotogrammetryFoliageSet({
      modelUrl: '/models/shrub_02/shrub_02_1k.gltf',
      alphaUrl: '/models/shrub_02/textures/shrub_02_alpha_1k.png',
      label: 'Loading 3D autumn shrubs',
      placements: shrubPlacements,
      group,
      anisotropy: options.anisotropy,
      sunDir,
      isAutumnHueRemap: true,
      isDisposed,
      disposables,
      onLoaded: options.onStaticGeometryChanged,
      onAssetLoaded: options.onAssetLoaded,
    }),
    loadPhotogrammetryFoliageSet({
      modelUrl: '/models/fern_02/fern_02_1k.gltf',
      alphaUrl: '/models/fern_02/textures/fern_02_alpha_1k.png',
      label: 'Loading 3D sword ferns',
      placements: fernPlacements,
      group,
      anisotropy: options.anisotropy,
      sunDir,
      isAutumnHueRemap: false,
      isDisposed,
      disposables,
      onLoaded: options.onStaticGeometryChanged,
      onAssetLoaded: options.onAssetLoaded,
    }),
  ];

  const ready = Promise.all(foliageLoadPromises).then(() => undefined);

  return {
    group,
    ready,
    update: (elapsedSeconds: number) => {
      autumnCanopyUniforms.uTime.value = elapsedSeconds;
      coniferCanopyUniforms.uTime.value = elapsedSeconds;
      forestGrassUniforms.uTime.value = elapsedSeconds;
    },
    setShadowUniforms: (shadowOptions) => {
      autumnCanopyUniforms.uSunShadowMap.value = shadowOptions.shadowMap;
      autumnCanopyUniforms.uSunShadowMatrix.value.copy(shadowOptions.shadowMatrix);
      autumnCanopyUniforms.uShadowMapSize.value = shadowOptions.shadowMapSize;
      coniferCanopyUniforms.uSunShadowMap.value = shadowOptions.shadowMap;
      coniferCanopyUniforms.uSunShadowMatrix.value.copy(shadowOptions.shadowMatrix);
      coniferCanopyUniforms.uShadowMapSize.value = shadowOptions.shadowMapSize;
      forestGrassUniforms.uSunShadowMap.value = shadowOptions.shadowMap;
      forestGrassUniforms.uSunShadowMatrix.value.copy(shadowOptions.shadowMatrix);
      forestGrassUniforms.uShadowMapSize.value = shadowOptions.shadowMapSize;
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
