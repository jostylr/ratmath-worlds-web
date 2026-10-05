import { defaultParameters, CAMERA_DISTANCE_RANGE, clamp } from './math.js';

const ranges = { power: [2, 12], iterations: [2, 24], juliaMix: [0, 1], phaseTheta: [-Math.PI, Math.PI], phasePhi: [-Math.PI, Math.PI], sliceHeight: [-1.2, 2.5], palette: [0, 3], yaw: [-10000, 10000], pitch: [-1.45, 1.45], cameraDistance: CAMERA_DISTANCE_RANGE };
const vector = (v, limit) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v.map(n => clamp(n, -limit, limit)) : null;

export function bulbSceneText(model) {
  const scene = { p: model.parameters, probe: model.probe, explorer: model.explorerIsOpen, surface: model.probeStaysOnSurface, follow: model.cameraFollowsProbe };
  return '#scene=' + encodeURIComponent(JSON.stringify(scene));
}

export function readBulbScene(hash) {
  if (!hash.startsWith('#scene=') || hash.length > 8000) { return null; }
  try {
    const scene = JSON.parse(decodeURIComponent(hash.slice(7)));
    if (!scene || !scene.p || typeof scene.p !== 'object') { return null; }
    const p = defaultParameters();
    for (const [key, range] of Object.entries(ranges)) {
      if (Number.isFinite(scene.p[key])) { p[key] = clamp(scene.p[key], ...range); }
    }
    p.palette = Math.round(p.palette);
    p.juliaC = vector(scene.p.juliaC, 1.5) ?? p.juliaC;
    p.focus = vector(scene.p.focus, 1e6) ?? p.focus;
    return { parameters: p, probe: vector(scene.probe, 1e6) ?? [0, 0, 1], explorerIsOpen: scene.explorer === true, probeStaysOnSurface: scene.surface !== false, cameraFollowsProbe: scene.follow !== false };
  } catch { return null; }
}

/** Validate scene values against the controls, including hidden controls. */
export function validateWorldValues(values, world) {
  const result = values.map(n => Number.isFinite(n) ? clamp(n, -1e12, 1e12) : 0);
  for (const control of world.controlGroups.flatMap(group => group.controls)) {
    if (control.kind === 'slider') { result[control.index] = clamp(result[control.index], ...control.range); }
    else if (control.kind === 'picker') { result[control.index] = clamp(Math.round(result[control.index]), 0, control.options.length - 1); }
    else if (control.kind === 'toggle') { result[control.index] = result[control.index] > 0.5 ? 1 : 0; }
  }
  return result;
}

export function worldSceneText(state, world) {
  const round = value => String(Number((Number.isFinite(value) ? value : 0).toFixed(world.urlDigits ?? 6)));
  const d = world.defaults;
  const parts = [];
  const values = [...state.values];
  if (world.playback) { values[world.playback.play] = 0; }
  let last = -1;
  for (let i = 0; i < 32; i += 1) {
    if (round(values[i]) !== round(d.values[i])) { last = i; }
  }
  if (last >= 0) { parts.push('v=' + values.slice(0, last + 1).map(round).join(',')); }
  const camera = [state.yaw, state.pitch, state.cameraDistance].map(round).join(',');
  if (camera !== [d.yaw, d.pitch, d.cameraDistance].map(round).join(',')) { parts.push('c=' + camera); }
  const focus = state.focus.map(round).join(',');
  if (focus !== d.focus.map(round).join(',')) { parts.push('f=' + focus); }
  if (state.palette !== d.palette) { parts.push('p=' + state.palette); }
  return parts.join('&');
}


export function readWorldScene(text, world) {
  const pitchRange = world.pitchRange ?? [-1.45, 1.45];
  const distanceRange = world.cameraDistanceRange;
  const next = { ...world.defaults, values: [...world.defaults.values], focus: [...world.defaults.focus] };
  for (const part of text.replace(/^#/, '').split('&')) {
    const [key, value] = part.split('=');
    if (value === undefined) { continue; }
    const numbers = value.split(',').map(Number);
    if (numbers.some(n => !Number.isFinite(n))) { continue; }
    if (key === 'v') {
      numbers.slice(0, 32).forEach((n, i) => { next.values[i] = n; });
    } else if (key === 'c' && numbers.length === 3) {
      next.yaw = clamp(numbers[0], -10000, 10000);
      next.pitch = clamp(numbers[1], ...pitchRange);
      next.cameraDistance = clamp(numbers[2], ...distanceRange);
    } else if (key === 'f' && numbers.length === 3) {
      next.focus = numbers.map(n => clamp(n, -1e6, 1e6));
    } else if (key === 'p' && numbers.length === 1) {
      next.palette = clamp(Math.round(numbers[0]), 0, world.paletteNames.length - 1);
    }
  }
  next.values = validateWorldValues(next.values, world);
  return next;
}

