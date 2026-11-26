import { SHARED_ATMOS_AND_SHADOW_GLSL } from './sharedShaderGlsl';

export const MIST_BILLBOARD_VERTEX_SHADER = /* glsl */ `
attribute vec3 aOrigin;
attribute vec4 aParams;
attribute vec3 aDrift;

uniform float uTime;

varying vec2 vUv;
varying float vAge;
varying float vSeed;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  float duration = aParams.x;
  float baseScale = aParams.y;
  float spinSpeed = aParams.z;
  float seed = aParams.w;
  vSeed = seed;

  float age = fract((uTime + seed * duration) / duration);
  vAge = age;

  float easeOut = 1.0 - pow(1.0 - age, 2.2);
  vec3 centerPos = aOrigin;
  centerPos.x += aDrift.x * easeOut + sin(uTime * 0.42 + seed * 12.0) * 1.05 * age;
  centerPos.y += aDrift.y * easeOut + age * age * 0.9;
  centerPos.z += aDrift.z * easeOut + cos(uTime * 0.35 + seed * 9.0) * 0.65 * age;

  float scale = baseScale * (0.48 + easeOut * 1.4);
  float angle = seed * 6.28318 + uTime * spinSpeed;
  float cosA = cos(angle);
  float sinA = sin(angle);
  vec2 rotated = vec2(
    position.x * cosA - position.y * sinA,
    position.x * sinA + position.y * cosA
  ) * scale;

  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 worldPos = centerPos + camRight * rotated.x + camUp * rotated.y;

  vWorldPos = worldPos;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

export const MIST_BILLBOARD_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDirection;
uniform float uOpacityScale;
uniform sampler2D uNoiseTex;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
uniform float uCameraNear;
uniform float uCameraFar;
uniform sampler2D uSunShadowMap;
uniform mat4 uSunShadowMatrix;
uniform float uShadowMapSize;

varying vec2 vUv;
varying float vAge;
varying float vSeed;
varying vec3 vWorldPos;

${SHARED_ATMOS_AND_SHADOW_GLSL}

void main() {
  vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  float rawSceneDepth = texture2D(tSceneDepth, screenUv).r;
  if (gl_FragCoord.z > rawSceneDepth) {
    discard;
  }

  float sceneZ = linearizeDepth(rawSceneDepth, uCameraNear, uCameraFar);
  float fragZ = linearizeDepth(gl_FragCoord.z, uCameraNear, uCameraFar);
  float softDepth = smoothstep(0.0, 2.4, sceneZ - fragZ);

  vec2 centered = (vUv - 0.5) * 2.0;
  float radial = length(centered);
  if (radial > 1.0) {
    discard;
  }

  float softCircle = pow(1.0 - radial, 2.1);
  vec2 noiseCoord = vUv * 0.74 + vec2(vSeed * 3.7, -uTime * 0.025 + vSeed * 1.9);
  vec4 sampleA = texture2D(uNoiseTex, noiseCoord);
  vec4 sampleB = texture2D(uNoiseTex, noiseCoord * 1.75 + vec2(0.42, -uTime * 0.038));
  float cloudShape = softCircle * smoothstep(0.22, 0.84, sampleA.a * 0.64 + sampleB.r * 0.38);

  float lifeFade = smoothstep(0.0, 0.16, vAge) * (1.0 - smoothstep(0.40, 1.0, vAge));
  float camDist = length(cameraPosition - vWorldPos);
  float nearCamFade = smoothstep(4.5, 11.5, camDist);

  float alpha = cloudShape * lifeFade * softDepth * nearCamFade * uOpacityScale;
  if (alpha < 0.003) {
    discard;
  }

  vec3 viewDir = normalize(vWorldPos - cameraPosition);
  vec3 sunDir = normalize(uSunDirection);

  float sunShadow = sampleSunShadowPcf(
    vWorldPos,
    vec3(0.0, 1.0, 0.0),
    sunDir,
    uSunShadowMap,
    uSunShadowMatrix,
    uShadowMapSize
  );

  float cosTheta = dot(viewDir, sunDir);
  float g = 0.62;
  float mie = (1.0 - g * g) / (4.0 * 3.14159 * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5));
  float forwardScatter = clamp(mie * 0.72, 0.0, 2.2) * sunShadow;

  vec3 shadowVapor = vec3(0.11, 0.145, 0.19);
  vec3 sunlitVapor = vec3(0.55, 0.42, 0.29);
  vec3 goldenMie = vec3(1.15, 0.66, 0.32);

  vec3 color = mix(shadowVapor, sunlitVapor, sunShadow * 0.78);
  color += goldenMie * forwardScatter * 0.42 * (1.0 - softCircle * 0.35);
  color = applyLinearHeightFog(color, vWorldPos, cameraPosition, sunDir);

  gl_FragColor = vec4(color, alpha);
}
`;

