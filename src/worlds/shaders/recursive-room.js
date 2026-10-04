// RecursiveRoom.metal in GLSL, written by web/make-shaders.py from the app's
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


// A room whose back wall carries a doorway onto a smaller copy of the room.
// The copy is the room under the similarity S(x) = k·R(θ)·x + t, which
// carries the room's open front onto the doorway. Only one room is defined;
// a ray that passes through the doorway is mapped by S⁻¹ and carries on in
// the same room, and a ray that leaves by the open front is mapped by S.
//
// v[0]: k, θ, doorway centre x, doorway centre y
// v[1]: depth (fraction of one copy the camera has moved inward),
//       copies drawn, tint levels flag

#define ROOM_HALF vec3(1.5, 1.0, 2.0)

struct RoomMap {
    float k;
    vec2 turn;   // cos θ, sin θ
    vec2 centre;
};

vec2 roomRotate(vec2 p, vec2 turn) {
    return vec2(turn.x * p.x - turn.y * p.y, turn.y * p.x + turn.x * p.y);
}

vec3 roomToChild(vec3 p, RoomMap m) {
    vec2 xy = roomRotate(p.xy - m.centre, vec2(m.turn.x, -m.turn.y)) / m.k;
    return vec3(xy, (p.z + ROOM_HALF.z * (1.0 + m.k)) / m.k);
}

vec3 roomToParent(vec3 p, RoomMap m) {
    return vec3(m.k * roomRotate(p.xy, m.turn) + m.centre,
                  m.k * p.z - ROOM_HALF.z * (1.0 + m.k));
}

vec3 roomDirectionToChild(vec3 d, RoomMap m) {
    return vec3(roomRotate(d.xy, vec2(m.turn.x, -m.turn.y)), d.z);
}

vec3 roomDirectionToParent(vec3 d, RoomMap m) {
    return vec3(roomRotate(d.xy, m.turn), d.z);
}

// The furniture: a ball, a block, and a lamp.
#define ROOM_BALL vec4(-0.70, -0.58, -0.60, 0.42)
#define ROOM_BLOCK_CENTRE vec3(0.78, -0.68, 0.35)
#define ROOM_BLOCK_HALF vec3(0.32, 0.32, 0.32)
#define ROOM_LAMP vec4(0.0, 0.80, 0.10, 0.07)

float roomBoxHit(vec3 ro, vec3 rd, vec3 centre, vec3 halfSize, inout vec3 normal) {
    vec3 inverseOf = 1.0 / rd;
    vec3 n = inverseOf * (ro - centre);
    vec3 k = abs(inverseOf) * halfSize;
    vec3 t1 = -n - k;
    vec3 t2 = -n + k;
    float tNear = max(max(t1.x, t1.y), t1.z);
    float tFar = min(min(t2.x, t2.y), t2.z);
    if (tNear > tFar || tFar < 0.0 || tNear < 0.0) { return -1.0; }
    normal = -sign(rd) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
    return tNear;
}

bool roomShadowed(vec3 p, vec3 toLight, float lightDistance) {
    float t = wSphereHit(p, toLight, ROOM_BALL.xyz, ROOM_BALL.w);
    if (t > 0.002 && t < lightDistance) { return true; }
    vec3 n;
    t = roomBoxHit(p, toLight, ROOM_BLOCK_CENTRE, ROOM_BLOCK_HALF, n);
    return t > 0.002 && t < lightDistance;
}

vec3 roomLit(vec3 albedo, vec3 p, vec3 normal, vec3 rd) {
    vec3 toLight = ROOM_LAMP.xyz - p;
    float lightDistance = length(toLight);
    toLight /= lightDistance;
    float diffuse = saturate(dot(normal, toLight));
    if (diffuse > 0.0 && roomShadowed(p + normal * 0.003, toLight, lightDistance)) {
        diffuse *= 0.25;
    }
    float falloff = 2.6 / (1.0 + 0.45 * lightDistance * lightDistance);
    vec3 halfVector = normalize(toLight - rd);
    float specular = pow(saturate(dot(normal, halfVector)), 40.0) * 0.18;
    return albedo * (0.16 + diffuse * falloff) + specular * falloff;
}

