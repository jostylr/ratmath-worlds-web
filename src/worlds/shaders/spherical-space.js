// SphericalSpace.metal in GLSL, written by make-shaders.py from the app's
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


// Inside the 120-cell: spherical space, the three-dimensional surface of a
// four-dimensional ball, filled by 120 rooms, each a regular dodecahedron.
//
// A point of the space is a unit vector p in R⁴. A straight line from p in
// the direction d (a unit vector at right angles to p) is the great circle
// p cos t + d sin t: after t = π it reaches the opposite point, and after
// 2π it is home again.
//
// The rooms' edges are found by folding: p is reflected in the four mirrors
// of the symmetry group H4 until it lies in one small chamber, which holds
// one half-edge of the 120-cell, from the corner v0 toward the middle of
// the edge (direction b). SphericalSpaceWorld.swift holds the same numbers.
//
// v[0], v[1], v[2], v[3]: where you stand, and your right, up and forward
// v[4]: fog, show yourself, show the beacon, colour by layer
// v[5]: zoom

#define SS_N0 vec4(1.0, 0.0, 0.0, 0.0)
#define SS_N1 vec4(-0.809016994, 0.587785252, 0.0, 0.0)
#define SS_N2 vec4(0.0, -0.850650808, 0.525731112, 0.0)
#define SS_N3 vec4(0.0, 0.0, -0.951056516, 0.309016994)
#define SS_V0 vec4(0.135045378, 0.185874017, 0.300750478, 0.925614793)
#define SS_B vec4(-0.990839415, 0.025333497, 0.040990459, 0.126155660)
#define SS_HOME vec4(0.0, 0.0, 0.0, 1.0)

vec4 ssReflect(vec4 p, vec4 n) {
    float d = dot(p, n);
    return d < 0.0 ? p - 2.0 * d * n : p;
}

// The angle from p to the nearest beam or corner of any room.
float ssDistance(vec4 p) {
    for (int i = 0; i < 60; ++i) {
        vec4 before = p;
        p = ssReflect(p, SS_N0);
        p = ssReflect(p, SS_N1);
        p = ssReflect(p, SS_N2);
        p = ssReflect(p, SS_N3);
        vec4 moved = p - before;
        if (dot(moved, moved) == 0.0) { break; }
    }
    float along = dot(p, SS_V0);
    float side = dot(p, SS_B);
    float inPlane = sqrt(along * along + side * side);
    float beam = atan2(sqrt(max(1.0 - inPlane * inPlane, 0.0)), inPlane) - 0.010;
    float corner = acos(clamp(along, -1.0, 1.0)) - 0.022;
    return min(beam, corner);
}

vec4 ssOrthonormal(vec4 v, vec4 a, vec4 b, vec4 c) {
    v -= dot(v, a) * a;
    v -= dot(v, b) * b;
    v -= dot(v, c) * c;
    return normalize(v);
}

vec4 sphericalSpaceFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);

    // Keep the frame exact, even part-way through an animation.
    vec4 o = normalize(u.v[0]);
    vec4 right = ssOrthonormal(u.v[1], o, vec4(0.0), vec4(0.0));
    vec4 up = ssOrthonormal(u.v[2], o, right, vec4(0.0));
    vec4 forward = ssOrthonormal(u.v[3], o, right, up);

    float zoom = max(u.v[5].x, 0.3);
    vec3 local = wRotateY(wRotateX(normalize(vec3(uv * 0.72 / zoom, -1.65)), u.camera.y), u.camera.x);
    vec4 d = normalize(local.x * right + local.y * up - local.z * forward);

    bool fog = u.v[4].x > 0.5;
    bool showYou = u.v[4].y > 0.5;
    bool showBeacon = u.v[4].z > 0.5;
    int maxSteps = int(u.budget.x);

    float t = 0.002;
    int kind = 0;
    int steps = 0;
    for (int i = 0; i < 260; ++i) {
        if (i >= maxSteps + 60) { break; }
        vec4 p = o * cos(t) + d * sin(t);
        float h = ssDistance(p);
        kind = 1;
        if (showYou && t > 0.5) {
            float you = acos(clamp(dot(p, o), -1.0, 1.0)) - 0.035;
            if (you < h) { h = you; kind = 2; }
        }
        if (showBeacon) {
            float beacon = acos(clamp(dot(p, -SS_HOME), -1.0, 1.0)) - 0.06;
            if (beacon < h) { h = beacon; kind = 3; }
        }
        steps = i;
        if (h < 0.0004) { break; }
        t += max(h * 0.9, 0.0006);
        kind = 0;
        if (t > 6.2832) { break; }
    }

    vec3 color = vec3(0.004, 0.005, 0.012);
    if (kind > 0) {
        vec4 p = o * cos(t) + d * sin(t);
        float shade = 1.0 - float(steps) / float(maxSteps + 60);
        vec3 albedo;
        if (kind == 2) {
            albedo = vec3(1.0, 0.85, 0.35);
        } else if (kind == 3) {
            albedo = vec3(1.0, 0.35, 0.25);
        } else if (u.v[4].w > 0.5) {
            // Coloured by how far the beam is from the middle of the home room:
            // the rooms come in layers, at 36°, 60°, 72°, 90° and so on.
            float away = acos(clamp(dot(p, SS_HOME), -1.0, 1.0)) / 3.14159265;
            albedo = wCosinePalette(away * 0.9 + 0.05, vec3(0.55), vec3(0.42),
                                    vec3(1.0), vec3(0.0, 0.33, 0.67));
        } else {
            albedo = vec3(0.85, 0.80, 0.70);
        }
        color = albedo * (0.25 + 0.95 * shade * shade);
        if (fog) {
            color *= exp(-t * 0.55);
        } else {
            color *= 0.35 + 0.65 * exp(-t * 0.15);
        }
    }
    float vignette = 1.0 - 0.22 * dot(screen, screen);
    return vec4(wToneMap(color * vignette), 1.0);
}

uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(sphericalSpaceFragment(position, U).rgb, 1.0);
}
`;
