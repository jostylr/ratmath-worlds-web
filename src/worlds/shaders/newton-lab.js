// NewtonLab.metal in GLSL, written by make-shaders.py from the app's
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

// A world's longer table of numbers (shaderData), 1024 to a row.
uniform highp sampler2D uData;
vec4 wData(int i) { return texelFetch(uData, ivec2(i % 1024, i / 1024), 0); }

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



// Newton's method for a function of your choosing: either one given by the
// roots and poles you place, or a formula.
//
// v[0]: kind (0 roots and poles, 1 formula), step size, step limit, the
//       number of steps in the formula's program
// v[1]: number of roots, number of poles, which is picked up (−1: none;
//       roots first, then poles)
// v[2]...v[5]: five roots, then two poles, two numbers apiece
//
// data holds the formula's program, one step to a vec4: what to do, and
// a complex number for the steps that need one. FormulaProgram.swift writes
// it and runs the same steps itself.
//
// The view is the orbit camera's, looking straight down (see fPlane).

#define kLabRoots 5
#define kLabPoles 2

vec2 labMul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 labDiv(vec2 a, vec2 b) {
    float bottom = max(dot(b, b), 1e-30);
    return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / bottom;
}

vec2 labSin(vec2 a) { return vec2(sin(a.x) * cosh(a.y), cos(a.x) * sinh(a.y)); }
vec2 labCos(vec2 a) { return vec2(cos(a.x) * cosh(a.y), -sin(a.x) * sinh(a.y)); }
vec2 labSinh(vec2 a) { return vec2(sinh(a.x) * cos(a.y), cosh(a.x) * sin(a.y)); }
vec2 labCosh(vec2 a) { return vec2(cosh(a.x) * cos(a.y), sinh(a.x) * sin(a.y)); }
vec2 labExp(vec2 a) { return exp(a.x) * vec2(cos(a.y), sin(a.y)); }

// A whole-number power, by way of length and angle.
vec2 labPower(vec2 a, float n) {
    float size = length(a);
    if (size < 1e-20) { return vec2(n == 0.0 ? 1.0 : 0.0, 0.0); }
    float angle = atan2(a.y, a.x) * n;
    return pow(size, n) * vec2(cos(angle), sin(angle));
}

vec2 labRoot(int index, WorldUniforms u) {
    vec4 pair = u.v[2 + index / 2];
    return (index & 1) == 0 ? pair.xy : pair.zw;
}

vec2 labPole(int index, WorldUniforms u) {
    return index == 0 ? u.v[4].zw : u.v[5].xy;
}

// The formula's value at z (xy) and its slope there (zw). Every number on
// the stack carries its own slope along with it, so the slope of the whole
// comes out with the value.
vec4 labFormula(vec2 z, int count) {
    vec4 stack[8];
    int top = 0;
    for (int i = 0; i < count; ++i) {
        vec4 stage = wData(i);
        int op = int(stage.x);
        if (op == 1) {
            if (top < 8) { stack[top] = vec4(z, 1.0, 0.0); top += 1; }
        } else if (op == 2) {
            if (top < 8) { stack[top] = vec4(stage.yz, 0.0, 0.0); top += 1; }
        } else if (op <= 6) {
            if (top < 2) { continue; }
            vec4 b = stack[top - 1];
            vec4 a = stack[top - 2];
            top -= 1;
            if (op == 3) {
                stack[top - 1] = a + b;
            } else if (op == 4) {
                stack[top - 1] = a - b;
            } else if (op == 5) {
                stack[top - 1] = vec4(labMul(a.xy, b.xy), labMul(a.zw, b.xy) + labMul(a.xy, b.zw));
            } else {
                vec2 value = labDiv(a.xy, b.xy);
                stack[top - 1] = vec4(value, labDiv(a.zw - labMul(value, b.zw), b.xy));
            }
        } else {
            if (top < 1) { continue; }
            vec4 a = stack[top - 1];
            vec2 value;
            vec2 slope;
            if (op == 7) {
                value = -a.xy;
                slope = vec2(-1.0, 0.0);
            } else if (op == 8) {
                value = labPower(a.xy, stage.y);
                slope = stage.y * labPower(a.xy, stage.y - 1.0);
            } else if (op == 9) {
                value = labSin(a.xy);
                slope = labCos(a.xy);
            } else if (op == 10) {
                value = labCos(a.xy);
                slope = -labSin(a.xy);
            } else if (op == 11) {
                value = labExp(a.xy);
                slope = value;
            } else if (op == 12) {
                value = vec2(log(max(length(a.xy), 1e-30)), atan2(a.y, a.x));
                slope = labDiv(vec2(1.0, 0.0), a.xy);
            } else if (op == 13) {
                value = labPower(a.xy, 0.5);
                slope = labDiv(vec2(0.5, 0.0), value);
            } else if (op == 14) {
                value = labSinh(a.xy);
                slope = labCosh(a.xy);
            } else if (op == 15) {
                value = labCosh(a.xy);
                slope = labSinh(a.xy);
            } else if (op == 16) {
                vec2 bottom = labCos(a.xy);
                value = labDiv(labSin(a.xy), bottom);
                slope = labDiv(vec2(1.0, 0.0), labMul(bottom, bottom));
            } else {
                vec2 bottom = labCosh(a.xy);
                value = labDiv(labSinh(a.xy), bottom);
                slope = labDiv(vec2(1.0, 0.0), labMul(bottom, bottom));
            }
            stack[top - 1] = vec4(value, labMul(slope, a.zw));
        }
    }
    return top > 0 ? stack[top - 1] : vec4(0.0);
}

