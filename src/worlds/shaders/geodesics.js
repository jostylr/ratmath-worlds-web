// Geodesic.metal in GLSL, written by make-shaders.py from the app's
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


// Straight lines on curved surfaces: a sphere, a torus and a saddle, with
// geodesics painted on them. The geodesics are worked out in
// GeodesicWorld.swift and handed over as a table of points (buffer 3):
// (x, y, z, path), where path says which curve a point belongs to.
//
// v[0]: surface (0 sphere, 1 torus, 2 saddle), points in the table,
//       grid shown, curvature colouring
// v[1]: the triangle's angle marks: unused here, kept for the explorer

#define GEO_R 1.0     // the torus's large radius, and the sphere's radius
#define GEO_TUBE 0.42 // the torus's tube
#define GEO_HALF 1.3  // half the side of the saddle's square patch

float geoSurface(vec3 p, int kind) {
    if (kind == 0) { return length(p) - GEO_R; }
    if (kind == 1) {
        vec2 q = vec2(length(p.xz) - GEO_R, p.y);
        return length(q) - GEO_TUBE;
    }
    // The saddle y = (x² − z²) ⁄ 2, a thin sheet over a square.
    float f = (p.y - 0.5 * (p.x * p.x - p.z * p.z)) / sqrt(1.0 + p.x * p.x + p.z * p.z);
    float sheet = abs(f) - 0.006;
    vec2 edge = abs(p.xz) - vec2(GEO_HALF);
    float box = length(max(edge, 0.0)) + min(max(edge.x, edge.y), 0.0);
    return max(sheet, box);
}

vec3 geoNormal(vec3 p, int kind) {
    vec2 h = vec2(0.0007, -0.0007);
    return normalize(h.xyy * geoSurface(p + h.xyy, kind) + h.yyx * geoSurface(p + h.yyx, kind)
                   + h.yxy * geoSurface(p + h.yxy, kind) + h.xxx * geoSurface(p + h.xxx, kind));
}

// Gaussian curvature, and two coordinates on the surface for its grid.
float geoCurvature(vec3 p, int kind) {
    if (kind == 0) { return 1.0 / (GEO_R * GEO_R); }
    if (kind == 1) {
        float q = length(p.xz);
        float cosV = (q - GEO_R) / GEO_TUBE;
        return cosV / (GEO_TUBE * (GEO_R + GEO_TUBE * cosV));
    }
    float w = 1.0 + p.x * p.x + p.z * p.z;
    return -1.0 / (w * w);
}

vec2 geoGrid(vec3 p, int kind) {
    if (kind == 0) {
        return vec2(atan2(p.z, p.x) / 6.2831853 * 24.0, asin(clamp(p.y, -1.0, 1.0)) / 3.14159265 * 12.0);
    }
    if (kind == 1) {
        float q = length(p.xz);
        return vec2(atan2(p.z, p.x) / 6.2831853 * 24.0, atan2(p.y, q - GEO_R) / 6.2831853 * 12.0);
    }
    return p.xz * 5.0;
}

vec3 geoPathColor(float id) {
    if (id < 0.5) { return vec3(1.0, 0.78, 0.15); }
    if (id < 1.5) { return vec3(1.0, 0.25, 0.45); }
    return vec3(0.25, 0.85, 1.0);
}

