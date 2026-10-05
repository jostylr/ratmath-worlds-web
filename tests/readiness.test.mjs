import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MandelbulbModel } from '../src/model.js';
import { bulbSceneText, readBulbScene, worldSceneText, readWorldScene } from '../src/scene-state.js';
import { advancePlayback } from '../src/playback.js';
import { copyState } from '../src/worlds/engine.js';
import * as L from '../src/babel/library.js';
import * as W from '../src/babel/world.js';
import * as G from '../src/gallery/logic.js';
import { world as escher } from '../src/worlds/escher.js';
import { world as eversion } from '../src/worlds/eversion.js';
import { world as attractors } from '../src/worlds/attractors.js';
import { ImmersiveSession } from '../src/xr.js';
import { compileProgram, manageGraphics } from '../src/graphics.js';
import { RenderQuality, sceneURL } from '../src/site.js';

const root = new URL('../', import.meta.url);
const worlds = ['menger', 'hyperbolic-plane', 'hyperbolic-space', 'recursive-room', 'escher', 'four-d', 'quaternion-julia', 'topology', 'eversion', 'attractors', 'mandelbrot', 'flatland', 'logistic', 'newton', 'henon', 'chaos-game', 'pendulum'];

for (const name of worlds) {
  test(`${name}: defaults and every tour frame are finite and round-trip`, async () => {
    const { world } = await import(`../src/worlds/${name}.js`);
    const frames = world.tour.flatMap(stop => stop.build(copyState(world.defaults)));
    assert.ok(frames.length > 0);
    for (const state of [world.defaults, ...frames.map(frame => frame.target)]) {
      assert.equal(state.values.length, 32);
      assert.ok([...state.values, ...state.focus, state.yaw, state.pitch, state.cameraDistance].every(Number.isFinite));
      assert.ok(state.cameraDistance > 0);
      const encoded = worldSceneText(state, world);
      const restored = readWorldScene(encoded, world);
      for (let index = 0; index < 32; index++) {
        if (world.playback?.play === index) { assert.equal(restored.values[index], 0); }
        else { assert.ok(Math.abs(restored.values[index] - state.values[index]) < 0.000001); }
      }
      const canonical = worldSceneText(restored, world);
      assert.equal(worldSceneText(readWorldScene(canonical, world), world), canonical);
    }
  });
}

test('Escher distant positive and negative stair addresses take constant work', { timeout: 2000 }, () => {
  for (const stair of [1e12, -1e12, 1e12 + 3, -1e12 - 3]) {
    const state = readWorldScene(`#v=0,0,${stair}`, escher);
    assert.ok(escher.shaderValues(state).every(Number.isFinite));
  }
});

test('Mandelbulb scene keeps parameters, camera and explorer without changing them', () => {
  const model = new MandelbulbModel();
  model.parameters.power = 11.25;
  model.parameters.juliaC = [0.2, -0.7, 0.4];
  model.parameters.focus = [-0.2, 0.1, 0.6];
  model.parameters.cameraDistance = 0.3;
  model.explorerIsOpen = true;
  model.probe = [0.4, 0.5, 0.6];
  model.probeStaysOnSurface = false;
  model.cameraFollowsProbe = false;
  const restored = new MandelbulbModel();
  restored.restoreScene(readBulbScene(bulbSceneText(model)));
  assert.deepEqual(restored.parameters, model.parameters);
  assert.deepEqual(restored.probe, model.probe);
  assert.equal(restored.explorerIsOpen, true);
  assert.equal(restored.probeStaysOnSurface, false);
  assert.equal(restored.cameraFollowsProbe, false);
});

test('Malformed Mandelbulb links and fractional tour stops are safe', () => {
  for (const text of ['#scene=%', '#scene=null', '#scene={}', '#scene=' + 'x'.repeat(8001)]) { assert.equal(readBulbScene(text), null); }
  const model = new MandelbulbModel();
  for (const stop of [0.5, -1, NaN, Infinity, 999]) { model.showTourStep(stop); assert.equal(model.tourIndex, null); }
  const scene = readBulbScene('#scene=' + encodeURIComponent(JSON.stringify({ p: { power: 1e100, pitch: -100, cameraDistance: 0 } })));
  assert.equal(scene.parameters.power, 12);
  assert.equal(scene.parameters.pitch, -1.45);
  assert.equal(scene.parameters.cameraDistance, 0.02);
});

