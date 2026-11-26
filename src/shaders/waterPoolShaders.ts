export const WATER_POOL_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform vec2 uPlungeCenter;
uniform sampler2D uNoiseTex;

varying vec3 vWorldPos;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec2 fromImpact = worldPosition.xz - uPlungeCenter;
  float dist = length(fromImpact);

  float radialWave = sin(dist * 3.1 - uTime * 4.6) * exp(-dist * 0.11) * 0.13;
  float secondaryWave = sin(dist * 6.0 - uTime * 6.8 + 1.2) * exp(-dist * 0.17) * 0.045;
  float currentRipple = (texture2D(uNoiseTex, worldPosition.xz * 0.032 - vec2(0.0, uTime * 0.055)).r - 0.5) * 0.12;

  worldPosition.y += radialWave + secondaryWave + currentRipple;
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

float sampleWaterHeight(vec2 xz, float time) {
  vec2 fromImpact = xz - uPlungeCenter;
  float dist = length(fromImpact);
  vec2 flowOffset = vec2(0.0, -time * 0.065);

  float shockwave = sin(dist * 3.4 - time * 4.9) * exp(-dist * 0.12) * 0.19;
  float microShock = sin(dist * 7.6 - time * 7.8) * exp(-dist * 0.20) * 0.055;
  vec4 broadSwell = texture2D(uNoiseTex, xz * 0.045 + flowOffset);
  vec4 midWave = texture2D(uNoiseTex, xz * 0.125 - vec2(time * 0.022, time * 0.095));
  vec4 fineRipple = texture2D(uNoiseTex, xz * 0.28 + vec2(time * 0.03, -time * 0.14));

  return shockwave + microShock + broadSwell.r * 0.36 + midWave.r * 0.18 + fineRipple.b * 0.07;
}

vec3 sampleGoldenSkyReflection(vec3 reflDir, vec3 sunDir) {
  float elev = clamp(reflDir.y, 0.0, 1.0);
  float horizon = pow(1.0 - elev, 3.2);
  float sunAlign = max(dot(reflDir, sunDir), 0.0);

  vec3 zenith = vec3(0.065, 0.10, 0.16);
  vec3 warmHorizon = vec3(0.84, 0.49, 0.26);
  vec3 coolHorizon = vec3(0.24, 0.29, 0.36);
  vec3 sky = mix(zenith, mix(coolHorizon, warmHorizon, 0.42 + 0.58 * pow(sunAlign, 1.9)), horizon);
  sky += vec3(1.25, 0.76, 0.42) * pow(sunAlign, 12.0) * 0.55;

  float cliffMask = smoothstep(-0.15, 0.35, reflDir.z) * 0.55 + 0.45;
  float cliffDarkness = smoothstep(0.02, 0.28, elev);
  return mix(vec3(0.035, 0.042, 0.052), sky * cliffMask, cliffDarkness);
}

