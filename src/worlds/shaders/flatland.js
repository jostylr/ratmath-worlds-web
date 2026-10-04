// Flatland.metal in GLSL, written by make-shaders.py from the app's
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

// The size of one pixel, in view units.
float fPixel(vec4 resolutionAndCone) {
    return 2.0 / min(resolutionAndCone.x, resolutionAndCone.y);
}

// The top edge and the right edge of the view, in view units.
vec2 fViewExtent(vec4 resolutionAndCone) {
    float aspect = resolutionAndCone.x / resolutionAndCone.y;
    return vec2(aspect, 1.0) / min(aspect, 1.0);
}

float fSegmentDistance(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = saturate(dot(p - a, ab) / max(dot(ab, ab), 1e-12));
    return length(p - a - ab * t);
}

// A remainder that is never negative, the same in Metal and in GLSL.
float fWrap(float x, float period) {
    return x - period * floor(x / period);
}

// How much of a pixel a line of half-width width covers at distance d.
float fStroke(float d, float width, float pixel) {
    return smoothstep(width + pixel, width - 0.5 * pixel, d);
}

// The explorer's marks, in view coordinates. markers holds pairs of
// vec4: a shape, then (colour, kind).
//   kind 0: dot at xy with radius z
//   kind 1: segment from xy to zw
//   kind 2: ring with centre xy and radius z
vec3 fDrawMarkers(
    vec3 color,
    vec2 uv,
    float pixel,
    int markerCount
) {
    for (int i = 0; i < markerCount; ++i) {
        vec4 shape = markers[2 * i];
        vec4 tint = markers[2 * i + 1];
        if (tint.w < 0.5) {
            float away = length(uv - shape.xy);
            float coverage = smoothstep(shape.z + pixel, shape.z - pixel, away);
            // A dark rim keeps the dot readable on any colour.
            float rim = smoothstep(shape.z * 0.62, shape.z * 0.82, away);
            color = mix(color, mix(tint.rgb, vec3(0.02), rim * 0.8), coverage);
        } else if (tint.w < 1.5) {
            float d = fSegmentDistance(uv, shape.xy, shape.zw);
            color = mix(color, tint.rgb, fStroke(d, 0.0035, pixel) * 0.92);
        } else {
            float d = abs(length(uv - shape.xy) - shape.z);
            color = mix(color, tint.rgb, fStroke(d, 0.0025, pixel) * 0.85);
        }
    }
    return color;
}



// Flatland: a plane of shapes, drawn from above and as one of them sees it.
//
// v[0]: eye x, eye y, heading, fog
// v[1]: view (0 both, 1 from above, 2 the eye alone), visitor (0 none,
//       1 sphere, 2 cube), the visitor's height above the plane, needle angle
// v[2]: field of view, plane units per view unit on the map, the map's shift
//       up the view, explorer flag
// v[3]: the explorer's ray: direction (an angle in the plane)
//
// FlatlandWorld.swift has the same scene, for walking and for the explorer.

#define kFlatMapCentre vec2(0.0, -0.3)
#define kFlatVisitor vec2(0.4, 0.3)
#define kFlatSphereRadius 0.9
#define kFlatCubeHalfSide 0.62

// A regular polygon: radius to its corners, one side facing along turn.
float flatPolygon(vec2 p, vec2 centre, float radius, float sides, float turn) {
    vec2 q = p - centre;
    float sector = 6.2831853 / sides;
    float angle = fWrap(atan2(q.y, q.x) - turn + 0.5 * sector, sector) - 0.5 * sector;
    return length(q) * cos(angle) - radius * cos(0.5 * sector);
}

float flatVisitor(vec2 p, float kind, float height) {
    vec2 q = p - kFlatVisitor;
    if (kind < 0.5) { return 1e6; }
    if (kind < 1.5) {
        // A sphere meets the plane in a circle, or not at all.
        float inside = kFlatSphereRadius * kFlatSphereRadius - height * height;
        return inside > 0.0 ? length(q) - sqrt(inside) : 1e6;
    }
    // A cube balanced on one corner: three pairs of faces, each leaning
    // the same way from the upright.
    float d = -1e6;
    for (int i = 0; i < 3; ++i) {
        float around = 2.0943951 * float(i) + 0.4;
        vec3 axis = vec3(0.8164966 * cos(around), 0.8164966 * sin(around), 0.5773503);
        d = max(d, abs(dot(axis, vec3(q, height))) - kFlatCubeHalfSide);
    }
    return d * 1.2247449;
}