vec3 roomLevelTint(int level) {
    return wCosinePalette(float(level) * 0.17 + 0.08, vec3(0.62), vec3(0.38),
                          vec3(1.0), vec3(0.0, 0.33, 0.67));
}

vec4 recursiveRoomFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);

    RoomMap m;
    m.k = clamp(u.v[0].x, 0.05, 0.9);
    m.turn = vec2(cos(u.v[0].y), sin(u.v[0].y));
    m.centre = u.v[0].zw;
    float depth = u.v[1].x;
    int copies = int(u.v[1].y + 0.5);
    bool tintLevels = u.v[1].z > 0.5;
    int palette = int(u.budget.z);

    float yaw = u.camera.x;
    float pitch = u.camera.y;
    vec3 ro = wRotateY(wRotateX(vec3(0.0, 0.0, u.camera.z), pitch), yaw) + u.focus.xyz;
    vec3 rd = wRotateY(wRotateX(normalize(vec3(uv * 0.72, -1.65)), pitch), yaw);

    // Moving depth copies inward is S^depth: shrink by k^depth and turn by
    // depth·θ about the fixed point, the one point every copy contains.
    float theta = u.v[0].y;
    vec2 denominator = vec2(1.0 - m.k * m.turn.x, -m.k * m.turn.y);
    vec2 fixedXY = vec2(m.centre.x * denominator.x + m.centre.y * denominator.y,
                            m.centre.y * denominator.x - m.centre.x * denominator.y)
        / dot(denominator, denominator);
    vec3 fixedPoint = vec3(fixedXY, -ROOM_HALF.z * (1.0 + m.k) / (1.0 - m.k));
    float shrink = pow(m.k, depth);
    vec2 depthTurn = vec2(cos(depth * theta), sin(depth * theta));
    ro = fixedPoint + shrink * vec3(roomRotate(ro.xy - fixedPoint.xy, depthTurn),
                                      ro.z - fixedPoint.z);
    rd = vec3(roomRotate(rd.xy, depthTurn), rd.z);

    vec3 markerOrigin = ro;
    vec3 markerDirection = rd;

    vec3 color = vec3(0.0);
    float travel = 0.0;      // in the units of the room the camera started in
    float unit = 1.0;        // length of one local unit, in those units
    float surfaceTravel = 1e20;
    int level = 0;           // copies inward from the room the camera is in
    bool placed = false;     // whether the camera's own room has been found
    bool done = false;

    for (int iteration = 0; iteration < 28 && !done; ++iteration) {
        vec3 outside = abs(ro) - ROOM_HALF;
        if (max(outside.x, max(outside.y, outside.z)) > 1e-4) {
            // Not in this room. In front of its open side is the parent
            // room; behind its back wall is the child, if anywhere.
            if (ro.z > ROOM_HALF.z) {
                ro = roomToParent(ro, m);
                rd = roomDirectionToParent(rd, m);
                unit /= m.k;
                level -= 1;
            } else if (ro.z < -ROOM_HALF.z) {
                ro = roomToChild(ro, m);
                rd = roomDirectionToChild(rd, m);
                unit *= m.k;
                level += 1;
            } else {
                color = vec3(0.004, 0.004, 0.006); // inside a wall
                done = true;
            }
            if (level > 14 || level < -14) { done = true; }
            continue;
        }
        if (!placed) {
            placed = true;
            level = 0;
        }

        // Where the ray leaves the room.
        vec3 inverseOf = 1.0 / rd;
        vec3 exits = (sign(rd) * ROOM_HALF - ro) * inverseOf;
        float tExit = min(exits.x, min(exits.y, exits.z));
        vec3 wallNormal = exits.x <= tExit ? vec3(-sign(rd.x), 0.0, 0.0)
            : (exits.y <= tExit ? vec3(0.0, -sign(rd.y), 0.0) : vec3(0.0, 0.0, -sign(rd.z)));

        // The furniture.
        float tBest = tExit;
        vec3 normal = wallNormal;
        int object = 0; // 0 wall, 1 ball, 2 block, 3 lamp
        float t = wSphereHit(ro, rd, ROOM_BALL.xyz, ROOM_BALL.w);
        if (t > 1e-4 && t < tBest) {
            tBest = t; object = 1;
            normal = normalize(ro + rd * t - ROOM_BALL.xyz);
        }
        vec3 blockNormal;
        t = roomBoxHit(ro, rd, ROOM_BLOCK_CENTRE, ROOM_BLOCK_HALF, blockNormal);
        if (t > 1e-4 && t < tBest) {
            tBest = t; object = 2; normal = blockNormal;
        }
        t = wSphereHit(ro, rd, ROOM_LAMP.xyz, ROOM_LAMP.w);
        if (t > 1e-4 && t < tBest) {
            tBest = t; object = 3;
        }

        vec3 p = ro + rd * tBest;
        vec3 albedo = vec3(0.0);
        bool shade = true;

        if (object == 0) {
            if (wallNormal.z < -0.5) {
                // Left through the open front, into the parent room.
                travel += tBest * unit;
                ro = roomToParent(p + rd * 1e-4, m);
                rd = roomDirectionToParent(rd, m);
                unit /= m.k;
                level -= 1;
                if (level < -6) { color = vec3(0.02); done = true; }
                continue;
            }
            if (wallNormal.z > 0.5) {
                // The back wall. Inside the doorway the ray goes on into the child.
                vec2 q = roomRotate(p.xy - m.centre, vec2(m.turn.x, -m.turn.y)) / m.k;
                vec2 over = abs(q) - ROOM_HALF.xy;
                float border = 0.10;
                if (max(over.x, over.y) < 0.0) {
                    if (level + 1 < copies && level < 13) {
                        travel += tBest * unit;
                        ro = roomToChild(p + rd * 1e-4 * m.k, m);
                        rd = roomDirectionToChild(rd, m);
                        unit *= m.k;
                        level += 1;
                        continue;
                    }
                    // No more copies to draw: an empty canvas.
                    albedo = vec3(0.10, 0.11, 0.13);
                } else if (max(over.x, over.y) < border) {
                    albedo = vec3(0.80, 0.56, 0.16); // the frame
                } else {
                    albedo = palette == 1 ? vec3(0.70, 0.74, 0.80) : vec3(0.74, 0.68, 0.58);
                }
            } else if (wallNormal.y > 0.5) {
                // Floor: a chequerboard, one square per half unit.
                vec2 cell = floor(p.xz * 2.0);
                bool dark = fmod(abs(cell.x + cell.y), 2.0) > 0.5;
                albedo = palette == 1
                    ? (dark ? vec3(0.16, 0.20, 0.30) : vec3(0.62, 0.68, 0.78))
                    : (dark ? vec3(0.34, 0.20, 0.12) : vec3(0.78, 0.66, 0.48));
            } else if (wallNormal.y < -0.5) {
                albedo = vec3(0.80, 0.80, 0.78);
            } else {
                albedo = wallNormal.x > 0.0
                    ? (palette == 1 ? vec3(0.30, 0.48, 0.70) : vec3(0.62, 0.30, 0.24))
                    : (palette == 1 ? vec3(0.36, 0.62, 0.60) : vec3(0.28, 0.46, 0.40));
            }
        } else if (object == 1) {
            albedo = vec3(0.86, 0.22, 0.16);
        } else if (object == 2) {
            albedo = vec3(0.22, 0.38, 0.82);
        } else {
            color = vec3(2.4, 2.1, 1.6);
            shade = false;
        }

        if (shade) {
            color = roomLit(albedo, p, normal, rd);
        }
        if (tintLevels) {
            color *= mix(vec3(1.0), roomLevelTint(level), 0.55);
        }
        travel += tBest * unit;
        surfaceTravel = travel;
        done = true;
    }

    vec3 lightDirection = normalize(vec3(-0.4, 0.8, 0.5));
    color = wDrawMarkers(color, markerOrigin, markerDirection, lightDirection,
                         surfaceTravel, int(u.budget.w));
    float vignette = 1.0 - 0.25 * dot(screen, screen);
    return vec4(wToneMap(color * vignette), 1.0);
}

uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(recursiveRoomFragment(position, U).rgb, 1.0);
}
`;
