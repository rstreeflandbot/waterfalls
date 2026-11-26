export const WATER_POOL_VERTEX_SHADER = /* glsl */ `
attribute float aWaterDepth;

uniform float uTime;
uniform vec2 uPlungeCenter;
uniform sampler2D uNoiseTex;

varying vec3 vWorldPos;
varying float vWaterDepth;

void main() {
  vWaterDepth = aWaterDepth;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec2 fromImpact = worldPosition.xz - uPlungeCenter;
  float dist = length(fromImpact);

  float depthDamp = smoothstep(0.0, 0.75, aWaterDepth);
  float radialWave = sin(dist * 3.0 - uTime * 4.4) * exp(-dist * 0.11) * 0.12;
  float secondaryWave = sin(dist * 5.8 - uTime * 6.5 + 1.2) * exp(-dist * 0.17) * 0.04;
  float currentRipple = (texture2D(uNoiseTex, worldPosition.xz * 0.032 - vec2(0.0, uTime * 0.05)).r - 0.5) * 0.09;

  worldPosition.y += (radialWave + secondaryWave + currentRipple) * depthDamp;
  vWorldPos = worldPosition.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const WATER_POOL_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec2 uPlungeCenter;
uniform vec3 uSunDirection;
uniform sampler2D uNoiseTex;
uniform sampler2D uFoamTex;

varying vec3 vWorldPos;
varying float vWaterDepth;

float sampleWaterHeight(vec2 xz, float time) {
  vec2 fromImpact = xz - uPlungeCenter;
  float dist = length(fromImpact);
  vec2 flowOffset = vec2(0.0, -time * 0.058);

  float shockwave = sin(dist * 3.3 - time * 4.8) * exp(-dist * 0.12) * 0.17;
  float microShock = sin(dist * 7.2 - time * 7.5) * exp(-dist * 0.20) * 0.045;
  vec4 broadSwell = texture2D(uNoiseTex, xz * 0.042 + flowOffset);
  vec4 midWave = texture2D(uNoiseTex, xz * 0.115 - vec2(time * 0.02, time * 0.085));
  vec4 fineRipple = texture2D(uNoiseTex, xz * 0.25 + vec2(time * 0.025, -time * 0.12));

  return shockwave + microShock + broadSwell.r * 0.34 + midWave.r * 0.16 + fineRipple.b * 0.06;
}

vec3 sampleGoldenSkyReflection(vec3 reflDir, vec3 sunDir) {
  float elev = clamp(reflDir.y, 0.0, 1.0);
  float horizon = pow(1.0 - elev, 3.2);
  float sunAlign = max(dot(reflDir, sunDir), 0.0);

  vec3 zenith = vec3(0.045, 0.075, 0.12);
  vec3 warmHorizon = vec3(0.74, 0.44, 0.24);
  vec3 coolHorizon = vec3(0.18, 0.23, 0.30);
  vec3 sky = mix(zenith, mix(coolHorizon, warmHorizon, 0.40 + 0.60 * pow(sunAlign, 1.9)), horizon);
  sky += vec3(1.15, 0.70, 0.38) * pow(sunAlign, 14.0) * 0.52;

  float cliffMask = smoothstep(-0.2, 0.4, reflDir.z) * 0.55 + 0.45;
  float cliffDarkness = smoothstep(0.02, 0.30, elev);
  return mix(vec3(0.022, 0.028, 0.036), sky * cliffMask, cliffDarkness);
}

void main() {
  if (vWaterDepth <= 0.002) {
    discard;
  }

  vec2 xz = vWorldPos.xz;
  float eps = 0.14;

  float hCenter = sampleWaterHeight(xz, uTime);
  float hRight = sampleWaterHeight(xz + vec2(eps, 0.0), uTime);
  float hForward = sampleWaterHeight(xz + vec2(0.0, eps), uTime);

  float calmNearShore = smoothstep(0.05, 0.65, vWaterDepth);
  vec3 normal = normalize(vec3((hCenter - hRight) * 1.05 * calmNearShore, eps * 3.1, (hCenter - hForward) * 1.05 * calmNearShore));
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDirection);

  float ndotv = clamp(dot(normal, viewDir), 0.0, 1.0);
  float fresnel = 0.025 + 0.975 * pow(1.0 - ndotv, 5.0);

  vec3 reflDir = reflect(-viewDir, normal);
  vec3 skyReflection = sampleGoldenSkyReflection(reflDir, sunDir);

  vec2 fromImpact = xz - uPlungeCenter;
  float distToImpact = length(fromImpact);
  float radialAngle = atan(fromImpact.y, fromImpact.x);

  vec3 shallowClear = vec3(0.028, 0.042, 0.048);
  vec3 midGlacial = vec3(0.024, 0.068, 0.084);
  vec3 deepObsidianTeal = vec3(0.012, 0.036, 0.048);

  float depthRatio = smoothstep(0.15, 2.2, vWaterDepth);
  vec3 waterBody = mix(shallowClear, mix(midGlacial, deepObsidianTeal, depthRatio), smoothstep(0.05, 0.9, vWaterDepth));

  float plungeTurbulenceGlow = exp(-distToImpact * 0.16);
  waterBody += vec3(0.055, 0.11, 0.13) * plungeTurbulenceGlow;

  vec3 surfaceColor = mix(waterBody, skyReflection, clamp(fresnel * 0.92, 0.0, 0.88));

  vec3 halfVec = normalize(sunDir + viewDir);
  float specTight = pow(max(dot(normal, halfVec), 0.0), 280.0) * 2.8;
  float specBroad = pow(max(dot(normal, halfVec), 0.0), 36.0) * 0.18;
  surfaceColor += vec3(1.12, 0.74, 0.44) * (specTight + specBroad);

  vec2 outflowUv = vec2(xz.x * 0.06, xz.y * 0.048 - uTime * 0.062);
  vec4 foamWarp = texture2D(uNoiseTex, outflowUv);
  float radialFoam = texture2D(
    uFoamTex,
    vec2(radialAngle * 0.55 + foamWarp.r * 0.22, distToImpact * 0.09 - uTime * 0.14)
  ).r;
  float riverLace = texture2D(uFoamTex, outflowUv * 1.65 + (foamWarp.rg - 0.5) * 0.18).g;

  float impactRing = (1.0 - smoothstep(2.0, 9.2, distToImpact)) * smoothstep(0.36, 0.80, radialFoam + foamWarp.g * 0.22);
  float trailingVeins =
    (1.0 - smoothstep(5.5, 24.0, distToImpact)) *
    smoothstep(0.56, 0.86, riverLace * 0.72 + foamWarp.g * 0.35) *
    smoothstep(uPlungeCenter.y - 1.0, uPlungeCenter.y + 5.5, xz.y);
  float shorelineFoam =
    smoothstep(0.02, 0.14, vWaterDepth) *
    (1.0 - smoothstep(0.14, 0.42, vWaterDepth)) *
    smoothstep(0.54, 0.82, foamWarp.g) *
    (0.35 + 0.65 * exp(-distToImpact * 0.045));

  float foamMask = clamp(impactRing * 0.95 + trailingVeins * 0.44 + shorelineFoam * 0.45, 0.0, 0.88);

  vec3 foamShadow = vec3(0.38, 0.46, 0.53);
  vec3 foamLit = vec3(0.84, 0.85, 0.84);
  float sunWarmth = clamp(dot(normal, sunDir) * 0.55 + 0.45, 0.0, 1.0);
  vec3 foamColor = mix(foamShadow, foamLit, sunWarmth);

  surfaceColor = mix(surfaceColor, foamColor, foamMask);

  float camDist = length(cameraPosition - vWorldPos);
  float fogFactor = 1.0 - exp(-pow(camDist * 0.0056, 2.0));
  surfaceColor = mix(surfaceColor, vec3(0.16, 0.20, 0.25), fogFactor * 0.82);

  float edgeSoftness = smoothstep(0.0, 0.34, vWaterDepth);
  float waterOpacity = mix(0.28, 0.96, smoothstep(0.06, 1.15, vWaterDepth));
  float alpha = clamp(edgeSoftness * (waterOpacity + foamMask * 0.4), 0.0, 0.98);
  gl_FragColor = vec4(surfaceColor, alpha);
}
`;
