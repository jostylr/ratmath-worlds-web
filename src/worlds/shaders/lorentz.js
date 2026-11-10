// Lorentz.metal in GLSL, written by make-shaders.py from the app's
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


// Flying through a lattice of glowing beams at a speed β (a fraction of the
// speed of light), drawn as it would really look.
//
// Each pixel looks in some direction d′ in the traveller's frame, at angle θ′
// to the direction of travel v. Light arriving from there left the lattice
// travelling along a direction at angle θ in the lattice's own frame, where
//     cos θ = (cos θ′ − β) ⁄ (1 − β cos θ′)        (aberration)
// and its frequency is multiplied by the Doppler factor
//     D = γ (1 + β cos θ),   γ = 1 ⁄ √(1 − β²).
// A glowing body at temperature T looks like one at D·T, and its brightness
// is multiplied by D⁴. The lattice is at rest in its own frame, so the ray is
// simply traced there. LorentzWorld.swift works the same numbers out.
//
// v[0]: β, aberration on, Doppler colour on, brightness on
// v[1]: zoom, temperature at rest (kelvin), flying on, unused
// v[2]: travel direction (x, y, z), unused
// v[3]: starting place in the lattice (x, y, z), unused

vec3 lorentzBlackbody(float kelvin) {
    // Tanner Helland's fit to the colour of a glowing body, then into linear
    // light. Below about 1000 K the glow fades into the infrared.
    float t = clamp(kelvin, 600.0, 40000.0) / 100.0;
    float r = t <= 66.0 ? 1.0 : saturate(1.292936 * pow(t - 60.0, -0.1332047592));
    float g = t <= 66.0 ? saturate(0.390081579 * log(t) - 0.631841444)
                        : saturate(1.129890861 * pow(t - 60.0, -0.0755148492));
    float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : saturate(0.543206789 * log(t - 10.0) - 1.19625408914));
    vec3 c = pow(vec3(r, g, b), vec3(2.2));
    return c * smoothstep(600.0, 1600.0, kelvin);
}

// The lattice: beams along x, y and z through every whole-number point,
// and a bright node where three meet.
float lorentzLattice(vec3 p, inout int kind) {
    vec3 q = p - floor(p + 0.5);
    float bx = length(q.yz) - 0.035;
    float by = length(q.xz) - 0.035;
    float bz = length(q.xy) - 0.035;
    float node = length(q) - 0.085;
    float d = bx;
    kind = 0;
    if (by < d) { d = by; kind = 1; }
    if (bz < d) { d = bz; kind = 2; }
    if (node < d) { d = node; kind = 3; }
    return d;
}

vec4 lorentzFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);
    float beta = clamp(u.v[0].x, 0.0, 0.999);
    float gamma = 1.0 / sqrt(1.0 - beta * beta);
    float zoom = max(u.v[1].x, 0.2);

    // The direction this pixel looks, in the traveller's frame.
    vec3 look = wRotateY(wRotateX(normalize(vec3(uv * 0.72 / zoom, -1.65)), u.camera.y), u.camera.x);
    vec3 v = normalize(u.v[2].xyz);
    float cosSeen = clamp(dot(look, v), -1.0, 1.0);
    float cosLattice = cosSeen;
    if (u.v[0].y > 0.5) {
        cosLattice = (cosSeen - beta) / (1.0 - beta * cosSeen);
    }
    vec3 across = look - cosSeen * v;
    float acrossLength = length(across);
    across = acrossLength > 1e-6 ? across / acrossLength : vec3(0.0);
    float sinLattice = sqrt(max(1.0 - cosLattice * cosLattice, 0.0));
    vec3 rd = normalize(cosLattice * v + sinLattice * across);
    float doppler = gamma * (1.0 + beta * cosLattice);

    // Where the traveller is: the lattice repeats, so the place wraps.
    float travelled = u.v[1].z > 0.5 ? fmod(u.focus.w * 0.6, 1000.0) : 0.0;
    vec3 ro = u.v[3].xyz + v * travelled;

    float travel = 0.0;
    int kind = 0;
    bool hit = false;
    int maxSteps = int(u.budget.x);
    for (int i = 0; i < 160; ++i) {
        if (i >= maxSteps) { break; }
        float d = lorentzLattice(ro + rd * travel, kind);
        if (d < 0.0015 * (1.0 + travel)) { hit = true; break; }
        travel += d;
        if (travel > 40.0) { break; }
    }

    vec3 color = vec3(0.0);
    if (hit) {
        vec3 p = ro + rd * travel;
        vec3 q = p - floor(p + 0.5);
        vec3 normal = kind == 3 ? normalize(q)
            : (kind == 0 ? normalize(vec3(0.0, q.y, q.z))
            : (kind == 1 ? normalize(vec3(q.x, 0.0, q.z)) : normalize(vec3(q.x, q.y, 0.0))));
        float facing = saturate(dot(normal, -rd));
        // Each kind of beam is painted a little differently, so they can be
        // told apart; they all glow at the same temperature at rest.
        vec3 paint = kind == 0 ? vec3(1.0, 0.78, 0.70)
            : (kind == 1 ? vec3(0.78, 1.0, 0.78)
            : (kind == 2 ? vec3(0.75, 0.82, 1.0) : vec3(1.0)));
        float rest = u.v[1].y;
        float kelvin = u.v[0].z > 0.5 ? rest * doppler : rest;
        float brightness = 1.0;
        if (u.v[0].w > 0.5) {
            // D⁴, with the camera's exposure set for the brightest view,
            // straight ahead, so that the picture is not all white.
            float ahead = gamma * (1.0 + beta);
            brightness = pow(doppler, 4.0) / (ahead * ahead);
        }
        color = lorentzBlackbody(kelvin) * paint * brightness * (0.45 + 0.55 * facing) * (kind == 3 ? 1.6 : 1.0);
        color *= 0.55 * exp(-travel * 0.07);
    }
    float vignette = 1.0 - 0.2 * dot(screen, screen);
    return vec4(wToneMap(color * vignette), 1.0);
}

uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(lorentzFragment(position, U).rgb, 1.0);
}
`;