vec4 geodesicFragment(vec4 inPosition, WorldUniforms u) {

    vec2 screen;
    vec2 uv = wViewCoordinates(inPosition, u.resolutionAndCone, screen);
    int kind = int(u.v[0].x + 0.5);
    int count = int(u.v[0].y + 0.5);

    vec3 ro = wRotateY(wRotateX(vec3(0.0, 0.0, u.camera.z), u.camera.y), u.camera.x) + u.focus.xyz;
    vec3 rd = wRotateY(wRotateX(normalize(vec3(uv * 0.72, -1.65)), u.camera.y), u.camera.x);
    vec3 light = wRotateY(wRotateX(normalize(vec3(-0.55, 0.70, 0.55)), u.camera.y), u.camera.x);

    vec3 color = wBackground(rd);
    float travel = 0.0;
    bool hit = false;
    for (int i = 0; i < 200; ++i) {
        float d = geoSurface(ro + rd * travel, kind);
        if (d < 0.0004 * (1.0 + travel)) { hit = true; break; }
        // The saddle's distance is only an estimate: step a little short.
        travel += kind == 2 ? d * 0.6 : d * 0.95;
        if (travel > 20.0) { break; }
    }
    if (hit) {
        vec3 p = ro + rd * travel;
        vec3 n = geoNormal(p, kind);
        if (dot(n, rd) > 0.0) { n = -n; }   // the saddle is seen from both sides

        float k = geoCurvature(p, kind);
        vec3 albedo = vec3(0.78, 0.76, 0.72);
        if (u.v[0].w > 0.5) {
            // Warm where the surface curves like a ball, cool where like a saddle.
            float t = clamp(k * 0.9, -1.0, 1.0);
            albedo = t > 0.0 ? mix(vec3(0.80, 0.78, 0.74), vec3(0.92, 0.48, 0.25), t)
                             : mix(vec3(0.80, 0.78, 0.74), vec3(0.22, 0.48, 0.90), -t);
        }
        float pixel = 2.0 / min(u.resolutionAndCone.x, u.resolutionAndCone.y) * travel * 0.44;
        if (u.v[0].z > 0.5) {
            vec2 g = geoGrid(p, kind);
            vec2 to = abs(fract(g + 0.5) - 0.5) / max(fwidth(g), vec2(1e-4));
            float line = 1.0 - saturate(min(to.x, to.y) - 0.5);
            albedo *= 1.0 - 0.28 * line;
        }
        // The geodesics, painted on the surface.
        float best = 1e9;
        float which = 0.0;
        for (int i = 0; i + 1 < count && i < 1200; ++i) {
            int next = i + 1;
            vec4 a = wData(i);
            vec4 b = wData(next);
            if (abs(a.w - b.w) > 0.1) { continue; }
            vec3 ab = b.xyz - a.xyz;
            float h = saturate(dot(p - a.xyz, ab) / max(dot(ab, ab), 1e-12));
            float d = length(p - a.xyz - ab * h);
            if (d < best) { best = d; which = a.w; }
        }
        float width = max(0.011, 1.4 * pixel);
        float stroke = 1.0 - smoothstep(width - pixel, width + pixel, best);
        // A start point is a larger dot.
        float previous = -1.0;
        for (int i = 0; i < count && i < 1200; ++i) {
            vec4 here = wData(i);
            if (abs(here.w - previous) > 0.1) {
                float d = length(p - here.xyz);
                stroke = max(stroke, 1.0 - smoothstep(0.032 - pixel, 0.032 + pixel, d));
                if (d < 0.04) { which = here.w; }
            }
            previous = here.w;
        }
        albedo = mix(albedo, geoPathColor(which), stroke);

        float occlusion = 1.0;
        for (int j = 1; j <= 3; ++j) {
            float away = 0.06 * float(j);
            occlusion -= max(away - geoSurface(p + n * away, kind), 0.0) * (1.2 / float(j));
        }
        color = wShade(albedo, n, rd, light, 1.0, saturate(occlusion));
        color = mix(color, albedo * 1.1, stroke * 0.5);
    }
    float vignette = 1.0 - 0.25 * dot(screen, screen);
    return vec4(wToneMap(color * vignette), 1.0);
}

uniform WorldUniforms U;
out vec4 fragColor;

void main() {
    // Metal counts rows from the top.
    vec4 position = vec4(gl_FragCoord.x, U.resolutionAndCone.y - gl_FragCoord.y, 0.0, 1.0);
    fragColor = vec4(geodesicFragment(position, U).rgb, 1.0);
}
`;
