export const WATERFALL_CURTAIN_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uTurbulence;
uniform float uPhaseOffset;
uniform sampler2D uNoiseTex;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vUv = uv;
  vec3 pos = position;

  float fallProgress = 1.0 - uv.y;
  float accelScroll = uTime * (0.45 + fallProgress * 0.22) + uPhaseOffset * 0.15;

  float surge = texture2D(uNoiseTex, vec2(uv.x * 1.15, uv.y * 0.6 + accelScroll)).r - 0.5;
  float ripple = sin(uv.y * 16.0 + uTime * 7.2 + uv.x * 8.5 + uPhaseOffset) * 0.5;

  float displacementMask = smoothstep(0.0, 0.14, fallProgress) * (0.4 + 0.6 * fallProgress);
  pos += normal * (surge * 0.62 + ripple * 0.14) * uTurbulence * displacementMask;

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
uniform vec3 uSunDirection;
uniform sampler2D uNoiseTex;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  float fallProgress = 1.0 - vUv.y;
  float accelFactor = 1.0 + fallProgress * 0.85;
  float flowY = vUv.y * (0.85 + fallProgress * 0.35) + uTime * uSpeed * 0.32 * accelFactor + uPhaseOffset * 0.11;

  vec4 warpSample = texture2D(uNoiseTex, vec2(vUv.x * 1.3 + uPhaseOffset * 0.17, flowY * 0.45));
  vec2 streakUv = vec2(vUv.x * 2.4 + (warpSample.r - 0.5) * 0.24, flowY * 0.88);
  vec4 mainSample = texture2D(uNoiseTex, streakUv);
  vec4 fineSample = texture2D(uNoiseTex, vec2(vUv.x * 5.2 + (warpSample.a - 0.5) * 0.28, flowY * 1.65));

  float channelRhythm = 0.72 + 0.28 * sin(vUv.x * 14.0 + warpSample.r * 4.5);
  float aeration = clamp(
    mainSample.r * 0.44 + fineSample.b * 0.26 + mainSample.g * 0.36 + fineSample.g * 0.14,
    0.0,
    1.0
  );
  aeration *= channelRhythm;

  float horizontalFeather = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
  float topBlend = smoothstep(0.0, 0.06, fallProgress);
  float bottomPlungeFoam = smoothstep(0.76, 1.0, fallProgress);

  float densityMask = mix(
    smoothstep(0.28, 0.74, aeration + bottomPlungeFoam * 0.35),
    smoothstep(0.14, 0.58, aeration + 0.24),
    uCoreDensity
  );

  float alpha = horizontalFeather * (0.25 + 0.75 * topBlend) * densityMask * uOpacity;
  alpha = clamp(alpha + bottomPlungeFoam * horizontalFeather * 0.35 * uOpacity, 0.0, 0.98);
  if (alpha < 0.015) {
    discard;
  }

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDirection);
  vec3 normal = normalize(vWorldNormal);

  float sunFacing = max(dot(normal, sunDir), 0.0);
  float backScatter = pow(max(dot(-viewDir, sunDir), 0.0), 3.0);
  float rimFresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.2);

  vec3 deepGlacialShadow = vec3(0.32, 0.43, 0.53);
  vec3 aeratedWhite = vec3(0.88, 0.92, 0.97);
  vec3 goldenSunlit = vec3(1.18, 0.88, 0.64);
  vec3 goldenBackglow = vec3(1.28, 0.79, 0.45);

  float foamBrightness = smoothstep(0.30, 0.82, aeration + bottomPlungeFoam * 0.32);
  vec3 waterColor = mix(deepGlacialShadow, aeratedWhite, foamBrightness);

  float topSunCatch = smoothstep(4.0, 17.5, vWorldPos.y);
  float thinVeilMask = 1.0 - smoothstep(0.35, 0.92, alpha);
  float warmLitAmount = clamp(
    sunFacing * 0.55 +
    backScatter * (0.45 + thinVeilMask * 0.65) +
    rimFresnel * 0.4 +
    topSunCatch * 0.24,
    0.0,
    1.0
  );

  waterColor = mix(waterColor, goldenSunlit, warmLitAmount * 0.54);
  waterColor += goldenBackglow * backScatter * thinVeilMask * 0.42;

  float crestWaterDark = (1.0 - smoothstep(0.0, 0.16, fallProgress)) * 0.42;
  waterColor = mix(waterColor, vec3(0.18, 0.27, 0.34), crestWaterDark * (1.0 - foamBrightness * 0.6));

  float dist = length(cameraPosition - vWorldPos);
  float fogAmount = 1.0 - exp(-pow(dist * 0.0145, 2.0));
  vec3 fogColor = vec3(0.16, 0.19, 0.23);
  waterColor = mix(waterColor, fogColor, fogAmount * 0.55);

  gl_FragColor = vec4(waterColor, alpha);
}
`;

export const PLUNGE_BOIL_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform sampler2D uNoiseTex;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vBoilHeight;

void main() {
  vUv = uv;
  vec3 pos = position;

  float radial = length(uv - 0.5) * 2.0;
  float moundMask = 1.0 - smoothstep(0.25, 1.0, radial);

  float boilA = texture2D(uNoiseTex, vec2(pos.x * 0.14, pos.z * 0.14 - uTime * 0.35)).r;
  float boilB = texture2D(uNoiseTex, vec2(pos.x * 0.26 + uTime * 0.18, pos.z * 0.26 - uTime * 0.42)).g;
  float lift = (boilA * 0.55 + boilB * 0.45) * moundMask * 1.45;

  pos.y += lift;
  vBoilHeight = lift;

  vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPosition.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const PLUNGE_BOIL_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDirection;
uniform sampler2D uNoiseTex;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vBoilHeight;

void main() {
  vec2 centered = (vUv - 0.5) * 2.0;
  float dist = length(centered);
  vec2 radialDir = dist > 0.001 ? centered / dist : vec2(0.0, 1.0);

  vec2 advectedUv = centered * 0.72 - radialDir * uTime * 0.26;
  vec4 sampleA = texture2D(uNoiseTex, advectedUv);
  vec4 sampleB = texture2D(uNoiseTex, advectedUv * 1.8 + vec2(uTime * 0.09, -uTime * 0.14));

  float edgeFade = 1.0 - smoothstep(0.45, 0.98, dist + (sampleA.r - 0.5) * 0.32);
  float density = clamp(sampleA.r * 0.45 + sampleB.g * 0.58 + vBoilHeight * 0.34, 0.0, 1.0);
  float alpha = edgeFade * smoothstep(0.24, 0.74, density) * 0.92;

  if (alpha < 0.02) {
    discard;
  }

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDirection);
  float warmRim = pow(max(dot(-viewDir, sunDir), 0.0), 2.5) * 0.55 + 0.25;

  vec3 shadowFoam = vec3(0.48, 0.58, 0.67);
  vec3 brightFoam = vec3(0.96, 0.98, 1.0);
  vec3 warmGlow = vec3(1.14, 0.85, 0.62);

  vec3 color = mix(shadowFoam, brightFoam, smoothstep(0.30, 0.85, density));
  color = mix(color, warmGlow, warmRim * 0.44 * smoothstep(0.15, 1.2, vBoilHeight));

  gl_FragColor = vec4(color, alpha);
}
`;
