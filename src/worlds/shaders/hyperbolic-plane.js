// HyperbolicPlane.metal in GLSL, written by make-shaders.py from the app's
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


// The hyperbolic plane, tiled by regular p-gons meeting q at a corner.
//
// v[0]: p, q, model blend (0 Poincaré disk ... 1 Klein disk), zoom
// v[1]: a.x, a.y, cos θ, sin θ. A view point w is the plane point
//       z = (e^{iθ} w + a) / (1 + conj(a) e^{iθ} w), so the viewer stands at a.
// v[2]: distance rings flag, triangles flag
//
// Markers (pairs of vec4) carry the constructions:
//   kind 0: dot at view point xy with radius z
//   kind 1: straight line of the plane. A circle with centre xy and radius z
//           meeting the boundary at right angles, or, when z < 0, the
//           diameter whose unit normal is xy. w is the drawn width.
//   kind 2: hyperbolic circle with centre xy and hyperbolic radius z

#define kDiskRadius 0.9

vec2 cMul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 cDiv(vec2 a, vec2 b) {
    float d = max(dot(b, b), 1e-20);
    return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d;
}

struct HyperTiling {
    vec2 mirrorNormal; // normal of the mirror through the centre at angle π/p
    vec2 edgeCenter;   // the tile edge is a circle meeting the boundary squarely
    float edgeRadius;
};

HyperTiling hyperTiling(float p, float q) {
    float sp = sin(M_PI_F / p);
    float cq = cos(M_PI_F / q);
    float denominator = sqrt(max(cq * cq - sp * sp, 1e-6));
    HyperTiling t;
    t.mirrorNormal = vec2(-sp, cos(M_PI_F / p));
    t.edgeCenter = vec2(cq / denominator, 0.0);
    t.edgeRadius = sp / denominator;
    return t;
}

vec3 hyperTileColor(int palette, int reflections, int crossings, vec2 z) {
    bool odd = (reflections & 1) == 1;
    if (palette == 1) { // Triangles
        return odd ? vec3(0.10, 0.20, 0.42) : vec3(0.86, 0.82, 0.70);
    }
    if (palette == 2) { // Chalk
        return vec3(0.88, 0.86, 0.80) * (odd ? 0.94 : 1.0);
    }
    // Rings: one hue per number of edges crossed on the way to the centre.
    vec3 base = wCosinePalette(float(crossings) * 0.085 + 0.58, vec3(0.52), vec3(0.40),
                                 vec3(1.0), vec3(0.0, 0.33, 0.67));
    return base * (odd ? 0.82 : 1.0);
}