test('Babel and gallery preserve zoom, position, and old four-number views', () => {
  const place = L.newPlace();
  const view = { x: 0, z: 1.23456, yaw: 0.7, pitch: -0.1, zoom: 0.65 };
  const parsed = L.parseAddress(L.addressText(place, view), place.design);
  assert.equal(W.sceneAt(parsed.place, parsed.view).zoom, view.zoom);
  assert.equal(parsed.view.z, view.z);
  const old = L.parseAddress('borges:0~0,1,0,0', place.design);
  assert.equal(W.sceneAt(old.place, old.view, 0.8).zoom, 0.8);
  const scene = G.sceneAt(G.newPlace());
  scene.zoom = 0.35;
  const next = G.parseAddress(G.addressText(scene, true), G.sceneAt(G.newPlace()));
  assert.equal(next.zoom, scene.zoom);
  assert.equal(G.parseAddress('gallery:0,0,0~0,1,0,0', scene).zoom, 0.35);
  assert.equal(G.parseAddress('gallery:0,0,0~0,1,0,0,999', scene).zoom, 1.6);
});

test('Empty Babel shelves do not pretend to contain a book', () => {
  const { place } = L.parseAddress('a2.p2.l1.c1:1:1.1.1.1', L.newPlace().design);
  assert.equal(L.bookOf(place), null);
});

for (const world of [eversion, attractors]) {
  test(`${world.title}: pause holds, resume advances, shared links hold the shown frame`, () => {
    const state = copyState(world.defaults);
    const { play, value } = world.playback;
    state.values[value] = 0.25;
    advancePlayback(state, world.playback, 1);
    const shown = state.values[value];
    state.values[play] = 0;
    assert.equal(advancePlayback(state, world.playback, 10), false);
    assert.equal(state.values[value], shown);
    state.values[play] = 1;
    advancePlayback(state, world.playback, 0.1);
    assert.notEqual(state.values[value], shown);
    const restored = readWorldScene(worldSceneText(state, world), world);
    assert.equal(restored.values[play], 0);
    assert.ok(Math.abs(restored.values[value] - state.values[value]) < 0.000001);
  });
}

test('Eversion resumes backward motion correctly across a pause', () => {
  const state = copyState(eversion.defaults);
  advancePlayback(state, eversion.playback, 20);
  const before = state.values[0];
  state.values[1] = 0;
  advancePlayback(state, eversion.playback, 10);
  state.values[1] = 1;
  advancePlayback(state, eversion.playback, 0.1);
  assert.ok(state.values[0] < before);
});

test('Formula diagnostics catch underflow, overflow and correctly model duplicate/swap', () => {
  assert.equal(G.analyzeFormula('xy*4*s').valid, true);
  assert.equal(G.analyzeFormula('+').valid, false);
  assert.equal(G.analyzeFormula('xw').valid, false);
  assert.equal(G.analyzeFormula('123456789').valid, false);
  assert.equal(G.analyzeFormula('xdw+').depth, 1);
  assert.equal(G.analyzeFormula('xyr').depth, 3);
  assert.equal(G.analyzeFormula('nope!').valid, false);
});

test('Reduced motion snaps the tour and canonical URLs discard launch overrides', () => {
  const original = globalThis.matchMedia;
  const originalLocation = globalThis.location;
  try {
    globalThis.matchMedia = () => ({ matches: true });
    globalThis.location = { pathname: '/world/mandelbulb.html', search: '?tourStep=4&explorer=1&keep=yes' };
    const model = new MandelbulbModel();
    model.showTourStep(0);
    assert.equal(model.isAnimating, false);
    assert.equal(model.tourIndex, 0);
    assert.equal(sceneURL('#scene=example'), '/world/mandelbulb.html?keep=yes#scene=example');
  } finally { globalThis.matchMedia = original; globalThis.location = originalLocation; }
});

