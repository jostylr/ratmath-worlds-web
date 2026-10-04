#!/usr/bin/env python3
"""Writes the web version's GLSL from the app's Metal shaders.

The Library of Babel and the art gallery are drawn by the same shader code in
the app and on the web. The Metal files are the source; this script turns
them into src/babel/shader.js and src/gallery/shader.js. Run it from anywhere
after changing Babel.metal, Gallery.metal or the BabelRoom headers:

    python3 web/make-shaders.py
"""
import re
from pathlib import Path

WEB = Path(__file__).resolve().parent
SHADERS = WEB.parent / "RatMathWorlds" / "Worlds" / "Shaders"

PRELUDE = """#version 300 es
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

"""

MAIN_OPEN = """void main() {
    // The shorter side of the view spans -1...1, y up.
    vec2 screen = gl_FragCoord.xy / uResolution * 2.0 - 1.0;
    float aspect = uResolution.x / uResolution.y;
    vec2 uv = vec2(screen.x * aspect, screen.y) / min(aspect, 1.0);

"""


def replace_calls(text, name, rewrite):
    """Rewrites name(...) with balanced parentheses."""
    out, i = "", 0
    while True:
        j = text.find(name + "(", i)
        if j < 0:
            return out + text[i:]
        k, depth = j + len(name) + 1, 1
        while depth > 0:
            depth += {"(": 1, ")": -1}.get(text[k], 0)
            k += 1
        out += text[i:j] + rewrite(text[j + len(name) + 1:k - 1])
        i = k


def glsl(text):
    text = re.sub(r"\bstatic inline\b ?", "", text)
    text = re.sub(r"\bstatic\b ?", "", text)
    for metal, name in [("float2", "vec2"), ("float3", "vec3"), ("float4", "vec4"),
                        ("int3", "ivec3"), ("int2", "ivec2")]:
        text = re.sub(rf"\b{metal}\b", name, text)
    text = re.sub(r"\bfmod\(", "mod(", text)
    text = re.sub(r"\batan2\(", "atan(", text)
    # GLSL does not turn an int literal into a uint by itself.
    text = re.sub(r"bUnit\(([^,()]+(?:\([^()]*\))?[^,()]*), (\d+)\)", r"bUnit(\1, \2u)", text)
    while "saturate(" in text:
        text = replace_calls(text, "saturate", lambda inner: f"clamp({inner}, 0.0, 1.0)")
    text = text.replace("!isfinite(value)", "(isnan(value) || isinf(value))")
    # Array constants are written differently.
    text = re.sub(r"const uint (\w+)\[(\d+)\] = \{([^}]*)\};",
                  lambda m: f"const uint {m.group(1)}[{m.group(2)}] = uint[{m.group(2)}]({m.group(3).strip()});",
                  text, flags=re.S)
    # Words GLSL keeps for itself.
    text = re.sub(r"\bpacked\b", "triple", text)
    text = re.sub(r"\bD\.uniform\b", "D.plain", text)
    return text


def section(text, start, end=None):
    a = text.index(start)
    return text[a:text.index(end, a)] if end else text[a:]


def strip_guard(text):
    text = section(text, "#define B_PI")
    return text[:text.rindex("#endif")]


def build(metal_name, wall):
    parts = strip_guard((SHADERS / "BabelRoomParts.h").read_text())
    world = (SHADERS / metal_name).read_text()
    # The world's own functions: after its header comment, before the hook-up.
    own = world[world.index("\n\n", world.index("// v[0]")):world.index("#define BABEL_FRAGMENT")]
    fragment = (SHADERS / "BabelRoomFragment.h").read_text()
    lit = section(fragment, "static float3 bLit(", "// MARK: The picture")
    body = section(fragment, "    WorldValues P;", "    // What is far away")
    body = body.replace("P.v[i] = u.v[i]", "P.v[i] = uV[i]")
    body = re.sub(r"u\.v\[(\d)\]", r"uV[\1]", body)
    body = body.replace("u.camera.x", "uCamera.x").replace("u.camera.y", "uCamera.y")
    body = body.replace("BABEL_WALL(", wall + "(")
    source = glsl(parts + own + lit) + MAIN_OPEN + glsl(body) + """    // What is far away is lost in the dark of the shaft.
    color += vec3(0.010, 0.009, 0.014);
    float vignette = 1.0 - 0.22 * dot(screen, screen);
    fragColor = vec4(wToneMap(color * vignette), 1.0);
}"""
    assert "`" not in source and "${" not in source, "the shader would break out of its JavaScript string"
    return PRELUDE + source


VERTEX = """#version 300 es
void main() {
  vec2 corner = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(corner, 0.0, 1.0);
}"""

for folder, metal_name, wall in [("babel", "Babel.metal", "bShelves"), ("gallery", "Gallery.metal", "gPictures")]:
    target = WEB / "src" / folder / "shader.js"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        f"// {metal_name} in GLSL, written by web/make-shaders.py from the app's Metal\n"
        "// shaders. Do not edit: change the Metal files and run the script again.\n\n"
        f"export const VERTEX = `{VERTEX}`;\n\n"
        f"export const FRAGMENT = `{build(metal_name, wall)}`;\n"
    )
    print("wrote", target.relative_to(WEB.parent))
