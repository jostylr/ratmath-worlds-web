// The pages of a book in hand, drawn on canvases: paper with grain, fibres
// and the odd brown spot, darker toward the spine, and the text set in the
// book's own typeface. Each character keeps its column, as in Borges's books
// (and so that a picture made of characters still comes out), but the
// letters are those of a printed book rather than a typewriter's.
// BabelPages.swift draws the same pages in the app.
import * as L from './library.js';

/** The measurements of a page, in units of the type's body (em). */
export const SHAPE = { cell: 0.62, line: 1.45, inner: 3.5, outer: 4.0, top: 4.0, bottom: 6.0 };

export const pageSize = design => ({
  width: design.columns * SHAPE.cell + SHAPE.inner + SHAPE.outer,
  height: design.lines * SHAPE.line + SHAPE.top + SHAPE.bottom,
});

const rgba = (c, a = 1) => `rgba(${c.map(v => Math.round(255 * Math.min(Math.max(v, 0), 1))).join(', ')}, ${a})`;

let grain = null;
function grainTile() {
  if (grain) { return grain; }
  const size = 192;
  const noise = new Float32Array(size * size);
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) { noise[y * size + x] = L.unit(L.combine(x, y), 1); }
  }
  grain = document.createElement('canvas');
  grain.width = grain.height = size;
  const g = grain.getContext('2d');
  const image = g.createImageData(size, size);
  const at = (x, y) => noise[((y + size) % size) * size + (x + size) % size];
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const sum = 4 * at(x, y) + at(x + 1, y) + at(x - 1, y) + at(x, y + 1) + at(x, y - 1);
      const v = Math.max(0, Math.min(255, 128 + (sum / 8 - 0.5) * 150));
      const i = 4 * (y * size + x);
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  return grain;
}

function paper(g, width, height, look, seed, left, endpaper, scale) {
  const c = look.colors;
  const base = endpaper ? c.paper.map((v, i) => v * 0.62 + c.cover[i] * 0.38) : c.paper;
  g.fillStyle = rgba(base);
  g.fillRect(0, 0, width, height);

  // Grain.
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.10;
  const pattern = g.createPattern(grainTile(), 'repeat');
  const zoom = Math.max(0.5, scale * 0.5);
  pattern.setTransform?.(new DOMMatrix([zoom, 0, 0, zoom, 0, 0]));
  g.fillStyle = pattern;
  g.fillRect(0, 0, width, height);
  g.restore();

  // Fibres: short faint strokes.
  g.save();
  g.lineCap = 'round';
  g.lineWidth = 0.5 * scale;
  const fibres = Math.floor(width * height / (2600 * scale * scale));
  for (let i = 0; i < fibres; ++i) {
    const h = L.combine(seed, i);
    const x = L.unit(h, 1) * width;
    const y = L.unit(h, 2) * height;
    const angle = L.unit(h, 3) * Math.PI;
    const length = (2 + 7 * L.unit(h, 4)) * scale;
    g.strokeStyle = L.unit(h, 5) < 0.6 ? rgba(base.map(v => v * 0.72), 0.16) : 'rgba(255, 255, 255, 0.22)';
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    g.stroke();
  }
  g.restore();

  // Foxing: a few soft brown spots on some pages.
  const spots = L.unit(seed, 9) < 0.45 ? Math.floor(1 + 4 * L.unit(seed, 10)) : 0;
  for (let i = 0; i < spots; ++i) {
    const h = L.combine(seed, 1000 + i);
    const x = L.unit(h, 1) * width;
    const y = L.unit(h, 2) * height;
    const radius = (3 + 16 * L.unit(h, 3) * L.unit(h, 3)) * scale;
    const spot = g.createRadialGradient(x, y, 0, x, y, radius);
    spot.addColorStop(0, rgba([0.55, 0.38, 0.20], 0.10 + 0.12 * L.unit(h, 4)));
    spot.addColorStop(1, rgba([0.55, 0.38, 0.20], 0));
    g.fillStyle = spot;
    g.fillRect(x - radius, y - radius, 2 * radius, 2 * radius);
  }

  // Toward the spine the page curves away and darkens; the outer edge and
  // the top and bottom are a little worn.
  const spine = left ? width : 0;
  const reach = width * 0.16;
  const fold = g.createLinearGradient(spine, 0, left ? width - reach : reach, 0);
  fold.addColorStop(0, rgba([0.18, 0.12, 0.06], 0.42));
  fold.addColorStop(0.35, rgba([0.18, 0.12, 0.06], 0.08));
  fold.addColorStop(1, rgba([0.18, 0.12, 0.06], 0));
  g.fillStyle = fold;
  g.fillRect(0, 0, width, height);
  const worn = (x0, y0, x1, y1) => {
    const edge = g.createLinearGradient(x0, y0, x1, y1);
    edge.addColorStop(0, rgba([0.40, 0.30, 0.15], 0.18));
    edge.addColorStop(1, rgba([0.40, 0.30, 0.15], 0));
    g.fillStyle = edge;
    g.fillRect(0, 0, width, height);
  };
  const outer = left ? 0 : width;
  worn(outer, 0, left ? 10 * scale : width - 10 * scale, 0);
  worn(0, 0, 0, 8 * scale);
  worn(0, height, 0, height - 8 * scale);
}

