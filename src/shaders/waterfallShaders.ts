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

  float flowV1 = tau * 1.85 - uTime * uSpeed * 0.56 + uPhaseOffset;
  float flowV2 = tau * 3.10 - uTime * uSpeed * 0.78 - uPhaseOffset * 0.6;

  float billowA = texture2D(uFoamTex, vec2(uv.x * 1.45 + uPhaseOffset * 0.13, flowV1)).r;
  float billowB = texture2D(uFoamTex, vec2(uv.x * 2.75 - uPhaseOffset * 0.21, flowV2)).r;
  float surgeHeight = (billowA * 0.62 + billowB * 0.38) - 0.48;

  float edgeHold = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x);
  float displacementMask = smoothstep(0.02, 0.18, fallProgress) * (0.35 + 0.65 * fallProgress) * edgeHold;
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

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vChuteMask;

float gravityTau(float progress) {
  return sqrt(clamp(progress, 0.0, 1.0) * 0.92 + 0.08) - sqrt(0.08);
}

vec4 sampleWaterfallField(vec2 baseUv, float tau, float time) {
  float flowA = tau * 2.25 - time * uSpeed * 0.52 + uPhaseOffset;
  float flowB = tau * 3.85 - time * uSpeed * 0.76 - uPhaseOffset * 0.73;

  vec2 warpUv = vec2(baseUv.x * 0.65 + uPhaseOffset * 0.19, tau * 1.2 - time * uSpeed * 0.30);
  vec2 warp = (texture2D(uNoiseTex, warpUv).rg - 0.5) * 0.042;

  vec4 layerA = texture2D(uFoamTex, vec2(baseUv.x * uHorizontalRepeat + warp.x, flowA + warp.y));
  vec4 layerB = texture2D(
    uFoamTex,
    vec2(baseUv.x * (uHorizontalRepeat * 1.72) - warp.x * 1.25 + 0.37, flowB)
  );

  float plume = layerA.r * 0.58 + layerB.r * 0.42;
  float filaments = max(layerA.g, layerB.g * 0.92);
  float spray = layerA.b * 0.5 + layerB.b * 0.5;
  float edgeMask = layerA.a * 0.6 + layerB.a * 0.4;
  return vec4(plume, filaments, spray, edgeMask);
}

