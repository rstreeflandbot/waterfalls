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
  float accelScroll = uTime * (0.42 + fallProgress * 0.22) + uPhaseOffset * 0.15;

  float surge = texture2D(uNoiseTex, vec2(uv.x * 1.1, uv.y * 0.55 + accelScroll)).r - 0.5;
  float ripple = sin(uv.y * 14.0 + uTime * 6.8 + uv.x * 7.5 + uPhaseOffset) * 0.5;

  float displacementMask = smoothstep(0.0, 0.14, fallProgress) * (0.35 + 0.65 * fallProgress);
  pos += normal * (surge * 0.52 + ripple * 0.12) * uTurbulence * displacementMask;

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
uniform sampler2D uFoamTex;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  float fallProgress = 1.0 - vUv.y;
  float accelFactor = 1.0 + fallProgress * 0.88;
  float flowY = vUv.y * (0.95 + fallProgress * 0.32) + uTime * uSpeed * 0.28 * accelFactor + uPhaseOffset * 0.13;

  vec4 warpSample = texture2D(uNoiseTex, vec2(vUv.x * 1.4 + uPhaseOffset * 0.17, flowY * 0.42));
  vec2 distort = (warpSample.rg - 0.5) * 0.09;

  float foamPrimary = texture2D(uFoamTex, vec2(vUv.x * 2.1 + distort.x, flowY * 1.05 + distort.y)).r;
  float foamSecondary = texture2D(
    uFoamTex,
    vec2(vUv.x * 3.8 - distort.x * 1.2 + uPhaseOffset * 0.21, flowY * 1.65 + uTime * uSpeed * 0.14)
  ).r;
  vec4 fineDetail = texture2D(uNoiseTex, vec2(vUv.x * 5.6 + distort.x * 2.0, flowY * 2.2));

  float chuteMask = 0.72 + 0.28 * sin(vUv.x * 15.0 + warpSample.r * 4.0);
  float aeration = clamp(
    foamPrimary * 0.56 + foamSecondary * 0.34 + fineDetail.g * 0.24,
    0.0,
    1.0
  );
  aeration *= chuteMask;

  float horizontalFeather = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
  float topBlend = smoothstep(0.0, 0.05, fallProgress);
  float bottomPlungeFoam = smoothstep(0.76, 1.0, fallProgress);

  float densityMask = mix(
    smoothstep(0.24, 0.74, aeration + bottomPlungeFoam * 0.32),
    smoothstep(0.10, 0.58, aeration + 0.24),
    uCoreDensity
  );

  float alpha = horizontalFeather * (0.28 + 0.72 * topBlend) * densityMask * uOpacity;
  alpha = clamp(alpha + bottomPlungeFoam * horizontalFeather * 0.32 * uOpacity, 0.0, 0.96);
  if (alpha < 0.015) {
    discard;
  }

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDirection);
  vec3 normal = normalize(vWorldNormal);

  float sunFacing = max(dot(normal, sunDir), 0.0);
  float backScatter = pow(max(dot(-viewDir, sunDir), 0.0), 3.6);
  float rimFresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.5);

  vec3 deepGlacialWater = vec3(0.13, 0.21, 0.27);
  vec3 shadedFoam = vec3(0.46, 0.55, 0.63);
  vec3 crispFoam = vec3(0.84, 0.89, 0.93);
  vec3 goldenRim = vec3(1.02, 0.76, 0.52);

  float crestWaterDark = (1.0 - smoothstep(0.0, 0.18, fallProgress));
  float foamBrightness = smoothstep(0.26, 0.86, aeration + bottomPlungeFoam * 0.26);

  vec3 waterColor = mix(deepGlacialWater, shadedFoam, smoothstep(0.12, 0.58, aeration + 0.18));
  waterColor = mix(waterColor, crispFoam, foamBrightness);
  waterColor = mix(waterColor, deepGlacialWater * 0.9, crestWaterDark * (1.0 - foamBrightness) * 0.55);

  float topSunCatch = smoothstep(7.0, 22.0, vWorldPos.y);
  float thinVeilMask = 1.0 - smoothstep(0.35, 0.90, alpha);
  float warmLight = clamp(
    sunFacing * 0.35 +
    backScatter * (0.22 + thinVeilMask * 0.45) +
    rimFresnel * 0.26 +
    topSunCatch * 0.18,
    0.0,
    0.72
  );
  waterColor = mix(waterColor, goldenRim, warmLight * 0.38);

  float dist = length(cameraPosition - vWorldPos);
  float fogAmount = 1.0 - exp(-pow(dist * 0.0056, 2.0));
  vec3 fogColor = vec3(0.17, 0.21, 0.26);
  waterColor = mix(waterColor, fogColor, fogAmount * 0.65);

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
  float moundMask = 1.0 - smoothstep(0.22, 1.0, radial);

  float boilA = texture2D(uNoiseTex, vec2(pos.x * 0.12, pos.z * 0.12 - uTime * 0.32)).r;
  float boilB = texture2D(uNoiseTex, vec2(pos.x * 0.24 + uTime * 0.16, pos.z * 0.24 - uTime * 0.38)).g;
  float lift = (boilA * 0.55 + boilB * 0.45) * moundMask * 1.35;

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
uniform sampler2D uFoamTex;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vBoilHeight;

void main() {
  vec2 centered = (vUv - 0.5) * 2.0;
  float dist = length(centered);
  vec2 radialDir = dist > 0.001 ? centered / dist : vec2(0.0, 1.0);

  vec2 advectedUv = centered * 0.72 - radialDir * uTime * 0.24;
  vec4 sampleA = texture2D(uNoiseTex, advectedUv);
  float foamSample = texture2D(uFoamTex, advectedUv * 1.45 + vec2(uTime * 0.08, -uTime * 0.12)).r;

  float edgeFade = 1.0 - smoothstep(0.42, 0.98, dist + (sampleA.r - 0.5) * 0.30);
  float density = clamp(sampleA.g * 0.42 + foamSample * 0.52 + vBoilHeight * 0.32, 0.0, 1.0);
  float alpha = edgeFade * smoothstep(0.24, 0.76, density) * 0.88;

  if (alpha < 0.02) {
    discard;
  }

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 sunDir = normalize(uSunDirection);
  float warmRim = pow(max(dot(-viewDir, sunDir), 0.0), 3.0) * 0.45 + 0.15;

  vec3 shadowFoam = vec3(0.42, 0.51, 0.59);
  vec3 brightFoam = vec3(0.88, 0.92, 0.95);
  vec3 warmGlow = vec3(1.02, 0.78, 0.56);

  vec3 color = mix(shadowFoam, brightFoam, smoothstep(0.28, 0.85, density));
  color = mix(color, warmGlow, warmRim * 0.32 * smoothstep(0.2, 1.2, vBoilHeight));

  gl_FragColor = vec4(color, alpha);
}
`;
