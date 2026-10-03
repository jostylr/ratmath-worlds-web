// Port of RatMathWorlds/Model/MandelbulbParameters.swift: the parameter set
// and the CPU mirror of `bulbField` in the shader. Vectors are [x, y, z].

export const CAMERA_DISTANCE_RANGE = [0.02, 7.0];
export const DEFAULT_CAMERA_DISTANCE = 3.35;
/** Slice heights at or above this value leave the whole object visible. */
export const SLICE_DISABLED = 2.5;
export const ESCAPE_RADIUS = 4.0;

export function defaultParameters() {
  return {
    // Shape
    power: 8,
    iterations: 12,
    // 0 is the Mandelbulb (c is the point being tested); 1 is a Julia set
    // (c is `juliaC` for every point).
    juliaMix: 0,
    juliaC: [0.30, -0.55, 0.45],
    phaseTheta: 0,
    phasePhi: 0,
    sliceHeight: SLICE_DISABLED,
    // Look
    palette: 0,
    // Camera: orbits `focus` at `cameraDistance`.
    yaw: -0.55,
    pitch: 0.45,
    cameraDistance: DEFAULT_CAMERA_DISTANCE,
    focus: [0, 0, 0],
  };
}

export function cloneParameters(p) {
  return { ...p, juliaC: [...p.juliaC], focus: [...p.focus] };
}

export const magnification = p => DEFAULT_CAMERA_DISTANCE / p.cameraDistance;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = a => Math.hypot(a[0], a[1], a[2]);
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function normalize(a) {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
}
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

/**
 * Blend used by animations. Distance moves logarithmically so zooming feels
 * even, and the camera backs away while the focus point travels so it does
 * not cut through the object.
 */
export function interpolate(a, b, t) {
  const out = cloneParameters(b);
  out.power = lerp(a.power, b.power, t);
  out.iterations = lerp(a.iterations, b.iterations, t);
  out.juliaMix = lerp(a.juliaMix, b.juliaMix, t);
  out.juliaC = lerp3(a.juliaC, b.juliaC, t);
  out.phaseTheta = lerp(a.phaseTheta, b.phaseTheta, t);
  out.phasePhi = lerp(a.phasePhi, b.phasePhi, t);
  out.sliceHeight = lerp(a.sliceHeight, b.sliceHeight, t);
  out.yaw = lerp(a.yaw, b.yaw, t);
  out.pitch = lerp(a.pitch, b.pitch, t);
  out.focus = lerp3(a.focus, b.focus, t);

  const logDistance = lerp(Math.log(a.cameraDistance), Math.log(b.cameraDistance), t);
  const focusTravel = length(sub(b.focus, a.focus));
  const turn = Math.abs(b.yaw - a.yaw) + Math.abs(b.pitch - a.pitch);
  const closest = Math.min(a.cameraDistance, b.cameraDistance);
  const clearance = (1.8 * focusTravel + Math.max(0, 1.2 - closest) * Math.min(turn, 1.0))
    * Math.sin(Math.PI * t);
  out.cameraDistance = Math.min(Math.exp(logDistance) + clearance, CAMERA_DISTANCE_RANGE[1]);
  return out;
}

const spherical = (r, theta, phi) => [
  r * Math.sin(theta) * Math.cos(phi),
  r * Math.sin(theta) * Math.sin(phi),
  r * Math.cos(theta),
];

/** CPU mirror of `bulbField`'s distance estimate. */
export function distance(point, p) {
  let z = point;
  const c = lerp3(point, p.juliaC, p.juliaMix);
  let derivative = 1.0;
  let radius = 0.0;
  const iterations = Math.max(Math.round(p.iterations), 1);

  for (let i = 0; i < iterations; ++i) {
    radius = length(z);
    if (radius > 4) { break; }
    const safeRadius = Math.max(radius, 1e-9);
    const theta = Math.acos(clamp(z[2] / safeRadius, -1, 1));
    const phi = Math.atan2(z[1], z[0]);
    const radialPower = Math.pow(safeRadius, p.power - 1);
    derivative = radialPower * p.power * derivative + (1 - p.juliaMix);
    z = add(
      spherical(radialPower * safeRadius, theta * p.power + p.phaseTheta, phi * p.power + p.phasePhi),
      c
    );
  }

  const estimate = 0.5 * Math.log(Math.max(radius, 1e-9)) * radius / Math.max(derivative, 1e-9);
  return Math.max(estimate, point[1] - p.sliceHeight);
}