// The nearest shape: its distance, and which it is.
vec2 flatScene(vec2 p, WorldUniforms u) {
    vec2 best = vec2(flatPolygon(p, vec2(-2.7, -0.3), 0.62, 3.0, 0.5), 1.0);
    float d = flatPolygon(p, vec2(-1.6, 1.7), 0.62, 4.0, 0.3);
    if (d < best.x) { best = vec2(d, 2.0); }
    d = flatPolygon(p, vec2(0.3, 2.5), 0.66, 5.0, 0.2);
    if (d < best.x) { best = vec2(d, 3.0); }
    d = flatPolygon(p, vec2(2.1, 1.5), 0.70, 6.0, 0.0);
    if (d < best.x) { best = vec2(d, 4.0); }
    d = length(p - vec2(2.9, -0.5)) - 0.6;
    if (d < best.x) { best = vec2(d, 5.0); }
    vec2 along = 0.55 * vec2(cos(u.v[1].w), sin(u.v[1].w));
    d = fSegmentDistance(p, vec2(-1.1, -1.3) - along, vec2(-1.1, -1.3) + along) - 0.025;
    if (d < best.x) { best = vec2(d, 6.0); }
    d = flatVisitor(p, u.v[1].y, u.v[1].z);
    if (d < best.x) { best = vec2(d, 7.0); }
    return best;
}

// Follows a line of sight: how far it gets, and what it meets (0: nothing).
vec2 flatTrace(vec2 origin, vec2 direction, float reach, WorldUniforms u) {
    float travelled = 0.0;
    for (int i = 0; i < 72; ++i) {
        vec2 nearest = flatScene(origin + direction * travelled, u);
        if (nearest.x < 0.003) { return vec2(travelled, nearest.y); }
        // Nothing is nearer than this, so the line is clear that far.
        travelled += nearest.x;
        if (travelled > reach) { break; }
    }
    return vec2(reach, 0.0);
}

vec3 flatPaint(float shape, int palette) {
    if (palette == 1) { return vec3(0.78, 0.80, 0.84); }
    if (shape < 1.5) { return vec3(0.95, 0.30, 0.16); }
    if (shape < 2.5) { return vec3(0.95, 0.70, 0.14); }
    if (shape < 3.5) { return vec3(0.30, 0.78, 0.36); }
    if (shape < 4.5) { return vec3(0.20, 0.55, 0.95); }
    if (shape < 5.5) { return vec3(0.68, 0.44, 0.95); }
    if (shape < 6.5) { return vec3(0.95, 0.42, 0.66); }
    return vec3(0.96, 0.96, 0.92);
}

// Everything the eye has: one line, brighter where things are nearer.
vec3 flatEye(float across, float upright, WorldUniforms u) {
    float heading = u.v[0].z;
    float angle = heading - across * 0.5 * u.v[2].x;
    vec2 hit = flatTrace(u.v[0].xy, vec2(cos(angle), sin(angle)), 30.0, u);
    vec3 color = vec3(0.006, 0.008, 0.016);
    if (hit.y > 0.5) {
        color = flatPaint(hit.y, int(u.budget.z)) * exp(-u.v[0].w * hit.x);
    }
    return color * (0.80 + 0.20 * (1.0 - upright * upright));
}

vec3 flatStrip(vec3 color, vec2 uv, vec2 centre, vec2 size, float pixel,
                        WorldUniforms u) {
    vec2 local = (uv - centre) / size;
    vec2 q = (abs(local) - 1.0) * size;
    float box = max(q.x, q.y);
    if (box > 0.012) { return color; }
    if (box > 0.0) { return vec3(0.50, 0.54, 0.68); }
    vec3 inner = flatEye(local.x, local.y, u);
    // A notch marks straight ahead.
    float notch = fStroke(abs(local.x) * size.x, 0.002, pixel) * step(0.72, abs(local.y));
    inner = mix(inner, vec3(1.0, 0.70, 0.05), notch);
    if (u.v[2].w > 0.5) {
        // The explorer's line of sight.
        float at = (u.v[0].z - u.v[3].x) / (0.5 * u.v[2].x);
        inner = mix(inner, vec3(1.0), fStroke(abs(local.x - at) * size.x, 0.0025, pixel));
    }
    return inner;
}

