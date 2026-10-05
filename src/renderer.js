import { compileProgram, manageGraphics } from './graphics.js';
import { RenderQuality } from './site.js';
// The windowed renderer: the counterpart of MandelbulbMetalView.swift.
import { VERTEX, WINDOWED_FRAGMENT, IMMERSIVE_FRAGMENT, MAX_MARKERS } from './shaders.js';
import { CAMERA_DISTANCE_RANGE, DEFAULT_CAMERA_DISTANCE, add, clamp, length, normalize, scale, sub } from './math.js';

function compile(gl, fragmentSource) {
  const program = compileProgram(gl, VERTEX, fragmentSource);
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; ++i) {
    const name = gl.getActiveUniform(program, i).name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const finiteClamped = (value, lo, hi, fallback) => (Number.isFinite(value) ? clamp(value, lo, hi) : fallback);
const mix3 = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

/**
 * The explorer's point, its orbit and (for Julia sets) the constant c, as
 * pairs of (position, radius) and (colour, connect-to-next).
 */
function markersFor(orbit, parameters) {
  // Sized from the camera distance so markers look the same size on screen
  // at every zoom level.
  const radius = 0.013 * parameters.cameraDistance;
  const visibleLimit = 6.0;
  const result = [];
  const count = Math.min(orbit.steps.length, MAX_MARKERS - 1);

  for (let index = 0; index < count; ++index) {
    let position = orbit.steps[index].z;
    let isLast = index === count - 1;
    if (length(position) > visibleLimit && index > 0) {
      // An escaping orbit leaves the picture; draw its last rod heading out
      // of view rather than to a far-off point.
      const previous = orbit.steps[index - 1].z;
      position = add(previous, scale(normalize(sub(position, previous)), visibleLimit));
      isLast = true;
    }
    const t = count > 1 ? index / (count - 1) : 0;
    const color = index === 0 ? [1, 1, 1] : mix3([0.25, 0.9, 1.0], [1.0, 0.3, 0.65], t);
    result.push(...position, index === 0 ? radius * 1.7 : radius);
    result.push(...color, isLast ? 0 : 1);
    if (isLast) { break; }
  }

  if (parameters.juliaMix > 0.5) {
    if (result.length > 0) { result[result.length - 1] = 0; }
    result.push(...orbit.c, radius * 1.7);
    result.push(0.35, 1.0, 0.45, 0);
  }
  return result;
}

export class Renderer {
  /** Set by the immersive session while it owns the frame loop. */
  paused = false;

  #dirty = true;

  constructor(canvas, model) {
    this.canvas = canvas;
    this.model = model;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, xrCompatible: true });
    this.gl = gl;
    this.quality = new RenderQuality();
    this.graphics = manageGraphics(canvas, () => {
      if (!gl) { throw new Error('WebGL 2 is unavailable.'); }
      this.windowed = compile(gl, WINDOWED_FRAGMENT);
      this.immersive = compile(gl, IMMERSIVE_FRAGMENT);
      gl.bindVertexArray(gl.createVertexArray());
    }, () => this.invalidate());

    // Phones and tablets get the native iOS budgets; everything else the Mac's.
    this.constrained = matchMedia('(pointer: coarse)').matches;
    model.onChange(() => this.invalidate());
    new ResizeObserver(() => this.invalidate()).observe(canvas);
  }

  invalidate() { this.#dirty = true; }

  setShapeUniforms(target, iterations, steps, shadowSteps) {
    const gl = this.gl;
    const p = this.model.parameters;
    gl.uniform4f(target.uniforms.uShape, finiteClamped(p.power, 2, 12, 8), iterations, steps, shadowSteps);
    gl.uniform4f(target.uniforms.uJulia, ...p.juliaC.map(v => finite(v)), finiteClamped(p.juliaMix, 0, 1, 0));
    gl.uniform4f(target.uniforms.uExtras, finite(p.phaseTheta), finite(p.phasePhi), finite(p.sliceHeight), p.palette);
  }

  /** Draws a frame if anything changed. Call once per animation frame. */
  frame(now) {
    if (this.paused || !this.graphics.ready || document.hidden) { return; }
    const model = this.model;
    const moving = model.isInteracting || model.isAnimating;
    if (!this.#dirty) {
      return;
    }
    this.#dirty = false;

    const gl = this.gl;
    const canvas = this.canvas;
    const cssWidth = canvas.clientWidth, cssHeight = canvas.clientHeight;
    if (!(cssWidth > 0 && cssHeight > 0)) { return; }
    const ratio = this.quality.ratio(canvas, moving, now);
    const width = Math.max(1, Math.floor(cssWidth * ratio));
    const height = Math.max(1, Math.floor(cssHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const p = model.parameters;
    const iterations = Math.round(finiteClamped(p.iterations, 2, 24, 12));
    // Quality 0 skips normals, 1 adds them, 2 adds occlusion and shadows.
    const stepBudget = this.constrained ? (moving ? 120 : 190) : 240;
    const shadowBudget = moving || this.quality.mode === 'economy' ? 0 : (this.constrained ? 24 : 40);
    const pixelCone = moving ? 0.0006 : 0.0003;
    const quality = moving || this.quality.mode === 'economy' ? 1 : 2;

    const target = this.windowed;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(target.program);
    gl.uniform4f(target.uniforms.uResolutionAndCone, width, height, pixelCone, model.verticalShift);
    gl.uniform4f(
      target.uniforms.uCamera,
      finiteClamped(p.yaw, -10000, 10000, -0.35),
      finiteClamped(p.pitch, -1.45, 1.45, 0.15),
      finiteClamped(p.cameraDistance, ...CAMERA_DISTANCE_RANGE, DEFAULT_CAMERA_DISTANCE),
      quality
    );
    gl.uniform4f(target.uniforms.uFocus, ...p.focus.map(v => finite(v)), 0);
    this.setShapeUniforms(target, iterations, stepBudget, shadowBudget);

    const markers = model.explorerIsOpen ? markersFor(model.orbit, p) : [];
    gl.uniform1i(target.uniforms.uMarkerCount, markers.length / 8);
    if (markers.length > 0) { gl.uniform4fv(target.uniforms.uMarkers, new Float32Array(markers)); }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
