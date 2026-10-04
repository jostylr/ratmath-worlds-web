// Gallery.metal in GLSL, written by web/make-shaders.py from the app's Metal
// shaders. Do not edit: change the Metal files and run the script again.

export const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

export const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uResolution;
uniform vec2 uCamera; // yaw, pitch
uniform vec4 uV[8];   // the world's thirty-two numbers, as in the Metal file
out vec4 fragColor;

struct WorldValues {
    vec4 v[8];
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

float wSphereHit(vec3 ro, vec3 rd, vec3 center, float radius) {
    vec3 oc = ro - center;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - radius * radius;
    float h = b * b - c;
    return h > 0.0 ? -b - sqrt(h) : -1.0;
}

// Filmic curve (Narkowicz ACES fit), then the sRGB curve the native render
// target applies by itself.
vec3 wToneMap(vec3 x) {
    x *= 0.9;
    vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    return mix(12.92 * mapped, 1.055 * pow(mapped, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, mapped));
}

#define B_PI 3.14159265
#define B_SLAB 0.45
#define B_VEST 1.2
#define B_VEST_HALF 1.2
#define B_DOOR_HALF 0.6
#define B_STAIR_Z 0.74
#define B_STAIR_R 0.44
#define B_STEPS 14
#define B_RAIL 0.95
#define B_MARGIN 0.10

struct BabelDesign {
    int n;
    float ap;
    float H;
    int open;
    int shelves;
    int vols;
    bool plain;
    int limit;
    vec3 low;
    int floorTurn;
    uint high;
    uint key;
    bool othersFull;
    float hw;      // half the width of a wall
    float sa;      // apothem of the shaft
    float doorH;
    vec3 chosen; // wall, shelf, volume
    bool taken;
};

struct BabelStyle {
    vec3 stone;
    vec3 wood;
    vec3 floorA;
    vec3 floorB;
    int floorKind;
    vec3 lamp;
    vec3 metal;
};

// MARK: Hashing (BabelHash in Swift)

uint bMix(uint x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

uint bCombine(uint a, uint b) {
    return bMix(a ^ (b + 0x9e3779b9u + (a << 6) + (a >> 2)));
}

float bUnit(uint h, uint k) {
    return float(bMix(h + k * 0x9e3779b9u) & 0xffffu) / 65535.0;
}

uint bRoomSeed(BabelDesign D, ivec3 off) {
    if (D.plain) { return 0x0b0b0b0bu; }
    uint s = bCombine(0x5eed0001u, D.key);
    s = bCombine(s, uint(int(D.low.x) + off.x));
    s = bCombine(s, uint(int(D.low.y) + off.y));
    s = bCombine(s, uint(int(D.low.z) + off.z));
    return bCombine(s, D.high);
}

vec3 bHSV(float h, float s, float v) {
    vec3 rgb = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    return v * mix(vec3(1.0), rgb, s);
}

BabelStyle bStyle(uint seed) {
    BabelStyle s;
    float hue = bUnit(seed, 1u);
    s.stone = bHSV(hue, 0.06 + 0.26 * bUnit(seed, 3u), 0.24 + 0.40 * bUnit(seed, 2u));
    s.wood = bHSV(0.03 + 0.07 * bUnit(seed, 4u), 0.45 + 0.35 * bUnit(seed, 5u),
                  0.14 + 0.30 * bUnit(seed, 6u));
    s.floorKind = int(bUnit(seed, 7u) * 3.999);
    s.floorA = bHSV(hue + 0.5 * bUnit(seed, 8u), 0.15 + 0.45 * bUnit(seed, 9u),
                    0.22 + 0.34 * bUnit(seed, 10u));
    s.floorB = mix(s.floorA * (0.35 + 0.4 * bUnit(seed, 11u)), s.stone, 0.25);
    s.lamp = vec3(1.0, 0.62 + 0.33 * bUnit(seed, 12u), 0.22 + 0.62 * bUnit(seed, 13u))
        * (2.6 + 1.4 * bUnit(seed, 14u));
    s.metal = bHSV(0.07 + 0.08 * bUnit(seed, 15u), 0.30 + 0.50 * bUnit(seed, 16u),
                   0.30 + 0.40 * bUnit(seed, 17u));
    return s;
}

// MARK: The plan of a room

vec2 bRot(vec2 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// The k-th wall without shelves. They come in opposite pairs, spread round
// the room.
int bOpenWall(int k, int n, int m) {
    int pairs = (m + 1) / 2;
    return ((k / 2) * (n / 2)) / pairs + ((k & 1) != 0 ? n / 2 : 0);
}

bool bIsOpen(int wall, int n, int m) {
    for (int k = 0; k < m; ++k) {
        if (bOpenWall(k, n, m) == wall) { return true; }
    }
    return false;
}

int bShelvedIndex(int wall, int n, int m) {
    int count = 0;
    for (int j = 0; j < wall; ++j) {
        if (!bIsOpen(j, n, m)) { count += 1; }
    }
    return count;
}

// Which neighbour a wall faces: one of the six directions of a honeycomb.
// Each floor is turned one wall further round than the floor below.
ivec3 bDirection(int wall, int n, int floorTurn) {
    int d = ((wall * 6) / n + floorTurn) % 6;
    switch (d) {
        case 0: return ivec3(1, 0, 0);
        case 1: return ivec3(0, 1, 0);
        case 2: return ivec3(-1, 1, 0);
        case 3: return ivec3(-1, 0, 0);
        case 4: return ivec3(0, -1, 0);
        default: return ivec3(1, -1, 0);
    }
}

int bFloorTurn(BabelDesign D, ivec3 off) {
    return ((D.floorTurn + off.z) % 6 + 6) % 6;
}

float bShaftInside(vec2 p, BabelDesign D) {
    // Positive inside the shaft's polygon.
    float most = -1e9;
    for (int i = 0; i < D.n; ++i) {
        float a = 2.0 * B_PI * float(i) / float(D.n);
        most = max(most, dot(p, vec2(cos(a), sin(a))));
    }
    return D.sa - most;
}

// MARK: Surfaces

struct BabelSurface {
    vec3 albedo;
    vec3 normal;
    float gloss;
    vec3 glow;
};

vec3 bFloor(vec2 p, BabelStyle s, uint seed) {
    if (s.floorKind == 0) {
        // Hexagonal tiles.
        vec2 q = p * 2.4;
        vec2 r = vec2(1.0, 1.7320508);
        vec2 h = r * 0.5;
        vec2 a = q - r * floor(q / r) - h;
        vec2 b = (q - h) - r * floor((q - h) / r) - h;
        vec2 g = dot(a, a) < dot(b, b) ? a : b;
        vec2 cell = q - g;
        float edge = 0.5 - max(abs(g.x), dot(abs(g), vec2(0.5, 0.8660254)));
        uint id = uint(int(floor(cell.x * 2.0 + 0.5)) * 73856093) ^ uint(int(floor(cell.y * 2.0 + 0.5)) * 19349663);
        vec3 c = mix(s.floorA, s.floorB, step(0.5, bUnit(id ^ seed, 1u)));
        return c * (edge < 0.035 ? 0.45 : 1.0);
    }
    if (s.floorKind == 1) {
        // Planks.
        float row = floor(p.y / 0.17);
        uint id = uint(int(row)) * 2654435761u ^ seed;
        float along = p.x / 1.3 + bUnit(id, 1u);
        uint plank = id ^ uint(int(floor(along))) * 40503u;
        vec3 c = mix(s.wood * 1.5, s.wood * 2.4, bUnit(plank, 2u));
        float seam = min(fract(p.y / 0.17), fract(along) * 7.0);
        return c * (seam < 0.05 ? 0.5 : 1.0);
    }
    if (s.floorKind == 2) {
        vec2 cell = floor(p / 0.5);
        bool dark = mod(abs(cell.x + cell.y), 2.0) > 0.5;
        return dark ? s.floorB : s.floorA;
    }
    vec2 cell = floor(p / 0.9);
    uint id = uint(int(cell.x) * 73856093) ^ uint(int(cell.y) * 19349663) ^ seed;
    vec2 f = fract(p / 0.9);
    float seam = min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y));
    return s.stone * (0.75 + 0.3 * bUnit(id, 1u)) * (seam < 0.012 ? 0.5 : 1.0);
}

// Coursed stone: big blocks with slightly different tones.
vec3 bStone(vec2 p, BabelStyle s, uint seed) {
    float row = floor(p.y / 0.42);
    float along = p.x / 0.8 + 0.5 * mod(abs(row), 2.0);
    uint id = uint(int(row) * 7919) ^ uint(int(floor(along)) * 104729) ^ seed;
    vec2 f = vec2(fract(along), fract(p.y / 0.42));
    float seam = min(min(f.x * 0.8, f.y * 0.42), min((1.0 - f.x) * 0.8, (1.0 - f.y) * 0.42));
    return s.stone * (0.82 + 0.22 * bUnit(id, 3u)) * (seam < 0.008 ? 0.6 : 1.0);
}



#define G_PI 3.14159265

vec3 gPalette(float t, uint h) {
    vec3 phase = vec3(bUnit(h, 40u), bUnit(h, 41u), bUnit(h, 42u));
    vec3 rate = vec3(1.0, 0.6 + 0.8 * bUnit(h, 43u), 0.6 + 0.8 * bUnit(h, 44u));
    return 0.5 + 0.5 * cos(2.0 * G_PI * (rate * t + phase));
}

// MARK: Schemes. Each takes a point with x and y from −1 to 1.

// Waves bent by other waves.
vec3 gPlasma(vec2 p, uint h) {
    float a = bUnit(h, 1u) * 2.0 * G_PI;
    vec2 q = p * (1.5 + 2.5 * bUnit(h, 2u));
    for (int i = 0; i < 3; ++i) {
        q += 0.6 * vec2(sin(q.y * 1.7 + a + float(i)), cos(q.x * 1.3 - a * 0.7 + 2.0 * float(i)));
    }
    float v = sin(q.x + q.y) + sin(length(q) * 1.5);
    return gPalette(0.25 * v + bUnit(h, 3u), h);
}

// Truchet tiles: every square holds two quarter circles, turned one of two ways.
vec3 gTruchet(vec2 p, uint h) {
    float n = 3.0 + floor(bUnit(h, 1u) * 8.0);
    vec2 g = (p * 0.5 + 0.5) * n;
    vec2 cell = floor(g);
    vec2 f = g - cell;
    uint id = bCombine(bCombine(h, uint(int(cell.x))), uint(int(cell.y)));
    if (bUnit(id, 1u) > 0.5) { f.x = 1.0 - f.x; }
    float d = min(abs(length(f) - 0.5), abs(length(f - 1.0) - 0.5));
    float width = 0.08 + 0.12 * bUnit(h, 2u);
    vec3 ground = gPalette(bUnit(h, 3u), h) * 0.9 + 0.1;
    vec3 line = gPalette(bUnit(h, 3u) + 0.5, h) * 0.35;
    return mix(line, ground, smoothstep(width - 0.02, width + 0.02, d));
}

// A rectangle cut in two, and the pieces cut again, a few of them painted.
vec3 gMondrian(vec2 p, uint h) {
    vec2 lo = vec2(-1.0);
    vec2 hi = vec2(1.0);
    uint id = h;
    float edge = 1.0;
    for (int depth = 0; depth < 5; ++depth) {
        vec2 size = hi - lo;
        if (depth > 1 && bUnit(id, 1u) < 0.25) { break; }
        bool vertical = size.x * (0.6 + 0.8 * bUnit(id, 2u)) > size.y;
        float cut = 0.3 + 0.4 * bUnit(id, 3u);
        if (vertical) {
            float at = lo.x + size.x * cut;
            edge = min(edge, abs(p.x - at));
            if (p.x < at) { hi.x = at; id = bCombine(id, 1u); } else { lo.x = at; id = bCombine(id, 2u); }
        } else {
            float at = lo.y + size.y * cut;
            edge = min(edge, abs(p.y - at));
            if (p.y < at) { hi.y = at; id = bCombine(id, 3u); } else { lo.y = at; id = bCombine(id, 4u); }
        }
    }
    float pick = bUnit(id, 5u);
    vec3 color = vec3(0.93, 0.92, 0.88);
    if (pick > 0.86) { color = vec3(0.80, 0.12, 0.10); }
    else if (pick > 0.74) { color = vec3(0.10, 0.22, 0.60); }
    else if (pick > 0.62) { color = vec3(0.92, 0.76, 0.12); }
    return edge < 0.028 ? vec3(0.05) : color;
}

// An elementary cellular automaton: each row is made from the row above by
// a rule that looks at a cell and its two neighbours.
vec3 gAutomaton(vec2 p, uint h) {
    const uint rules[16] = uint[16](30u, 90u, 110u, 54u, 60u, 73u, 105u, 150u,
                             126u, 22u, 45u, 18u, 182u, 122u, 146u, 62u);
    uint rule = rules[uint(bUnit(h, 1u) * 15.999)];
    int column = clamp(int((p.x * 0.5 + 0.5) * 32.0), 0, 31);
    int row = clamp(int((0.5 - p.y * 0.5) * 32.0), 0, 31);
    // Half start from one live cell, half from a scatter of them.
    uint cells = bUnit(h, 2u) > 0.5 ? 0x00010000u : bMix(h ^ 0xa5a5u);
    for (int j = 0; j < row; ++j) {
        uint left = (cells << 1) | (cells >> 31);
        uint right = (cells >> 1) | (cells << 31);
        uint next = 0u;
        for (uint k = 0u; k < 8u; ++k) {
            if (((rule >> k) & 1u) != 0u) {
                next |= ((k & 4u) != 0u ? left : ~left) & ((k & 2u) != 0u ? cells : ~cells)
                    & ((k & 1u) != 0u ? right : ~right);
            }
        }
        cells = next;
    }
    bool live = ((cells >> uint(31 - column)) & 1u) != 0u;
    vec3 paper = gPalette(bUnit(h, 3u), h) * 0.25 + 0.72;
    vec3 ink = gPalette(bUnit(h, 3u) + 0.45, h) * 0.45;
    return live ? ink : paper;
}

// A Julia set: points whose path under z → z² + c stays near.
vec3 gJulia(vec2 p, uint h) {
    float angle = bUnit(h, 1u) * 2.0 * G_PI;
    vec2 c = 0.7885 * vec2(cos(angle), sin(angle));
    vec2 z = p * 1.5;
    float n = 0.0;
    for (int i = 0; i < 64; ++i) {
        z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        if (dot(z, z) > 64.0) { break; }
        n += 1.0;
    }
    if (n > 63.5) { return vec3(0.03, 0.03, 0.05); }
    float level = n + 1.0 - log2(max(log2(dot(z, z)) * 0.5, 1e-4));
    return gPalette(0.035 * level + bUnit(h, 3u), h);
}

// A rose, r = |cos kθ|, filled with rings.
vec3 gRose(vec2 p, uint h) {
    float k = 2.0 + floor(bUnit(h, 1u) * 7.0);
    float rings = 2.0 + floor(bUnit(h, 2u) * 6.0);
    float r = length(p);
    float petal = abs(cos(0.5 * k * atan(p.y, p.x)));
    vec3 ground = gPalette(bUnit(h, 3u) + 0.5, h) * 0.2 + 0.05;
    if (r > 0.95 * petal) { return ground; }
    float band = floor(r / max(0.95 * petal, 1e-3) * rings) / rings;
    return gPalette(band * 0.6 + bUnit(h, 3u), h);
}

// Whole-number games: x and y combined bit by bit, then a remainder taken.
vec3 gBits(vec2 p, uint h) {
    uint size = 32u << uint(bUnit(h, 1u) * 2.999);
    uint ix = uint(clamp((p.x * 0.5 + 0.5) * float(size), 0.0, float(size) - 1.0));
    uint iy = uint(clamp((p.y * 0.5 + 0.5) * float(size), 0.0, float(size) - 1.0));
    uint op = uint(bUnit(h, 2u) * 3.999);
    uint value = op == 0u ? (ix ^ iy) : (op == 1u ? (ix & iy) : (op == 2u ? (ix | iy) : ix * iy));
    uint modulus = 3u + uint(bUnit(h, 4u) * 28.999);
    return gPalette(float(value % modulus) / float(modulus) + bUnit(h, 3u), h);
}

// Voronoi cells: each point takes the colour of the nearest of a scatter of sites.
vec3 gVoronoi(vec2 p, uint h) {
    float n = 3.0 + floor(bUnit(h, 1u) * 6.0);
    vec2 g = (p * 0.5 + 0.5) * n;
    vec2 cell = floor(g);
    float best = 1e9;
    float second = 1e9;
    uint bestId = 0u;
    for (int j = -1; j <= 1; ++j) {
        for (int i = -1; i <= 1; ++i) {
            vec2 other = cell + vec2(float(i), float(j));
            uint id = bCombine(bCombine(h, uint(int(other.x))), uint(int(other.y)));
            vec2 site = other + vec2(bUnit(id, 1u), bUnit(id, 2u));
            float d = length(g - site);
            if (d < best) { second = best; best = d; bestId = id; }
            else if (d < second) { second = d; }
        }
    }
    vec3 color = gPalette(bUnit(bestId, 3u) * 0.5 + bUnit(h, 3u), h);
    return second - best < 0.05 ? color * 0.25 : color;
}

float gNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    f = f * f * (3.0 - 2.0 * f);
    uint a = bCombine(uint(int(i.x)), uint(int(i.y)));
    uint b = bCombine(uint(int(i.x) + 1), uint(int(i.y)));
    uint c = bCombine(uint(int(i.x)), uint(int(i.y) + 1));
    uint d = bCombine(uint(int(i.x) + 1), uint(int(i.y) + 1));
    return mix(mix(bUnit(a, 1u), bUnit(b, 1u), f.x), mix(bUnit(c, 1u), bUnit(d, 1u), f.x), f.y) * 2.0 - 1.0;
}