export function rotate(v, yaw, pitch) {
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  const x = [v[0], cp * v[1] - sp * v[2], sp * v[1] + cp * v[2]];
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  return [cy * x[0] + sy * x[2], x[1], -sy * x[0] + cy * x[2]];
}

export function cameraPosition(p) {
  return add(p.focus, rotate([0, 0, p.cameraDistance], p.yaw, p.pitch));
}

/** Marches one ray and returns where it meets the surface, if it does. */
export function raycast(origin, direction, p) {
  let travel = 0.0;
  for (let i = 0; i < 600; ++i) {
    const point = add(origin, scale(direction, travel));
    const d = distance(point, p);
    if (!Number.isFinite(d)) { return null; }
    const threshold = Math.max(2e-4 * travel, 1e-7);
    if (d < threshold) { return { point, travel }; }
    travel += Math.max(d * 0.72, threshold * 0.35);
    if (travel > 12) { return null; }
  }
  return null;
}

/**
 * The first surface point seen when looking at the origin from far away along
 * the given viewing direction. A camera placed anywhere on that line of sight
 * is guaranteed to be outside the object.
 */
export function surfacePointFromAngles(yaw, pitch, p) {
  const axis = rotate([0, 0, 1], yaw, pitch);
  return raycast(scale(axis, 5), scale(axis, -1), p)?.point ?? null;
}

/**
 * The surface point under a location in the view, using the same camera model
 * as the fragment shader. `x`, `y` are in CSS pixels from the top-left.
 */
export function surfacePointAt(x, y, width, height, verticalShift, p) {
  if (!(width > 0 && height > 0)) { return null; }
  const aspect = width / height;
  const fit = Math.min(aspect, 1);
  const u = (x / width * 2 - 1) * aspect / fit;
  const v = -(y / height * 2 - 1) / fit - verticalShift;
  const local = normalize([u * 0.72, v * 0.72, -1.65]);
  return raycast(cameraPosition(p), rotate(local, p.yaw, p.pitch), p);
}

/**
 * The surface point on the line from far outside toward the origin that
 * passes through `point`: the nearest outer surface "above" it.
 */
export function radialSurfacePoint(point, p) {
  const l = length(point);
  const direction = l > 1e-9 ? scale(point, 1 / l) : [0, 0, 1];
  return raycast(scale(direction, 5), scale(direction, -1), p)?.point ?? null;
}

/** Camera angles that look at the origin from the side `direction` is on. */
export function viewAngles(direction) {
  const l = length(direction);
  if (!(l > 1e-9)) { return { yaw: 0, pitch: 0 }; }
  const d = scale(direction, 1 / l);
  return {
    yaw: Math.atan2(d[0], d[2]),
    pitch: clamp(-Math.asin(clamp(d[1], -1, 1)), -1.45, 1.45),
  };
}

export function rotateAbout(v, axis, angle) {
  const k = normalize(axis);
  return add(
    add(scale(v, Math.cos(angle)), scale(cross(k, v), Math.sin(angle))),
    scale(k, dot(k, v) * (1 - Math.cos(angle)))
  );
}

/**
 * Follows one point through the rule, keeping every intermediate value so the
 * arithmetic can be shown.
 */
export function orbit(start, p) {
  const c = lerp3(start, p.juliaC, p.juliaMix);
  const limit = Math.max(Math.round(p.iterations), 1);
  const steps = [];
  let escapedAt = null;
  let z = start;

  for (let k = 0; k <= limit; ++k) {
    const radius = length(z);
    const safeRadius = Math.max(radius, 1e-9);
    const theta = Math.acos(clamp(z[2] / safeRadius, -1, 1));
    const phi = Math.atan2(z[1], z[0]);
    const step = { id: k, z, radius, theta, phi, next: null };
    steps.push(step);
    if (radius > ESCAPE_RADIUS) {
      escapedAt = k;
      break;
    }
    if (k === limit) { break; }
    step.poweredRadius = Math.pow(safeRadius, p.power);
    step.newTheta = theta * p.power + p.phaseTheta;
    step.newPhi = phi * p.power + p.phasePhi;
    step.powered = spherical(step.poweredRadius, step.newTheta, step.newPhi);
    z = add(step.powered, c);
    step.next = z;
  }

  return { steps, c, escapedAt, iterationLimit: limit, distanceEstimate: distance(start, p) };
}
