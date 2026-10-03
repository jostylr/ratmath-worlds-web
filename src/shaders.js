// GLSL ES 3.00 port of RatMathWorlds/Renderer/Shaders/Mandelbulb.metal.
// The field and shading sections are a line-for-line translation; keep them
// in step with that file. Only type names, atan2 -> atan, saturate and
// isfinite differ.

export const MAX_MARKERS = 32;

export const VERTEX = `#version 300 es
void main() {
  vec2 positions[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
}`;

const SHARED = `#version 300 es
precision highp float;
precision highp int;

uniform vec4 uShape;   // power, iterations, max ray steps, shadow steps
uniform vec4 uJulia;   // xyz: fixed c, w: 0 = Mandelbulb ... 1 = Julia
uniform vec4 uExtras;  // theta phase, phi phase, slice height, palette
out vec4 fragColor;

bool finite(float x) { return !(isnan(x) || isinf(x)); }
float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }

vec3 rotateX(vec3 p, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

vec3 rotateY(vec3 p, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// ---- Shared field ----

// The mathematical definition of the object, shared by the windowed and the
// immersive renderers. math.js mirrors this on the CPU.
struct BulbParams {
  float power;
  uint iterations;
  vec3 juliaC;
  float juliaMix;
  float phaseTheta;
  float phasePhi;
  float cutOffset;
};

struct FieldSample {
  float distance;
  // x: closest approach to a ring around the polar axis, y: closest approach
  // to the origin, z: closest approach to the equatorial plane,
  // w: 1 when the nearest surface is the slice plane.
  vec4 trap;
  // Distance from the origin at which the orbit ended.
  float orbitEnd;
};

BulbParams readParams() {
  BulbParams b;
  b.power = uShape.x;
  b.iterations = uint(uShape.y);
  b.juliaC = uJulia.xyz;
  b.juliaMix = uJulia.w;
  b.phaseTheta = uExtras.x;
  b.phasePhi = uExtras.y;
  b.cutOffset = uExtras.z;
  return b;
}

FieldSample bulbField(vec3 point, BulbParams b) {
  vec3 z = point;
  // Mandelbulb: c is the point being tested. Julia: c is one fixed value.
  vec3 c = mix(point, b.juliaC, b.juliaMix);
  float derivative = 1.0;
  float radius = 0.0;
  vec3 trap = vec3(10.0);

  for (uint i = 0u; i < b.iterations; ++i) {
    radius = length(z);
    trap = min(trap, vec3(abs(length(z.xy) - 0.45), radius, abs(z.z)));
    if (radius > 4.0) { break; }

    float safeRadius = max(radius, 1e-6);
    float theta = acos(clamp(z.z / safeRadius, -1.0, 1.0));
    float phi = atan(z.y, z.x);
    float radialPower = pow(safeRadius, b.power - 1.0);
    derivative = radialPower * b.power * derivative + (1.0 - b.juliaMix);

    float zr = radialPower * safeRadius;
    theta = theta * b.power + b.phaseTheta;
    phi = phi * b.power + b.phasePhi;
    z = zr * vec3(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta)) + c;
  }

  float distance = 0.5 * log(max(radius, 1e-6)) * radius / max(derivative, 1e-6);
  // Keep only the half-space below the slice plane.
  float cut = point.y - b.cutOffset;
  FieldSample result;
  result.distance = max(distance, cut);
  result.trap = vec4(trap, cut > distance ? 1.0 : 0.0);
  result.orbitEnd = length(z);
  return result;
}

float bulbDistance(vec3 p, BulbParams b) {
  return bulbField(p, b).distance;
}

vec3 bulbNormal(vec3 p, BulbParams b, float e) {
  vec2 h = vec2(e, -e);
  vec3 gradient =
    h.xyy * bulbDistance(p + h.xyy, b) +
    h.yyx * bulbDistance(p + h.yyx, b) +
    h.yxy * bulbDistance(p + h.yxy, b) +
    h.xxx * bulbDistance(p + h.xxx, b);
  float gradientLength = length(gradient);
  return finite(gradientLength) && gradientLength > 1e-12
    ? gradient / gradientLength
    : vec3(0.0, 0.0, 1.0);
}

// scale shrinks the absolute step sizes as the camera moves in, so shadows
// keep the same apparent softness at every zoom level.
float softShadow(vec3 origin, vec3 direction, BulbParams b, uint steps, float scale) {
  float result = 1.0;
  float travel = 0.025 * scale;
  uint shadowSteps = min(steps, 40u);
  for (uint i = 0u; i < shadowSteps; ++i) {
    float h = bulbDistance(origin + direction * travel, b);
    if (!finite(h)) { break; }
    result = min(result, 14.0 * h / travel);
    travel += clamp(h, 0.008 * scale, 0.14);
    if (h < 0.0004 * scale || travel > 5.0) { break; }
  }
  return clamp(result, 0.0, 1.0);
}

float ambientOcclusion(vec3 p, vec3 n, BulbParams b, float scale) {
  float occlusion = 0.0;
  float weight = 1.0;
  for (int i = 1; i <= 5; ++i) {
    float h = scale * float(i);
    float d = bulbDistance(p + n * h, b);
    occlusion += max(h - d, 0.0) / scale * weight;
    weight *= 0.62;
  }
  return clamp(1.0 - 0.33 * occlusion, 0.0, 1.0);
}

vec2 intersectBoundingSphere(vec3 origin, vec3 direction, float radius) {
  float projectedOrigin = dot(origin, direction);
  float discriminant = projectedOrigin * projectedOrigin
    - (dot(origin, origin) - radius * radius);
  if (discriminant < 0.0 || !finite(discriminant)) {
    return vec2(-1.0);
  }
  float root = sqrt(discriminant);
  return vec2(-projectedOrigin - root, -projectedOrigin + root);
}

// Low powers and Julia sets have a wider outer envelope than the classic
// power-8 bulb. Keep the acceleration bound conservative.
float boundingRadius(BulbParams b) {
  float radius = b.power < 3.0 ? 2.15 : (b.power < 5.0 ? 1.90 : 1.65);
  return radius + 0.5 * b.juliaMix;
}

// ---- Shared shading ----

vec3 background(vec3 direction) {
  float upper = saturate(direction.y * 0.5 + 0.5);
  float horizon = pow(saturate(1.0 - abs(direction.y)), 6.0);
  vec3 base = mix(vec3(0.004, 0.005, 0.012), vec3(0.012, 0.018, 0.045), upper);
  return base + horizon * vec3(0.020, 0.014, 0.040);
}

vec3 paletteColor(uint palette, vec4 trap) {
  float ring = exp(-9.0 * trap.x);
  float core = saturate(trap.y);
  float plane = exp(-6.0 * trap.z);

  if (palette == 1u) { // Glacier
    vec3 color = mix(vec3(0.03, 0.10, 0.22), vec3(0.55, 0.85, 1.0), ring);
    return mix(color, vec3(0.05, 0.55, 0.50), 0.45 * plane * (1.0 - ring));
  }
  if (palette == 2u) { // Spectrum
    float t = core * 1.35 + ring * 0.30 + plane * 0.12;
    return 0.5 + 0.45 * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67)));
  }
  if (palette == 3u) { // Chalk
    return vec3(0.80, 0.78, 0.74) * (0.72 + 0.28 * ring);
  }
  // Ember
  vec3 color = mix(vec3(0.42, 0.10, 0.03), vec3(1.0, 0.62, 0.16), ring);
  color = mix(color, vec3(0.70, 0.16, 0.20), 0.55 * plane * (1.0 - ring));
  return mix(vec3(0.20, 0.05, 0.10), color, 0.35 + 0.65 * core);
}

// The slice plane shows interior points, which never escape. Band them by how
// far from the origin their orbit has settled, so the cut reads as a contour
// map of the interior dynamics.
vec3 sliceColor(uint palette, vec4 trap, float orbitEnd) {
  vec3 base = paletteColor(palette, trap);
  float bands = 0.5 + 0.5 * cos(34.0 * orbitEnd);
  return mix(base * 0.35, base * 0.9 + 0.08, smoothstep(0.15, 0.85, bands));
}

vec3 shadeSurface(
  vec3 albedo,
  vec3 normal,
  vec3 viewDirection,   // from the camera toward the surface
  vec3 lightDirection,
  float shadow,
  float occlusion
) {
  float diffuse = saturate(dot(normal, lightDirection));
  vec3 halfVector = normalize(lightDirection - viewDirection);
  float specular = pow(saturate(dot(normal, halfVector)), 42.0);
  float rim = pow(saturate(1.0 + dot(normal, viewDirection)), 3.0);
  float sky = 0.5 + 0.5 * normal.y;

  vec3 color = albedo * vec3(1.0, 0.94, 0.86) * (1.55 * diffuse * shadow);
  color += albedo * mix(vec3(0.05, 0.045, 0.06), vec3(0.16, 0.20, 0.30), sky) * occlusion;
  color += vec3(1.0, 0.95, 0.85) * specular * shadow * 0.22;
  color += vec3(0.16, 0.26, 0.52) * rim * occlusion * 0.35;
  return color;
}

// Filmic curve (Narkowicz ACES fit). Metal's render target converts to sRGB
// itself; a canvas does not, so the encoding is applied here.
vec3 toneMap(vec3 x) {
  x *= 0.9;
  x = saturate((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
  return mix(12.92 * x, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x));
}
`;