// Where the formula is kept: four steps to a number, in the two groups set
// aside for it and then in the five numbers the rooms leave unused.
float gFormulaNumber(WorldValues P, int index) {
    if (index < 8) { return P.v[6 + index / 4][index % 4]; }
    if (index == 8) { return P.v[2].w; }
    if (index == 9) { return P.v[4].w; }
    if (index == 10) { return P.v[5].y; }
    if (index == 11) { return P.v[5].z; }
    return P.v[5].w;
}

// The visitor's own formula, in reverse Polish: each step pushes a number or
// combines the top of the stack. One number left over is a place on a colour
// wheel; three are red, green and blue.
vec3 gFormula(vec2 p, uint h, WorldValues P, int count) {
    float stack[8];
    int top = 0;
    float t = bUnit(h, 1u);
    float u = bUnit(h, 2u);
    for (int i = 0; i < count; ++i) {
        int triple = int(gFormulaNumber(P, i / 4) + 0.5);
        int place = i % 4;
        int op = (place == 0 ? triple : (place == 1 ? triple / 64 : (place == 2 ? triple / 4096 : triple / 262144))) % 64;
        float value = 0.0;
        bool push = true;
        if (op == 1) { value = p.x; }
        else if (op == 2) { value = p.y; }
        else if (op == 3) { value = length(p); }
        else if (op == 4) { value = atan(p.y, p.x) / G_PI; }
        else if (op == 5) { value = t; }
        else if (op == 6) { value = u; }
        else if (op >= 10 && op <= 19) { value = float(op - 10); }
        else if (op == 31) { value = top > 0 ? stack[top - 1] : 0.0; }
        else { push = false; }
        if (push) {
            if (top < 8) { stack[top] = value; top += 1; }
            continue;
        }
        if (top < 1) { continue; }
        float b = stack[top - 1];
        if ((op >= 24 && op <= 28) || op == 34 || op == 36 || op == 37 || op == 38 || op == 40) {
            float r = b;
            if (op == 24) { r = sin(G_PI * b); }
            else if (op == 25) { r = cos(G_PI * b); }
            else if (op == 26) { r = sqrt(abs(b)); }
            else if (op == 27) { r = abs(b); }
            else if (op == 28) { r = b - floor(b); }
            else if (op == 34) { r = exp(clamp(b, -20.0, 20.0)); }
            else if (op == 36) { r = abs(b) > 1e-6 ? 1.0 / b : 0.0; }
            else if (op == 37) { r = b > 0.0 ? 1.0 : 0.0; }
            else if (op == 38) { r = floor(b); }
            else { r = -b; }
            stack[top - 1] = r;
            continue;
        }
        if (top < 2) { continue; }
        float a = stack[top - 2];
        float r = 0.0;
        if (op == 20) { r = a + b; }
        else if (op == 21) { r = a - b; }
        else if (op == 22) { r = a * b; }
        else if (op == 23) { r = abs(b) > 1e-6 ? a / b : 0.0; }
        else if (op == 29) { r = min(a, b); }
        else if (op == 30) { r = max(a, b); }
        else if (op == 33) { r = gNoise(vec2(a, b)); }
        else if (op == 35) { r = pow(abs(a), clamp(b, -8.0, 8.0)); }
        else if (op == 39) { r = abs(b) > 1e-6 ? a - b * floor(a / b) : 0.0; }
        else if (op == 32) {
            stack[top - 2] = b;
            stack[top - 1] = a;
            continue;
        }
        stack[top - 2] = r;
        top -= 1;
    }
    if (top >= 3) {
        vec3 rgb = vec3(stack[top - 3], stack[top - 2], stack[top - 1]);
        return clamp(0.5 + 0.5 * rgb, 0.0, 1.0);
    }
    float value = top > 0 ? stack[top - 1] : 0.0;
    if ((isnan(value) || isinf(value))) { value = 0.0; }
    return gPalette(0.5 * value, h);
}

