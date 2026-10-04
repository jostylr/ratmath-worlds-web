// Logistic.metal in GLSL, written by make-shaders.py from the app's
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



// The logistic map, x → r·x·(1 − x), three ways: the diagram of where it
// ends up for every r, the cobweb for one r, and the values in order.
//
// v[0]: r, picture (0 diagram, 1 cobweb, 2 series), rule (0 logistic, 1 sine), zoom
// v[1]: diagram: centre r, centre x, r per view unit, x per view unit
// v[2]: steps shown, steps skipped first, twin flag, selected step (−1: none)
// v[3]: diagram grid: spacing in r, spacing in x
//
// For the cobweb and the series the values are worked out by the app, where
// the arithmetic is exact enough to trust, and arrive in place of markers:
// 208 numbers for the path, then 208 for its twin.

#define kLogisticTwin 208

float logisticMap(float x, float r, bool sine) {
    return sine ? 0.25 * r * sin(M_PI_F * x) : r * x * (1.0 - x);
}

float logisticSlope(float x, float r, bool sine) {
    return sine ? 0.25 * r * M_PI_F * cos(M_PI_F * x) : r * (1.0 - 2.0 * x);
}

float logisticValue(int index) {
    return markers[index >> 2][index & 3];
}

#define kLogisticPaper vec3(0.010, 0.014, 0.030)
#define kLogisticFrame vec3(0.26, 0.30, 0.44)

// Where the rule ends up, for every r: after a long run-in, the values
// visited are piled up, and a pixel is as bright as the pile that falls on it.
vec3 logisticDiagram(vec2 uv, float pixel, WorldUniforms u) {
    float r = u.v[1].x + uv.x * u.v[1].z;
    float x = u.v[1].y + uv.y * u.v[1].w;
    float dr = pixel * u.v[1].z;
    float dx = pixel * u.v[1].w;
    bool sine = u.v[0].z > 0.5;
    vec3 color = kLogisticPaper;

    // Grid lines, drawn under the diagram.
    float gridR = abs(fWrap(r / u.v[3].x + 0.5, 1.0) - 0.5) * u.v[3].x;
    float gridX = abs(fWrap(x / u.v[3].y + 0.5, 1.0) - 0.5) * u.v[3].y;
    float grid = max(smoothstep(1.2 * dr, 0.4 * dr, gridR), smoothstep(1.2 * dx, 0.4 * dx, gridX));
    color = mix(color, kLogisticFrame, grid * 0.38);

    if (r > 0.0 && r < 4.0 && x > -2.0 * dx && x < 1.0 + 2.0 * dx) {
        bool still = u.camera.w > 1.5;
        int runIn = still ? 500 : 260;
        int count = still ? 500 : 260;
        int columns = still ? 2 : 1;
        float hits = 0.0;
        float stretch = 0.0;
        for (int k = 0; k < columns; ++k) {
            float rr = r + (float(k) - 0.5 * float(columns - 1)) * 0.5 * dr;
            float value = 0.5;
            for (int i = 0; i < runIn; ++i) { value = logisticMap(value, rr, sine); }
            for (int i = 0; i < count; ++i) {
                value = logisticMap(value, rr, sine);
                hits += saturate(1.0 - abs(value - x) / (1.5 * dx));
                stretch += log(max(abs(logisticSlope(value, rr, sine)), 1e-6));
            }
        }
        float samples = float(columns * count);
        // Zooming in spreads the same pile over more pixels.
        float gain = pow(clamp(u.v[0].w, 1.0, 400.0), 0.8);
        float ink = 1.0 - exp(-hits / samples * 500.0 * 0.9 * gain);
        vec3 inkColor = vec3(0.90, 0.94, 1.0);
        if (int(u.budget.z) == 1) {
            // Order and chaos: blue where neighbours close up, amber where
            // they are pushed apart.
            float exponent = stretch / samples;
            inkColor = mix(vec3(0.30, 0.66, 1.0), vec3(1.0, 0.52, 0.10),
                           smoothstep(-0.03, 0.03, exponent));
        }
        color = mix(color, inkColor, ink);
    }

    // The chosen r.
    float chosen = smoothstep(1.6 * dr, 0.6 * dr, abs(r - u.v[0].x));
    return mix(color, vec3(1.0, 0.70, 0.05), chosen * 0.75);
}

vec3 logisticAge(float t) {
    return mix(vec3(0.10, 0.62, 1.0), vec3(1.0, 0.22, 0.50), saturate(t));
}

