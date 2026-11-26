import { SHARED_ATMOS_AND_SHADOW_GLSL } from './sharedShaderGlsl';

export const WATER_POOL_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform vec2 uPlungeCenter;
uniform sampler2D uNoiseTex;

varying vec3 vWorldPos;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec2 fromImpact = worldPosition.xz - uPlungeCenter;
  float dist = length(fromImpact);

  float radialWave = sin(dist * 2.8 - uTime * 4.2) * exp(-dist * 0.12) * 0.11;
  float currentRipple = (texture2D(uNoiseTex, worldPosition.xz * 0.03 - vec2(0.0, uTime * 0.045)).r - 0.5) * 0.08;

  worldPosition.y += radialWave + currentRipple;
  vWorldPos = worldPosition.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const WATER_POOL_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec2 uPlungeCenter;
uniform vec3 uSunDirection;
uniform vec3 uWaterAbsorption;
uniform vec3 uWaterDeepScatter;
uniform vec3 uWaterAeratedGlow;
uniform sampler2D uNoiseTex;
uniform sampler2D uFoamTex;
uniform sampler2D tSceneColor;
uniform sampler2D tSceneDepth;
uniform sampler2D tReflection;
uniform vec2 uResolution;
uniform float uCameraNear;
uniform float uCameraFar;
uniform sampler2D uSunShadowMap;
uniform mat4 uSunShadowMatrix;
uniform float uShadowMapSize;
uniform float uForestMode;
uniform vec3 uFogCool;
uniform vec3 uFogWarm;

varying vec3 vWorldPos;

${SHARED_ATMOS_AND_SHADOW_GLSL}

vec2 computeFlowVector(vec2 xz) {
  vec2 fromImpact = xz - uPlungeCenter;
  float dist = max(length(fromImpact), 0.1);
  vec2 radialOut = fromImpact / dist;
  float radialWeight = exp(-dist * 0.095);
  vec2 riverFlow = vec2(cos((xz.y + 10.0) * 0.042) * 0.22, 1.0);
  return normalize(mix(riverFlow, radialOut, radialWeight * 0.72));
}

float sampleFlowAdvectedWave(vec2 xz, vec2 flowDir, float time) {
  float cycleSpeed = 0.24;
  float phase0 = fract(time * cycleSpeed);
  float phase1 = fract(time * cycleSpeed + 0.5);
  float blend = abs(phase0 * 2.0 - 1.0);

  vec2 uv0 = xz * 0.085 - flowDir * phase0 * 1.4;
  vec2 uv1 = xz * 0.085 - flowDir * phase1 * 1.4 + vec2(0.37, 0.61);

  float broad0 = texture2D(uNoiseTex, uv0).r;
  float broad1 = texture2D(uNoiseTex, uv1).r;
  float broad = mix(broad0, broad1, blend);

  float fine0 = texture2D(uNoiseTex, uv0 * 2.45 + vec2(0.11, -time * 0.08)).b;
  float fine1 = texture2D(uNoiseTex, uv1 * 2.45 + vec2(0.53, -time * 0.08)).b;
  float fine = mix(fine0, fine1, blend);

  float dist = length(xz - uPlungeCenter);
  float shock = sin(dist * 3.2 - time * 4.7) * exp(-dist * 0.13) * 0.16;

  return shock + broad * 0.36 + fine * 0.14;
}

float sampleFlowAdvectedFoam(vec2 xz, vec2 flowDir, float time) {
  float cycleSpeed = 0.22;
  float phase0 = fract(time * cycleSpeed);
  float phase1 = fract(time * cycleSpeed + 0.5);
  float blend = abs(phase0 * 2.0 - 1.0);

  vec2 uv0 = xz * 0.09 - flowDir * phase0 * 1.65;
  vec2 uv1 = xz * 0.09 - flowDir * phase1 * 1.65 + vec2(0.43, 0.29);

  float f0 = texture2D(uFoamTex, uv0).g * 0.6 + texture2D(uNoiseTex, uv0 * 1.6).g * 0.4;
  float f1 = texture2D(uFoamTex, uv1).g * 0.6 + texture2D(uNoiseTex, uv1 * 1.6).g * 0.4;
  return mix(f0, f1, blend);
}