vec3 gArt(vec2 p, uint h, int scheme, WorldValues P, int count) {
    // A mixed gallery lets each picture choose.
    int kind = scheme == 0 ? 1 + int(bUnit(h, 50u) * 7.999) : scheme;
    switch (kind) {
        case 1: return gPlasma(p, h);
        case 2: return gTruchet(p, h);
        case 3: return gMondrian(p, h);
        case 4: return gAutomaton(p, h);
        case 5: return gJulia(p, h);
        case 6: return gRose(p, h);
        case 7: return gBits(p, h);
        case 8: return gVoronoi(p, h);
        default: return gFormula(p, h, P, count);
    }
}

// A wall of pictures. u runs left to right as seen from inside the room.
BabelSurface gPictures(
    float u, float y, int wallIndex, uint seed, BabelStyle style, BabelDesign D, bool here,
    vec3 outward, vec3 along, WorldValues P, ivec3 off
) {
    BabelSurface result;
    result.normal = -outward;
    result.gloss = 0.05;
    result.glow = vec3(0.0);
    // Pale plaster, tinted by the room's own stone.
    result.albedo = mix(vec3(0.84, 0.83, 0.80), style.stone * 1.6, 0.30);
    if (y < 0.14) {
        result.albedo = vec3(0.92);
        return result;
    }

    // The scheme of the floor this room is on.
    int floorAndCount = int(P.v[5].x + 0.5);
    int scheme = ((floorAndCount % 16 + off.z) % 10 + 10) % 10;
    int count = floorAndCount / 16;

    float usable = D.hw - 0.25;
    float y0 = 0.55;
    float y1 = D.H - 0.35;
    float cellWidth = 2.0 * usable / float(D.vols);
    float cellHeight = (y1 - y0) / float(D.shelves);
    if (abs(u) >= usable || y <= y0 || y >= y1) { return result; }
    int column = clamp(int((u + usable) / cellWidth), 0, D.vols - 1);
    int row = clamp(int((y1 - y) / cellHeight), 0, D.shelves - 1);
    uint h = bCombine(bCombine(bCombine(seed, uint(wallIndex)), uint(row)), uint(column));

    float halfWidth = min(cellWidth * 0.5 - 0.12, 0.85) * (0.72 + 0.28 * bUnit(h, 60u));
    float halfHeight = min(halfWidth * (0.7 + 0.6 * bUnit(h, 61u)), cellHeight * 0.5 - 0.14);
    vec2 q = vec2(u + usable - (float(column) + 0.5) * cellWidth,
                      y - (y1 - (float(row) + 0.5) * cellHeight));
    vec2 e = abs(q) - vec2(halfWidth, halfHeight);
    float frame = 0.05 + 0.04 * bUnit(h, 62u);
    if (max(e.x, e.y) < 0.0) {
        vec3 art = gArt(q / vec2(halfWidth, halfHeight), h, scheme, P, count);
        result.albedo = art;
        // A picture light over each frame.
        result.glow = art * 0.45;
    } else if (max(e.x, e.y) < frame) {
        result.albedo = bUnit(h, 63u) > 0.5 ? vec3(0.62, 0.47, 0.18) : vec3(0.10, 0.09, 0.08);
        result.gloss = 0.5;
        result.normal = normalize(-outward + (e.x > e.y ? along * sign(q.x) : vec3(0.0, sign(q.y), 0.0)) * 0.6);
    } else if (e.x < frame && e.y > 0.0 && e.y < frame + 0.07 && q.y < 0.0) {
        result.albedo *= 0.82; // the shadow under a frame
    }
    return result;
}