export const WINDOWED_FRAGMENT = SHARED + `
// ---- Explorer markers ----

float sphereHit(vec3 ro, vec3 rd, vec3 center, float radius) {
  vec3 oc = ro - center;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - radius * radius;
  float h = b * b - c;
  return h > 0.0 ? -b - sqrt(h) : -1.0;
}

// Ray against a capsule from pa to pb (after Inigo Quilez).
float capsuleHit(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float radius) {
  vec3 ba = pb - pa;
  vec3 oa = ro - pa;
  float baba = dot(ba, ba);
  if (baba < 1e-12) { return -1.0; }
  float bard = dot(ba, rd);
  float baoa = dot(ba, oa);
  float rdoa = dot(rd, oa);
  float oaoa = dot(oa, oa);
  float a = baba - bard * bard;
  float b = baba * rdoa - baoa * bard;
  float c = baba * oaoa - baoa * baoa - radius * radius * baba;
  float h = b * b - a * c;
  if (h >= 0.0 && abs(a) > 1e-12) {
    float t = (-b - sqrt(h)) / a;
    float y = baoa + t * bard;
    if (y > 0.0 && y < baba) { return t; }
    vec3 oc = (y <= 0.0) ? oa : ro - pb;
    b = dot(rd, oc);
    c = dot(oc, oc) - radius * radius;
    h = b * b - c;
    if (h > 0.0) { return -b - sqrt(h); }
  }
  return -1.0;
}

// ---- Windowed renderer ----

uniform vec4 uResolutionAndCone; // xy: drawable size, z: pixel-cone factor, w: vertical shift
uniform vec4 uCamera;            // yaw, pitch, distance from focus, quality (0, 1, 2)
uniform vec4 uFocus;             // xyz: point the camera orbits
uniform int uMarkerCount;
// Pairs of (position, radius) and (colour, connect-to-next flag).
uniform vec4 uMarkers[${2 * MAX_MARKERS}];

void main() {
  vec2 resolution = uResolutionAndCone.xy;
  // gl_FragCoord has a bottom-left origin, so Metal's y flip is not needed.
  vec2 uv = (gl_FragCoord.xy / resolution) * 2.0 - 1.0;
  vec2 screen = uv;
  // Fit the shorter side of the view, so the object is never cropped in
  // portrait layouts.
  float aspect = resolution.x / resolution.y;
  uv.x *= aspect;
  uv /= min(aspect, 1.0);
  // Moves the object up the screen when a caption covers the lower part.
  uv.y -= uResolutionAndCone.w;

  float yaw = uCamera.x;
  float pitch = uCamera.y;
  uint quality = uint(uCamera.w);

  BulbParams b = readParams();
  uint maxSteps = uint(uShape.z);
  uint shadowSteps = uint(uShape.w);
  uint palette = uint(uExtras.w);

  vec3 rayOrigin = rotateY(rotateX(vec3(0.0, 0.0, uCamera.z), pitch), yaw) + uFocus.xyz;
  vec3 rayDirection = rotateY(rotateX(normalize(vec3(uv * 0.72, -1.65)), pitch), yaw);
  // The key light travels with the camera so close-up views are never unlit.
  vec3 lightDirection = rotateY(rotateX(normalize(vec3(-0.55, 0.70, 0.55)), pitch), yaw);

  float vignette = 1.0 - 0.28 * dot(screen, screen);
  vec3 color = background(rayDirection);
  float surfaceTravel = 1e20;

  vec2 bounds = intersectBoundingSphere(rayOrigin, rayDirection, boundingRadius(b));
  if (bounds.y > 0.0) {
    float travel = max(bounds.x, 0.0);
    float maximumTravel = bounds.y;
    float cone = uResolutionAndCone.z;
    FieldSample fs;
    bool hit = false;
    uint steps = 0u;
    float threshold = 1e-6;

    for (; steps < maxSteps; ++steps) {
      vec3 p = rayOrigin + rayDirection * travel;
      fs = bulbField(p, b);
      if (!finite(fs.distance)) { break; }
      // The hit tolerance follows the width of a pixel at this depth, so
      // detail sharpens automatically as the camera approaches.
      threshold = max(cone * travel, 1e-6);
      if (fs.distance < threshold) {
        hit = true;
        break;
      }
      travel += max(fs.distance * 0.72, threshold * 0.35);
      if (!finite(travel) || travel > maximumTravel) { break; }
    }

    if (hit) {
      surfaceTravel = travel;
      vec3 p = rayOrigin + rayDirection * travel;
      float stepShade = 1.0 - float(steps) / float(maxSteps);
      bool onSlice = fs.trap.w > 0.5;
      vec3 albedo = onSlice
        ? sliceColor(palette, fs.trap, fs.orbitEnd)
        : paletteColor(palette, fs.trap);

      if (quality == 0u) {
        // During manipulation on constrained devices, omit the extra
        // distance-estimator calls needed for a surface normal.
        color = albedo * (0.10 + 0.75 * stepShade * stepShade);
      } else {
        float e = max(threshold * 1.5, 4e-6);
        vec3 normal = bulbNormal(p, b, e);
        float shadow = 1.0;
        float occlusion = stepShade;
        if (quality >= 2u) {
          float scale = clamp(travel / 2.5, 0.002, 1.0);
          occlusion = ambientOcclusion(p, normal, b, max(threshold * 6.0, 0.012 * scale));
          occlusion *= 0.55 + 0.45 * stepShade;
          if (shadowSteps > 0u) {
            shadow = softShadow(p + normal * threshold * 3.0, lightDirection, b, shadowSteps, scale);
          }
        }
        color = shadeSurface(albedo, normal, rayDirection, lightDirection, shadow, occlusion);
      }
    }
  }

  // The explorer's point and its orbit, drawn as small spheres joined by
  // rods. Markers behind the surface show through it faintly, because most
  // of an interior point's orbit lies inside the solid.
  if (uMarkerCount > 0) {
    float best = 1e20;
    vec3 markerColor = vec3(1.0);
    vec3 markerNormal = -rayDirection;
    for (int i = 0; i < ${MAX_MARKERS}; ++i) {
      if (i >= uMarkerCount) { break; }
      vec4 placement = uMarkers[2 * i];
      vec4 tint = uMarkers[2 * i + 1];
      float t = sphereHit(rayOrigin, rayDirection, placement.xyz, placement.w);
      if (t > 0.0 && t < best) {
        best = t;
        markerColor = tint.rgb;
        markerNormal = normalize(rayOrigin + rayDirection * t - placement.xyz);
      }
      if (tint.w > 0.5 && i + 1 < uMarkerCount) {
        vec4 next = uMarkers[2 * (i + 1)];
        float rod = min(placement.w, next.w) * 0.28;
        float t2 = capsuleHit(rayOrigin, rayDirection, placement.xyz, next.xyz, rod);
        if (t2 > 0.0 && t2 < best) {
          best = t2;
          markerColor = 0.5 * (tint.rgb + uMarkers[2 * (i + 1) + 1].rgb);
          markerNormal = -rayDirection;
        }
      }
    }
    if (best < 1e19) {
      vec3 lit = markerColor * (0.55 + 0.75 * saturate(dot(markerNormal, lightDirection)));
      color = best > surfaceTravel ? mix(color, lit, 0.42) : lit;
    }
  }

  fragColor = vec4(toneMap(color * vignette), 1.0);
}
`;