// The cobweb: up to the curve, across to the diagonal, and again.
vec3 logisticCobweb(vec2 uv, float pixel, WorldUniforms u) {
    float zoom = max(u.v[0].w, 0.05);
    float unit = 0.72 / zoom;
    vec2 p = vec2(0.5) + uv * unit;
    float px = pixel * unit;
    float r = u.v[0].x;
    bool sine = u.v[0].z > 0.5;
    vec3 color = kLogisticPaper;

    vec2 q = abs(p - 0.5);
    float box = max(q.x, q.y) - 0.5;
    if (box < 0.0) { color = vec3(0.016, 0.022, 0.046); }
    color = mix(color, kLogisticFrame, fStroke(abs(box), 0.0015 * unit, px));
    if (box > 0.02) { return color; }

    // The diagonal, where the next value equals this one.
    color = mix(color, vec3(0.50, 0.55, 0.70), fStroke(abs(p.y - p.x) * 0.7071, 0.002 * unit, px) * 0.8);
    // The rule's own curve.
    float slope = logisticSlope(p.x, r, sine);
    float toCurve = abs(p.y - logisticMap(p.x, r, sine)) / sqrt(1.0 + slope * slope);
    color = mix(color, vec3(0.95, 0.90, 0.70), fStroke(toCurve, 0.003 * unit, px));

    int steps = int(u.v[2].x);
    int selected = int(u.v[2].w);
    bool fromAxis = u.v[2].y < 0.5;
    float value = logisticValue(0);
    for (int i = 0; i < steps; ++i) {
        float next = logisticValue(i + 1);
        float d = fSegmentDistance(p, vec2(value, (i == 0 && fromAxis) ? 0.0 : value), vec2(value, next));
        d = min(d, fSegmentDistance(p, vec2(value, next), vec2(next, next)));
        bool chosen = i == selected;
        vec3 tint = chosen ? vec3(1.0) : logisticAge(float(i) / float(max(steps - 1, 1)));
        color = mix(color, tint, fStroke(d, (chosen ? 0.004 : 0.0018) * unit, px) * (chosen ? 1.0 : 0.85));
        value = next;
    }
    float start = length(p - vec2(logisticValue(0), fromAxis ? 0.0 : logisticValue(0)));
    return mix(color, vec3(1.0, 0.70, 0.05), smoothstep(0.016 * unit + px, 0.016 * unit - px, start));
}

// The values in order, left to right, with the twin's in pink.
vec3 logisticSeries(vec2 uv, float pixel, WorldUniforms u) {
    vec2 extent = fViewExtent(u.resolutionAndCone);
    float halfWidth = 0.88 * extent.x;
    float halfHeight = 0.50;
    int steps = int(u.v[2].x);
    int selected = int(u.v[2].w);
    vec3 color = kLogisticPaper;

    vec2 q = abs(uv) - vec2(halfWidth, halfHeight);
    float box = max(q.x, q.y);
    if (box < 0.0) { color = vec3(0.016, 0.022, 0.046); }
    color = mix(color, kLogisticFrame, fStroke(abs(box), 0.0015, pixel));
    color = mix(color, kLogisticFrame, fStroke(abs(uv.y), 0.001, pixel) * 0.5 * step(abs(uv.x), halfWidth));
    if (box > 0.03) { return color; }

    float across = 2.0 * halfWidth / float(max(steps, 1));
    // Only the few segments near this pixel can reach it.
    int nearest = int(floor((uv.x + halfWidth) / across));
    for (int pass = 0; pass < 2; ++pass) {
        // The twin goes underneath.
        bool twin = pass == 0;
        if (twin && u.v[2].z < 0.5) { continue; }
        int base = twin ? kLogisticTwin : 0;
        vec3 tint = twin ? vec3(1.0, 0.22, 0.50) : vec3(0.10, 0.62, 1.0);
        for (int i = max(nearest - 1, 0); i <= min(nearest + 1, steps - 1); ++i) {
            vec2 a = vec2(-halfWidth + across * float(i),
                              (logisticValue(base + i) - 0.5) * 2.0 * halfHeight);
            vec2 b = vec2(-halfWidth + across * float(i + 1),
                              (logisticValue(base + i + 1) - 0.5) * 2.0 * halfHeight);
            color = mix(color, tint, fStroke(fSegmentDistance(uv, a, b), 0.0022, pixel) * 0.9);
            float size = (!twin && (i == selected || i + 1 == selected)) ? 0.016 : 0.007;
            vec2 mark = (!twin && i + 1 == selected) ? b : a;
            vec3 markTint = (!twin && (i == selected || i + 1 == selected)) ? vec3(1.0) : tint;
            color = mix(color, markTint, smoothstep(size + pixel, size - pixel, length(uv - mark)));
            color = mix(color, tint, smoothstep(0.007 + pixel, 0.007 - pixel, length(uv - b)));
        }
    }
    return color;
}

vec4 logisticFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);
    float pixel = fPixel(u.resolutionAndCone);

    vec3 color;
    if (u.v[0].y < 0.5) {
        color = logisticDiagram(uv, pixel, u);
    } else if (u.v[0].y < 1.5) {
        color = logisticCobweb(uv, pixel, u);
    } else {
        color = logisticSeries(uv, pixel, u);
    }
    return vec4(color, 1.0);
}

uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(logisticFragment(position, U).rgb, 1.0);
}
`;
