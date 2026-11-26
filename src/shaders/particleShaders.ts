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
  centerPos.x += aDrift.x * easeOut + sin(uTime * 0.45 + seed * 12.0) * 1.15 * age;
  centerPos.y += aDrift.y * easeOut + age * age * 1.4;
  centerPos.z += aDrift.z * easeOut + cos(uTime * 0.35 + seed * 9.0) * 0.65 * age;

  float scale = baseScale * (0.45 + easeOut * 1.45);
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

varying vec2 vUv;
varying float vAge;
varying float vSeed;
varying vec3 vWorldPos;

void main() {
  vec2 centered = (vUv - 0.5) * 2.0;
  float radial = length(centered);
  if (radial > 1.0) {
    discard;
  }

  float softCircle = pow(1.0 - radial, 1.85);
  vec2 noiseCoord = vUv * 0.72 + vec2(vSeed * 3.7, -uTime * 0.025 + vSeed * 1.9);
  vec4 sampleA = texture2D(uNoiseTex, noiseCoord);
  vec4 sampleB = texture2D(uNoiseTex, noiseCoord * 1.75 + vec2(0.42, -uTime * 0.04));
  float cloudShape = softCircle * smoothstep(0.18, 0.84, sampleA.a * 0.66 + sampleB.r * 0.38);

  float lifeFade = smoothstep(0.0, 0.18, vAge) * (1.0 - smoothstep(0.45, 1.0, vAge));
  float groundFade = smoothstep(-0.35, 0.85, vWorldPos.y);
  float alpha = cloudShape * lifeFade * groundFade * uOpacityScale;

  if (alpha < 0.004) {
    discard;
  }

  vec3 viewDir = normalize(vWorldPos - cameraPosition);
  vec3 sunDir = normalize(uSunDirection);
  float forwardScatter = pow(max(dot(viewDir, sunDir), 0.0), 3.2);
  float sideScatter = clamp(dot(normalize(vec3(vWorldPos.x, vWorldPos.y + 4.0, vWorldPos.z)), sunDir) * 0.5 + 0.5, 0.0, 1.0);

  vec3 coolMist = vec3(0.44, 0.53, 0.62);
  vec3 sunlitMist = vec3(1.06, 0.79, 0.55);
  vec3 goldenRim = vec3(1.38, 0.87, 0.48);

  float sunExposure = smoothstep(0.5, 9.5, vWorldPos.y) * 0.65 + 0.35;
  vec3 color = mix(coolMist, sunlitMist, clamp((sideScatter * 0.55 + forwardScatter * 0.6) * sunExposure, 0.0, 0.92));
  color += goldenRim * forwardScatter * 0.44 * sunExposure * (1.0 - softCircle * 0.45);

  float camDist = length(cameraPosition - vWorldPos);
  float nearCamFade = smoothstep(2.5, 7.5, camDist);

  gl_FragColor = vec4(color, alpha * nearCamFade);
}
`;

export const SPRAY_DROPLET_VERTEX_SHADER = /* glsl */ `
attribute vec3 aVelocity;
attribute vec3 aParams;

uniform float uTime;
uniform float uPixelRatio;

varying float vAlpha;
varying float vSparkle;
varying vec3 vWorldPos;

void main() {
  float duration = aParams.x;
  float seed = aParams.y;
  float baseSize = aParams.z;

  float t = fract((uTime + seed * duration) / duration) * duration;
  float age = t / duration;

  vec3 pos = position;
  pos.x += aVelocity.x * t + sin(uTime * 1.1 + seed * 20.0) * 0.32 * age;
  pos.y += aVelocity.y * t - 4.4 * t * t;
  pos.z += aVelocity.z * t;

  if (pos.y < -0.1) {
    pos.y = -100.0;
  }

  vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;

  float fadeIn = smoothstep(0.0, 0.12, age);
  float fadeOut = 1.0 - smoothstep(0.55, 1.0, age);
  vAlpha = fadeIn * fadeOut * smoothstep(-0.05, 0.35, pos.y);
  vSparkle = pow(sin(uTime * 6.5 + seed * 47.0) * 0.5 + 0.5, 4.0);

  float sizeAtten = (baseSize * uPixelRatio * 48.0) / max(-mvPosition.z, 1.0);
  gl_PointSize = clamp(sizeAtten, 1.0, 14.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const SPRAY_DROPLET_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uSunDirection;

varying float vAlpha;
varying float vSparkle;
varying vec3 vWorldPos;

void main() {
  vec2 centered = gl_PointCoord - 0.5;
  float dist = length(centered);
  if (dist > 0.5) {
    discard;
  }

  float disc = pow(1.0 - dist * 2.0, 1.7);
  vec3 viewDir = normalize(vWorldPos - cameraPosition);
  vec3 sunDir = normalize(uSunDirection);
  float sunCatch = pow(max(dot(viewDir, sunDir), 0.0), 2.2);

  vec3 baseSpray = vec3(0.76, 0.85, 0.94);
  vec3 goldGlint = vec3(1.55, 1.12, 0.72);
  vec3 color = mix(baseSpray, goldGlint, clamp(sunCatch * 0.75 + vSparkle * 0.65, 0.0, 1.0));

  float alpha = disc * vAlpha * (0.42 + vSparkle * 0.45);
  if (alpha < 0.01) {
    discard;
  }

  gl_FragColor = vec4(color, alpha);
}
`;