// One draw per eye, with that eye's viewport and matrices.
export const IMMERSIVE_FRAGMENT = SHARED + `
uniform vec4 uViewport;
uniform mat4 uInverseViewProjection;
uniform mat4 uViewProjection;
uniform vec4 uCameraPosition;
uniform vec4 uCenterAndScale;
uniform vec4 uRotationAndEpsilon;
uniform float uInteracting;

void main() {
  // Reconstruct this eye's world-space ray from its own viewport and
  // projection instead of assuming a monoscopic camera.
  vec2 ndc = (gl_FragCoord.xy - uViewport.xy) / uViewport.zw * 2.0 - 1.0;
  vec4 worldFarHomogeneous = uInverseViewProjection * vec4(ndc, 1.0, 1.0);
  vec3 worldFar = worldFarHomogeneous.xyz / worldFarHomogeneous.w;
  vec3 worldOrigin = uCameraPosition.xyz;
  vec3 worldDirection = normalize(worldFar - worldOrigin);

  float scale = max(uCenterAndScale.w, 0.01);
  vec3 localOrigin = (worldOrigin - uCenterAndScale.xyz) / scale;
  vec3 localDirection = worldDirection;
  localOrigin = rotateY(rotateX(localOrigin, uRotationAndEpsilon.y), uRotationAndEpsilon.x);
  localDirection = rotateY(rotateX(localDirection, uRotationAndEpsilon.y), uRotationAndEpsilon.x);

  BulbParams b = readParams();
  uint palette = uint(uExtras.w);
  uint maximumSteps = uint(uShape.z);
  bool interactionMode = uInteracting > 0.5;
  float epsilon = uRotationAndEpsilon.z;

  vec2 bounds = intersectBoundingSphere(localOrigin, localDirection, boundingRadius(b));

  vec3 color = background(worldDirection);
  gl_FragDepth = 1.0; // WebGL depth runs 0 (near) to 1 (far), unlike Metal's reverse-Z
  if (bounds.y > 0.0) {
    float travel = max(bounds.x, 0.0);
    float maximumTravel = bounds.y;
    FieldSample fs;
    bool hit = false;
    uint steps = 0u;
    float threshold = epsilon;

    for (; steps < maximumSteps; ++steps) {
      vec3 point = localOrigin + localDirection * travel;
      fs = bulbField(point, b);
      if (!finite(fs.distance)) { break; }
      threshold = epsilon * max(1.0, travel * 0.35);
      if (fs.distance < threshold) {
        hit = true;
        break;
      }
      travel += max(fs.distance * 0.72, threshold * 0.35);
      if (!finite(travel) || travel > maximumTravel) { break; }
    }

    if (hit) {
      vec3 point = localOrigin + localDirection * travel;
      float stepShade = 1.0 - float(steps) / max(float(maximumSteps), 1.0);
      vec3 albedo = fs.trap.w > 0.5
        ? sliceColor(palette, fs.trap, fs.orbitEnd)
        : paletteColor(palette, fs.trap);

      if (interactionMode) {
        color = albedo * (0.10 + 0.75 * stepShade * stepShade);
      } else {
        vec3 normal = bulbNormal(point, b, max(epsilon * 1.7, 0.0003));
        vec3 lightDirection = normalize(vec3(-0.55, 0.75, 0.45));
        color = shadeSurface(albedo, normal, localDirection, lightDirection, 1.0, stepShade);
      }

      vec3 worldHit = worldOrigin + worldDirection * (travel * scale);
      vec4 clipHit = uViewProjection * vec4(worldHit, 1.0);
      float projectedDepth = clipHit.z / clipHit.w * 0.5 + 0.5;
      gl_FragDepth = finite(projectedDepth) ? clamp(projectedDepth, 0.0, 1.0) : 1.0;
    }
  }

  fragColor = vec4(toneMap(color), 1.0);
}
`;
