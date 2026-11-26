import { SHARED_ATMOS_AND_SHADOW_GLSL } from './sharedShaderGlsl';

export const WATERFALL_CURTAIN_VERTEX_SHADER = /* glsl */ `
attribute float aChuteMask;

uniform float uTime;
uniform float uTurbulence;
uniform float uSpeed;
uniform float uPhaseOffset;
uniform sampler2D uFoamTex;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vChuteMask;

float gravityTau(float progress) {
  return sqrt(clamp(progress, 0.0, 1.0) * 0.92 + 0.08) - sqrt(0.08);
}

void main() {
  vUv = uv;
  vChuteMask = aChuteMask;
  vec3 pos = position;

  float fallProgress = clamp(1.0 - uv.y, 0.0, 1.0);
  float tau = gravityTau(fallProgress);

  float flowV1 = tau * 1.9 - uTime * uSpeed * 0.52 + uPhaseOffset;
  float flowV2 = tau * 3.2 - uTime * uSpeed * 0.74 - uPhaseOffset * 0.6;

  float billowA = texture2D(uFoamTex, vec2(uv.x * 1.55 + uPhaseOffset * 0.13, flowV1)).r;
  float billowB = texture2D(uFoamTex, vec2(uv.x * 2.85 - uPhaseOffset * 0.21, flowV2)).r;
  float surgeHeight = (billowA * 0.62 + billowB * 0.38) - 0.48;

  float edgeHold = smoothstep(0.0, 0.14, uv.x) * smoothstep(1.0, 0.86, uv.x);
  float displacementMask = smoothstep(0.02, 0.20, fallProgress) * (0.35 + 0.65 * fallProgress) * edgeHold;
  pos += normal * surgeHeight * uTurbulence * displacementMask;

  vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const WATERFALL_CURTAIN_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uSpeed;
uniform float uPhaseOffset;
uniform float uCoreDensity;
uniform float uHorizontalRepeat;
uniform vec3 uSunDirection;
uniform sampler2D uNoiseTex;
uniform sampler2D uFoamTex;
uniform sampler2D tSceneColor;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float uUseDepthPass;
uniform sampler2D uSunShadowMap;
uniform mat4 uSunShadowMatrix;
uniform float uShadowMapSize;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vChuteMask;

${SHARED_ATMOS_AND_SHADOW_GLSL}

float gravityTau(float progress) {
  return sqrt(clamp(progress, 0.0, 1.0) * 0.92 + 0.08) - sqrt(0.08);
}

float hashChevron(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float waterRocketChevrons(vec2 uv, float tau, float time) {
  vec2 scaled = vec2(uv.x * 13.0, tau * 5.2 - time * uSpeed * 1.15);
  vec2 cell = floor(scaled);
  vec2 local = fract(scaled);
  float acc = 0.0;

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 neighbor = vec2(float(dx), float(dy));
      vec2 cid = cell + neighbor;
      float rnd = hashChevron(cid);
      vec2 center = neighbor + vec2(0.2 + rnd * 0.6, 0.25 + fract(rnd * 7.3) * 0.55);
      vec2 delta = local - center;
      float vWake = delta.y + pow(abs(delta.x) * 1.65, 1.4);
      float packet = exp(-abs(delta.x) * 4.4) * smoothstep(-0.85, 0.02, vWake) * (1.0 - smoothstep(0.02, 0.28, vWake));
      acc = max(acc, packet * (0.55 + 0.45 * fract(rnd * 13.1)));
    }
  }
  return acc;
}

vec4 sampleWaterfallField(vec2 baseUv, float tau, float time) {
  float flowA = tau * 2.35 - time * uSpeed * 0.50 + uPhaseOffset;
  float flowB = tau * 4.15 - time * uSpeed * 0.78 - uPhaseOffset * 0.73;

  vec2 warpUv = vec2(baseUv.x * 0.65 + uPhaseOffset * 0.19, tau * 1.25 - time * uSpeed * 0.28);
  vec2 warp = (texture2D(uNoiseTex, warpUv).rg - 0.5) * 0.04;

  vec4 layerA = texture2D(uFoamTex, vec2(baseUv.x * uHorizontalRepeat + warp.x, flowA + warp.y));
  vec4 layerB = texture2D(
    uFoamTex,
    vec2(baseUv.x * (uHorizontalRepeat * 1.85) - warp.x * 1.25 + 0.37, flowB)
  );
  vec4 microStrands = texture2D(
    uFoamTex,
    vec2(baseUv.x * (uHorizontalRepeat * 4.2) + warp.x * 0.6, tau * 6.8 - time * uSpeed * 1.28)
  );

  float chevron = waterRocketChevrons(baseUv, tau, time);
  float plume = clamp(layerA.r * 0.48 + layerB.r * 0.32 + chevron * 0.42, 0.0, 1.0);
  float filaments = clamp(max(layerA.g, layerB.g * 0.9) * 0.72 + microStrands.g * 0.45, 0.0, 1.0);
  float spray = clamp(microStrands.b * 0.65 + layerB.b * 0.45, 0.0, 1.0);
  float edgeMask = layerA.a * 0.58 + layerB.a * 0.42;
  return vec4(plume, filaments, spray, edgeMask);
}

void main() {
  vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  float depthFade = 1.0;

  if (uUseDepthPass > 0.5) {
    float rawSceneDepth = texture2D(tSceneDepth, screenUv).r;
    if (gl_FragCoord.z > rawSceneDepth + 0.0002) {
      discard;
    }
    float sceneZ = linearizeDepth(rawSceneDepth, uCameraNear, uCameraFar);
    float fragZ = linearizeDepth(gl_FragCoord.z, uCameraNear, uCameraFar);
    depthFade = smoothstep(0.0, 1.15, sceneZ - fragZ);
  }

  float fallProgress = clamp(1.0 - vUv.y, 0.0, 1.0);
  float tau = gravityTau(fallProgress);

  vec4 field = sampleWaterfallField(vUv, tau, uTime);
  float epsU = 0.006;
  float epsT = 0.009;
  vec4 fieldRight = sampleWaterfallField(vUv + vec2(epsU, 0.0), tau, uTime);
  vec4 fieldDown = sampleWaterfallField(vUv, tau + epsT, uTime);

  float heightC = field.r * 0.68 + field.g * 0.32;
  float heightR = fieldRight.r * 0.68 + fieldRight.g * 0.32;
  float heightD = fieldDown.r * 0.68 + fieldDown.g * 0.32;

  vec3 baseNormal = normalize(vWorldNormal);
  vec3 refUp = abs(baseNormal.y) > 0.92 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0);
  vec3 tangentRight = normalize(cross(refUp, baseNormal));
  vec3 tangentDown = normalize(cross(tangentRight, baseNormal));

  float slopeX = (heightC - heightR) * 4.8;
  float slopeY = (heightC - heightD) * 4.4;
  vec3 foamNormal = normalize(baseNormal + tangentRight * slopeX + tangentDown * slopeY);

  float edgeDist = min(vUv.x, 1.0 - vUv.x);
  float edgeSignal = edgeDist + (field.a - 0.48) * 0.19 + (field.g - 0.5) * 0.09;
  float edgeWidth = max(fwidth(edgeSignal) * 1.4, 0.025);
  float raggedEdge = smoothstep(0.035 - edgeWidth, 0.145 + edgeWidth, edgeSignal);

  float topFeather = smoothstep(0.0, 0.05, fallProgress);
  float bottomPlunge = smoothstep(0.78, 1.0, fallProgress);

  float aeration = smoothstep(0.04, 0.42, fallProgress + (field.r - 0.4) * 0.25);
  float plumeDensity = clamp(
    (field.r * 0.58 + field.g * 0.48 + field.b * 0.24) * (0.58 + 0.54 * vChuteMask),
    0.0,
    1.25
  );

  float strandSharp = max(fwidth(plumeDensity) * 1.35, 0.04);
  float veilCoverage = smoothstep(0.32 - strandSharp, 0.68 + strandSharp, plumeDensity + bottomPlunge * 0.28);
  float coreCoverage = smoothstep(0.10, 0.50, plumeDensity + 0.28 + (1.0 - aeration) * 0.32);

  float alpha = mix(veilCoverage, coreCoverage, uCoreDensity);
  alpha *= raggedEdge * (0.35 + 0.65 * topFeather) * uOpacity * (0.35 + 0.65 * depthFade);
  alpha = clamp(alpha, 0.0, 0.96);

  if (alpha < 0.02) {
    discard;
  }

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDirection);
  vec3 skyDir = vec3(0.0, 1.0, 0.0);

  float sunShadow = sampleSunShadowPcf(
    vWorldPos,
    baseNormal,
    sunDir,
    uSunShadowMap,
    uSunShadowMatrix,
    uShadowMapSize
  );

  float sunNdotL = clamp(dot(foamNormal, sunDir) * 0.65 + 0.35, 0.0, 1.0) * sunShadow;
  float skyDiffuse = clamp(dot(foamNormal, skyDir) * 0.55 + 0.45, 0.0, 1.0);
  float fresnel = 0.025 + 0.975 * pow(1.0 - clamp(dot(foamNormal, viewDir), 0.0, 1.0), 4.6);

  float cosTheta = dot(-viewDir, sunDir);
  float g1 = 0.68;
  float hgForward = (1.0 - g1 * g1) / (4.0 * 3.14159 * pow(1.0 + g1 * g1 - 2.0 * g1 * cosTheta, 1.5));
  float g2 = -0.25;
  float hgBack = (1.0 - g2 * g2) / (4.0 * 3.14159 * pow(1.0 + g2 * g2 - 2.0 * g2 * cosTheta, 1.5));
  float phaseScatter = clamp((hgForward * 0.72 + hgBack * 0.28) * 0.65, 0.0, 1.8) * sunShadow;

  vec3 halfVec = normalize(sunDir + viewDir);
  float liquidSpec = pow(max(dot(foamNormal, halfVec), 0.0), 140.0) * 2.2 * sunShadow;

  vec3 refractedBg = vec3(0.015, 0.028, 0.038);
  if (uUseDepthPass > 0.5) {
    vec2 refrUv = clamp(screenUv + vec2(slopeX, slopeY) * 0.012, vec2(0.002), vec2(0.998));
    refractedBg = texture2D(tSceneColor, refrUv).rgb;
  }

  float waterThickness = 0.75 + vChuteMask * 1.35;
  vec3 absorption = exp(-waterThickness * vec3(0.65, 0.26, 0.19));
  vec3 skyReflectLinear = mix(vec3(0.04, 0.065, 0.095), vec3(0.32, 0.20, 0.11), pow(max(dot(reflect(-viewDir, foamNormal), sunDir), 0.0), 3.0));
  vec3 liquidColor = refractedBg * absorption + vec3(0.014, 0.036, 0.048) * (1.0 - absorption);
  liquidColor = mix(liquidColor, skyReflectLinear, clamp(fresnel * 0.85, 0.0, 0.88));
  liquidColor += vec3(1.15, 0.72, 0.38) * liquidSpec;

  vec3 ambientSkyLinear = vec3(0.11, 0.15, 0.20) * skyDiffuse;
  vec3 directSunLinear = vec3(1.25, 0.78, 0.44) * sunNdotL;
  vec3 scatterLinear = vec3(1.35, 0.74, 0.34) * phaseScatter * (0.35 + 0.65 * (1.0 - alpha));

  float selfOcclude = clamp(0.45 + heightC * 0.65, 0.38, 1.08);
  vec3 foamAlbedo = vec3(0.84, 0.88, 0.91) * selfOcclude;
  vec3 foamLit = foamAlbedo * (ambientSkyLinear + directSunLinear * 0.88) + scatterLinear * 0.26;

  float foamMix = clamp(
    smoothstep(0.14, 0.62, plumeDensity) * (0.28 + 0.72 * aeration) + bottomPlunge * 0.42,
    0.0,
    0.96
  );

  vec3 color = mix(liquidColor, foamLit, foamMix);
  color = applyLinearHeightFog(color, vWorldPos, cameraPosition, sunDir);

  gl_FragColor = vec4(color, alpha);
}
`;
