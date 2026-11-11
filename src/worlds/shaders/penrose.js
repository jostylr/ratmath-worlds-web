// Penrose.metal in GLSL, written by make-shaders.py from the app's
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



// Penrose's rhombus tiling, built by de Bruijn's pentagrid: five families of
// parallel lines, at 72° to one another, each shifted by its own offset γⱼ.
// Every crossing of two lines is one tile. Where line r = kᵣ crosses line
// s = kₛ, every other family j contributes the whole number Kⱼ = ⌈x·eⱼ + γⱼ⌉,
// and the tile's corners are Σ Kⱼ eⱼ with (Kᵣ, Kₛ) running over
// {kᵣ, kᵣ + 1} × {kₛ, kₛ + 1}. That is the same as cutting a slice through the
// five-dimensional cubic lattice and projecting it flat.
//
// For a point p of the picture, the crossing is found by trying the few
// lines of each pair of families that pass near p's place in the grid.
// PenroseWorld.swift does the same in double precision.
//
// v[0]: γ₀, γ₁, γ₂, γ₃
// v[1]: γ₄, c = Σ γⱼ eⱼ (x, y), ribbons shown
// v[2]: corners shown, unused, unused, unused
// v[3]: the chosen tile: r, s, kᵣ, kₛ (r < 0 for none)

struct PenroseTile {
    float found;
    int r;
    int s;
    float kr;
    float ks;
    vec2 base;   // the corner with Kᵣ = kᵣ and Kₛ = kₛ
    float a;       // the point is base + a·eᵣ + b·eₛ
    float b;
    float index;   // Σ Kⱼ at that corner
    float height;  // the tile's height: sin of its angle
};

vec2 penroseE(int j) {
    float t = 1.2566371 * float(j);
    return vec2(cos(t), sin(t));
}

float penroseGamma(int j, WorldUniforms u) {
    if (j == 0) { return u.v[0].x; }
    if (j == 1) { return u.v[0].y; }
    if (j == 2) { return u.v[0].z; }
    if (j == 3) { return u.v[0].w; }
    return u.v[1].x;
}

PenroseTile penroseFind(vec2 p, WorldUniforms u) {
    PenroseTile tile;
    tile.found = 0.0;
    tile.r = 0;
    tile.s = 1;
    tile.kr = 0.0;
    tile.ks = 0.0;
    tile.base = vec2(0.0);
    tile.a = 0.0;
    tile.b = 0.0;
    tile.index = 0.0;
    tile.height = 1.0;
    // The grid point that lands near p: p ≈ 2.5·x + c.
    vec2 x0 = (p - u.v[1].yz) / 2.5;
    for (int r = 0; r < 4; ++r) {
        for (int s = r + 1; s < 5; ++s) {
            vec2 er = penroseE(r);
            vec2 es = penroseE(s);
            float gr = penroseGamma(r, u);
            float gs = penroseGamma(s, u);
            float det = er.x * es.y - er.y * es.x;
            float tr = dot(x0, er) + gr;
            float ts = dot(x0, es) + gs;
            for (float kr = ceil(tr - 1.2); kr <= floor(tr + 1.2); kr += 1.0) {
                for (float ks = ceil(ts - 1.2); ks <= floor(ts + 1.2); ks += 1.0) {
                    float ar = kr - gr;
                    float bs = ks - gs;
                    vec2 x = vec2(ar * es.y - bs * er.y, bs * er.x - ar * es.x) / det;
                    vec2 base = kr * er + ks * es;
                    float index = kr + ks;
                    for (int j = 0; j < 5; ++j) {
                        if (j == r || j == s) { continue; }
                        float k = ceil(dot(x, penroseE(j)) + penroseGamma(j, u));
                        base += k * penroseE(j);
                        index += k;
                    }
                    vec2 d = p - base;
                    float a = (d.x * es.y - d.y * es.x) / det;
                    float b = (er.x * d.y - er.y * d.x) / det;
                    if (a >= 0.0 && a <= 1.0 && b >= 0.0 && b <= 1.0) {
                        tile.found = 1.0;
                        tile.r = r;
                        tile.s = s;
                        tile.kr = kr;
                        tile.ks = ks;
                        tile.base = base;
                        tile.a = a;
                        tile.b = b;
                        tile.index = index;
                        tile.height = abs(det);
                        return tile;
                    }
                }
            }
        }
    }
    return tile;
}

