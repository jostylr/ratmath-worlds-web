// Mandelbrot.metal in GLSL, written by make-shaders.py from the app's
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



// The Mandelbrot set and its Julia sets: z → z² + c, repeated.
//
// v[0]: centre of the view (x, y), plane units per view unit, step limit
// v[1]: picture (0 Mandelbrot set, 1 Julia set), c.x, c.y, small picture flag
//
// Markers are the flat worlds' own (see Flat2D.h), in view coordinates.

// Runs the rule from z. Returns a smoothly varying step count, or −1 for a
// point that never left, and the first step at which |z| passed 2.
vec2 mandelEscape(vec2 z, vec2 c, int limit) {
    float first = -1.0;
    for (int i = 0; i < limit; ++i) {
        float x2 = z.x * z.x;
        float y2 = z.y * z.y;
        float r2 = x2 + y2;
        if (first < 0.0 && r2 > 4.0) { first = float(i); }
        // Carrying on to 16 lets the count be smoothed between steps.
        if (r2 > 256.0) {
            return vec2(float(i) + 2.0 - log2(0.5 * log2(r2)), first);
        }
        z = vec2(x2 - y2 + c.x, 2.0 * z.x * z.y + c.y);
    }
    if (first >= 0.0) { return vec2(float(limit), first); }
    return vec2(-1.0, first);
}

vec3 mandelColor(vec2 escape, int palette) {
    if (escape.x < 0.0) { return vec3(0.004, 0.005, 0.010); }
    if (palette == 1) { // Bands: one flat colour for each count
        float n = escape.y;
        vec3 base = wCosinePalette(n * 0.045 + 0.5, vec3(0.5), vec3(0.5),
                                     vec3(1.0), vec3(0.0, 0.10, 0.20));
        return (base * base * 0.85 + vec3(0.004, 0.010, 0.030)) * (fWrap(n, 2.0) < 0.5 ? 1.0 : 0.55);
    }
    float t = 0.11 * sqrt(max(escape.x, 0.0));
    if (palette == 2) { // Ember
        float s = 0.5 - 0.5 * cos(6.2831853 * (t * 0.9 + 0.04));
        return vec3(pow(s, 0.8), 0.78 * pow(s, 1.9), 0.62 * pow(s, 4.2)) + vec3(0.012, 0.004, 0.002);
    }
    // Dawn: deep blue far away, through gold and white, and round again.
    // Squared, because the palette is chosen by eye and the target is linear.
    vec3 dawn = wCosinePalette(t + 0.5, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.10, 0.20));
    // Points that leave at once are far from the set, and are kept dark.
    return dawn * dawn * (1.0 - 0.95 * exp(-escape.x / 9.0));
}

vec3 mandelSample(vec2 uv, WorldUniforms u) {
    vec2 plane = u.v[0].xy + uv * u.v[0].z;
    int limit = int(u.v[0].w);
    vec2 escape = u.v[1].x > 0.5
        ? mandelEscape(plane, u.v[1].yz, limit)
        : mandelEscape(vec2(0.0), plane, limit);
    return mandelColor(escape, int(u.budget.z));
}

// The small picture at the top: the Julia set of c beside the Mandelbrot
// set, or the Mandelbrot set with c marked beside a Julia set.
vec3 mandelInset(vec3 color, vec2 uv, float pixel, WorldUniforms u) {
    if (u.v[1].w < 0.5) { return color; }
    vec2 extent = fViewExtent(u.resolutionAndCone);
    float top = extent.y - u.resolutionAndCone.w;
    float size = 0.27;
    // A tall window keeps the small picture clear of the way back.
    float margin = extent.y > 1.2 ? 0.26 : 0.06;
    vec2 local = (uv - vec2(0.0, top - margin - size)) / size;
    float reach = max(abs(local.x), abs(local.y));
    if (reach > 1.05) { return color; }
    if (reach > 1.0) { return vec3(0.62, 0.66, 0.80); }

    vec2 c = u.v[1].yz;
    int limit = min(int(u.v[0].w), 200);
    int palette = int(u.budget.z);
    if (u.v[1].x > 0.5) {
        vec2 p = vec2(-0.6, 0.0) + local * 1.45;
        vec3 inner = mandelColor(mandelEscape(vec2(0.0), p, limit), palette);
        float away = length(p - c) / 1.45;
        inner = mix(inner, vec3(0.02), smoothstep(0.075, 0.060, away));
        return mix(inner, vec3(1.0, 0.85, 0.25), smoothstep(0.052, 0.040, away));
    }
    return mandelColor(mandelEscape(local * 1.7, c, limit), palette);
}

vec4 mandelbrotFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);
    float pixel = fPixel(u.resolutionAndCone);

    vec3 color = vec3(0.0);
    if (u.camera.w > 1.5) {
        // Four samples per pixel once the picture is still.
        const vec2 offsets[4] = vec2[4](vec2(-0.375, -0.125), vec2(0.125, -0.375),
            vec2(0.375, 0.125), vec2(-0.125, 0.375));
        for (int i = 0; i < 4; ++i) {
            color += mandelSample(uv + offsets[i] * pixel, u);
        }
        color *= 0.25;
    } else {
        color = mandelSample(uv, u);
    }

    color = fDrawMarkers(color, uv, pixel, int(u.budget.w));
    color = mandelInset(color, uv, pixel, u);
    return vec4(color, 1.0);
}

uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(mandelbrotFragment(position, U).rgb, 1.0);
}
`;
