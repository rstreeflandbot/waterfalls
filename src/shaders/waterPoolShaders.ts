export const WATER_POOL_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform vec2 uPlungeCenter;
uniform sampler2D uNoiseTex;

varying vec3 vWorldPos;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec2 fromImpact = worldPosition.xz - uPlungeCenter;
  float dist = length(fromImpact);

  float radialWave = sin(dist * 3.8 - uTime * 5.2) * exp(-dist * 0.14) * 0.14;
  float secondaryWave = sin(dist * 7.2 - uTime * 7.8 + 1.2) * exp(-dist * 0.2) * 0.055;
  float currentRipple = (texture2D(uNoiseTex, worldPosition.xz * 0.055 - vec2(0.0, uTime * 0.08)).r - 0.5) * 0.14;

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

varying vec3 vWorldPos;

float sampleWaterHeight(vec2 xz, float time) {
  vec2 fromImpact = xz - uPlungeCenter;
  float dist = length(fromImpact);
  vec2 flowOffset = vec2(0.0, -time * 0.095);

  float shockwave = sin(dist * 4.2 - time * 5.6) * exp(-dist * 0.15) * 0.22;
  float microShock = sin(dist * 9.5 - time * 9.2) * exp(-dist * 0.24) * 0.075;
  vec4 waveA = texture2D(uNoiseTex, xz * 0.095 + flowOffset);
  vec4 waveB = texture2D(uNoiseTex, xz * 0.23 - vec2(time * 0.035, time * 0.14));

  return shockwave + microShock + waveA.r * 0.42 + waveB.b * 0.24;
}

vec3 sampleGoldenSkyReflection(vec3 reflDir, vec3 sunDir) {
  float elev = clamp(reflDir.y, 0.0, 1.0);
  float horizon = pow(1.0 - elev, 3.0);
  float sunAlign = max(dot(reflDir, sunDir), 0.0);

  vec3 zenith = vec3(0.08, 0.12, 0.18);
  vec3 warmHorizon = vec3(0.92, 0.54, 0.28);
  vec3 coolHorizon = vec3(0.28, 0.33, 0.40);
  vec3 sky = mix(zenith, mix(coolHorizon, warmHorizon, 0.45 + 0.55 * pow(sunAlign, 1.8)), horizon);
  sky += vec3(1.45, 0.85, 0.46) * pow(sunAlign, 10.0) * 0.68;

  float cliffShadowOcclusion = smoothstep(-0.35, 0.35, reflDir.z) * 0.45 + 0.55;
  float basaltReflect = smoothstep(0.0, 0.22, elev);
  return mix(vec3(0.04, 0.05, 0.065), sky * cliffShadowOcclusion, basaltReflect);
}

void main() {
  vec2 xz = vWorldPos.xz;
  float eps = 0.09;

  float hCenter = sampleWaterHeight(xz, uTime);
  float hRight = sampleWaterHeight(xz + vec2(eps, 0.0), uTime);
  float hForward = sampleWaterHeight(xz + vec2(0.0, eps), uTime);

  vec3 normal = normalize(vec3((hCenter - hRight) * 1.45, eps * 2.2, (hCenter - hForward) * 1.45));
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDirection);

  float ndotv = clamp(dot(normal, viewDir), 0.0, 1.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - ndotv, 4.4);

  vec3 reflDir = reflect(-viewDir, normal);
  vec3 skyReflection = sampleGoldenSkyReflection(reflDir, sunDir);

  vec2 fromImpact = xz - uPlungeCenter;
  float distToImpact = length(fromImpact);
  float radialAngle = atan(fromImpact.y, fromImpact.x);

  vec3 deepGlacial = vec3(0.025, 0.078, 0.098);
  vec3 midGlacial = vec3(0.068, 0.15, 0.172);
  vec3 shallowBed = vec3(0.045, 0.052, 0.058);

  float centerDepth = 1.0 - smoothstep(4.5, 13.5, length(vec2(xz.x * 0.9, xz.y - 4.2)));
  vec3 waterBody = mix(shallowBed, mix(midGlacial, deepGlacial, centerDepth), 0.45 + 0.55 * centerDepth);

  float plungeGlow = exp(-distToImpact * 0.16);
  waterBody += vec3(0.11, 0.19, 0.21) * plungeGlow;

  vec3 surfaceColor = mix(waterBody, skyReflection, clamp(fresnel * 1.15, 0.0, 0.96));

  vec3 halfVec = normalize(sunDir + viewDir);
  float specTight = pow(max(dot(normal, halfVec), 0.0), 210.0) * 3.8;
  float specBroad = pow(max(dot(normal, halfVec), 0.0), 26.0) * 0.36;
  surfaceColor += vec3(1.18, 0.75, 0.42) * (specTight + specBroad);

  vec2 outflowUv = vec2(xz.x * 0.075, xz.y * 0.055 - uTime * 0.075);
  vec4 foamSampleA = texture2D(uNoiseTex, outflowUv);
  vec4 foamSampleB = texture2D(
    uNoiseTex,
    vec2(radialAngle * 0.45 + foamSampleA.r * 0.28, distToImpact * 0.095 - uTime * 0.15)
  );

  float laceNoise = foamSampleB.r;
  float cellular = foamSampleA.g * 0.55 + foamSampleB.g * 0.45;

  float impactRing = (1.0 - smoothstep(1.8, 7.8, distToImpact)) * smoothstep(0.32, 0.74, laceNoise + cellular * 0.35);
  float trailingVeins =
    (1.0 - smoothstep(3.5, 20.0, distToImpact)) *
    smoothstep(0.60, 0.83, laceNoise * 0.58 + cellular * 0.52) *
    smoothstep(-2.0, 4.0, xz.y);

  float shoreRadius = 9.2 + sin(xz.y * 0.25) * 1.4;
  float shoreBand = smoothstep(shoreRadius - 2.6, shoreRadius, abs(xz.x)) * smoothstep(0.45, 0.76, cellular);

  float foamMask = clamp(impactRing * 1.15 + trailingVeins * 0.72 + shoreBand * 0.42, 0.0, 0.94);

  vec3 foamShadow = vec3(0.46, 0.54, 0.62);
  vec3 foamLit = vec3(0.96, 0.92, 0.87);
  float sunWarmth = clamp(dot(normal, sunDir) * 0.6 + 0.4, 0.0, 1.0);
  vec3 foamColor = mix(foamShadow, foamLit, sunWarmth);

  surfaceColor = mix(surfaceColor, foamColor, foamMask);

  float camDist = length(cameraPosition - vWorldPos);
  float fogFactor = 1.0 - exp(-pow(camDist * 0.0145, 2.0));
  surfaceColor = mix(surfaceColor, vec3(0.12, 0.15, 0.19), fogFactor * 0.78);

  float basinAlpha = 1.0 - smoothstep(28.0, 44.0, length(vec2(xz.x * 1.1, xz.y - 12.0)));
  gl_FragColor = vec4(surfaceColor, clamp(0.94 * basinAlpha + 0.06, 0.0, 0.98));
}
`;
