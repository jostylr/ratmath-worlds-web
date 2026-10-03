// Port of RatMathWorlds/Model/MandelbulbModel.swift.
import * as M from './math.js';
import * as Tour from './tour.js';

export class MandelbulbModel {
  parameters = M.defaultParameters();
  isInteracting = false;
  /** True while a tour step or focus move is animating the parameters. */
  isAnimating = false;
  /** Index into `Tour.steps` while the guided tour is showing. */
  tourIndex = null;
  /**
   * Raises the object on screen, in units of half the shorter view side, to
   * keep it clear of a caption along the bottom edge.
   */
  verticalShift = 0;
  /** The numerical explorer: one point whose orbit is computed and drawn. */
  explorerIsOpen = false;
  probe = [0, 0, 1];
  probeStaysOnSurface = true;
  cameraFollowsProbe = true;
  /** Set while the explorer was opened from a tour stop, so it can return. */
  tourStopToResume = null;

  #activeInteractions = new Set();
  #animation = null;
  #listeners = [];
  #orbit = null;

  onChange(listener) { this.#listeners.push(listener); }

  #changed() {
    this.#orbit = null;
    for (const listener of this.#listeners) { listener(); }
  }

  /** Every parameter edit goes through here so dependants stay in step. */
  update(mutate) {
    const old = M.cloneParameters(this.parameters);
    mutate(this.parameters);
    this.#keepProbeOnSurface(old);
    this.#changed();
  }

  // MARK: Direct manipulation

  setInteraction(interaction, active) {
    if (active) {
      // The person's hands win over any animation in progress.
      this.cancelAnimation();
      this.#activeInteractions.add(interaction);
    } else {
      this.#activeInteractions.delete(interaction);
    }
    const value = this.#activeInteractions.size > 0;
    if (this.isInteracting !== value) {
      this.isInteracting = value;
      this.#changed();
    }
  }

  rotate(horizontal, vertical) {
    this.update(p => {
      p.yaw += horizontal;
      p.pitch = M.clamp(p.pitch + vertical, -1.45, 1.45);
    });
  }

  zoom(factor) { this.setZoom(this.parameters.cameraDistance, factor); }

  setZoom(origin, magnification) {
    if (!Number.isFinite(origin) || !Number.isFinite(magnification) || magnification <= 0.001) { return; }
    const proposed = origin / M.clamp(magnification, 0.05, 20.0);
    if (!Number.isFinite(proposed)) { return; }
    this.update(p => { p.cameraDistance = M.clamp(proposed, ...M.CAMERA_DISTANCE_RANGE); });
  }

  /**
   * Makes the surface point under a view location the centre of the view and
   * moves the camera most of the way toward it.
   */
  focusAt(x, y, width, height) {
    const hit = M.surfacePointAt(x, y, width, height, this.verticalShift, this.parameters);
    if (!hit) { return; }
    const target = M.cloneParameters(this.parameters);
    target.focus = hit.point;
    target.cameraDistance = Math.max(hit.travel * 0.4, M.CAMERA_DISTANCE_RANGE[0]);
    // Keep enough iterations switched on for detail at the new scale.
    target.iterations = Math.max(
      target.iterations,
      Math.min(12 + 2.5 * Math.log2(Math.max(M.magnification(target), 1)), 24)
    );
    this.#animate([{ target, duration: 1.4, hold: 0 }]);
  }

  resetView() {
    this.cancelAnimation();
    this.#activeInteractions.clear();
    this.isInteracting = false;
    const defaults = M.defaultParameters();
    this.update(p => {
      p.yaw = defaults.yaw;
      p.pitch = defaults.pitch;
      p.cameraDistance = defaults.cameraDistance;
      p.focus = defaults.focus;
    });
  }

  resetShape() {
    this.cancelAnimation();
    const defaults = M.defaultParameters();
    this.update(p => {
      for (const key of ['power', 'iterations', 'juliaMix', 'juliaC', 'phaseTheta', 'phasePhi', 'sliceHeight']) {
        p[key] = defaults[key];
      }
    });
  }

  // MARK: Numerical explorer

  get orbit() {
    this.#orbit ??= M.orbit(this.probe, this.parameters);
    return this.#orbit;
  }

  openExplorer() {
    // Opened from the tour, the explorer remembers the stop to return to.
    const resume = this.tourIndex;
    this.endTour();
    this.tourStopToResume = resume;
    // Start on the surface point in the middle of the current view.
    const p = this.parameters;
    const axis = M.rotate([0, 0, 1], p.yaw, p.pitch);
    const hit = M.raycast(M.cameraPosition(p), M.scale(axis, -1), p);
    this.explorerIsOpen = true;
    if (hit) {
      this.probe = hit.point;
      if (this.cameraFollowsProbe) {
        // Orbit the point from where the camera already is, so the picture
        // does not jump when the point first moves.
        p.focus = hit.point;
        p.cameraDistance = Math.max(hit.travel, M.CAMERA_DISTANCE_RANGE[0]);
      }
    } else {
      this.probe = M.radialSurfacePoint(axis, p) ?? axis;
    }
    this.#changed();
  }

  closeExplorer() {
    this.explorerIsOpen = false;
    this.tourStopToResume = null;
    this.#changed();
  }

  returnToTour() {
    const stop = this.tourStopToResume;
    if (stop === null) { return; }
    this.closeExplorer();
    this.#showTourStep(stop);
  }

  /** Places the point exactly, then applies the surface constraint if on. */
  setProbe(point) {
    if (!point.every(Number.isFinite)) { return; }
    this.probe = point;
    if (this.probeStaysOnSurface) { this.snapProbeToSurface(); }
    this.#followProbe();
    this.#changed();
  }

  /** Puts the point on the surface under a location in the view. */
  pickProbe(x, y, width, height) {
    if (!this.explorerIsOpen) { return; }
    const hit = M.surfacePointAt(x, y, width, height, this.verticalShift, this.parameters);
    if (!hit) { return; }
    this.probe = hit.point;
    this.#changed();
  }

  /**
   * Moves the point in view directions: `right` and `up` across the screen,
   * `away` into it. On the surface the point slides around the object
   * instead, and `away` is ignored.
   */
  moveProbe(right, up, away = 0) {
    if (!this.explorerIsOpen) { return; }
    this.cancelAnimation();
    const p = this.parameters;
    const scale = M.clamp(p.cameraDistance / M.DEFAULT_CAMERA_DISTANCE, 0.003, 1);
    const rightAxis = M.rotate([1, 0, 0], p.yaw, p.pitch);
    const upAxis = M.rotate([0, 1, 0], p.yaw, p.pitch);
    const backAxis = M.rotate([0, 0, 1], p.yaw, p.pitch);

    if (this.probeStaysOnSurface) {
      const angle = 0.035 * scale;
      let direction = M.length(this.probe) < 1e-9 ? backAxis : this.probe;
      direction = M.rotateAbout(direction, upAxis, right * angle);
      direction = M.rotateAbout(direction, rightAxis, -up * angle);
      const point = M.radialSurfacePoint(direction, p);
      if (point) { this.probe = point; }
    } else {
      const step = 0.04 * scale;
      const move = M.add(
        M.add(M.scale(rightAxis, right), M.scale(upAxis, up)),
        M.scale(backAxis, -away)
      );
      this.probe = M.add(this.probe, M.scale(move, step));
    }
    this.#followProbe();
    this.#changed();
  }

  snapProbeToSurface() {
    const point = M.radialSurfacePoint(this.probe, this.parameters);
    if (point) { this.probe = point; }
  }

  setProbeStaysOnSurface(value) {
    this.probeStaysOnSurface = value;
    if (value) { this.snapProbeToSurface(); }
    this.#changed();
  }

  setCameraFollowsProbe(value) {
    this.cameraFollowsProbe = value;
    this.#changed();
  }

  /** Flies the camera to look straight at the point from outside. */
  lookAtProbe() {
    const target = M.cloneParameters(this.parameters);
    Object.assign(target, M.viewAngles(this.probe));
    target.focus = [...this.probe];
    this.#animate([{ target, duration: 1.2, hold: 0 }]);
  }

  #followProbe() {
    if (!this.cameraFollowsProbe) { return; }
    if (this.probeStaysOnSurface) {
      // Looking along the line through the origin keeps the camera outside
      // the object however far it is zoomed in.
      Object.assign(this.parameters, M.viewAngles(this.probe));
    }
    this.parameters.focus = [...this.probe];
  }

