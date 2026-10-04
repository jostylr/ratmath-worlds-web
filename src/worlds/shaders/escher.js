// Escher.metal in GLSL, written by make-shaders.py from the app's
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


// One space, six ways up.
//
// Three square spiral staircases stand in a single space, one about each
// axis, woven past each other without touching. Each staircase is a thin
// stepped ribbon that can be walked on both faces, so it serves two realms
// with opposite ideas of down: six realms in all.
//
// The space repeats every ES_P units in every direction (it is a 3-torus),
// which is two turns of a staircase: climb two floors and you are back.
//
// Only the flight that arrives at "landing 0" of the staircase about the y
// axis is described. The screw S (a quarter turn about the axis and a rise of
// one flight) repeats it round its own staircase, and T, which sends the
// y axis to the z axis to the x axis, carries it to the other two.
//
// Doors are square frames standing at the edge of the landings. A ray (or a
// walker) that passes through one comes out of its partner, turned.
// EscherMath in EscherWorld.swift mirrors everything here.
//
// v[0]: zoom
// v[1], v[2], v[3]: the camera's right, up and forward
// v[4]: the camera's position

#define ES_L 3.2        // half-width of a staircase
#define ES_W 1.6        // width of the stairs, and side of a door
#define ES_H 6.4        // rise of one full turn (four flights)
#define ES_P 12.8       // the space repeats after this far: two turns
#define ES_T 0.1        // thickness of the ribbon
#define ES_RUN 0.4      // depth of one step
#define ES_RISE 0.2     // height of one step
#define ES_C 2.4        // centre line of the stairs: ES_L − ES_W ⁄ 2

struct EscherHit {
    float distance;
    float kind;    // 1 ribbon, 2 rail, 3 pillar, 4 upper door frame, 5 lower
    float door;    // which landing of the turn the nearest piece belongs to
    float chart;   // which staircase
    float turn;    // which of the two turns (for the pillar's markings)
};

// T⁻¹ applied c times, wrapped into the repeating cell.
vec3 escherToChart(vec3 p, int c) {
    for (int i = 0; i < c; ++i) {
        p = vec3(p.y - 0.5 * ES_P, p.z, p.x - 0.5 * ES_P);
    }
    return p - ES_P * round(p / ES_P);
}

vec3 escherFromChart(vec3 q, int c) {
    for (int i = 0; i < c; ++i) {
        q = vec3(q.z + 0.5 * ES_P, q.x + 0.5 * ES_P, q.y);
    }
    return q;
}

vec3 escherDirectionToChart(vec3 d, int c) {
    for (int i = 0; i < c; ++i) { d = vec3(d.y, d.z, d.x); }
    return d;
}

vec3 escherDirectionFromChart(vec3 d, int c) {
    for (int i = 0; i < c; ++i) { d = vec3(d.z, d.x, d.y); }
    return d;
}

// S⁻¹ applied m times, then the height wrapped to the nearest turn.
vec3 escherToLanding(vec3 p, int m, inout float turns) {
    for (int i = 0; i < m; ++i) {
        p = vec3(p.z, p.y - 0.25 * ES_H, -p.x);
    }
    turns = round(p.y / ES_H);
    p.y -= turns * ES_H;
    return p;
}

vec3 escherFromLanding(vec3 q, int m, float turns) {
    q.y += turns * ES_H;
    for (int i = 0; i < m; ++i) {
        q = vec3(-q.z, q.y + 0.25 * ES_H, q.x);
    }
    return q;
}

vec3 escherDirectionToLanding(vec3 d, int m) {
    for (int i = 0; i < m; ++i) { d = vec3(d.z, d.y, -d.x); }
    return d;
}

vec3 escherDirectionFromLanding(vec3 d, int m) {
    for (int i = 0; i < m; ++i) { d = vec3(-d.z, d.y, d.x); }
    return d;
}

