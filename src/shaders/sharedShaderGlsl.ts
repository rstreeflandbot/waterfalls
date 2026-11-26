export const SHARED_ATMOS_AND_SHADOW_GLSL = /* glsl */ `
float linearizeDepth(float depthSample, float cameraNear, float cameraFar) {
  float ndc = depthSample * 2.0 - 1.0;
  return (2.0 * cameraNear * cameraFar) / max(cameraFar + cameraNear - ndc * (cameraFar - cameraNear), 0.0001);
}

float unpackThreeShadowDepth(vec4 packed) {
  const float unpackDownscale = 255.0 / 256.0;
  const vec4 unpackFactors = vec4(
    unpackDownscale,
    unpackDownscale / 256.0,
    unpackDownscale / 65536.0,
    1.0 / 16777216.0
  );
  return dot(packed, unpackFactors);
}

float sampleSunShadowPcf(
  vec3 worldPos,
  vec3 worldNormal,
  vec3 sunDir,
  sampler2D shadowMap,
  mat4 shadowMatrix,
  float shadowMapSize
) {
  vec3 biasedPos = worldPos + worldNormal * 0.14 + sunDir * 0.08;
  vec4 shadowCoord = shadowMatrix * vec4(biasedPos, 1.0);
  if (shadowCoord.w <= 0.0) {
    return 1.0;
  }
  vec3 proj = shadowCoord.xyz / shadowCoord.w;
  if (proj.x < 0.01 || proj.x > 0.99 || proj.y < 0.01 || proj.y > 0.99 || proj.z > 1.0) {
    return 1.0;
  }

  float currentDepth = proj.z - 0.0018;
  float texelSize = 1.0 / max(shadowMapSize, 1.0);
  float lit = 0.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y)) * texelSize * 1.45;
      float storedDepth = unpackThreeShadowDepth(texture2D(shadowMap, proj.xy + offset));
      lit += currentDepth <= storedDepth ? 1.0 : 0.0;
    }
  }
  return lit / 9.0;
}

vec3 applyLinearHeightFog(vec3 color, vec3 worldPos, vec3 camPos, vec3 sunDir) {
  vec3 toFrag = worldPos - camPos;
  float dist = length(toFrag);
  vec3 viewDir = toFrag / max(dist, 0.0001);

  float heightAtten = exp(-max(worldPos.y, 0.0) * 0.022);
  float fogDensity = 0.0052 * (0.45 + 0.55 * heightAtten);
  float fogFactor = clamp(1.0 - exp(-pow(dist * fogDensity, 1.45)), 0.0, 0.88);

  float sunAlign = max(dot(viewDir, normalize(sunDir)), 0.0);
  vec3 coolLinearFog = vec3(0.024, 0.034, 0.048);
  vec3 warmLinearFog = vec3(0.16, 0.095, 0.048);
  vec3 fogColor = mix(coolLinearFog, warmLinearFog, pow(sunAlign, 2.8) * 0.72);

  return mix(color, fogColor, fogFactor);
}
`;
