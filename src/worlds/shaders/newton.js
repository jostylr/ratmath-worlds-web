// Newton.metal in GLSL, written by make-shaders.py from the app's
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



// Newton's method for the roots of zⁿ = 1, tried from every starting point.
//
// v[0]: degree n, step size a (1 is Newton's own), step limit
//
// The view is the orbit camera's, looking straight down (see fPlane).

vec2 newtonPower(vec2 z, int n) {
    vec2 w = vec2(1.0, 0.0);
    for (int i = 0; i < n; ++i) {
        w = vec2(w.x * z.x - w.y * z.y, w.x * z.y + w.y * z.x);
    }
    return w;
}

vec3 newtonSample(vec2 uv, WorldUniforms u) {
    vec2 z = fPlane(uv, u.focus, u.camera);
    int degree = int(u.v[0].x);
    float size = u.v[0].y;
    int limit = int(u.v[0].z);
    float steps = -1.0;
    for (int i = 0; i < limit; ++i) {
        vec2 below = newtonPower(z, degree - 1);
        vec2 value = vec2(below.x * z.x - below.y * z.y, below.x * z.y + below.y * z.x)
            - vec2(1.0, 0.0);
        if (dot(value, value) < 1e-6) {
            steps = float(i);
            break;
        }
        vec2 slope = below * float(degree);
        float bottom = max(dot(slope, slope), 1e-20);
        // value ⁄ slope, as complex numbers.
        vec2 change = vec2(value.x * slope.x + value.y * slope.y,
                               value.y * slope.x - value.x * slope.y) / bottom;
        z -= size * change;
    }
    if (steps < 0.0) { return vec3(0.004, 0.005, 0.010); }

    int palette = int(u.budget.z);
    float shade = 0.16 + 0.84 * exp(-steps * 0.085);
    if (palette == 1) { // Steps: the count alone
        return vec3(0.86, 0.90, 1.0) * shade * shade;
    }
    // Which root: they sit evenly round the unit circle.
    float which = fWrap(floor(atan2(z.y, z.x) * float(degree) / 6.2831853 + 0.5), float(degree));
    vec3 tint = wCosinePalette(which / float(degree) + 0.02, vec3(0.52), vec3(0.46),
                                 vec3(1.0), vec3(0.0, 0.33, 0.67));
    return tint * tint * 0.8 * shade;
}

vec4 newtonFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);
    float pixel = fPixel(u.resolutionAndCone);

    vec3 color = vec3(0.0);
    if (u.camera.w > 1.5) {
        const vec2 offsets[4] = vec2[4](vec2(-0.375, -0.125), vec2(0.125, -0.375),
            vec2(0.375, 0.125), vec2(-0.125, 0.375));
        for (int i = 0; i < 4; ++i) {
            color += newtonSample(uv + offsets[i] * pixel, u);
        }
        color *= 0.25;
    } else {
        color = newtonSample(uv, u);
    }

    // The roots themselves.
    int degree = int(u.v[0].x);
    float unit = u.camera.z * 0.4363636;
    for (int k = 0; k < degree; ++k) {
        float angle = 6.2831853 * float(k) / float(degree);
        vec2 at = (vec2(cos(angle), sin(angle)) - u.focus.xy) / unit;
        float away = length(uv - at);
        color = mix(color, vec3(0.02), smoothstep(0.020 + pixel, 0.020 - pixel, away));
        color = mix(color, vec3(1.0), smoothstep(0.013 + pixel, 0.013 - pixel, away));
    }
    color = fDrawMarkers(color, uv, pixel, int(u.budget.w));
    return vec4(color, 1.0);
}

uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(newtonFragment(position, U).rgb, 1.0);
}
`;