void main() {
  vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  float rawSceneDepth = texture2D(tSceneDepth, screenUv).r;
  if (gl_FragCoord.z > rawSceneDepth + 0.00015) {
    discard;
  }

  float sceneZ = linearizeDepth(rawSceneDepth, uCameraNear, uCameraFar);
  float waterZ = linearizeDepth(gl_FragCoord.z, uCameraNear, uCameraFar);
  float viewDepth = max(sceneZ - waterZ, 0.0);
  if (viewDepth < 0.008) {
    discard;
  }

  vec2 xz = vWorldPos.xz;
  vec2 flowDir = computeFlowVector(xz);
  float eps = 0.14;

  float hC = sampleFlowAdvectedWave(xz, flowDir, uTime);
  float hR = sampleFlowAdvectedWave(xz + vec2(eps, 0.0), flowDir, uTime);
  float hF = sampleFlowAdvectedWave(xz + vec2(0.0, eps), flowDir, uTime);

  float waveCalm = smoothstep(0.05, 0.9, viewDepth);
  vec3 normal = normalize(vec3((hC - hR) * 1.25 * waveCalm, eps * 2.9, (hC - hF) * 1.25 * waveCalm));
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDirection);

  float sunShadow = sampleSunShadowPcf(
    vWorldPos,
    vec3(0.0, 1.0, 0.0),
    sunDir,
    uSunShadowMap,
    uSunShadowMatrix,
    uShadowMapSize
  );

  vec2 refrOffset = normal.xz * clamp(viewDepth * 0.045, 0.0, 0.028);
  vec2 refrUv = clamp(screenUv + refrOffset, vec2(0.002), vec2(0.998));
  float refrSceneZ = linearizeDepth(texture2D(tSceneDepth, refrUv).r, uCameraNear, uCameraFar);
  if (refrSceneZ < waterZ) {
    refrUv = screenUv;
  }

  vec3 underwaterColor = texture2D(tSceneColor, refrUv).rgb;
  vec3 absorption = exp(-viewDepth * uWaterAbsorption);
  vec3 refractedWater = mix(uWaterDeepScatter, underwaterColor * absorption, clamp(absorption.b, 0.0, 1.0));

  float distToImpact = length(xz - uPlungeCenter);
  float aeratedPoolGlow = exp(-distToImpact * 0.14) * 0.045;
  refractedWater += uWaterAeratedGlow * aeratedPoolGlow;

  vec2 reflUv = clamp(vec2(screenUv.x, 1.0 - screenUv.y) + normal.xz * 0.055, vec2(0.002), vec2(0.998));
  vec3 planarReflection = texture2D(tReflection, reflUv).rgb;
  if (uForestMode > 0.5) {
    float gorgeThroatAtten = mix(0.28, 0.82, smoothstep(-4.0, 28.0, vWorldPos.z));
    planarReflection *= gorgeThroatAtten;
  }

  float ndotv = clamp(dot(normal, viewDir), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndotv, 5.0);

  vec3 surfaceColor = mix(refractedWater, planarReflection, clamp(fresnel * 0.94, 0.0, 0.94));

  vec3 halfVec = normalize(sunDir + viewDir);
  float specTight = pow(max(dot(normal, halfVec), 0.0), 320.0) * 3.6 * sunShadow;
  float specBroad = pow(max(dot(normal, halfVec), 0.0), 38.0) * 0.20 * sunShadow;
  surfaceColor += vec3(1.25, 0.78, 0.42) * (specTight + specBroad);

  float advectedFoam = sampleFlowAdvectedFoam(xz, flowDir, uTime);
  float plungeFoam =
    (1.0 - smoothstep(1.5, 9.6, distToImpact)) *
    smoothstep(0.26, 0.72, advectedFoam + exp(-distToImpact * 0.22) * 0.55);
  float trailingLace =
    (1.0 - smoothstep(5.5, 28.0, distToImpact)) *
    smoothstep(0.56, 0.84, advectedFoam) *
    smoothstep(uPlungeCenter.y - 1.0, uPlungeCenter.y + 4.0, xz.y);
  float contactFoam =
    smoothstep(0.02, 0.18, viewDepth) *
    (1.0 - smoothstep(0.18, 0.72, viewDepth)) *
    smoothstep(0.46, 0.78, advectedFoam) *
    (0.35 + 0.65 * exp(-distToImpact * 0.04));

  float foamMask = clamp(plungeFoam * 1.1 + trailingLace * 0.48 + contactFoam * 0.65, 0.0, 0.92);

  vec3 foamAmbient = mix(vec3(0.11, 0.15, 0.19), vec3(0.76, 0.82, 0.88), uForestMode);
  vec3 foamDirect = vec3(0.92, 0.66, 0.44) * sunShadow * clamp(dot(normal, sunDir) * 0.6 + 0.4, 0.0, 1.0);
  vec3 foamColor = mix(vec3(0.84, 0.88, 0.91), vec3(0.95, 0.97, 1.0), uForestMode) * (foamAmbient + foamDirect * 0.75);

  surfaceColor = mix(surfaceColor, foamColor, foamMask);
  if (uForestMode > 0.5) {
    vec3 toFrag = vWorldPos - cameraPosition;
    float dist = length(toFrag);
    vec3 rayDir = toFrag / max(dist, 0.0001);
    float fogFactor = clamp(1.0 - exp(-pow(dist * 0.0022, 1.35)), 0.0, 0.48);
    float sunAlign = max(dot(rayDir, sunDir), 0.0);
    vec3 fFog = mix(uFogCool, uFogWarm, pow(sunAlign, 2.4) * 0.52);
    surfaceColor = mix(surfaceColor, fFog, fogFactor);
  } else {
    surfaceColor = applyLinearHeightFog(surfaceColor, vWorldPos, cameraPosition, sunDir);
  }

  float shoreSoftness = smoothstep(0.0, 0.22, viewDepth);
  gl_FragColor = vec4(surfaceColor, shoreSoftness);
}
`;
