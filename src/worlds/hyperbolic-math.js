// Arithmetic of the hyperbolic plane in the Poincaré disk model, where points
// are complex numbers of size less than 1, written [x, y]. The shaders work in
// single precision; everything that accumulates is done here in double
// precision. This is Worlds/Hyperbolic/HyperbolicMath.swift, without the parts
// only the app's explorer uses.

export const Hyp = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  scale: (a, s) => [a[0] * s, a[1] * s],
  length: a => Math.hypot(a[0], a[1]),
  lengthSquared: a => a[0] * a[0] + a[1] * a[1],

  mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],

  div(a, b) {
    const d = Math.max(b[0] * b[0] + b[1] * b[1], 1e-300);
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
  },

  conj: a => [a[0], -a[1]],

  expi: angle => [Math.cos(angle), Math.sin(angle)],

  arg: a => Math.atan2(a[1], a[0]),

  ONE: [1, 0],

  /** The translation that carries the centre to `b`. */
  translate(z, b) {
    return Hyp.div(Hyp.add(z, b), Hyp.add(Hyp.ONE, Hyp.mul(Hyp.conj(b), z)));
  },

  /** True distance between two points: 2 artanh |(z − a) ⁄ (1 − āz)|. */
  distance(a, z) {
    return 2 * Math.atanh(Math.min(Hyp.length(Hyp.translate(z, Hyp.scale(a, -1))), 1 - 1e-15));
  },

  /** Keeps a point strictly inside the disk. */
  clamped(z, limit = 0.995) {
    const length = Hyp.length(z);
    return length > limit ? Hyp.scale(z, limit / length) : z;
  },
};

/**
 * Where the viewer stands and which way they face. A view point w is the
 * plane point (e^{iθ} w + a) ⁄ (1 + ā e^{iθ} w).
 */
export class Frame {
  constructor(a = [0, 0], theta = 0) {
    this.a = a;
    this.theta = theta;
  }

  apply(w) {
    const rotated = Hyp.mul(Hyp.expi(this.theta), w);
    return Hyp.div(Hyp.add(rotated, this.a), Hyp.add(Hyp.ONE, Hyp.mul(Hyp.conj(this.a), rotated)));
  }

  inverse(z) {
    return Hyp.mul(Hyp.expi(-this.theta),
      Hyp.div(Hyp.sub(z, this.a), Hyp.sub(Hyp.ONE, Hyp.mul(Hyp.conj(this.a), z))));
  }

  /** The viewer steps by `delta`, measured in their own view. */
  translated(delta) {
    const turn = Hyp.add(Hyp.ONE, Hyp.mul(Hyp.conj(this.a), Hyp.mul(Hyp.expi(this.theta), delta)));
    return new Frame(this.apply(delta), this.theta - 2 * Hyp.arg(turn));
  }

  rotated(angle) {
    return new Frame(this.a, this.theta + angle);
  }
}

/**
 * A straight line of the plane: in the disk, a circle that meets the boundary
 * at right angles, `{ center, radius }`, or a diameter, `{ normal }`.
 */
export const Line = {
  circle: (center, radius) => ({ center, radius }),
  diameter: normal => ({ normal }),

  /** The line through two points of the closed disk. */
  through(u, v) {
    // A centre c with |c|² = 1 + r² at distance r from u and v
    // satisfies 2c·u = |u|² + 1 and 2c·v = |v|² + 1.
    const determinant = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(determinant) < 1e-9) {
      const direction = Hyp.length(u) > Hyp.length(v) ? u : v;
      const length = Math.max(Hyp.length(direction), 1e-12);
      return Line.diameter([-direction[1] / length, direction[0] / length]);
    }
    const ru = (Hyp.lengthSquared(u) + 1) / 2;
    const rv = (Hyp.lengthSquared(v) + 1) / 2;
    const center = [(ru * v[1] - rv * u[1]) / determinant, (rv * u[0] - ru * v[0]) / determinant];
    return Line.circle(center, Math.sqrt(Math.max(Hyp.lengthSquared(center) - 1, 0)));
  },
};

/** The regular tiling by p-gons, q at each corner, and its three mirrors. */
export class Tiling {
  constructor(p, q) {
    this.p = p;
    this.q = q;
    const sp = Math.sin(Math.PI / p);
    const cq = Math.cos(Math.PI / q);
    const denominator = Math.sqrt(Math.max(cq * cq - sp * sp, 1e-9));
    this.mirrorNormal = [-sp, Math.cos(Math.PI / p)];
    this.edgeCenter = [cq / denominator, 0];
    this.edgeRadius = sp / denominator;
  }

  /** The smallest q for which p-gons, q to a corner, need a hyperbolic
      plane: (p − 2)(q − 2) > 4. */
  static minimumQ(p) {
    switch (p) {
      case 3: return 7;
      case 4: return 5;
      case 5: case 6: return 4;
      default: return 3;
    }
  }

  /** Distance from the centre of a tile to the middle of an edge. */
  get inradius() { return 2 * Math.atanh(this.edgeCenter[0] - this.edgeRadius); }

  /** cosh(side ⁄ 2) = cos(π⁄p) ⁄ sin(π⁄q) */
  get sideLength() {
    return 2 * Math.acosh(Math.cos(Math.PI / this.p) / Math.sin(Math.PI / this.q));
  }

  /** The area of a polygon is its angle shortfall: (p − 2)π − p·(2π⁄q). */
  get tileArea() {
    return (this.p - 2) * Math.PI - this.p * 2 * Math.PI / this.q;
  }

  /**
   * Replaces a frame by an equivalent one whose viewer stands in the central
   * tile. The tiling looks identical from both, so the picture does not
   * change, but the numbers stay small however far one walks.
   */
  recentered(start) {
    const frame = new Frame(start.a, start.theta);
    const sector = 2 * Math.PI / this.p;
    // A half-turn about the middle of the edge on the positive x-axis.
    const m = this.edgeCenter[0] - this.edgeRadius;
    const b = [2 * m / (1 + m * m), 0];
    for (let i = 0; i < 200; i += 1) {
      // Rotate the viewer into the sector facing that edge.
      const steps = roundAwayFromZero(Hyp.arg(frame.a) / sector);
      if (steps !== 0) {
        frame.a = Hyp.mul(frame.a, Hyp.expi(-steps * sector));
        frame.theta -= steps * sector;
      }
      if (!(Hyp.length(Hyp.sub(frame.a, this.edgeCenter)) < this.edgeRadius)) { break; }
      // H(z) = (b − z) ⁄ (1 − bz), with H′(z) = (b² − 1) ⁄ (1 − bz)².
      const denominator = Hyp.sub(Hyp.ONE, Hyp.mul(b, frame.a));
      frame.theta += Math.PI - 2 * Hyp.arg(denominator);
      frame.a = Hyp.div(Hyp.sub(b, frame.a), denominator);
    }
    frame.theta = Math.atan2(Math.sin(frame.theta), Math.cos(frame.theta));
    return frame;
  }
}

/** Swift's `rounded()`: halves go away from zero, where Math.round sends
    them up. */
export function roundAwayFromZero(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}