vec3 bLit(
    BabelSurface s, vec3 p, vec3 rd, vec3 lampA, vec3 lampB, vec3 lampColor
) {
    vec3 color = s.albedo * vec3(0.055, 0.050, 0.060) + s.glow;
    for (int i = 0; i < 2; ++i) {
        vec3 toLamp = (i == 0 ? lampA : lampB) - p;
        float d2 = dot(toLamp, toLamp);
        vec3 l = toLamp / sqrt(d2);
        float falloff = 1.0 / (1.0 + 0.30 * d2);
        float diffuse = clamp(dot(s.normal, l), 0.0, 1.0);
        vec3 h = normalize(l - rd);
        float specular = pow(clamp(dot(s.normal, h), 0.0, 1.0), 36.0) * s.gloss;
        color += lampColor * falloff * (s.albedo * diffuse + 0.25 * specular);
    }
    return color;
}

void main() {
    // The shorter side of the view spans -1...1, y up.
    vec2 screen = gl_FragCoord.xy / uResolution * 2.0 - 1.0;
    float aspect = uResolution.x / uResolution.y;
    vec2 uv = vec2(screen.x * aspect, screen.y) / min(aspect, 1.0);

    WorldValues P;
    for (int i = 0; i < 8; ++i) { P.v[i] = uV[i]; }

    BabelDesign D;
    D.n = int(uV[1].x + 0.5);
    D.ap = uV[1].y;
    D.H = uV[1].z;
    D.open = D.n - int(uV[1].w + 0.5);
    D.shelves = int(uV[2].x + 0.5);
    D.vols = int(uV[2].y + 0.5);
    D.plain = uV[2].z > 0.5;
    D.limit = int(uV[2].w + 0.5);
    D.low = uV[3].xyz;
    D.floorTurn = int(uV[3].w + 0.5);
    D.high = uint(uV[4].x + 0.5) | (uint(uV[4].y + 0.5) << 16);
    D.key = uint(uV[4].z + 0.5);
    D.othersFull = uV[4].w > 0.5;
    D.hw = D.ap * tan(B_PI / float(D.n));
    D.sa = 0.36 * D.ap;
    D.doorH = min(2.1, D.H - 0.25);
    D.chosen = uV[5].xyz;
    D.taken = uV[5].w > 0.5;

    float yaw = uCamera.x;
    float pitch = uCamera.y;
    float lens = uV[0].w;
    vec3 ro = uV[0].xyz;
    vec3 rd = wRotateY(wRotateX(normalize(vec3(uv * 0.72 * lens, -1.65)), pitch), yaw);

    float wallTurn = 2.0 * B_PI / float(D.n);
    float period = D.H + B_SLAB;

    // Which part of the plan the viewer stands in.
    int zone = 0;
    int wallV = 0;
    for (int k = 0; k < D.open; ++k) {
        int wall = bOpenWall(k, D.n, D.open);
        vec2 q = bRot(ro.xz, -wallTurn * float(wall));
        if (zone == 0 && q.x > D.ap) {
            zone = 1;
            wallV = wall;
            ro = vec3(q.x - D.ap - B_VEST, ro.y, q.y);
            vec2 d = bRot(rd.xz, -wallTurn * float(wall));
            rd = vec3(d.x, rd.y, d.y);
        }
    }

    ivec3 off = ivec3(0);
    float travelled = 0.0;
    vec3 tint = vec3(1.0);
    vec3 color = vec3(0.0);
    bool mirrored = false;
    bool finished = false;

    for (int iteration = 0; iteration < 20 && !finished; ++iteration) {
        uint seed = bRoomSeed(D, off);
        BabelStyle style = bStyle(seed);
        bool here = off.x == 0 && off.y == 0 && off.z == 0;
        BabelSurface surface;
        surface.glow = vec3(0.0);
        surface.gloss = 0.1;
        vec3 lampA;
        vec3 lampB;
        vec3 lampColor = style.lamp;
        vec3 p;

        if (zone == 0) {
            lampA = vec3(0.0, D.H - 0.42, 0.66 * D.ap);
            lampB = vec3(0.0, D.H - 0.42, -0.66 * D.ap);

            float best = 1e9;
            int kind = 0;
            int wall = 0;
            vec3 railNormal = vec3(0.0);
            for (int i = 0; i < D.n; ++i) {
                float a = wallTurn * float(i);
                vec2 nn = vec2(cos(a), sin(a));
                float denom = dot(rd.xz, nn);
                if (denom > 1e-5) {
                    float t = (D.ap - dot(ro.xz, nn)) / denom;
                    if (t < best) { best = t; kind = 1; wall = i; }
                }
                // The railing round the shaft.
                if (abs(denom) > 1e-5) {
                    float t = (D.sa - dot(ro.xz, nn)) / denom;
                    if (t > 1e-3 && t < best) {
                        vec3 q = ro + rd * t;
                        float across = dot(q.xz, vec2(-nn.y, nn.x));
                        if (abs(across) <= D.sa * tan(B_PI / float(D.n)) && q.y >= 0.0 && q.y <= B_RAIL) {
                            bool solid = q.y > B_RAIL - 0.07 || q.y < 0.05
                                || fract(across / 0.13 + 0.5) < 0.2;
                            if (solid) {
                                best = t; kind = 4;
                                railNormal = vec3(nn.x, 0.0, nn.y) * (denom > 0.0 ? -1.0 : 1.0);
                            }
                        }
                    }
                }
            }
            if (rd.y < -1e-5) {
                float t = -ro.y / rd.y;
                if (t < best) { best = t; kind = 2; }
            }
            if (rd.y > 1e-5) {
                float t = (D.H - ro.y) / rd.y;
                if (t < best) { best = t; kind = 3; }
            }
            float tLamp = wSphereHit(ro, rd, lampA, 0.12);
            if (tLamp > 1e-3 && tLamp < best) { best = tLamp; kind = 5; }
            tLamp = wSphereHit(ro, rd, lampB, 0.12);
            if (tLamp > 1e-3 && tLamp < best) { best = tLamp; kind = 5; }

            best = max(best, 0.0);
            p = ro + rd * best;
            travelled += best;

            if (kind == 5) {
                color += tint * style.lamp * 0.9 * exp(-0.045 * travelled);
                finished = true;
                continue;
            }
            if (kind == 2 || kind == 3) {
                bool down = kind == 2;
                if (bShaftInside(p.xz, D) > 0.0) {
                    // Through the shaft, if the ray clears the thickness of the floor.
                    float extra = B_SLAB / abs(rd.y);
                    vec3 q = p + rd * extra;
                    if (bShaftInside(q.xz, D) > 0.0) {
                        float turn = down ? wallTurn : -wallTurn;
                        vec2 xz = bRot(q.xz, turn);
                        vec2 dxz = bRot(rd.xz, turn);
                        ro = vec3(xz.x, down ? D.H : 0.0, xz.y);
                        rd = vec3(dxz.x, rd.y, dxz.y);
                        off.z += down ? -1 : 1;
                        travelled += extra;
                        continue;
                    }
                    surface.albedo = style.stone * 0.8;
                    surface.normal = normalize(vec3(-p.x, 0.0, -p.z));
                } else if (down) {
                    surface.albedo = bFloor(p.xz, style, seed);
                    surface.normal = vec3(0.0, 1.0, 0.0);
                    surface.gloss = 0.25;
                } else {
                    surface.albedo = style.stone * 1.15;
                    surface.normal = vec3(0.0, -1.0, 0.0);
                }
            } else if (kind == 4) {
                surface.albedo = style.metal;
                surface.normal = railNormal;
                surface.gloss = 0.8;
            } else {
                float a = wallTurn * float(wall);
                vec2 nn = vec2(cos(a), sin(a));
                vec2 tt = vec2(-nn.y, nn.x);
                float across = dot(p.xz, tt);
                if (bIsOpen(wall, D.n, D.open)) {
                    if (abs(across) < B_DOOR_HALF && p.y < D.doorH) {
                        ro = vec3(-B_VEST, p.y, across);
                        rd = vec3(dot(rd.xz, nn), rd.y, dot(rd.xz, tt));
                        zone = 1;
                        wallV = wall;
                        continue;
                    }
                    bool frame = abs(across) < B_DOOR_HALF + 0.09 && p.y < D.doorH + 0.09;
                    surface.albedo = frame ? style.wood * 1.6 : bStone(vec2(across, p.y), style, seed);
                    surface.normal = vec3(-nn.x, 0.0, -nn.y);
                } else {
                    surface = gPictures(across, p.y, bShelvedIndex(wall, D.n, D.open), seed, style, D,
                                         here, vec3(nn.x, 0.0, nn.y), vec3(tt.x, 0.0, tt.y), P, off);
                }
            }
        } else {
            // The vestibule: x runs from this gallery (−) to the next (+).
            // The stair stands on one side and the mirror hangs on the other.
            // Which is which turns round with the wall, so the two galleries
            // that share a vestibule agree about it.
            float side = wallV < D.n / 2 ? 1.0 : -1.0;
            vec2 stair = vec2(0.0, side * B_STAIR_Z);
            lampA = vec3(0.0, D.H - 0.40, -0.45 * side);
            lampB = lampA;
            lampColor = style.lamp * 0.35;

            float best = 1e9;
            int kind = 0;
            if (rd.x > 1e-5) { float t = (B_VEST - ro.x) / rd.x; if (t < best) { best = t; kind = 1; } }
            if (rd.x < -1e-5) { float t = (-B_VEST - ro.x) / rd.x; if (t < best) { best = t; kind = 2; } }
            if (rd.z > 1e-5) { float t = (B_VEST_HALF - ro.z) / rd.z; if (t < best) { best = t; kind = 3; } }
            if (rd.z < -1e-5) { float t = (-B_VEST_HALF - ro.z) / rd.z; if (t < best) { best = t; kind = 4; } }
            if (rd.y < -1e-5) { float t = -ro.y / rd.y; if (t < best) { best = t; kind = 5; } }
            if (rd.y > 1e-5) { float t = (D.H - ro.y) / rd.y; if (t < best) { best = t; kind = 6; } }

            // The spiral stair: a pole and a turn of treads.
            vec3 stairNormal = vec3(0.0);
            {
                vec2 oc = ro.xz - stair;
                float qa = dot(rd.xz, rd.xz);
                float qb = dot(oc, rd.xz);
                float qc = dot(oc, oc) - 0.05 * 0.05;
                float h = qb * qb - qa * qc;
                if (h > 0.0 && qa > 1e-8) {
                    float t = (-qb - sqrt(h)) / qa;
                    if (t > 1e-3 && t < best) {
                        best = t; kind = 7;
                        vec2 q = ro.xz + rd.xz * t - stair;
                        stairNormal = normalize(vec3(q.x, 0.0, q.y));
                    }
                }
            }
            if (abs(rd.y) > 1e-5) {
                for (int k = 0; k < B_STEPS; ++k) {
                    float yk = (float(k) + 0.5) * period / float(B_STEPS);
                    if (yk > D.H - 0.02) { break; }
                    float t = (yk - ro.y) / rd.y;
                    if (t > 1e-3 && t < best) {
                        vec2 q = ro.xz + rd.xz * t - stair;
                        float r = length(q);
                        if (r < B_STAIR_R && r > 0.04) {
                            float turn = fract(atan(q.y, q.x) / (2.0 * B_PI) + (side > 0.0 ? 0.0 : 0.5)
                                              - float(k) / float(B_STEPS));
                            if (turn < 1.15 / float(B_STEPS)) {
                                best = t; kind = 8;
                                stairNormal = vec3(0.0, rd.y > 0.0 ? -1.0 : 1.0, 0.0);
                            }
                        }
                    }
                }
            }

            best = max(best, 0.0);
            p = ro + rd * best;
            travelled += best;
            bool doorway = abs(p.z) < B_DOOR_HALF && p.y < D.doorH;
            bool frame = abs(p.z) < B_DOOR_HALF + 0.09 && p.y < D.doorH + 0.09;

            if (kind == 1) {
                int back = (wallV + D.n / 2) % D.n;
                if (doorway && bIsOpen(back, D.n, D.open)) {
                    // Into the next gallery, by the wall that leads back here.
                    off += bDirection(wallV, D.n, bFloorTurn(D, off));
                    float a = wallTurn * float(back);
                    vec2 nn = vec2(cos(a), sin(a));
                    vec2 tt = vec2(-nn.y, nn.x);
                    ro = vec3(nn.x * D.ap - tt.x * p.z, p.y, nn.y * D.ap - tt.y * p.z);
                    rd = vec3(-nn.x * rd.x - tt.x * rd.z, rd.y, -nn.y * rd.x - tt.y * rd.z);
                    zone = 0;
                    continue;
                }
                surface.albedo = frame && bIsOpen(back, D.n, D.open)
                    ? style.wood * 1.6 : bStone(vec2(p.z, p.y), style, seed);
                surface.normal = vec3(-1.0, 0.0, 0.0);
            } else if (kind == 2) {
                if (doorway) {
                    float a = wallTurn * float(wallV);
                    vec2 nn = vec2(cos(a), sin(a));
                    vec2 tt = vec2(-nn.y, nn.x);
                    ro = vec3(nn.x * D.ap + tt.x * p.z, p.y, nn.y * D.ap + tt.y * p.z);
                    rd = vec3(nn.x * rd.x + tt.x * rd.z, rd.y, nn.y * rd.x + tt.y * rd.z);
                    zone = 0;
                    continue;
                }
                surface.albedo = frame ? style.wood * 1.6 : bStone(vec2(p.z, p.y), style, seed);
                surface.normal = vec3(1.0, 0.0, 0.0);
            } else if ((kind == 3 && side < 0.0) || (kind == 4 && side > 0.0)) {
                surface.normal = vec3(0.0, 0.0, side);
                bool glass = abs(p.x) < 0.40 && p.y > 0.45 && p.y < 1.95;
                bool gilt = abs(p.x) < 0.46 && p.y > 0.39 && p.y < 2.01;
                float closet = abs(abs(p.x) - 0.84);
                if (glass && !mirrored) {
                    // The mirror, which faithfully duplicates all appearances.
                    ro = p;
                    rd.z = -rd.z;
                    tint *= vec3(0.80, 0.84, 0.88);
                    mirrored = true;
                    continue;
                } else if (gilt) {
                    surface.albedo = vec3(0.70, 0.52, 0.20);
                    surface.gloss = 0.8;
                } else if (closet < 0.24 && p.y < 1.92) {
                    // The doors of the two closets.
                    bool panel = closet < 0.17 && fract(p.y / 0.96) > 0.12 && fract(p.y / 0.96) < 0.88;
                    surface.albedo = style.wood * (panel ? 0.75 : 1.05);
                } else {
                    surface.albedo = bStone(vec2(p.x, p.y), style, seed);
                }
            } else if (kind == 3 || kind == 4) {
                surface.albedo = bStone(vec2(p.x, p.y), style, seed);
                surface.normal = vec3(0.0, 0.0, -side);
            } else if (kind == 5 || kind == 6) {
                bool down = kind == 5;
                if (length(p.xz - stair) < B_STAIR_R) {
                    float extra = B_SLAB / abs(rd.y);
                    vec3 q = p + rd * extra;
                    if (length(q.xz - stair) < B_STAIR_R) {
                        ro = vec3(q.x, down ? D.H : 0.0, q.z);
                        off.z += down ? -1 : 1;
                        travelled += extra;
                        continue;
                    }
                    surface.albedo = style.stone * 0.8;
                    vec2 away = normalize(stair - p.xz);
                    surface.normal = vec3(away.x, 0.0, away.y);
                } else if (down) {
                    surface.albedo = bFloor(p.xz + vec2(7.3, 2.1), style, seed);
                    surface.normal = vec3(0.0, 1.0, 0.0);
                    surface.gloss = 0.25;
                } else {
                    surface.albedo = style.stone * 1.15;
                    surface.normal = vec3(0.0, -1.0, 0.0);
                }
            } else if (kind == 7) {
                surface.albedo = style.metal;
                surface.normal = stairNormal;
                surface.gloss = 0.8;
            } else {
                surface.albedo = style.wood * 1.7;
                surface.normal = stairNormal;
                surface.gloss = 0.2;
            }
        }

        vec3 lit = bLit(surface, p, rd, lampA, lampB, lampColor);
        color += tint * lit * exp(-0.045 * travelled);
        finished = true;
    }

    // What is far away is lost in the dark of the shaft.
    color += vec3(0.010, 0.009, 0.014);
    float vignette = 1.0 - 0.22 * dot(screen, screen);
    fragColor = vec4(wToneMap(color * vignette), 1.0);
}`;
