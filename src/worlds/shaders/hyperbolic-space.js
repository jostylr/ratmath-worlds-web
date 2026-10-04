// HyperbolicSpace.metal in GLSL, written by make-shaders.py from the app's
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


// Hyperbolic 3-space, filled with identical rooms whose edges are drawn as
// beams. Points live on the hyperboloid x² + y² + z² − w² = −1, and a ray is
// p(t) = cosh t · o + sinh t · d.
//
// v[0]: room shape (0 cube, 1 dodecahedron), sinh a, cosh a, g
//       a is the distance from the middle of a room to each wall and
//       g = −cos(angle between neighbouring walls)
// v[1]: beam radius, view distance, zoom, palette
// v[2]: home point (w = 0 hides it)
// v[3]: explorer point (w = 0 hides it)
// v[4...7]: the viewer's frame: right, up, back, position

float mdot(vec4 a, vec4 b) {
    return dot(a.xyz, b.xyz) - a.w * b.w;
}

struct HyperRoom {
    int faces;
    float sinhA;
    float coshA;
    float g;
    float beam;
};

vec3 hyperFaceDirection(int shape, int index) {
    if (shape == 0) {
        float signOf = (index & 1) == 0 ? 1.0 : -1.0;
        int axis = index >> 1;
        return vec3(axis == 0 ? signOf : 0.0, axis == 1 ? signOf : 0.0, axis == 2 ? signOf : 0.0);
    }
    // The twelve faces of a dodecahedron point at the corners of an
    // icosahedron: the cyclic permutations of (0, ±1, ±φ).
    const float k = 0.52573111; // 1 / sqrt(1 + φ²)
    const float f = 0.85065081; // φ / sqrt(1 + φ²)
    float s1 = (index & 1) == 0 ? k : -k;
    float s2 = (index & 2) == 0 ? f : -f;
    int group = index >> 2;
    if (group == 0) { return vec3(0.0, s1, s2); }
    if (group == 1) { return vec3(s1, s2, 0.0); }
    return vec3(s2, 0.0, s1);
}

struct HyperFold {
    vec4 p;
    vec4 d;
    float first;   // the two walls the point is nearest (both ≤ 0 inside)
    float second;
    int firstIndex;
    int secondIndex;
    int reflections;
};

// Carries a point and its direction of travel back into the central room by
// reflecting them in whichever walls they have passed through.
HyperFold hyperFold(vec4 p, vec4 d, int shape, HyperRoom room, int reflections) {
    HyperFold res;
    for (int pass = 0; pass < 4; ++pass) {
        bool moved = false;
        float first = -1e9;
        float second = -1e9;
        int firstIndex = 0;
        int secondIndex = 1;
        for (int i = 0; i < room.faces; ++i) {
            vec4 n = vec4(hyperFaceDirection(shape, i) * room.coshA, room.sinhA);
            float s = mdot(p, n);
            if (s > 0.0) {
                p -= 2.0 * s * n;
                d -= 2.0 * mdot(d, n) * n;
                s = -s;
                reflections += 1;
                moved = true;
            }
            if (s > first) {
                second = first; secondIndex = firstIndex;
                first = s; firstIndex = i;
            } else if (s > second) {
                second = s; secondIndex = i;
            }
        }
        res.first = first;
        res.second = second;
        res.firstIndex = firstIndex;
        res.secondIndex = secondIndex;
        if (!moved) { break; }
    }
    res.p = p;
    res.d = d;
    res.reflections = reflections;
    return res;
}

// True distance to the nearest edge, where the two nearest walls meet:
// sinh² = (s₁² + s₂² − 2g·s₁s₂) ⁄ (1 − g²).
float hyperEdgeDistance(float first, float second, HyperRoom room) {
    float numerator = first * first + second * second - 2.0 * room.g * first * second;
    return asinh(sqrt(max(numerator, 0.0) / max(1.0 - room.g * room.g, 1e-4)));
}

// Distance along the ray to a ball of radius r about c, or a negative number.
float hyperBallHit(vec4 o, vec4 d, vec4 c, float r) {
    float A = -mdot(o, c);
    float B = -mdot(d, c);
    float amplitude2 = A * A - B * B;
    if (amplitude2 <= 0.0) { return -1.0; }
    float amplitude = sqrt(amplitude2);
    float ratio = cosh(r) / amplitude;
    if (ratio < 1.0) { return -1.0; } // the ray passes the ball by
    float shift = atanh(clamp(B / A, -0.999999, 0.999999));
    float t = -shift - acosh(ratio);
    return t > 0.0 ? t : -1.0;
}

struct HyperResult {
    vec3 color;
    float travel; // true distance to what was hit; negative for nothing
};

