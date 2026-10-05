// The immersive (WebXR) renderer: the counterpart of
// MandelbulbImmersiveRenderer.swift and ImmersiveInteractionController.swift.
//
// NOT YET RUN ON A HEADSET. It follows the native renderer closely, but the
// resolution scale, step budgets and gesture gains below are first guesses
// that need tuning on a device.
import { clamp } from './math.js';

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; ++c) {
    for (let r = 0; r < 4; ++r) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

const invert = m => new DOMMatrix(Array.from(m)).inverse().toFloat32Array();

export class ImmersiveSession {
  #session = null;
  #space = null;
  #fractalCenter = null;
  /** inputSource -> last hand position, for each pinch being held. */
  #grabs = new Map();
  #frameTime = 14;
  #lastFrame = null;
  #stepBudget = 60;
  #starting = false;

  constructor(renderer, model, onStateChange) {
    this.renderer = renderer;
    this.model = model;
    this.onStateChange = onStateChange;
    renderer.canvas?.addEventListener('webglcontextlost', () => {
      this.#session?.end().catch(() => {});
    });
  }

  static async isSupported() {
    try {
      return !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      return false;
    }
  }

  get isOpen() { return this.#session !== null; }

  async toggle() {
    if (this.#starting) { return; }
    if (this.#session) {
      await this.#session.end();
      return;
    }
    if (!this.renderer.graphics.ready) { throw new Error('The picture is not ready.'); }
    this.#starting = true;
    let session = null;
    try {
      const gl = this.renderer.gl;
      session = await navigator.xr.requestSession('immersive-vr');
      let ended = false;
      session.addEventListener('end', () => {
        ended = true;
        if (this.#session === session) { this.#session = null; }
        this.#space = null;
        this.#grabs.clear();
        this.model.setInteraction('rotation', false);
        this.model.setInteraction('zoom', false);
        this.renderer.paused = false;
        this.renderer.invalidate();
        this.onStateChange();
      });
      await gl.makeXRCompatible();
      // The ray marcher cannot afford full headset resolution. A reduced
      // framebuffer stands in for the native app's adaptive render quality.
      const layer = new XRWebGLLayer(session, gl, { antialias: false, framebufferScaleFactor: 0.5 });
      if (layer.fixedFoveation !== undefined && layer.fixedFoveation !== null) { layer.fixedFoveation = 1; }
      session.updateRenderState({ baseLayer: layer, depthNear: 0.1, depthFar: 10 });
      this.#space = await session.requestReferenceSpace('local');
      if (ended) { return; }
      this.#fractalCenter = null;
      this.#lastFrame = null;
      this.#frameTime = 14;
      this.#stepBudget = 60;
      this.#session = session;
      this.renderer.paused = true;

      session.addEventListener('selectstart', event => this.#grabs.set(event.inputSource, null));
      session.addEventListener('selectend', event => this.#release(event.inputSource));
      session.addEventListener('inputsourceschange', event => {
        for (const source of event.removed) { this.#release(source); }
      });
      session.requestAnimationFrame((time, frame) => this.#draw(time, frame));
      this.onStateChange();
    } catch (error) {
      if (session) { try { await session.end(); } catch {} }
      this.#session = null;
      this.#space = null;
      this.#grabs.clear();
      this.model.setInteraction('rotation', false);
      this.model.setInteraction('zoom', false);
      this.renderer.paused = false;
      this.renderer.invalidate();
      throw error;
    } finally { this.#starting = false; }
  }

  #release(source) {
    this.#grabs.delete(source);
    this.model.setInteraction('rotation', this.#grabs.size === 1);
    this.model.setInteraction('zoom', this.#grabs.size >= 2);
  }

  /** One pinch rotates; two pinches moved apart or together resize. */
  #handleInput(frame) {
    const model = this.model;
    const moved = [];
    for (const [source, previous] of this.#grabs) {
      const space = source.gripSpace ?? source.targetRaySpace;
      const pose = space && frame.getPose(space, this.#space);
      if (!pose) { continue; }
      const p = pose.transform.position;
      const current = { x: p.x, y: p.y, z: p.z };
      moved.push({ previous, current });
      this.#grabs.set(source, current);
    }

    if (moved.length >= 2 && moved[0].previous && moved[1].previous) {
      const separation = key => Math.hypot(
        moved[0][key].x - moved[1][key].x,
        moved[0][key].y - moved[1][key].y,
        moved[0][key].z - moved[1][key].z
      );
      const before = separation('previous');
      if (before > 0.001) { model.zoom(clamp(separation('current') / before, 0.85, 1.15)); }
      model.setInteraction('rotation', false);
      model.setInteraction('zoom', true);
    } else if (moved.length === 1 && moved[0].previous) {
      const { previous, current } = moved[0];
      // About a quarter turn for every 40 cm of hand travel.
      model.rotate((current.x - previous.x) * 4, -(current.y - previous.y) * 4);
      model.setInteraction('zoom', false);
      model.setInteraction('rotation', true);
    }
  }

  #draw(time, frame) {
    const session = this.#session;
    if (!session) { return; }
    session.requestAnimationFrame((t, f) => this.#draw(t, f));
    this.model.tick(performance.now());

    const pose = frame.getViewerPose(this.#space);
    if (!pose) { return; }
    this.#handleInput(frame);

    // Shed ray steps when frames run long, as the native quality controller does.
    if (this.#lastFrame !== null) {
      this.#frameTime = this.#frameTime * 0.9 + (time - this.#lastFrame) * 0.1;
      if (this.#frameTime > 19) {
        this.#stepBudget = Math.max(40, this.#stepBudget - 1);
      } else if (this.#frameTime < 12.5) {
        this.#stepBudget = Math.min(68, this.#stepBudget + 1);
      }
    }
    this.#lastFrame = time;

    if (!this.#fractalCenter) {
      // 1.45 m ahead of where the wearer is looking when the session starts.
      const m = pose.transform.matrix;
      const back = Math.hypot(m[8], m[9], m[10]) || 1;
      this.#fractalCenter = [
        m[12] - m[8] / back * 1.45,
        m[13] - m[9] / back * 1.45,
        m[14] - m[10] / back * 1.45,
      ];
    }

    const { gl, immersive } = this.renderer;
    const layer = session.renderState.baseLayer;
    const p = this.model.parameters;
    const interacting = this.model.isInteracting;
    // The unit Mandelbulb is about two units across, so 0.24 gives a
    // sculpture roughly 50 cm wide. Zoom resizes it within a comfortable range.
    const physicalScale = 0.24 * (3.35 / clamp(p.cameraDistance, 2.6, 7.0));
    const iterations = Math.min(Math.max(Math.round(p.iterations), 2), interacting ? 7 : 10);
    const steps = interacting ? Math.min(this.#stepBudget, 44) : this.#stepBudget;

    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.depthMask(true);
    gl.useProgram(immersive.program);
    this.renderer.setShapeUniforms(immersive, iterations, steps, 0);
    gl.uniform4f(immersive.uniforms.uCenterAndScale, ...this.#fractalCenter, physicalScale);
    gl.uniform4f(immersive.uniforms.uRotationAndEpsilon, p.yaw, p.pitch, interacting ? 0.0015 : 0.0008, 0);
    gl.uniform1f(immersive.uniforms.uInteracting, interacting ? 1 : 0);

    for (const view of pose.views) {
      const viewport = layer.getViewport(view);
      if (!viewport || viewport.width === 0) { continue; }
      gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
      const viewProjection = multiply(view.projectionMatrix, view.transform.inverse.matrix);
      const position = view.transform.position;
      gl.uniform4f(immersive.uniforms.uViewport, viewport.x, viewport.y, viewport.width, viewport.height);
      gl.uniformMatrix4fv(immersive.uniforms.uViewProjection, false, viewProjection);
      gl.uniformMatrix4fv(immersive.uniforms.uInverseViewProjection, false, invert(viewProjection));
      gl.uniform4f(immersive.uniforms.uCameraPosition, position.x, position.y, position.z, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
}