void main() {
  float fallProgress = clamp(1.0 - vUv.y, 0.0, 1.0);
  float tau = gravityTau(fallProgress);

  vec4 field = sampleWaterfallField(vUv, tau, uTime);
  float epsU = 0.008;
  float epsT = 0.011;
  vec4 fieldRight = sampleWaterfallField(vUv + vec2(epsU, 0.0), tau, uTime);
  vec4 fieldDown = sampleWaterfallField(vUv, tau + epsT, uTime);

  float heightC = field.r * 0.7 + field.g * 0.3;
  float heightR = fieldRight.r * 0.7 + fieldRight.g * 0.3;
  float heightD = fieldDown.r * 0.7 + fieldDown.g * 0.3;

  vec3 baseNormal = normalize(vWorldNormal);
  vec3 refUp = abs(baseNormal.y) > 0.92 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0);
  vec3 tangentRight = normalize(cross(refUp, baseNormal));
  vec3 tangentDown = normalize(cross(tangentRight, baseNormal));

  float slopeX = (heightC - heightR) * 4.4;
  float slopeY = (heightC - heightD) * 4.2;
  vec3 foamNormal = normalize(baseNormal + tangentRight * slopeX + tangentDown * slopeY);

  float edgeDist = min(vUv.x, 1.0 - vUv.x);
  float raggedEdge = smoothstep(0.015, 0.16, edgeDist + (field.a - 0.46) * 0.14);
  float topFeather = smoothstep(0.0, 0.045, fallProgress);
  float bottomPlunge = smoothstep(0.74, 1.0, fallProgress);

  float aerationGrowth = smoothstep(0.04, 0.42, fallProgress);
  float plumeDensity = clamp(
    (field.r * 0.62 + field.g * 0.48 + field.b * 0.22) * (0.62 + 0.52 * vChuteMask) *
      (0.55 + 0.55 * aerationGrowth),
    0.0,
    1.25
  );

  float alpha = mix(
    smoothstep(0.24, 0.78, plumeDensity + bottomPlunge * 0.35),
    smoothstep(0.08, 0.52, plumeDensity + 0.32),
    uCoreDensity
  );
  alpha *= raggedEdge * (0.35 + 0.65 * topFeather) * uOpacity;
  alpha = clamp(alpha + bottomPlunge * raggedEdge * 0.28 * uOpacity, 0.0, 0.98);

  if (alpha < 0.02) {
    discard;
  }

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDirection);
  vec3 skyDir = vec3(0.0, 1.0, 0.0);

  float sunDiffuse = clamp(dot(foamNormal, sunDir) * 0.55 + 0.45, 0.0, 1.0);
  float skyDiffuse = clamp(dot(foamNormal, skyDir) * 0.5 + 0.5, 0.0, 1.0);
  float fresnel = pow(1.0 - clamp(dot(foamNormal, viewDir), 0.0, 1.0), 3.4);
  float backScatter = pow(max(dot(-viewDir, sunDir), 0.0), 3.2);

  vec3 halfVec = normalize(sunDir + viewDir);
  float liquidSpec = pow(max(dot(foamNormal, halfVec), 0.0), 110.0) * 1.45;
  float skyReflSpec = pow(max(dot(foamNormal, normalize(skyDir + viewDir)), 0.0), 18.0) * 0.24;

  vec3 darkLiquidCore = vec3(0.075, 0.145, 0.185);
  vec3 midGlacialLiquid = vec3(0.18, 0.28, 0.35);
  vec3 shadowFoam = vec3(0.32, 0.40, 0.48);
  vec3 litFoam = vec3(0.84, 0.88, 0.92);
  vec3 warmSunFoam = vec3(1.04, 0.82, 0.60);

  float liquidMix = smoothstep(0.18, 0.62, plumeDensity);
  vec3 liquidColor = mix(darkLiquidCore, midGlacialLiquid, skyDiffuse);
  liquidColor += vec3(0.28, 0.36, 0.44) * fresnel * 0.65;
  liquidColor += vec3(1.05, 0.78, 0.52) * liquidSpec * (1.0 - liquidMix * 0.65);

  float selfShadow = clamp(0.42 + heightC * 0.68, 0.35, 1.05);
  float foamHighlight = smoothstep(0.38, 0.94, plumeDensity + bottomPlunge * 0.24);
  vec3 foamColor = mix(shadowFoam, litFoam, sunDiffuse * 0.72 + skyDiffuse * 0.28);
  foamColor *= selfShadow;
  foamColor = mix(foamColor, vec3(0.95, 0.96, 0.98), foamHighlight * sunDiffuse * 0.55);

  vec3 color = mix(liquidColor, foamColor, clamp(liquidMix * (0.45 + 0.55 * aerationGrowth) + bottomPlunge * 0.4, 0.0, 0.94));
  color += vec3(0.62, 0.74, 0.86) * skyReflSpec * (1.0 - foamHighlight * 0.5);

  float topSunCatch = smoothstep(6.0, 22.5, vWorldPos.y);
  float thinSprayMask = 1.0 - smoothstep(0.32, 0.88, alpha);
  float warmRimAmount = clamp(
    backScatter * (0.28 + thinSprayMask * 0.55) +
    fresnel * 0.32 +
    sunDiffuse * topSunCatch * 0.30,
    0.0,
    0.75
  );
  color = mix(color, warmSunFoam, warmRimAmount * 0.34);

  float crestWaterGloss = (1.0 - smoothstep(0.0, 0.16, fallProgress)) * (1.0 - foamHighlight * 0.65);
  color = mix(color, liquidColor * 0.88, crestWaterGloss * 0.55);

  float camDist = length(cameraPosition - vWorldPos);
  float fogAmount = 1.0 - exp(-pow(camDist * 0.0056, 2.0));
  vec3 fogColor = vec3(0.16, 0.20, 0.25);
  color = mix(color, fogColor, fogAmount * 0.62);

  gl_FragColor = vec4(color, alpha);
}
`;

export const PLUNGE_BOIL_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform sampler2D uFoamTex;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vBoilHeight;

void main() {
  vUv = uv;
  vec3 pos = position;

  float radial = length(uv - 0.5) * 2.0;
  float ringPeak = sin(clamp(radial, 0.0, 1.0) * 3.14159);
  float crownMask = smoothstep(1.0, 0.15, radial) * (0.45 + 0.55 * ringPeak);

  vec2 centered = uv - 0.5;
  float angle = atan(centered.y, centered.x);
  float boilA = texture2D(uFoamTex, vec2(angle * 0.45, radial * 1.1 - uTime * 0.58)).r;
  float boilB = texture2D(uFoamTex, vec2(pos.x * 0.14, pos.z * 0.14 - uTime * 0.45)).g;
  float lift = (boilA * 0.62 + boilB * 0.38) * crownMask * 1.85;

  pos.y += lift;
  vBoilHeight = lift;

  vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const PLUNGE_BOIL_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDirection;
uniform sampler2D uNoiseTex;
uniform sampler2D uFoamTex;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vBoilHeight;

void main() {
  vec2 centered = (vUv - 0.5) * 2.0;
  float dist = length(centered);
  if (dist > 1.0) {
    discard;
  }

  float angle = atan(centered.y, centered.x);
  vec2 radialDir = dist > 0.001 ? centered / dist : vec2(0.0, 1.0);

  vec2 radialUv = vec2(angle * 0.64, dist * 1.25 - uTime * 0.52);
  vec4 foamA = texture2D(uFoamTex, radialUv);
  vec4 foamB = texture2D(uFoamTex, centered * 0.9 - radialDir * uTime * 0.34);
  vec4 noiseSample = texture2D(uNoiseTex, centered * 0.85 - radialDir * uTime * 0.22);

  float density = clamp(foamA.r * 0.45 + foamB.g * 0.42 + noiseSample.g * 0.25 + vBoilHeight * 0.28, 0.0, 1.0);
  float edgeFade = 1.0 - smoothstep(0.42, 0.98, dist + (noiseSample.r - 0.5) * 0.34);
  float alpha = edgeFade * smoothstep(0.24, 0.78, density) * 0.86;

  if (alpha < 0.02) {
    discard;
  }

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDirection);
  float warmRim = pow(max(dot(-viewDir, sunDir), 0.0), 3.0) * 0.45 + 0.15;

  float shadowCrevice = clamp(0.48 + vBoilHeight * 0.42 + foamA.r * 0.25, 0.42, 1.0);
  vec3 deepFroth = vec3(0.30, 0.39, 0.47);
  vec3 brightFroth = vec3(0.86, 0.90, 0.93);
  vec3 warmGlow = vec3(1.0, 0.78, 0.56);

  vec3 color = mix(deepFroth, brightFroth, smoothstep(0.28, 0.86, density)) * shadowCrevice;
  color = mix(color, warmGlow, warmRim * 0.28 * smoothstep(0.35, 1.5, vBoilHeight));

  float camDist = length(cameraPosition - vWorldPos);
  float fogAmount = 1.0 - exp(-pow(camDist * 0.0056, 2.0));
  color = mix(color, vec3(0.16, 0.20, 0.25), fogAmount * 0.62);

  gl_FragColor = vec4(color, alpha);
}
`;