HyperResult hyperTrace(
    vec4 origin,
    vec4 direction,
    WorldValues P,
    int maxSteps
) {
    int shape = int(P.v[0].x + 0.5);
    HyperRoom room;
    room.faces = shape == 0 ? 6 : 12;
    room.sinhA = P.v[0].y;
    room.coshA = P.v[0].z;
    room.g = P.v[0].w;
    room.beam = P.v[1].x;
    float viewDistance = max(P.v[1].y, 0.5);
    int palette = int(P.v[1].w);

    vec3 fogColor = vec3(0.010, 0.014, 0.034);
    HyperResult result;
    result.color = fogColor;
    result.travel = -1.0;

    // The two balls are found exactly, on the ray before any folding.
    float ballTravel = 1e9;
    vec3 ballColor = vec3(0.0);
    for (int ball = 0; ball < 2; ++ball) {
        vec4 centre = P.v[2 + ball];
        if (centre.w < 0.5) { continue; }
        float radius = ball == 0 ? 0.20 : 0.10;
        float t = hyperBallHit(origin, direction, centre, radius);
        if (t > 0.0 && t < ballTravel) {
            vec4 q = cosh(t) * origin + sinh(t) * direction;
            vec4 heading = sinh(t) * origin + cosh(t) * direction;
            vec4 inward = centre + mdot(q, centre) * q;
            float facing = saturate(mdot(heading, inward) / max(sinh(radius), 1e-5));
            vec3 tint = ball == 0 ? vec3(1.0, 0.72, 0.10) : vec3(1.0);
            ballTravel = t;
            ballColor = tint * (0.18 + 0.95 * facing);
        }
    }

    vec4 p = origin;
    vec4 d = direction;
    float travel = 0.0;
    int reflections = 0;
    bool hit = false;
    HyperFold fold;
    float pixel = 0.0012;

    for (int stepIndex = 0; stepIndex < maxSteps; ++stepIndex) {
        fold = hyperFold(p, d, shape, room, reflections);
        p = fold.p;
        d = fold.d;
        reflections = fold.reflections;

        float toBeam = hyperEdgeDistance(fold.first, fold.second, room) - room.beam;
        // Things look smaller with distance much faster than in flat space,
        // so the tolerance grows with sinh rather than with the distance.
        float tolerance = pixel * max(sinh(travel), 0.05);
        if (toBeam < tolerance) {
            hit = true;
            break;
        }
        // Never step far past a wall: the fold undoes one crossing at a time.
        float toWall = asinh(max(-fold.first, 0.0));
        float advance = min(toBeam, toWall + 0.02);
        float c = cosh(advance);
        float s = sinh(advance);
        vec4 next = c * p + s * d;
        d = s * p + c * d;
        p = next;
        // Single precision drifts off the hyperboloid; put the point back.
        p /= sqrt(max(-mdot(p, p), 1e-6));
        d += mdot(d, p) * p;
        d /= sqrt(max(mdot(d, d), 1e-6));
        travel += advance;
        if (travel > ballTravel || travel > viewDistance * 2.6) { break; }
    }

    vec3 color = fogColor;
    float shown = -1.0;
    if (hit && travel < ballTravel) {
        // The beam's distance function has slope 1, so its change along the
        // ray is the cosine between the ray and the surface normal.
        float e = 0.002;
        vec4 ahead = cosh(e) * p + sinh(e) * d;
        vec4 aheadDirection = sinh(e) * p + cosh(e) * d;
        HyperFold probe = hyperFold(ahead, aheadDirection, shape, room, 0);
        float here = hyperEdgeDistance(fold.first, fold.second, room);
        float there = hyperEdgeDistance(probe.first, probe.second, room);
        float facing = saturate((here - there) / e);

        vec3 albedo;
        if (palette == 1) { // Depth: one hue per wall crossed
            albedo = wCosinePalette(float(reflections) * 0.07 + 0.55, vec3(0.55), vec3(0.42),
                                    vec3(1.0), vec3(0.0, 0.33, 0.67));
        } else if (palette == 2) { // Steel
            albedo = vec3(0.62, 0.68, 0.78);
        } else if (shape == 0) {
            // Axes: beams of a cube run along x, y or z, and reflections in the
            // walls never change which. The pair of nearest walls says which.
            int axis = 3 - (fold.firstIndex >> 1) - (fold.secondIndex >> 1);
            albedo = axis == 0 ? vec3(0.90, 0.16, 0.10)
                   : (axis == 1 ? vec3(0.14, 0.66, 0.20) : vec3(0.12, 0.32, 0.95));
        } else {
            albedo = vec3(0.90, 0.66, 0.30);
        }
        color = albedo * (0.10 + 1.05 * facing * facing);
        shown = travel;
    } else if (ballTravel < 1e8) {
        color = ballColor;
        shown = ballTravel;
    }

    if (shown > 0.0) {
        float fog = 1.0 - exp(-shown / viewDistance * 1.6);
        color = mix(color, fogColor, fog);
    }
    result.color = color;
    result.travel = shown;
    return result;
}

vec4 hyperbolicSpaceFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);

    WorldValues P;
    for (int i = 0; i < 8; ++i) { P.v[i] = u.v[i]; }

    float zoom = max(P.v[1].z, 0.2);
    vec3 local = normalize(vec3(uv * 0.95 / zoom, -1.0));
    vec4 direction = local.x * P.v[4] + local.y * P.v[5] + local.z * P.v[6];
    vec4 origin = P.v[7];

    HyperResult result = hyperTrace(origin, direction, P, int(u.budget.x));
    float vignette = 1.0 - 0.25 * dot(screen, screen);
    return vec4(wToneMap(result.color * 1.25 * vignette), 1.0);
}

// In immersive space the wearer's head position, measured from where they
// stood when the space opened, is laid onto the hyperboloid by walking that
// far in that direction from the frame's position.


uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(hyperbolicSpaceFragment(position, U).rgb, 1.0);
}
`;
