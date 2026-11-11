// Apollonian.metal in GLSL, written by make-shaders.py from the app's
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

    // A cool fill light from the far side of the key, so that faces turned
    // away from the key are still told apart.
    vec3 fillDirection = normalize(vec3(-lightDirection.x, 0.25, -lightDirection.z));
    float fill = saturate(dot(normal, fillDirection));

    vec3 color = albedo * vec3(1.0, 0.94, 0.86) * (1.55 * diffuse * shadow);
    color += albedo * vec3(0.30, 0.36, 0.48) * fill * (0.4 + 0.6 * occlusion);
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

// For flat worlds that pan and zoom with the orbit camera's own numbers,
// looking straight down on the plane z = 0: the point of the plane under a
// view point. Lines drawn by WorldLines.metal land in the same place.
vec2 fPlane(vec2 uv, vec4 focus, vec4 camera) {
    return focus.xy + uv * (camera.z * 0.4363636);
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

// A colour for each place round a wheel, for pictures that tell several
// answers apart: coral, amber and blue a third of a turn apart, with orange,
// sea green and violet between them. They are chosen to sit well together,
// where the plain rainbow's red, green and blue shout. Linear light.
vec3 fTint(float hue) {
    float h = fWrap(hue, 1.0) * 6.0;
    vec3 coral = vec3(0.90, 0.20, 0.13);
    vec3 orange = vec3(0.95, 0.40, 0.10);
    vec3 amber = vec3(0.97, 0.68, 0.13);
    vec3 green = vec3(0.16, 0.62, 0.46);
    vec3 blue = vec3(0.14, 0.38, 0.90);
    vec3 violet = vec3(0.52, 0.22, 0.72);
    vec3 from = h < 1.0 ? coral : (h < 2.0 ? orange : (h < 3.0 ? amber : (h < 4.0 ? green : (h < 5.0 ? blue : violet))));
    vec3 to = h < 1.0 ? orange : (h < 2.0 ? amber : (h < 3.0 ? green : (h < 4.0 ? blue : (h < 5.0 ? violet : coral))));
    float t = h - floor(h);
    return mix(from, to, t * t * (3.0 - 2.0 * t));
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



// The Apollonian gasket, and its relatives among the limit sets of groups
// of circle inversions (Kleinian groups).
//
// Start with four circles that touch in pairs: the unit circle, two circles
// of radius ½ at (±½, 0), and one of radius ⅓ at (0, ⅔). Their curvatures
// are −1, 2, 2 and 3. Through the three points where any three of them
// touch passes a fourth, "mirror" circle; for the triple that leaves out
// the unit circle it is a circle of radius ¼, and for the triple that
// leaves out the small circle it is the line y = 0.
//
// Inverting in the mirrors, over and over, carries the four circles onto
// every circle of the gasket. So a pixel is folded back: while it lies
// inside a mirror it is inverted in it. The number of folds says how deep
// its circle is, and which of the starting circles it lands in says which
// family. ApollonianWorld.swift does the same in double precision.
//
// v[0]: mirror scale (1 for the gasket), fold limit, mirrors shown, outlines
// v[1], v[2], v[3]: mirrors 0, 1, 2 as (centre x, centre y, radius, 0)

struct ApolloniusFold {
    vec2 p;
    float scale;   // how much the folds have magnified a small step
    int folds;
    int last;      // the mirror used last, or −1
    int settled;   // 1 if the point left every mirror within the limit
};

ApolloniusFold apolloniusFold(vec2 p, WorldUniforms u) {
    ApolloniusFold f;
    f.p = p;
    f.scale = 1.0;
    f.folds = 0;
    f.last = -1;
    f.settled = 0;
    int limit = int(u.v[0].y);
    for (int i = 0; i < 400; ++i) {
        // Inside one of the first circles: that circle's copy is this
        // point's circle, and no more folding is needed.
        if (length(f.p - vec2(-0.5, 0.0)) < 0.5 || length(f.p - vec2(0.5, 0.0)) < 0.5
            || length(f.p - vec2(0.0, 2.0 / 3.0)) < 1.0 / 3.0 || length(f.p) > 1.0) {
            f.settled = 1;
            return f;
        }
        if (i >= limit) { return f; }
        bool moved = false;
        // The line y = 0 is a mirror too: there inversion is reflection.
        if (f.p.y < 0.0) {
            f.p.y = -f.p.y;
            f.last = 3;
            moved = true;
        } else {
            for (int m = 0; m < 3; ++m) {
                vec4 c = m == 0 ? u.v[1] : (m == 1 ? u.v[2] : u.v[3]);
                vec2 d = f.p - c.xy;
                float d2 = dot(d, d);
                if (d2 < c.z * c.z && m != f.last) {
                    float k = c.z * c.z / max(d2, 1e-30);
                    f.p = c.xy + d * k;
                    f.scale *= k;
                    f.last = m;
                    moved = true;
                    break;
                }
            }
        }
        if (!moved) {
            f.settled = 1;
            return f;
        }
        f.folds += 1;
    }
    return f;
}

vec3 apolloniusSample(vec2 uv, float pixelSize, WorldUniforms u) {
    vec2 p = fPlane(uv, u.focus, u.camera);
    ApolloniusFold f = apolloniusFold(p, u);
    int palette = int(u.budget.z);
    float depth = float(f.folds);

    if (f.settled == 0) {
        // Still folding at the limit: on or very near the limit set.
        return vec3(0.95, 0.93, 0.86);
    }
    // Which of the three inner starting circles the point has landed in.
    vec2 q = f.p;
    float best = 1e9;
    int which = 0;
    float r1 = length(q - vec2(-0.5, 0.0)) - 0.5;
    float r2 = length(q - vec2(0.5, 0.0)) - 0.5;
    float r3 = length(q - vec2(0.0, 2.0 / 3.0)) - 1.0 / 3.0;
    // The unit circle's disc, as a circle of the gasket, is its outside.
    float r0 = 1.0 - length(q);
    if (r1 < best) { best = r1; which = 1; }
    if (r2 < best) { best = r2; which = 2; }
    if (r3 < best) { best = r3; which = 3; }
    if (r0 < best) { best = r0; which = 0; }
    // Distance to that circle's edge, carried back to the picture.
    float edge = abs(best) / max(f.scale, 1e-30);

    vec3 color;
    if (which == 0 && f.folds == 0) {
        // Outside the unit circle: not part of the picture.
        return vec3(0.012, 0.014, 0.026);
    }
    if (best > 0.0) {
        // In a gap between the circles: only possible when the mirrors do
        // not touch, so the gasket has come apart.
        color = vec3(0.03, 0.035, 0.06) * (1.0 + 0.04 * depth);
    } else if (palette == 1) {
        // By family: which starting circle it is a copy of.
        vec3 tint = which == 0 ? vec3(0.75, 0.75, 0.80)
            : (which == 1 ? vec3(0.85, 0.40, 0.25)
            : (which == 2 ? vec3(0.20, 0.55, 0.80) : vec3(0.85, 0.72, 0.25)));
        color = tint * (0.55 + 0.45 * exp(-depth * 0.06));
    } else {
        // By generation: how many folds it took.
        color = wCosinePalette(depth * 0.085 + 0.55, vec3(0.5), vec3(0.45),
                               vec3(1.0), vec3(0.0, 0.33, 0.67));
        color *= 0.5 + 0.5 * exp(-depth * 0.03);
    }
    // A soft shading toward each circle's rim, so that circles read as discs.
    float inner = saturate(-best / 0.5);
    color *= 0.78 + 0.22 * sqrt(inner);
    // Far from the edge in the folded picture, the stretch measured at the
    // point says nothing about the edge: no outline there.
    if (u.v[0].w > 0.5 && abs(best) < 0.25) {
        color = mix(color, vec3(0.98, 0.95, 0.85), fStroke(edge, 0.6 * pixelSize, pixelSize) * 0.9);
    }
    return color;
}

vec4 apollonianFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);
    float pixel = fPixel(u.resolutionAndCone);
    float pixelSize = pixel * u.camera.z * 0.4363636;

    vec3 color = vec3(0.0);
    if (u.camera.w > 1.5) {
        const vec2 offsets[4] = vec2[4](vec2(-0.375, -0.125), vec2(0.125, -0.375),
            vec2(0.375, 0.125), vec2(-0.125, 0.375));
        for (int i = 0; i < 4; ++i) {
            color += apolloniusSample(uv + offsets[i] * pixel, pixelSize, u);
        }
        color *= 0.25;
    } else {
        color = apolloniusSample(uv, pixelSize, u);
    }

    // The mirrors themselves.
    if (u.v[0].z > 0.5) {
        vec2 p = fPlane(uv, u.focus, u.camera);
        for (int m = 0; m < 3; ++m) {
            vec4 c = m == 0 ? u.v[1] : (m == 1 ? u.v[2] : u.v[3]);
            float d = abs(length(p - c.xy) - c.z);
            color = mix(color, vec3(0.30, 1.0, 0.75), fStroke(d, 1.2 * pixelSize, pixelSize) * 0.9);
        }
        color = mix(color, vec3(0.30, 1.0, 0.75), fStroke(abs(p.y), 1.2 * pixelSize, pixelSize) * 0.9);
    }
    color = fDrawMarkers(color, uv, pixel, int(u.budget.w));
    return vec4(color, 1.0);
}

uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(apollonianFragment(position, U).rgb, 1.0);
}
`;