test('Auto quality reduces resolution under slow moving frames and respects phone caps', () => {
  const original = globalThis.matchMedia, doc = globalThis.document;
  try {
    globalThis.document = { hidden: false };
    globalThis.matchMedia = () => ({ matches: true });
    const quality = new RenderQuality(), canvas = { clientWidth: 1200, clientHeight: 2000 };
    const first = quality.ratio(canvas, true, 0);
    for (let i = 1; i <= 30; i++) { quality.ratio(canvas, true, i * 60); }
    assert.ok(quality.ratio(canvas, true, 1860) < first);
    assert.ok(quality.ratio(canvas, false) * 2000 <= 1280);
  } finally { globalThis.matchMedia = original; globalThis.document = doc; }
});

test('XR startup failure ends acquired sessions, and concurrent starts are ignored', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let requested = 0, ended = 0;
  const session = { addEventListener() {}, async end() { ended++; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { xr: { async requestSession() { requested++; return session; } } } });
  try {
    const renderer = { graphics: { ready: true }, gl: { async makeXRCompatible() { throw new Error('simulated graphics failure'); } }, invalidate() {}, paused: false };
    const xr = new ImmersiveSession(renderer, new MandelbulbModel(), () => {});
    const start = xr.toggle();
    await xr.toggle();
    await assert.rejects(start, /simulated/);
    assert.equal(requested, 1); assert.equal(ended, 1); assert.equal(xr.isOpen, false); assert.equal(renderer.paused, false);
  } finally { Object.defineProperty(globalThis, 'navigator', original); }
});

test('Context loss stops rendering and restoration rebuilds resources', () => {
  const doc = globalThis.document;
  const element = () => ({ append() {}, setAttribute() {}, remove() {}, addEventListener() {} });
  globalThis.document = { createElement: element, body: element() };
  try {
    const canvas = new EventTarget();
    canvas.dataset = {};
    let initialized = 0, invalidated = 0;
    const graphics = manageGraphics(canvas, () => initialized++, () => invalidated++);
    assert.equal(graphics.ready, true);
    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    assert.equal(lost.defaultPrevented, true); assert.equal(graphics.ready, false);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    assert.equal(graphics.ready, true); assert.equal(initialized, 2); assert.equal(invalidated, 2);
  } finally { globalThis.document = doc; }
});

test('Compile failures clean shader resources and never link a broken program', () => {
  let deleted = 0, linked = 0, programsDeleted = 0;
  const gl = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, createProgram: () => ({}), createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => false, getShaderInfoLog: () => 'broken', attachShader() {}, linkProgram() { linked++; }, deleteShader() { deleted++; }, deleteProgram() { programsDeleted++; } };
  assert.throws(() => compileProgram(gl, '', ''), /broken/);
  assert.equal(linked, 0); assert.equal(deleted, 1); assert.equal(programsDeleted, 1);
});

test('Every JavaScript module parses and every local page asset/link exists', async () => {
  async function walk(folder) {
    const files = [];
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const url = new URL(item.name, folder);
      if (item.isDirectory()) { files.push(...await walk(new URL(item.name + '/', folder))); }
      else { files.push(url); }
    }
    return files;
  }
  for (const file of await walk(new URL('src/', root))) { if (file.pathname.endsWith('.js')) { execFileSync(process.execPath, ['--check', fileURLToPath(file)]); } }
  const pages = (await readdir(root)).filter(name => name.endsWith('.html'));
  for (const page of pages) {
    const source = await readFile(new URL(page, root), 'utf8');
    for (const match of source.matchAll(/(?:href|src)="([^"#]+)"|from ['"]([^'"]+)['"]/g)) {
      const path = (match[1] || match[2]).split(/[?#]/)[0];
      if (/^(https?:|mailto:|data:)/.test(path)) { continue; }
      assert.ok((await stat(new URL(path, root))).isFile(), `${page}: ${path}`);
    }
  }
});
