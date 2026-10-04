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