float esBox(vec3 p, vec3 centre, vec3 halfSize) {
    vec3 q = abs(p - centre) - halfSize;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float esBox2(vec2 p, vec2 halfSize) {
    vec2 q = abs(p) - halfSize;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float esCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a;
    vec3 ba = b - a;
    float h = saturate(dot(pa, ba) / dot(ba, ba));
    return length(pa - ba * h) - r;
}

// Centre of the door above (side 0) or below (side 1) a landing.
vec3 escherDoorCentre(int side) {
    return vec3(ES_C, side == 0 ? 0.5 * ES_W : -ES_T - 0.5 * ES_W, ES_L);
}

// The flight that climbs along x = L to landing 0, the landing, the rails,
// and the two door frames standing at the landing's far edge.
EscherHit escherPiece(vec3 q, int m) {
    EscherHit hit;
    float inner = ES_L - ES_W;

    // Landing: a thin slab in the corner, with its top at height 0.
    float d = esBox(q, vec3(ES_C, -0.5 * ES_T, ES_C),
                    vec3(0.5 * ES_W, 0.5 * ES_T, 0.5 * ES_W));

    // Eight steps, each a tread and the riser in front of it, so that the
    // underside is a staircase too. Only the nearest three can matter.
    float along = (q.z + inner) / ES_RUN;
    float nearest = clamp(floor(along), 0.0, 7.0);
    for (float i = max(nearest - 1.0, 0.0); i <= min(nearest + 1.0, 7.0); i += 1.0) {
        float top = -0.25 * ES_H + (i + 1.0) * ES_RISE;
        float front = -inner + i * ES_RUN;
        d = min(d, esBox(q, vec3(ES_C, top - 0.5 * ES_T, front + 0.5 * ES_RUN),
                         vec3(0.5 * ES_W, 0.5 * ES_T, 0.5 * ES_RUN + 0.5 * ES_T)));
        d = min(d, esBox(q, vec3(ES_C, top - 0.5 * (ES_RISE + ES_T), front),
                         vec3(0.5 * ES_W, 0.5 * (ES_RISE + ES_T), 0.5 * ES_T)));
    }
    hit.distance = d;
    hit.kind = 1.0;

    // A handrail along the open edge, for each of the two faces, tied to the
    // ribbon by a post at each end of the flight.
    float low = -0.25 * ES_H;
    float rail = min(
        esCapsule(q, vec3(ES_L, low + 0.72, -inner), vec3(ES_L, 0.72, inner), 0.04),
        esCapsule(q, vec3(ES_L, low - ES_T - 0.72, -inner), vec3(ES_L, -ES_T - 0.72, inner), 0.04));
    rail = min(rail, esCapsule(q, vec3(ES_L, 0.72, inner), vec3(ES_L, -ES_T - 0.72, inner), 0.03));
    rail = min(rail, esCapsule(q, vec3(ES_L, low + 0.72, -inner), vec3(ES_L, low - ES_T - 0.72, -inner), 0.03));
    if (rail < hit.distance) {
        hit.distance = rail;
        hit.kind = 2.0;
    }

    // Landing 2 of each turn has no door.
    if (m != 2) {
        for (int side = 0; side < 2; ++side) {
            vec3 centre = escherDoorCentre(side);
            vec2 inDoor = q.xy - centre.xy;
            float frame = max(max(esBox2(inDoor, vec2(0.5 * ES_W + 0.12)),
                                  -esBox2(inDoor, vec2(0.5 * ES_W - 0.10))),
                              abs(q.z - ES_L) - 0.07);
            if (frame < hit.distance) {
                hit.distance = frame;
                hit.kind = 4.0 + float(side);
            }
        }
    }
    return hit;
}

EscherHit escherScene(vec3 p) {
    EscherHit best;
    best.distance = 1e9;
    best.kind = 0.0;
    best.door = 0.0;
    best.chart = 0.0;
    best.turn = 0.0;
    for (int c = 0; c < 3; ++c) {
        vec3 q = escherToChart(p, c);
        // Far from this staircase, the distance to the square tube that
        // holds it is all a ray needs.
        float tube = esBox2(q.xz, vec2(ES_L + 0.2));
        if (tube > 0.5) {
            if (tube - 0.3 < best.distance) {
                best.distance = tube - 0.3;
                best.kind = 0.0;
            }
            continue;
        }
        // The pillar the stairs wind round.
        float pillar = esBox2(q.xz, vec2(ES_L - ES_W));
        if (pillar < best.distance) {
            best.distance = pillar;
            best.kind = 3.0;
            best.chart = float(c);
            best.turn = q.y >= 0.0 ? 1.0 : 0.0;
        }
        for (int m = 0; m < 4; ++m) {
            float turns;
            EscherHit hit = escherPiece(escherToLanding(q, m, turns), m);
            if (hit.distance < best.distance) {
                best.distance = hit.distance;
                best.kind = hit.kind;
                best.door = float(m);
                best.chart = float(c);
                best.turn = q.y >= 0.0 ? 1.0 : 0.0;
            }
        }
    }
    return best;
}

vec3 escherNormal(vec3 p, float e) {
    vec2 h = vec2(e, -e);
    return normalize(
        h.xyy * escherScene(p + h.xyy).distance +
        h.yyx * escherScene(p + h.yyx).distance +
        h.yxy * escherScene(p + h.yxy).distance +
        h.xxx * escherScene(p + h.xxx).distance);
}

// MARK: - Doors

// Where the door on landing m, face side, of staircase c leads: the
// staircase, landing and face of its partner.
void escherPartner(int c, int m, int side, inout int c2, inout int m2, inout int side2) {
    c2 = c; m2 = m; side2 = side;
    if (m == 0) {
        side2 = 1 - side;       // to the other face of the same stairs
    } else if (m == 1) {
        c2 = (c + 1) % 3;       // to the next staircase round
        m2 = 3;
    } else {
        c2 = (c + 2) % 3;       // and back again
        m2 = 1;
    }
}

// The turn that carries offsets from one door's centre to offsets from its
// partner's: out through the first, in through the second, rolled by 180°
// between the two faces of one staircase and by 90° between staircases.
vec3 escherDoorTurn(vec3 d, int m, int side, int side2) {
    // Each door's own axes: across, up (for the face it serves), and out.
    float sA = side == 0 ? 1.0 : -1.0;
    float sB = side2 == 0 ? 1.0 : -1.0;
    vec2 inA = vec2(d.x, d.y) * sA;
    // Undo the roll about the line through the door.
    vec2 rolled = m == 0 ? -inA : vec2(inA.y, -inA.x);
    // Coming in, across and out are reversed.
    return vec3(-rolled.x * sB, rolled.y * sB, -d.z);
}

// MARK: - Materials

float esHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float esNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(esHash(i), esHash(i + vec3(1, 0, 0)), f.x),
                   mix(esHash(i + vec3(0, 1, 0)), esHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(esHash(i + vec3(0, 0, 1)), esHash(i + vec3(1, 0, 1)), f.x),
                   mix(esHash(i + vec3(0, 1, 1)), esHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float esFbm(vec3 x) {
    return 0.5 * esNoise(x) + 0.25 * esNoise(x * 2.03) + 0.125 * esNoise(x * 4.01);
}

// The look of one realm's material. Realms: 0 wood, 1 marble (the two faces
// of the staircase about y), 2 brass, 3 slate (about z), 4 iron, 5 tile
// (about x).
vec3 escherMaterial(int realm, vec3 q, vec2 uv, bool trim, inout float gloss) {
    if (realm == 0) {
        float board = floor(uv.x * 2.5);
        float grain = esFbm(vec3(uv.x * 2.0, uv.y * 22.0, board * 7.3) + q * 0.2);
        vec3 color = mix(vec3(0.30, 0.15, 0.06), vec3(0.62, 0.38, 0.17), grain);
        color *= 0.86 + 0.28 * esHash(vec3(board, 1.0, 2.0));
        float seam = smoothstep(0.0, 0.03, abs(fract(uv.x * 2.5) - 0.5) - 0.47);
        color *= 1.0 - 0.55 * seam;
        gloss = 0.12;
        return trim ? color * vec3(0.75, 0.62, 0.55) : color;
    }
    if (realm == 1) {
        float warp = esFbm(q * 1.3) * 5.0;
        float vein = abs(sin(uv.x * 2.2 + uv.y * 1.4 + warp));
        vec3 color = mix(vec3(0.26, 0.27, 0.33), vec3(0.78, 0.77, 0.74), smoothstep(0.0, 0.16, vein));
        color *= 0.90 + 0.14 * esFbm(q * 6.0);
        gloss = 0.45;
        return trim ? color * vec3(1.0, 0.94, 0.84) : color;
    }
    if (realm == 2) {
        // Brass: warm metal with fine engraved lines.
        float lines = smoothstep(0.42, 0.5, abs(fract(uv.y * 6.0) - 0.5));
        vec3 color = vec3(0.72, 0.52, 0.16) * (0.82 + 0.3 * esFbm(q * 2.5));
        color *= 1.0 - 0.45 * lines;
        gloss = 0.7;
        return trim ? color * vec3(1.1, 0.95, 0.7) : color;
    }
    if (realm == 3) {
        // Slate: dark, layered blue-grey stone.
        float layer = esFbm(vec3(uv.x * 1.5, uv.y * 14.0, 3.0) + q * 0.3);
        vec3 color = mix(vec3(0.10, 0.13, 0.17), vec3(0.30, 0.35, 0.42), layer);
        vec2 flag = fract(uv * 1.25) - 0.5;
        color *= 1.0 - 0.5 * smoothstep(0.46, 0.49, max(abs(flag.x), abs(flag.y)));
        gloss = 0.25;
        return trim ? color * 1.35 : color;
    }
    if (realm == 4) {
        // Iron: dark plates, seams, rivets and chequer plate.
        vec2 plate = fract(uv * 1.25) - 0.5;
        float seam = smoothstep(0.46, 0.49, max(abs(plate.x), abs(plate.y)));
        vec2 rivet = fract(uv * 5.0) - 0.5;
        float edge = step(0.36, max(abs(plate.x), abs(plate.y)));
        float studs = (1.0 - smoothstep(0.10, 0.16, length(rivet))) * edge;
        vec3 color = vec3(0.13, 0.15, 0.18) * (0.8 + 0.4 * esFbm(q * 3.0));
        color = mix(color, vec3(0.04, 0.045, 0.05), seam);
        color = mix(color, vec3(0.34, 0.36, 0.40), studs);
        vec2 g = fract(uv * 9.0) - 0.5;
        color *= 0.85 + 0.4 * step(abs(g.x + g.y), 0.12);
        gloss = 0.55;
        return trim ? color + vec3(0.10, 0.05, 0.02) : color;
    }
    // Tile: an eight-pointed star pattern in blue, white and ochre.
    vec2 cell = fract(uv * 2.5) - 0.5;
    vec2 a = abs(cell);
    float square = max(a.x, a.y);
    float diamond = (a.x + a.y) * 0.7071;
    vec3 color = vec3(0.92, 0.90, 0.82);
    color = mix(color, vec3(0.08, 0.26, 0.62), 1.0 - smoothstep(0.26, 0.28, min(square, diamond)));
    color = mix(color, vec3(0.80, 0.56, 0.14), 1.0 - smoothstep(0.10, 0.12, max(square, diamond)));
    color = mix(color, vec3(0.30, 0.28, 0.24), smoothstep(0.47, 0.49, square));
    gloss = 0.35;
    return trim ? mix(color, vec3(0.05, 0.40, 0.42), 0.35) : color;
}

// The pillars are plain plaster carrying the markings that tell the two
// floors apart: a band of discs on one turn, of diamonds on the other, in a
// colour of its own for each staircase.
vec3 escherPillar(int chart, vec3 q, vec2 uv, float turn) {
    vec3 plaster = vec3(0.62, 0.60, 0.55) * (0.9 + 0.18 * esFbm(q * 1.7));
    vec3 ink = chart == 0 ? vec3(0.55, 0.12, 0.08)
               : (chart == 1 ? vec3(0.10, 0.32, 0.20) : vec3(0.10, 0.18, 0.48));
    float inTurn = q.y - ES_H * floor(q.y / ES_H);
    float band = abs(inTurn - 0.5 * ES_H);
    vec2 cell = vec2(fract(uv.x * 1.25) - 0.5, (inTurn - 0.5 * ES_H) * 1.25);
    float mark = turn > 0.5
        ? smoothstep(0.32, 0.30, length(cell))
        : smoothstep(0.34, 0.32, abs(cell.x) + abs(cell.y));
    float lines = smoothstep(0.04, 0.02, abs(band - 0.55));
    vec3 color = mix(plaster, ink, max(mark * step(band, 0.5), lines));
    // A plain stripe marks the foot of each turn.
    color = mix(color, ink * 0.6, smoothstep(0.10, 0.08, min(inTurn, ES_H - inTurn)));
    return color;
}

vec4 escherFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);
    float zoom = max(u.v[0].x, 0.3);
    vec3 local = normalize(vec3(uv * 1.15 / zoom, 1.0));
    vec3 ro = u.v[4].xyz;
    vec3 rd = normalize(local.x * u.v[1].xyz + local.y * u.v[2].xyz + local.z * u.v[3].xyz);

    int maxSteps = int(u.budget.x);
    float travel = 0.0;
    float reach = 44.0;
    bool hitSomething = false;
    EscherHit hit;
    vec3 p = ro;
    float lastStep = 0.0;
    int doors = 0;

    for (int stepIndex = 0; stepIndex < maxSteps; ++stepIndex) {
        p = ro + rd * travel;

        // Did the last step carry the ray through a doorway? If so it comes
        // out of the partner door, turned.
        bool through = false;
        if (lastStep > 0.0 && doors < 6) {
            for (int c = 0; c < 3 && !through; ++c) {
                vec3 qc = escherToChart(p, c);
                if (esBox2(qc.xz, vec2(ES_L + 1.2)) > 0.0) { continue; }
                vec3 dc = escherDirectionToChart(rd, c);
                for (int m = 0; m < 4 && !through; ++m) {
                    if (m == 2) { continue; }
                    float turns;
                    vec3 q = escherToLanding(qc, m, turns);
                    vec3 d = escherDirectionToLanding(dc, m);
                    float before = q.z - d.z * lastStep - ES_L;
                    float after = q.z - ES_L;
                    if (before * after >= 0.0) { continue; }
                    vec3 crossing = q - d * (after / d.z);
                    for (int side = 0; side < 2; ++side) {
                        vec3 centre = escherDoorCentre(side);
                        vec2 off = abs(crossing.xy - centre.xy);
                        if (max(off.x, off.y) > 0.5 * ES_W - 0.10) { continue; }
                        int c2, m2, side2;
                        escherPartner(c, m, side, c2, m2, side2);
                        vec3 q2 = escherDoorCentre(side2) + escherDoorTurn(q - centre, m, side, side2);
                        vec3 d2 = escherDoorTurn(d, m, side, side2);
                        vec3 beyond = escherFromChart(escherFromLanding(q2, m2, turns), c2);
                        rd = escherDirectionFromChart(escherDirectionFromLanding(d2, m2), c2);
                        // travel goes on counting from the far side.
                        ro = beyond - rd * travel;
                        p = beyond;
                        through = true;
                        doors += 1;
                        break;
                    }
                }
            }
        }
        if (through) {
            lastStep = 0.0;
        }

        hit = escherScene(p);
        float tolerance = max(0.0009 * travel, 0.0006);
        if (hit.distance < tolerance && hit.kind > 0.5) {
            hitSomething = true;
            break;
        }
        lastStep = max(hit.distance * 0.9, tolerance);
        travel += lastStep;
        if (travel > reach) { break; }
    }

    // The far distance is a soft dusk, a little lighter toward the middle.
    vec3 fog = mix(vec3(0.035, 0.045, 0.075), vec3(0.10, 0.11, 0.15),
                     saturate(1.0 - dot(screen, screen) * 0.5));
    vec3 color = fog;
    if (hitSomething) {
        vec3 normal = escherNormal(p, max(0.0012 * travel, 0.0008));
        int chart = int(hit.chart + 0.5);
        vec3 qc = escherToChart(p, chart);
        vec3 nc = escherDirectionToChart(normal, chart);
        float gloss = 0.1;
        vec3 albedo;

        if (hit.kind > 2.5 && hit.kind < 3.5) {
            vec2 surface = abs(nc.x) > abs(nc.z) ? qc.zy : qc.xy;
            albedo = escherPillar(chart, qc, surface, hit.turn);
        } else {
            int door = int(hit.door + 0.5);
            float turns;
            vec3 q = escherToLanding(qc, door, turns);
            vec3 qn = escherDirectionToLanding(nc, door);
            vec3 an = abs(qn);
            vec2 surface = an.y > max(an.x, an.z) ? q.xz : (an.x > an.z ? q.zy : q.xy);

            int style;
            bool trim = hit.kind > 1.5;
            if (hit.kind > 3.5) {
                // A door's frame is made of the stuff of the realm it leads to.
                int c2, m2, side2;
                escherPartner(chart, door, hit.kind > 4.5 ? 1 : 0, c2, m2, side2);
                style = 2 * c2 + side2;
            } else if (hit.kind > 1.5) {
                // Rails belong to the face they stand over.
                float inner = ES_L - ES_W;
                float ribbon = -0.25 * ES_H * (1.0 - saturate((q.z + inner) / (2.0 * inner)));
                style = 2 * chart + (q.y < ribbon - 0.5 * ES_T ? 1 : 0);
            } else {
                // The ribbon: its upper face is one realm, its underside another.
                // A riser is seen from the front by one and from behind by
                // the other.
                bool under = abs(qn.y) > 0.3 ? qn.y < 0.0 : qn.z > 0.3;
                style = 2 * chart + (under ? 1 : 0);
            }
            albedo = escherMaterial(style, q + vec3(0.0, turns * 1.7, 0.0), surface, trim, gloss);
        }

        // No direction is up for everyone, so the light favours none: every
        // face is lit by how squarely it meets the light, from either side.
        vec3 lightDirection = normalize(vec3(0.45, 0.70, 0.55));
        float facing = dot(normal, lightDirection);
        float diffuse = 0.55 * abs(facing) + 0.45 * saturate(facing);
        float fill = saturate(dot(normal, -rd));
        float occlusion = 1.0;
        for (int i = 1; i <= 3; ++i) {
            float away = 0.12 * float(i);
            occlusion -= max(away - escherScene(p + normal * away).distance, 0.0) * (0.9 / float(i));
        }
        occlusion = saturate(occlusion);
        vec3 halfVector = normalize(lightDirection - rd);
        float specular = pow(saturate(dot(normal, halfVector)), 30.0) * gloss;
        color = albedo * (0.20 + 0.75 * diffuse + 0.30 * fill) * (0.35 + 0.65 * occlusion)
            + specular * (0.3 + 0.5 * diffuse);
        color = mix(color, fog, 1.0 - exp(-travel * 0.06));
    }

    float vignette = 1.0 - 0.22 * dot(screen, screen);
    return vec4(wToneMap(color * vignette), 1.0);
}

uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(escherFragment(position, U).rgb, 1.0);
}
`;
