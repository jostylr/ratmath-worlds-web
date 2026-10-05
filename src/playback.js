// The displayed value is the stored value: pausing cannot jump to an old slider.
const phases = new WeakMap();
export function advancePlayback(state, config, dt) {
  if (!config || state.values[config.play] <= 0.5 || !(dt > 0)) { return false; }
  let entry = phases.get(state);
  const value = state.values[config.value];
  if (!entry || Math.abs(entry.shown - value) > 1e-9) { entry = { phase: value, shown: value }; }
  entry.phase = (entry.phase + dt * config.rate * (config.speed === undefined ? 1 : state.values[config.speed])) % config.period;
  entry.shown = config.bounce ? Math.min(entry.phase, config.period - entry.phase) : Math.min(entry.phase, config.maximum);
  state.values[config.value] = entry.shown;
  phases.set(state, entry);
  return true;
}