vec3 labTint(float hue) {
    vec3 tint = wCosinePalette(hue, vec3(0.52), vec3(0.46), vec3(1.0), vec3(0.0, 0.33, 0.67));
    return tint * tint * 0.8;
}

vec3 labSample(vec2 uv, WorldUniforms u) {
    vec2 z = fPlane(uv, u.focus, u.camera);
    bool formula = u.v[0].x > 0.5;
    float size = u.v[0].y;
    int limit = int(u.v[0].z);
    int count = int(u.v[0].w);
    int roots = int(u.v[1].x);
    int poles = int(u.v[1].y);
    float steps = -1.0;
    int found = 0;

    for (int i = 0; i < limit; ++i) {
        vec2 change;
        if (formula) {
            vec4 value = labFormula(z, count);
            change = labDiv(value.xy, value.zw);
            if (dot(value.xy, value.xy) < 1e-9 || dot(change, change) < 1e-10) {
                steps = float(i);
                break;
            }
        } else {
            // Value over slope is one over the sum of 1 ⁄ (z − root), less
            // the same for the poles.
            vec2 sum = vec2(0.0);
            float nearest = 1e9;
            for (int k = 0; k < roots; ++k) {
                vec2 away = z - labRoot(k, u);
                float d2 = dot(away, away);
                if (d2 < nearest) { nearest = d2; found = k; }
                sum += labDiv(vec2(1.0, 0.0), away);
            }
            if (nearest < 1e-6) {
                steps = float(i);
                break;
            }
            for (int k = 0; k < poles; ++k) {
                sum -= labDiv(vec2(1.0, 0.0), z - labPole(k, u));
            }
            change = labDiv(vec2(1.0, 0.0), sum);
        }
        z -= size * change;
        if (!(dot(z, z) < 1e12)) { break; }
    }
    if (steps < 0.0) { return vec3(0.004, 0.005, 0.010); }

    float shade = 0.14 + 0.86 * exp(-steps * 0.075);
    if (int(u.budget.z) == 1) { // Steps: the count alone
        return vec3(0.86, 0.90, 1.0) * shade * shade;
    }
    if (formula) {
        // A formula may have any number of roots: each takes its colour
        // from where it lies.
        return labTint(0.23 * z.x + 0.37 * z.y + 0.5 * z.x * z.y + 0.02) * shade;
    }
    return labTint(float(found) / float(max(roots, 1)) + 0.02) * shade;
}

vec4 newtonLabFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);
    float pixel = fPixel(u.resolutionAndCone);

    vec3 color = vec3(0.0);
    if (u.camera.w > 1.5) {
        const vec2 offsets[4] = vec2[4](vec2(-0.375, -0.125), vec2(0.125, -0.375),
            vec2(0.375, 0.125), vec2(-0.125, 0.375));
        for (int i = 0; i < 4; ++i) {
            color += labSample(uv + offsets[i] * pixel, u);
        }
        color *= 0.25;
    } else {
        color = labSample(uv, u);
    }

    if (u.v[0].x < 0.5) {
        // Roots are filled dots, poles are rings; the one picked up is larger.
        float unit = u.camera.z * 0.4363636;
        int roots = int(u.v[1].x);
        int poles = int(u.v[1].y);
        int picked = int(u.v[1].z);
        for (int k = 0; k < roots + poles; ++k) {
            bool pole = k >= roots;
            vec2 place = pole ? labPole(k - roots, u) : labRoot(k, u);
            vec2 at = (place - u.focus.xy) / unit;
            float radius = (pole ? k - roots + kLabRoots : k) == picked ? 0.030 : 0.019;
            float away = length(uv - at);
            color = mix(color, vec3(0.02), smoothstep(radius + 0.007 + pixel, radius + 0.007 - pixel, away));
            color = mix(color, vec3(1.0), smoothstep(radius + pixel, radius - pixel, away));
            if (pole) {
                color = mix(color, vec3(0.02), smoothstep(radius * 0.55 + pixel, radius * 0.55 - pixel, away));
            }
        }
    }
    color = fDrawMarkers(color, uv, pixel, int(u.budget.w));
    return vec4(color, 1.0);
}

uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(newtonLabFragment(position, U).rgb, 1.0);
}
`;