vec3 hyperSample(
    vec2 uv,
    float pixel,
    WorldUniforms u
) {
    float zoom = max(u.v[0].w, 0.05);
    vec2 w = uv / (kDiskRadius * zoom);
    float pixelInDisk = pixel / (kDiskRadius * zoom);
    float radius = length(w);
    vec3 outside = vec3(0.012, 0.016, 0.034);
    if (radius >= 1.0) {
        // The boundary circle: infinitely far away from every point inside.
        float rim = smoothstep(3.0 * pixelInDisk, 0.0, radius - 1.0);
        return mix(outside, vec3(0.55, 0.62, 0.80), rim * 0.8);
    }

    // The same plane point drawn in the Klein model sits farther out.
    float blend = saturate(u.v[0].z);
    vec2 poincare = mix(w, w / (1.0 + sqrt(max(1.0 - radius * radius, 0.0))), blend);
    float scale = max(1.0 - dot(poincare, poincare), 1e-6) * 0.5; // view length per unit of true length

    vec2 rotated = cMul(u.v[1].zw, poincare);
    vec2 a = u.v[1].xy;
    vec2 z = cDiv(rotated + a, vec2(1.0, 0.0) + cMul(vec2(a.x, -a.y), rotated));
    vec2 planePoint = z;

    // Fold the point into the one small triangle beside the centre by
    // reflecting it in the triangle's three sides until it stays put.
    HyperTiling tiling = hyperTiling(u.v[0].x, u.v[0].y);
    int reflections = 0;
    int crossings = 0;
    for (int i = 0; i < 90; ++i) {
        bool moved = false;
        if (z.y < 0.0) {
            z.y = -z.y;
            reflections += 1;
            moved = true;
        }
        float side = dot(z, tiling.mirrorNormal);
        if (side > 0.0) {
            z -= 2.0 * side * tiling.mirrorNormal;
            reflections += 1;
            moved = true;
        }
        vec2 d = z - tiling.edgeCenter;
        float d2 = dot(d, d);
        if (d2 < tiling.edgeRadius * tiling.edgeRadius) {
            z = tiling.edgeCenter + d * (tiling.edgeRadius * tiling.edgeRadius / d2);
            reflections += 1;
            crossings += 1;
            moved = true;
        }
        if (!moved) { break; }
    }

    int palette = int(u.budget.z);
    vec3 color = hyperTileColor(palette, reflections, crossings, z);

    // True (hyperbolic) distances from the folded point to the triangle's sides.
    float conformal = max(1.0 - dot(z, z), 1e-6);
    vec2 d = z - tiling.edgeCenter;
    float toEdge = asinh(max(dot(d, d) - tiling.edgeRadius * tiling.edgeRadius, 0.0)
                         / (tiling.edgeRadius * conformal));
    float edgeWidth = 0.024;
    float truePixel = pixelInDisk / scale; // one pixel, in true length
    float edge = smoothstep(edgeWidth + truePixel, edgeWidth, toEdge);
    vec3 edgeColor = palette == 2 ? vec3(0.10, 0.12, 0.20) : vec3(0.02, 0.03, 0.07);
    color = mix(color, edgeColor, edge);

    if (u.v[2].y > 0.5) {
        float toAxis = asinh(2.0 * max(z.y, 0.0) / conformal);
        float toMirror = asinh(2.0 * max(-dot(z, tiling.mirrorNormal), 0.0) / conformal);
        float line = smoothstep(0.014 + truePixel, 0.014, min(toAxis, toMirror));
        color = mix(color, vec3(0.98, 0.92, 0.70), line * 0.85);
    }

    // Close to the boundary the tiles become smaller than a pixel.
    vec3 haze = palette == 2 ? vec3(0.62, 0.62, 0.62) : vec3(0.20, 0.22, 0.34);
    color = mix(color, haze, smoothstep(0.12, 0.7, truePixel));

    // Circles of true radius 1, 2, 3, ... around the viewer.
    if (u.v[2].x > 0.5) {
        float fromViewer = 2.0 * atanh(min(length(poincare), 0.999999));
        float nearest = abs(fromViewer - round(fromViewer));
        float ring = fromViewer > 0.5
            ? smoothstep(2.5 * truePixel, 1.0 * truePixel, nearest)
            : 0.0;
        color = mix(color, vec3(1.0, 0.95, 0.75), ring * 0.9);
    }

    // Constructions.
    int markerCount = int(u.budget.w);
    for (int i = 0; i < markerCount; ++i) {
        vec4 shape = markers[2 * i];
        vec4 tint = markers[2 * i + 1];
        float coverage = 0.0;
        if (tint.w < 0.5) {
            float away = length(w - shape.xy);
            coverage = smoothstep(shape.z + pixelInDisk, shape.z - pixelInDisk, away);
            // A dark rim keeps the dot readable on any tile colour.
            float rim = smoothstep(shape.z * 0.62, shape.z * 0.80, away);
            color = mix(color, mix(tint.rgb, vec3(0.02), rim * 0.8), coverage);
            continue;
        }
        float planeConformal = max(1.0 - dot(planePoint, planePoint), 1e-6);
        float trueDistance;
        if (tint.w < 1.5) {
            if (shape.z < 0.0) {
                trueDistance = asinh(2.0 * abs(dot(planePoint, shape.xy)) / planeConformal);
            } else {
                vec2 e = planePoint - shape.xy;
                trueDistance = asinh(abs(dot(e, e) - shape.z * shape.z)
                                     / (shape.z * planeConformal));
            }
        } else {
            vec2 moved = cDiv(planePoint - shape.xy,
                                vec2(1.0, 0.0) - cMul(vec2(shape.x, -shape.y), planePoint));
            trueDistance = abs(2.0 * atanh(min(length(moved), 0.999999)) - shape.z);
        }
        // Lines keep the same width on screen everywhere.
        float onScreen = trueDistance * scale;
        coverage = smoothstep(shape.w + pixelInDisk, shape.w - 0.5 * pixelInDisk, onScreen);
        color = mix(color, tint.rgb, coverage * 0.95);
    }

    // A soft edge where the disk meets the boundary.
    float rim = smoothstep(1.0 - 3.0 * pixelInDisk, 1.0, radius);
    return mix(color, vec3(0.55, 0.62, 0.80), rim * 0.8);
}

vec4 hyperbolicPlaneFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);
    vec2 resolution = u.resolutionAndCone.xy;
    float pixel = 2.0 / min(resolution.x, resolution.y);

    // Four samples per pixel keep the thin lines near the boundary smooth.
    vec3 color = vec3(0.0);
    const vec2 offsets[4] = vec2[4](vec2(-0.375, -0.125), vec2(0.125, -0.375),
        vec2(0.375, 0.125), vec2(-0.125, 0.375));
    for (int i = 0; i < 4; ++i) {
        color += hyperSample(uv + offsets[i] * pixel, pixel, u);
    }
    color *= 0.25;

    float vignette = 1.0 - 0.18 * dot(screen, screen);
    return vec4(color * vignette, 1.0);
}

uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(hyperbolicPlaneFragment(position, U).rgb, 1.0);
}
`;