export const SPRAY_STREAK_VERTEX_SHADER = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aVelocity;
attribute vec3 aParams;

uniform float uTime;

varying vec2 vUv;
varying float vAlpha;
varying float vSparkle;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  float duration = aParams.x;
  float seed = aParams.y;
  float baseThickness = aParams.z;

  float t = fract((uTime + seed * duration) / duration) * duration;
  float age = t / duration;

  vec3 centerPos = aOrigin;
  centerPos.x += aVelocity.x * t + sin(uTime * 1.1 + seed * 20.0) * 0.24 * age;
  centerPos.y += aVelocity.y * t - 4.9 * t * t;
  centerPos.z += aVelocity.z * t;

  vec3 instVelocity = vec3(
    aVelocity.x,
    aVelocity.y - 9.8 * t,
    aVelocity.z
  );

  float speed = length(instVelocity);
  vec3 velDir = speed > 0.001 ? instVelocity / speed : vec3(0.0, -1.0, 0.0);
  vec3 toCam = normalize(cameraPosition - centerPos);
  vec3 sideDir = normalize(cross(velDir, toCam) + vec3(0.0001, 0.0, 0.0));

  float streakLen = clamp(speed * 0.055, 0.08, 0.65);
  float streakWidth = baseThickness * 0.032;

  vec3 worldPos = centerPos + sideDir * (position.x * streakWidth) + velDir * (position.y * streakLen);
  if (centerPos.y < -0.15) {
    worldPos = vec3(0.0, -500.0, 0.0);
  }

  vWorldPos = worldPos;
  float fadeIn = smoothstep(0.0, 0.12, age);
  float fadeOut = 1.0 - smoothstep(0.55, 1.0, age);
  vAlpha = fadeIn * fadeOut * smoothstep(-0.05, 0.25, centerPos.y);
  vSparkle = pow(sin(uTime * 7.2 + seed * 47.0) * 0.5 + 0.5, 3.0);

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

export const SPRAY_STREAK_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uSunDirection;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
uniform sampler2D uSunShadowMap;
uniform mat4 uSunShadowMatrix;
uniform float uShadowMapSize;

varying vec2 vUv;
varying float vAlpha;
varying float vSparkle;
varying vec3 vWorldPos;

${SHARED_ATMOS_AND_SHADOW_GLSL}

void main() {
  vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  float rawSceneDepth = texture2D(tSceneDepth, screenUv).r;
  if (gl_FragCoord.z > rawSceneDepth) {
    discard;
  }

  vec2 centered = (vUv - 0.5) * 2.0;
  float capsule = pow(max(0.0, 1.0 - centered.x * centered.x), 1.8) * pow(max(0.0, 1.0 - centered.y * centered.y), 1.3);
  if (capsule < 0.02) {
    discard;
  }

  vec3 viewDir = normalize(vWorldPos - cameraPosition);
  vec3 sunDir = normalize(uSunDirection);
  float sunShadow = sampleSunShadowPcf(
    vWorldPos,
    vec3(0.0, 1.0, 0.0),
    sunDir,
    uSunShadowMap,
    uSunShadowMatrix,
    uShadowMapSize
  );

  float sunCatch = pow(max(dot(viewDir, sunDir), 0.0), 2.5) * sunShadow;
  vec3 baseSpray = vec3(0.18, 0.23, 0.29);
  vec3 goldGlint = vec3(1.15, 0.78, 0.44);
  vec3 color = mix(baseSpray, goldGlint, clamp(sunCatch * 0.85 + vSparkle * 0.45 * sunShadow, 0.0, 1.0));

  float alpha = capsule * vAlpha * (0.28 + vSparkle * 0.34);
  if (alpha < 0.01) {
    discard;
  }

  gl_FragColor = vec4(color, alpha);
}
`;
