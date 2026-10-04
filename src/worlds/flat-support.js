// Helpers shared by the flat worlds, whose pictures lie in the plane of the
// screen. Their marks are given in view coordinates (see Camera.viewPoint)
// and drawn by fDrawMarkers in the shaders. This is Worlds/Flat/FlatSupport.swift.
import { Format } from './engine.js';

/** The shelf the flat worlds are opened from, and lead back to. */
export const SHELF = { title: '2D worlds', href: 'flat.html' };

// Linear colours; the picture is drawn in linear light.
export const WHITE = [1, 1, 1];
export const YELLOW = [1.0, 0.70, 0.05];
export const CYAN = [0.10, 0.62, 1.0];
export const PINK = [1.0, 0.22, 0.50];

/** Marks far outside the view are held at this distance from its centre. */
const REACH = 40;
const isNear = p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.max(Math.abs(p[0]), Math.abs(p[1])) <= REACH;

export function dot(p, color, radius = 0.018) {
  if (!isNear(p)) { return null; }
  return { raw: [[p[0], p[1], radius, 0], [color[0], color[1], color[2], 0]] };
}

/** A segment, cut short where it leaves the neighbourhood of the view so
    that its direction stays true. */
export function segment(a, b, color) {
  if (![...a, ...b].every(Number.isFinite)) { return null; }
  if (!isNear(a) && !isNear(b)) { return null; }
  const pulled = (far, near) => {
    if (isNear(far)) { return far; }
    let low = 0, high = 1;
    for (let i = 0; i < 40; i += 1) {
      const t = (low + high) / 2;
      const p = [near[0] + (far[0] - near[0]) * t, near[1] + (far[1] - near[1]) * t];
      if (isNear(p)) { low = t; } else { high = t; }
    }
    return [near[0] + (far[0] - near[0]) * low, near[1] + (far[1] - near[1]) * low];
  };
  const start = pulled(a, b);
  const end = pulled(b, start);
  return { raw: [[start[0], start[1], end[0], end[1]], [color[0], color[1], color[2], 1]] };
}

export function ring(centre, radius, color) {
  if (!isNear(centre) || !Number.isFinite(radius) || radius >= REACH) { return null; }
  return { raw: [[centre[0], centre[1], radius, 0], [color[0], color[1], color[2], 2]] };
}

export function blend(a, b, t) {
  const s = Math.min(Math.max(t, 0), 1);
  return a.map((value, i) => value + (b[i] - value) * s);
}

const SUBSCRIPTS = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '-': '₋' };
const SUPERSCRIPTS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };

/** A whole number as subscript digits, for naming the steps of a rule. */
export const sub = n => [...String(n)].map(c => SUBSCRIPTS[c] ?? c).join('');
/** A whole number as superscript digits, for a power. */
export const sup = n => [...String(n)].map(c => SUPERSCRIPTS[c] ?? c).join('');

/** A complex number written out, such as −0.1226 + 0.7449i. */
export const complex = (z, digits = 4) =>
  `${Format.number(z[0], digits)} ${z[1] < 0 ? '−' : '+'} ${Format.number(Math.abs(z[1]), digits)}i`;

// MARK: The orbit camera, used flat

/** Plane units per view unit, for each unit of camera distance, when the
    camera looks straight down on the plane z = 0 (fPlane in the shaders, and
    the line renderer, use the same number). */
export const LENS = 0.72 / 1.65;

export const scale = state => LENS * state.cameraDistance;
export const plane = (viewPoint, state) =>
  [state.focus[0] + viewPoint[0] * scale(state), state.focus[1] + viewPoint[1] * scale(state)];
export const view = (point, state) =>
  [(point[0] - state.focus[0]) / scale(state), (point[1] - state.focus[1]) / scale(state)];

/** Makes a state look straight down from `distance` at `centre`. */
export function lookDown(state, distance, centre = [0, 0]) {
  state.yaw = 0;
  state.pitch = 0;
  state.cameraDistance = distance;
  state.focus = [centre[0], centre[1], 0];
  return state;
}

export function pan(state, dx, dy) {
  state.focus[0] -= dx * scale(state);
  state.focus[1] += dy * scale(state);
}

/** `factor` times closer, with the view point staying where it is; `range`
    is the world's cameraDistanceRange. Returns a new state. */
export function dive(viewPoint, state, factor, range) {
  const goal = { ...state, values: [...state.values], focus: [...state.focus] };
  goal.cameraDistance = Math.min(Math.max(state.cameraDistance / factor, range[0]), range[1]);
  const ratio = goal.cameraDistance / state.cameraDistance;
  const point = plane(viewPoint, state);
  goal.focus = [point[0] + (state.focus[0] - point[0]) * ratio, point[1] + (state.focus[1] - point[1]) * ratio, 0];
  return goal;
}

/** A small generator of repeatable random numbers between 0 and 1. (The
    app's is a different one, so its throws fall differently.) */
export function dice(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