void main() {
  vec2 xz = vWorldPos.xz;
  float eps = 0.14;

  float hCenter = sampleWaterHeight(xz, uTime);
  float hRight = sampleWaterHeight(xz + vec2(eps, 0.0), uTime);
  float hForward = sampleWaterHeight(xz + vec2(0.0, eps), uTime);

  vec3 normal = normalize(vec3((hCenter - hRight) * 1.15, eps * 2.8, (hCenter - hForward) * 1.15));
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDirection);

  float ndotv = clamp(dot(normal, viewDir), 0.0, 1.0);
  float fresnel = 0.03 + 0.97 * pow(1.0 - ndotv, 4.8);

  vec3 reflDir = reflect(-viewDir, normal);
  vec3 skyReflection = sampleGoldenSkyReflection(reflDir, sunDir);

  vec2 fromImpact = xz - uPlungeCenter;
  float distToImpact = length(fromImpact);
  float radialAngle = atan(fromImpact.y, fromImpact.x);

  float riverCenterX = sin((xz.y + 10.0) * 0.042) * 5.2 + sin((xz.y + 10.0) * 0.017) * 3.8;
  float riverHalfWidth =
    7.2 +
    exp(-pow((xz.y - (uPlungeCenter.y + 4.0)) / 10.0, 2.0)) * 5.2 +
    smoothstep(14.0, 95.0, xz.y) * 8.5;
  float shoreFactor = clamp(abs(xz.x - riverCenterX) / max(riverHalfWidth, 1.0), 0.0, 1.4);

  vec3 deepGlacial = vec3(0.018, 0.052, 0.068);
  vec3 midGlacial = vec3(0.048, 0.105, 0.125);
  vec3 shallowPebbleTint = vec3(0.038, 0.042, 0.046);

  float depthFactor = 1.0 - smoothstep(0.35, 1.08, shoreFactor);
  vec3 waterBody = mix(shallowPebbleTint, mix(midGlacial, deepGlacial, depthFactor), 0.35 + 0.65 * depthFactor);

  float plungeGlow = exp(-distToImpact * 0.14);
  waterBody += vec3(0.075, 0.14, 0.16) * plungeGlow;

  vec3 surfaceColor = mix(waterBody, skyReflection, clamp(fresnel * 1.05, 0.0, 0.92));

  vec3 halfVec = normalize(sunDir + viewDir);
  float specTight = pow(max(dot(normal, halfVec), 0.0), 260.0) * 2.9;
  float specBroad = pow(max(dot(normal, halfVec), 0.0), 34.0) * 0.24;
  surfaceColor += vec3(1.1, 0.72, 0.42) * (specTight + specBroad);

  vec2 outflowUv = vec2(xz.x * 0.055, xz.y * 0.045 - uTime * 0.068);
  vec4 foamWarp = texture2D(uNoiseTex, outflowUv);
  float radialFoam = texture2D(
    uFoamTex,
    vec2(radialAngle * 0.55 + foamWarp.r * 0.25, distToImpact * 0.085 - uTime * 0.13)
  ).r;
  float riverLace = texture2D(uFoamTex, outflowUv * 1.7 + (foamWarp.rg - 0.5) * 0.2).r;

  float impactRing = (1.0 - smoothstep(2.2, 9.8, distToImpact)) * smoothstep(0.34, 0.78, radialFoam + foamWarp.g * 0.28);
  float trailingVeins =
    (1.0 - smoothstep(5.0, 28.0, distToImpact)) *
    smoothstep(0.56, 0.86, riverLace * 0.65 + foamWarp.g * 0.45) *
    smoothstep(uPlungeCenter.y - 2.0, uPlungeCenter.y + 6.0, xz.y);
  float shoreRippleFoam =
    smoothstep(0.84, 1.08, shoreFactor) *
    (1.0 - smoothstep(1.08, 1.24, shoreFactor)) *
    smoothstep(0.45, 0.80, foamWarp.g);

  float foamMask = clamp(impactRing * 1.05 + trailingVeins * 0.52 + shoreRippleFoam * 0.34, 0.0, 0.90);

  vec3 foamShadow = vec3(0.42, 0.50, 0.57);
  vec3 foamLit = vec3(0.88, 0.86, 0.83);
  float sunWarmth = clamp(dot(normal, sunDir) * 0.55 + 0.45, 0.0, 1.0);
  vec3 foamColor = mix(foamShadow, foamLit, sunWarmth);

  surfaceColor = mix(surfaceColor, foamColor, foamMask);

  float camDist = length(cameraPosition - vWorldPos);
  float fogFactor = 1.0 - exp(-pow(camDist * 0.0056, 2.0));
  surfaceColor = mix(surfaceColor, vec3(0.16, 0.20, 0.25), fogFactor * 0.82);

  float shallowEdgeAlpha = 1.0 - smoothstep(0.95, 1.22, shoreFactor);
  float alpha = clamp(mix(0.62, 0.96, depthFactor) * (0.25 + 0.75 * shallowEdgeAlpha) + foamMask * 0.35, 0.0, 0.98);
  gl_FragColor = vec4(surfaceColor, alpha);
}
`;