float penroseHash(vec2 q) {
    return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 penroseFamily(int j) {
    return wCosinePalette(float(j) / 5.0 + 0.05, vec3(0.55), vec3(0.42),
                          vec3(1.0), vec3(0.0, 0.33, 0.67));
}

vec3 penroseSample(vec2 uv, float pixelSize, WorldUniforms u) {
    vec2 p = fPlane(uv, u.focus, u.camera);
    PenroseTile tile = penroseFind(p, u);
    if (tile.found < 0.5) { return vec3(0.02, 0.02, 0.03); }

    int gap = tile.s - tile.r;
    bool thick = gap == 1 || gap == 4;
    int palette = int(u.budget.z);
    float vary = penroseHash(tile.base * 3.1 + vec2(tile.kr, tile.ks));
    vec3 color;
    if (palette == 1) {
        // Each of the ten kinds of tile by the two directions of its edges.
        float kind = float(tile.r * 5 + tile.s);
        color = wCosinePalette(kind / 23.0 + 0.1, vec3(0.5), vec3(0.45),
                               vec3(1.0), vec3(0.0, 0.33, 0.67));
    } else if (palette == 2) {
        // Σ Kⱼ at the tile's first corner: which slice of five-dimensional
        // space it comes from.
        float level = fWrap(tile.index, 5.0);
        color = wCosinePalette(level / 5.0 + 0.6, vec3(0.5), vec3(0.45),
                               vec3(1.0), vec3(0.0, 0.33, 0.67));
    } else {
        color = thick ? vec3(0.80, 0.50, 0.22) : vec3(0.12, 0.36, 0.52);
    }
    color *= 0.88 + 0.18 * vary;

    // Distance to the nearest edge, in units of the plane.
    float toEdge = min(min(tile.a, 1.0 - tile.a), min(tile.b, 1.0 - tile.b)) * tile.height;
    // Glazed tiles: a soft rim that catches the light on two sides.
    float rim = 1.0 - smoothstep(0.0, 0.09, toEdge);
    float side = (tile.a < 0.5 ? 1.0 : -0.6) * (tile.b < 0.5 ? 0.6 : -0.4);
    color *= 1.0 + 0.22 * rim * side;
    color = mix(color, color * 1.18 + 0.03, (1.0 - smoothstep(0.0, 0.35, abs(tile.a - 0.3) + abs(tile.b - 0.3))) * 0.3);
    // Grout between the tiles.
    color = mix(color, vec3(0.05, 0.045, 0.04), fStroke(toEdge, 0.025, pixelSize));

    // The ribbons: the grid line of family r crosses the tile at a = ½, and
    // the line of family s at b = ½.
    if (u.v[1].w > 0.5) {
        float dr = abs(tile.a - 0.5) * tile.height;
        float ds = abs(tile.b - 0.5) * tile.height;
        color = mix(color, penroseFamily(tile.r), fStroke(dr, 0.022, pixelSize) * 0.9);
        color = mix(color, penroseFamily(tile.s), fStroke(ds, 0.022, pixelSize) * 0.9);
    }

    // The corners, coloured by Σ Kⱼ: which of the four layers of the
    // five-dimensional lattice each comes from.
    if (u.v[2].x > 0.5) {
        vec2 corner = vec2(tile.a < 0.5 ? 0.0 : 1.0, tile.b < 0.5 ? 0.0 : 1.0);
        vec2 at = tile.base + corner.x * penroseE(tile.r) + corner.y * penroseE(tile.s);
        float away = length(p - at);
        float level = fWrap(tile.index + corner.x + corner.y, 5.0);
        vec3 ink = wCosinePalette(level / 5.0 + 0.6, vec3(0.55), vec3(0.45),
                                    vec3(1.0), vec3(0.0, 0.33, 0.67));
        color = mix(color, vec3(0.02), fStroke(away, 0.085, pixelSize));
        color = mix(color, ink, fStroke(away, 0.065, pixelSize));
    }

    // The tile the explorer is looking at.
    if (u.v[3].x >= 0.0 && float(tile.r) == u.v[3].x && float(tile.s) == u.v[3].y
        && tile.kr == u.v[3].z && tile.ks == u.v[3].w) {
        color = mix(color, vec3(1.0, 0.85, 0.3), 0.35);
        color = mix(color, vec3(1.0, 0.95, 0.6), fStroke(toEdge, 0.045, pixelSize));
    }
    return color;
}

vec4 penroseFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);
    float pixel = fPixel(u.resolutionAndCone);
    float pixelSize = pixel * u.camera.z * 0.4363636;

    vec3 color = vec3(0.0);
    if (u.camera.w > 1.5) {
        const vec2 offsets[4] = vec2[4](vec2(-0.375, -0.125), vec2(0.125, -0.375),
            vec2(0.375, 0.125), vec2(-0.125, 0.375));
        for (int i = 0; i < 4; ++i) {
            color += penroseSample(uv + offsets[i] * pixel, pixelSize, u);
        }
        color *= 0.25;
    } else {
        color = penroseSample(uv, pixelSize, u);
    }
    float vignette = 1.0 - 0.18 * dot(screen, screen);
    color = fDrawMarkers(color * vignette, uv, pixel, int(u.budget.w));
    return vec4(color, 1.0);
}

uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(penroseFragment(position, U).rgb, 1.0);
}
`;