  #keepProbeOnSurface(old) {
    if (!this.explorerIsOpen || !this.probeStaysOnSurface) { return; }
    const p = this.parameters;
    const shapeChanged = old.power !== p.power
      || Math.round(old.iterations) !== Math.round(p.iterations)
      || old.juliaMix !== p.juliaMix
      || old.juliaC.some((value, i) => value !== p.juliaC[i])
      || old.phaseTheta !== p.phaseTheta
      || old.phasePhi !== p.phasePhi
      || old.sliceHeight !== p.sliceHeight;
    if (shapeChanged) { this.snapProbeToSurface(); }
  }

  // MARK: Guided tour

  get tourStep() { return this.tourIndex === null ? null : Tour.steps[this.tourIndex]; }

  startTour() {
    this.explorerIsOpen = false;
    this.tourStopToResume = null;
    this.#showTourStep(0);
  }

  advanceTour(offset) {
    if (this.tourIndex === null) { return; }
    const next = this.tourIndex + offset;
    if (next < 0 || next >= Tour.steps.length) {
      this.endTour();
      return;
    }
    this.#showTourStep(next);
  }

  replayTourStep() {
    if (this.tourIndex !== null) { this.#showTourStep(this.tourIndex); }
  }

  endTour() {
    this.cancelAnimation();
    this.tourIndex = null;
    this.#changed();
  }

  showTourStep(index) {
    if (index >= 0 && index < Tour.steps.length) { this.#showTourStep(index); }
  }

  #showTourStep(index) {
    this.tourIndex = index;
    this.#animate(Tour.keyframesFor(index, this.parameters));
  }

  // MARK: Animation

  cancelAnimation() {
    this.#animation = null;
    if (this.isAnimating) {
      this.isAnimating = false;
      this.#changed();
    }
  }

  #animate(keyframes) {
    this.#activeInteractions.clear();
    this.isInteracting = false;
    this.isAnimating = true;
    this.#animation = { keyframes, index: 0, start: null, began: null, holdUntil: null };
    this.#changed();
  }

  /** Advances any running animation. Call once per frame with a time in ms. */
  tick(now) {
    const animation = this.#animation;
    if (!animation) { return; }
    const keyframe = animation.keyframes[animation.index];

    if (animation.holdUntil !== null) {
      if (now < animation.holdUntil) { return; }
      animation.holdUntil = null;
      animation.index += 1;
      animation.start = null;
      if (animation.index >= animation.keyframes.length) {
        this.#animation = null;
        this.isAnimating = false;
        this.#changed();
      }
      return;
    }

    if (animation.start === null) {
      animation.start = M.cloneParameters(this.parameters);
      animation.began = now;
    }
    const elapsed = (now - animation.began) / 1000;
    const linear = keyframe.duration > 0 ? Math.min(elapsed / keyframe.duration, 1) : 1;
    const eased = linear * linear * (3 - 2 * linear);
    const old = this.parameters;
    this.parameters = M.interpolate(animation.start, keyframe.target, eased);
    this.#keepProbeOnSurface(old);
    if (linear >= 1) { animation.holdUntil = now + keyframe.hold * 1000; }
    this.#changed();
  }
}
