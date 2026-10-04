// QuaternionJulia.metal in GLSL, written by web/make-shaders.py from the app's
// Metal shaders. Do not edit: change the Metal files and run the script again.

export const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;

#define M_PI_F 3.14159265358979
#define fmod mod
#define atan2 atan

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2 saturate(vec2 x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }
bool isfinite(float x) { return !(isnan(x) || isinf(x)); }

uniform vec4 markers[192];


// Every field is a vec4 so Swift and Metal have identical layouts.
struct WorldUniforms {
    vec4 resolutionAndCone; // xy: drawable size, z: pixel-cone factor, w: vertical shift
    vec4 camera;            // yaw, pitch, distance from focus, quality (0, 1, 2)
    vec4 focus;             // xyz: point the camera orbits, w: time in seconds
    vec4 budget;            // max ray steps, shadow steps, palette, marker count
    vec4 v[8];              // the world's own thirty-two numbers
};

// One instance is supplied for each eye.

struct WorldValues {
    vec4 v[8];
};

// What a distance field reports at one point: a lower bound on the distance
// to the surface, and four numbers of the world's choosing for colouring.
struct WorldSample {
    float distance;
    vec4 trap;
};


vec3 wRotateX(vec3 p, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

vec3 wRotateY(vec3 p, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 wBackground(vec3 direction) {
    float upper = saturate(direction.y * 0.5 + 0.5);
    float horizon = pow(saturate(1.0 - abs(direction.y)), 6.0);
    vec3 base = mix(vec3(0.004, 0.005, 0.012),
                      vec3(0.012, 0.018, 0.045), upper);
    return base + horizon * vec3(0.020, 0.014, 0.040);
}

vec3 wShade(
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

// Filmic curve (Narkowicz ACES fit). The render targets are sRGB or linear
// float, so no extra gamma is applied here.
vec3 wToneMap(vec3 x) {
    x *= 0.9;
    return saturate((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
}

// A smooth rainbow-like ramp (after Inigo Quilez).
vec3 wCosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.2831853 * (c * t + d));
}

vec2 wBoundingSphere(vec3 origin, vec3 direction, float radius) {
    float projected = dot(origin, direction);
    float discriminant = projected * projected - (dot(origin, origin) - radius * radius);
    if (discriminant < 0.0 || !isfinite(discriminant)) {
        return vec2(-1.0);
    }
    float root = sqrt(discriminant);
    return vec2(-projected - root, -projected + root);
}

float wSphereHit(vec3 ro, vec3 rd, vec3 center, float radius) {
    vec3 oc = ro - center;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - radius * radius;
    float h = b * b - c;
    return h > 0.0 ? -b - sqrt(h) : -1.0;
}

// Ray against a capsule from pa to pb (after Inigo Quilez).
float wCapsuleHit(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float radius) {
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

// The explorer's points, drawn as small spheres joined by rods. markers
// holds pairs of (position, radius) and (colour, connect-to-next flag).
// Markers behind the surface show through it faintly.
vec3 wDrawMarkers(
    vec3 color,
    vec3 rayOrigin,
    vec3 rayDirection,
    vec3 lightDirection,
    float surfaceTravel,
    int markerCount
) {
    if (markerCount == 0) { return color; }
    float best = 1e20;
    vec3 markerColor = vec3(1.0);
    vec3 markerNormal = -rayDirection;
    for (int i = 0; i < markerCount; ++i) {
        vec4 placement = markers[2 * i];
        vec4 tint = markers[2 * i + 1];
        float t = wSphereHit(rayOrigin, rayDirection, placement.xyz, placement.w);
        if (t > 0.0 && t < best) {
            best = t;
            markerColor = tint.rgb;
            markerNormal = normalize(rayOrigin + rayDirection * t - placement.xyz);
        }
        if (tint.w > 0.5 && i + 1 < markerCount) {
            vec4 next = markers[2 * (i + 1)];
            float rod = min(placement.w, next.w) * 0.28;
            float t2 = wCapsuleHit(rayOrigin, rayDirection, placement.xyz, next.xyz, rod);
            if (t2 > 0.0 && t2 < best) {
                best = t2;
                markerColor = 0.5 * (tint.rgb + markers[2 * (i + 1) + 1].rgb);
                markerNormal = -rayDirection;
            }
        }
    }
    if (best < 1e19) {
        vec3 lit = markerColor
            * (0.55 + 0.75 * saturate(dot(markerNormal, lightDirection)));
        return best > surfaceTravel ? mix(color, lit, 0.42) : lit;
    }
    return color;
}

// View coordinates of a pixel: the shorter side of the view spans -1...1,
// y points up, and the vertical shift has been applied.
vec2 wViewCoordinates(vec4 position, vec4 resolutionAndCone, inout vec2 screen) {
    vec2 resolution = resolutionAndCone.xy;
    vec2 uv = (position.xy / resolution) * 2.0 - 1.0;
    uv.y = -uv.y;
    screen = uv;
    float aspect = resolution.x / resolution.y;
    uv.x *= aspect;
    uv /= min(aspect, 1.0);
    uv.y -= resolutionAndCone.w;
    return uv;
}


// The Julia set of q → q² + c over the quaternions, seen as a
// three-dimensional slice of a four-dimensional set. A quaternion
// a + bi + cj + dk is stored as (a, b, c, d).
//
// v[0]: iterations, slice position w, cut depth (large = no cut)
// v[1], v[2], v[3]: the slice's directions e₁, e₂, e₃
// v[4]: the hidden direction n
// v[5]: the constant c

vec4 juliaPoint(vec3 u, WorldValues P) {
    return u.x * P.v[1] + u.y * P.v[2] + u.z * P.v[3] + P.v[0].y * P.v[4];
}

// q² = (a² − b² − c² − d², 2ab, 2ac, 2ad)
vec4 quaternionSquare(vec4 q) {
    return vec4(q.x * q.x - dot(q.yzw, q.yzw), 2.0 * q.x * q.yzw);
}

// QuaternionJuliaMath.distance in QuaternionJuliaWorld.swift mirrors this.
WorldSample worldField(vec3 u, WorldValues P) {
    vec4 q = juliaPoint(u, P);
    vec4 start = q;
    vec4 c = P.v[5];
    int iterations = int(P.v[0].x + 0.5);

    // |dq| follows the size of the derivative: each squaring doubles it and
    // multiplies it by |q|.
    float derivative = 1.0;
    float size2 = dot(q, q);
    vec3 trap = vec3(10.0);
    for (int i = 0; i < iterations; ++i) {
        derivative *= 2.0 * sqrt(size2);
        q = quaternionSquare(q) + c;
        size2 = dot(q, q);
        trap = min(trap, vec3(abs(q.x), length(q.yz), size2));
        if (size2 > 16.0) { break; }
    }
    float size = sqrt(size2);
    float d = 0.5 * size * log(max(size, 1e-6)) / max(derivative, 1e-6);

    // Keep only the part behind the cut plane.
    float cut = u.z - P.v[0].z;
    WorldSample res;
    res.distance = max(d, cut);
    res.trap = vec4(trap.xy, start.w, cut > d ? 1.0 : 0.0);
    return res;
}

float worldBoundRadius(WorldValues P) {
    return 2.1;
}

vec3 worldAlbedo(vec3 u, WorldSample s, int palette, WorldValues P) {
    vec3 color;
    if (palette == 1) {
        // Hidden coordinate: the k part of the point where the slice meets
        // the set.
        float t = clamp(s.trap.z / 0.8, -1.0, 1.0);
        vec3 middle = vec3(0.86, 0.86, 0.82);
        color = t < 0.0
            ? mix(middle, vec3(0.10, 0.32, 0.95), -t)
            : mix(middle, vec3(1.0, 0.42, 0.06), t);
    } else if (palette == 2) { // Chalk
        color = vec3(0.80, 0.78, 0.74);
    } else {
        // Orbit: how close the point's path came to the real axis and to
        // the plane of i and j.
        float nearAxis = exp(-4.0 * s.trap.y);
        float nearPlane = exp(-5.0 * s.trap.x);
        color = mix(vec3(0.10, 0.22, 0.48), vec3(0.25, 0.80, 0.90), nearPlane);
        color = mix(color, vec3(1.0, 0.78, 0.36), nearAxis * 0.85);
    }
    if (s.trap.w > 0.5) {
        // The cut face shows the solid inside.
        color = mix(color, vec3(0.94, 0.90, 0.80), 0.55);
    }
    return color;
}

#define WORLD_STEP_SCALE 0.7
#ifndef WORLD_STEP_SCALE
#define WORLD_STEP_SCALE 0.9
#endif

float wFieldDistance(vec3 p, WorldValues P) {
    return worldField(p, P).distance;
}

vec3 wFieldNormal(vec3 p, WorldValues P, float e) {
    vec2 h = vec2(e, -e);
    vec3 gradient =
        h.xyy * wFieldDistance(p + h.xyy, P) +
        h.yyx * wFieldDistance(p + h.yyx, P) +
        h.yxy * wFieldDistance(p + h.yxy, P) +
        h.xxx * wFieldDistance(p + h.xxx, P);
    float gradientLength = length(gradient);
    return isfinite(gradientLength) && gradientLength > 1e-12
        ? gradient / gradientLength
        : vec3(0.0, 0.0, 1.0);
}

// scale shrinks the absolute step sizes as the camera moves in, so shadows
// keep the same apparent softness at every zoom level.
float wSoftShadow(vec3 origin, vec3 direction, WorldValues P, int steps, float scale) {
    float result = 1.0;
    float travel = 0.025 * scale;
    int shadowSteps = min(steps, 40);
    for (int i = 0; i < shadowSteps; ++i) {
        float h = wFieldDistance(origin + direction * travel, P);
        if (!isfinite(h)) { break; }
        result = min(result, 14.0 * h / travel);
        travel += clamp(h, 0.008 * scale, 0.14);
        if (h < 0.0004 * scale || travel > 5.0) { break; }
    }
    return clamp(result, 0.0, 1.0);
}

float wAmbientOcclusion(vec3 p, vec3 n, WorldValues P, float scale) {
    float occlusion = 0.0;
    float weight = 1.0;
    for (int i = 1; i <= 5; ++i) {
        float h = scale * float(i);
        float d = wFieldDistance(p + n * h, P);
        occlusion += max(h - d, 0.0) / scale * weight;
        weight *= 0.62;
    }
    return clamp(1.0 - 0.33 * occlusion, 0.0, 1.0);
}

// MARK: - Windowed renderer

vec4 quaternionJuliaFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);

    float yaw = u.camera.x;
    float pitch = u.camera.y;
    int quality = int(u.camera.w);
    int maxSteps = int(u.budget.x);
    int shadowSteps = int(u.budget.y);
    int palette = int(u.budget.z);

    WorldValues P;
    for (int i = 0; i < 8; ++i) { P.v[i] = u.v[i]; }

    vec3 rayOrigin = wRotateY(wRotateX(vec3(0.0, 0.0, u.camera.z), pitch), yaw)
        + u.focus.xyz;
    vec3 rayDirection = wRotateY(wRotateX(normalize(vec3(uv * 0.72, -1.65)), pitch), yaw);
    // The key light travels with the camera so close-up views are never unlit.
    vec3 lightDirection = wRotateY(wRotateX(normalize(vec3(-0.55, 0.70, 0.55)), pitch), yaw);

    float vignette = 1.0 - 0.28 * dot(screen, screen);
    vec3 color = wBackground(rayDirection);
    float surfaceTravel = 1e20;

    vec2 bounds = wBoundingSphere(rayOrigin, rayDirection, worldBoundRadius(P));
    if (bounds.y > 0.0) {
        float travel = max(bounds.x, 0.0);
        float maximumTravel = bounds.y;
        float cone = u.resolutionAndCone.z;
        WorldSample smp;
        bool hit = false;
        int steps = 0;
        float threshold = 1e-6;

        for (; steps < maxSteps; ++steps) {
            vec3 p = rayOrigin + rayDirection * travel;
            smp = worldField(p, P);
            if (!isfinite(smp.distance)) { break; }
            // The hit tolerance follows the width of a pixel at this depth, so
            // detail sharpens automatically as the camera approaches.
            threshold = max(cone * travel, 1e-6);
            if (smp.distance < threshold) {
                hit = true;
                break;
            }
            travel += max(smp.distance * WORLD_STEP_SCALE, threshold * 0.35);
            if (!isfinite(travel) || travel > maximumTravel) { break; }
        }

        if (hit) {
            surfaceTravel = travel;
            vec3 p = rayOrigin + rayDirection * travel;
            float stepShade = 1.0 - float(steps) / float(maxSteps);
            vec3 albedo = worldAlbedo(p, smp, palette, P);

            if (quality == 0) {
                // During manipulation on constrained devices, omit the extra
                // field evaluations needed for a surface normal.
                color = albedo * (0.10 + 0.75 * stepShade * stepShade);
            } else {
                float e = max(threshold * 1.5, 4e-6);
                vec3 normal = wFieldNormal(p, P, e);
                float shadow = 1.0;
                float occlusion = 0.5 + 0.5 * stepShade;
                if (quality >= 2) {
                    float scale = clamp(travel / 2.5, 0.002, 1.0);
                    occlusion = wAmbientOcclusion(p, normal, P, max(threshold * 6.0, 0.012 * scale));
                    occlusion *= 0.55 + 0.45 * stepShade;
                    if (shadowSteps > 0) {
                        // Never fully black, so rooms the light cannot reach
                        // directly still read.
                        shadow = 0.22 + 0.78 * wSoftShadow(p + normal * threshold * 3.0,
                                                           lightDirection, P, shadowSteps, scale);
                    }
                }
                color = wShade(albedo, normal, rayDirection, lightDirection, shadow, occlusion);
            }
        }
    }

    color = wDrawMarkers(color, rayOrigin, rayDirection, lightDirection,
                         surfaceTravel, int(u.budget.w));
    return vec4(wToneMap(color * vignette), 1.0);
}


uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(quaternionJuliaFragment(position, U).rgb, 1.0);
}
`;