/**
 * Draws page `number` (0 or past the end: the endpaper) on a canvas whose
 * pixel size is already set. `left` puts the spine on the right.
 */
export function drawPage(canvas, { book, design, number, look, hash, left }) {
  const g = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const shape = pageSize(design);
  const em = width / shape.width;
  const scale = Math.max(em / 9, 0.3);
  const seed = L.combine(hash, Math.max(number, 0));
  const endpaper = number < 1 || number > design.pages;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, width, height);
  paper(g, width, height, look, seed, left, endpaper, scale);
  if (endpaper) { return; }

  const set = [...L.symbols(design)];
  const fontAt = size => `${look.typeface.match(/^(italic |\d00 )*/)[0]}${size}px ${look.typeface.replace(/^(italic |\d00 )+/, '')}`;
  g.font = fontAt(100);
  const widths = set.map(c => g.measureText(c).width / 100);
  const letters = widths.filter((_, i) => set[i] !== ' ');
  const average = letters.length ? letters.reduce((a, b) => a + b, 0) / letters.length : 0.55;
  const cell = SHAPE.cell * em;
  const size = Math.min(cell / (average * 1.04), SHAPE.line * em / 1.3);
  g.font = fontAt(size);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'center';
  const index = new Map(set.map((c, i) => [c, i]));

  const textLeft = (left ? SHAPE.outer : SHAPE.inner) * em;
  const line = SHAPE.line * em;
  const firstBaseline = SHAPE.top * em + 1.05 * size;
  const ink = look.colors.ink;
  const tones = [0, 1, 2, 3].map(t => rgba(ink, 0.70 + 0.10 * t));

  if (book) {
    const lines = L.pageOf(book, design, number);
    lines.forEach((text, row) => {
      const baseline = firstBaseline + row * line;
      for (let column = 0; column < text.length; ++column) {
        const c = text[column];
        if (c === ' ') { continue; }
        const h = L.combine(seed, row * 512 + column);
        // Ink lies a little unevenly, and the press did not lay every
        // letter on the line.
        g.fillStyle = tones[Math.floor(L.unit(h, 1) * 3.999)];
        const x = textLeft + (column + 0.5) * cell;
        const y = baseline - (L.unit(h, 2) - 0.5) * 0.04 * size;
        const advance = widths[index.get(c) ?? 0] * size;
        if (advance > cell * 0.98) {
          // Letters wider than their column are narrowed to fit it.
          g.save();
          g.translate(x, y);
          g.scale(cell * 0.98 / advance, 1);
          g.fillText(c, 0, 0);
          g.restore();
        } else {
          g.fillText(c, x, y);
        }
      }
    });
  }

  // The page number, at the foot.
  g.font = fontAt(size * 0.95);
  g.fillStyle = rgba(ink, 0.8);
  g.fillText(String(number), textLeft + design.columns * cell / 2, height - SHAPE.bottom * em * 0.45);
}