vec3 flatMap(vec2 uv, float pixel, WorldUniforms u) {
    float scale = u.v[2].y;
    vec2 p = kFlatMapCentre + (uv - vec2(0.0, u.v[2].z)) * scale;
    float px = pixel * scale;
    vec2 eye = u.v[0].xy;
    float heading = u.v[0].z;
    int palette = int(u.budget.z);

    vec3 color = vec3(0.020, 0.024, 0.040);
    vec2 cell = abs(fract(p + 0.5) - 0.5);
    color += vec3(0.012, 0.014, 0.022) * fStroke(min(cell.x, cell.y), 0.004, px);

    // What the eye's light reaches: within its field of view, and not
    // behind anything.
    vec2 toPoint = p - eye;
    float range = length(toPoint);
    vec2 direction = toPoint / max(range, 1e-5);
    float offAxis = acos(clamp(dot(direction, vec2(cos(heading), sin(heading))), -1.0, 1.0));
    float inView = smoothstep(0.5 * u.v[2].x + 0.01, 0.5 * u.v[2].x - 0.01, offAxis);
    float lit = 0.0;
    if (inView > 0.0) {
        vec2 sight = flatTrace(eye, direction, range, u);
        lit = inView * smoothstep(range - 0.06, range - 0.02, sight.x) * exp(-u.v[0].w * range);
    }
    color += vec3(0.085, 0.075, 0.035) * lit;

    vec2 nearest = flatScene(p, u);
    vec3 paint = flatPaint(nearest.y, palette);
    if (nearest.x < 0.0) { color = paint * 0.20; }
    // Outlines; the stretches the eye can see are bright.
    float outline = fStroke(abs(nearest.x), 0.012, px);
    color = mix(color, paint * (0.36 + 0.64 * min(lit * 1.6, 1.0)), outline);

    // A. Square, with his eye at the front corner.
    vec2 forward = vec2(cos(heading), sin(heading));
    vec2 body = p - (eye - forward * 0.14);
    vec2 turned = vec2(dot(body, forward), dot(body, vec2(-forward.y, forward.x)));
    float bodyDistance = max(abs(turned.x), abs(turned.y)) - 0.10;
    color = mix(color, vec3(0.90, 0.90, 0.86), fStroke(abs(bodyDistance), 0.008, px));
    if (bodyDistance < 0.0) { color = mix(color, vec3(0.90, 0.90, 0.86), 0.35); }
    color = mix(color, vec3(1.0, 0.70, 0.05), smoothstep(0.05 + px, 0.05 - px, length(p - eye)));

    return fDrawMarkers(color, uv, pixel, int(u.budget.w));
}

vec4 flatlandFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);
    float pixel = fPixel(u.resolutionAndCone);
    vec2 extent = fViewExtent(u.resolutionAndCone);
    bool tall = extent.y > 1.2;

    vec3 color = vec3(0.010, 0.012, 0.022);
    if (u.v[1].x < 1.5) {
        color = flatMap(uv, pixel, u);
    }
    if (u.v[1].x < 0.5) {
        // The eye's line, as a band: above the map in a wide view, where the
        // top is clear, and beneath it in a tall one.
        vec2 size = vec2(tall ? extent.x - 0.08 : 0.58, 0.09);
        color = flatStrip(color, uv, vec2(0.0, tall ? -0.78 : 0.86), size, pixel, u);
    } else if (u.v[1].x > 1.5) {
        vec2 size = vec2(min(extent.x - 0.08, 1.3), 0.20);
        color = flatStrip(color, uv, vec2(0.0, 0.12), size, pixel, u);
    }
    return vec4(color, 1.0);
}

uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(flatlandFragment(position, U).rgb, 1.0);
}
`;
