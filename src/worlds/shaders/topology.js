// Topology.metal in GLSL, written by make-shaders.py from the app's
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


// One-sided and two-sided surfaces.
//
// v[0]: surface (0 band, 1 figure-eight tube, 2 Klein bottle, 3 Roman
//       surface, 4 cross-cap), half-twists, cut gap, seam angle
// v[1]: band half-width, cut-away height (large = whole surface)
//
// The band and the figure-eight tube are a flat shape swept round a circle
// while it turns; the other three are the zero sets of polynomials.

#define TOPO_RING 1.15
#define TOPO_SHEET 0.022

float topoWrap(float angle) {
    return angle - 6.2831853 * floor((angle + 3.14159265) / 6.2831853);
}

// A polynomial's value divided by the size of its gradient is, close to the
// surface, the distance to it. Farther off it can overshoot, so a ray is
// never allowed a long step on its strength.
float topoSheet(float f, vec3 gradient, float scale) {
    return min(abs(f) / max(length(gradient), 1e-3) / scale, 0.16) - TOPO_SHEET;
}

// TopologyMath.distance in TopologyWorld.swift mirrors the swept surfaces.
WorldSample worldField(vec3 p, WorldValues P) {
    int surface = int(P.v[0].x + 0.5);
    float d;
    float side = 0.0;
    float across = 0.0;

    if (surface <= 1) {
        float halfTwists = P.v[0].y;
        float seam = P.v[0].w;
        float rho = length(p.xz);
        // Measured from the seam, so the place where the turn "wraps round"
        // can be moved without changing the shape.
        float phi = topoWrap(atan2(p.z, p.x) - seam);
        float turn = 0.5 * halfTwists * (phi + seam);
        float c = cos(turn);
        float s = sin(turn);
        vec2 section = vec2(rho - TOPO_RING, p.y);
        // (a, b): across the strip, and through it.
        vec2 q = vec2(c * section.x + s * section.y, -s * section.x + c * section.y);
        if (surface == 0) {
            float halfWidth = P.v[1].x;
            vec2 e = abs(q) - vec2(halfWidth, TOPO_SHEET);
            d = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
            // A cut down the middle of the strip.
            float gap = P.v[0].z;
            if (gap > 0.0) { d = max(d, gap - abs(q.x)); }
            side = q.y > 0.0 ? 1.0 : 0.0;
            across = q.x / halfWidth;
        } else {
            // A figure of eight: b² = a²(1 − a²), scaled.
            float size = 0.52;
            vec2 w = q / size;
            float g = w.y * w.y - w.x * w.x * (1.0 - w.x * w.x);
            vec2 gradient = vec2(-2.0 * w.x + 4.0 * w.x * w.x * w.x, 2.0 * w.y);
            d = abs(g) / max(length(gradient), 0.05) * size - TOPO_SHEET;
            // "Left of the curve" is inside one loop and outside the other.
            side = (g < 0.0) == (w.x > 0.0) ? 1.0 : 0.0;
            across = w.x;
        }
    } else if (surface == 2) {
        // The Klein bottle with a neck:
        // (r² + 2y − 1)((r² − 2y − 1)² − 8z²) + 16xz(r² − 2y − 1) = 0
        float scale = 2.3;
        vec3 x = vec3(p.x, p.z, p.y) * scale + vec3(0.0, 0.3, 0.0);
        float r2 = dot(x, x);
        float A = r2 + 2.0 * x.y - 1.0;
        float B = r2 - 2.0 * x.y - 1.0;
        float C = B * B - 8.0 * x.z * x.z;
        float f = A * C + 16.0 * x.x * x.z * B;
        vec3 dA = vec3(2.0 * x.x, 2.0 * x.y + 2.0, 2.0 * x.z);
        vec3 dB = vec3(2.0 * x.x, 2.0 * x.y - 2.0, 2.0 * x.z);
        vec3 gradient = dA * C + A * (2.0 * B * dB - vec3(0.0, 0.0, 16.0 * x.z))
            + 16.0 * x.x * x.z * dB + 16.0 * B * vec3(x.z, 0.0, x.x);
        d = topoSheet(f, gradient, scale);
        side = f > 0.0 ? 1.0 : 0.0;
    } else if (surface == 3) {
        // The Roman surface: x²y² + y²z² + z²x² = k·xyz
        float k = 2.9;
        vec3 x = p;
        vec3 x2 = x * x;
        float f = x2.x * x2.y + x2.y * x2.z + x2.z * x2.x - k * x.x * x.y * x.z;
        vec3 gradient = vec3(
            2.0 * x.x * (x2.y + x2.z) - k * x.y * x.z,
            2.0 * x.y * (x2.z + x2.x) - k * x.z * x.x,
            2.0 * x.z * (x2.x + x2.y) - k * x.x * x.y);
        // The equation also holds all along the three axes; the surface
        // itself stops at k⁄2.
        vec3 beyond = abs(x) - 0.5 * k;
        d = max(topoSheet(f, gradient, 1.0), max(beyond.x, max(beyond.y, beyond.z)));
        side = f > 0.0 ? 1.0 : 0.0;
    } else {
        // The cross-cap: 4x²(r² + z) + y²(y² + z² − 1) = 0
        float scale = 0.72;
        vec3 x = vec3(p.x, p.z, p.y) * scale;
        float r2 = dot(x, x);
        float f = 4.0 * x.x * x.x * (r2 + x.z) + x.y * x.y * (x.y * x.y + x.z * x.z - 1.0);
        vec3 gradient = vec3(
            8.0 * x.x * (r2 + x.z) + 8.0 * x.x * x.x * x.x,
            8.0 * x.x * x.x * x.y + 2.0 * x.y * (x.y * x.y + x.z * x.z - 1.0) + 2.0 * x.y * x.y * x.y,
            4.0 * x.x * x.x * (2.0 * x.z + 1.0) + 2.0 * x.y * x.y * x.z);
        // The equation also holds all along the z-axis; the surface stops at ±1.
        d = max(topoSheet(f, gradient, scale), (abs(x.z) - 1.02) / scale);
        side = f > 0.0 ? 1.0 : 0.0;
    }

    // Keep only the part below the cut-away plane.
    float cut = p.y - P.v[1].y;
    WorldSample res;
    res.distance = max(d, cut);
    res.trap = vec4(side, across, 0.0, cut > d ? 1.0 : 0.0);
    return res;
}

float worldBoundRadius(WorldValues P) {
    return 2.4;
}

vec3 worldAlbedo(vec3 p, WorldSample s, int palette, WorldValues P) {
    if (s.trap.w > 0.5) {
        return vec3(0.92, 0.90, 0.84); // the rim left by the cut-away
    }
    if (palette == 1) { // Across: a stripe pattern that shows the twist
        float stripe = 0.5 + 0.5 * cos(9.42 * s.trap.y);
        return mix(vec3(0.16, 0.30, 0.55), vec3(0.92, 0.86, 0.66), stripe);
    }
    if (palette == 2) { // Chalk
        return vec3(0.80, 0.78, 0.74);
    }
    // Sides: an attempt to paint the two faces different colours.
    return s.trap.x > 0.5 ? vec3(0.95, 0.46, 0.10) : vec3(0.10, 0.38, 0.90);
}

#define WORLD_STEP_SCALE 0.5
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

vec4 topologyFragment(vec4 inPosition, WorldUniforms u) {

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
    fragColor = vec4(topologyFragment(position, U).rgb, 1.0);
}
`;
