// The guided tour: the same stops and words as GalleryWorld.tour in the app.
// Each stop builds keyframes { scene, duration, hold } from addresses.
import * as G from './logic.js';

const BASE = G.sceneAt(G.newPlace());
const stop = (code, view = {}) => Object.assign(G.parseAddress(code, BASE), view);
const frame = (scene, duration, hold = 0) => ({ scene, duration, hold });
const show = (...codes) => () => codes.map(code => frame(stop(code), 1.5, 4.5));

export const TOUR = [
  {
    title: 'A gallery with no painters',
    body: [
      'Nobody made these pictures, and none of them is stored anywhere. Each frame has a number, worked out from which room it is in and where it hangs. A rule, here called a scheme, turns that number into a picture, one dot at a time, as you look.',
      'The rooms are the Library of Babel’s: six-sided galleries round an air shaft, with doorways to the next. On this floor each frame picks one of eight schemes.',
    ],
    tryIt: 'Drag to look; click the floor, a doorway or a picture',
    build() {
      const start = stop('gallery:0,0,0');
      return [
        frame(start, 2.0, 1.0),
        frame({ ...start, yaw: start.yaw + 2.2 }, 9.0, 0.5),
        frame({ ...start, yaw: start.yaw - 1.6 }, 13.0),
      ];
    },
  },
  {
    title: 'A scheme on every floor',
    body: [
      'Look down the shaft. The floor below hangs a different kind of picture, and the one below that another. There are ten kinds, one to a floor, and then they come round again.',
      'Climb by the spiral stair in a vestibule, or simply click up or down the shaft. The next stops visit the floors in turn.',
    ],
    tryIt: 'Up and down, or E and Q',
    build() {
      const r = G.geometry(G.PLAIN).shaft + 0.24;
      const a = Math.PI / 3;
      const down = stop('gallery:0,0,0', {
        x: r * Math.cos(a), z: r * Math.sin(a), yaw: Math.atan2(Math.cos(a), Math.sin(a)), pitch: -1.1,
      });
      return [frame(down, 4.0, 5.0), frame({ ...down, pitch: 1.1 }, 7.0)];
    },
  },
  {
    title: 'Two tiles, endless paths',
    body: [
      'Take a square tile with two quarter circles on it, joining the middles of neighbouring sides. It can be laid two ways. Lay a floor of them, choosing each by the toss of a coin.',
      'Whatever the tosses, the arcs meet up, and the floor fills with loops and winding paths. These are Truchet tiles: all the variety comes from one bit of choice per tile.',
    ],
    tryIt: 'Floor 2',
    build: show('gallery:0,0,2:2.1', 'gallery:0,0,2:2.2'),
  },
  {
    title: 'Cut, and cut again',
    body: [
      'Start with a blank rectangle. Cut it in two. Cut each piece in two, and so on a few times, sometimes stopping early. Paint a few pieces.',
      'The same instruction applied to its own results is called recursion. The picture’s number decides every cut, so the next frame along follows the same recipe to a different end.',
    ],
    tryIt: 'Floor 3',
    build: show('gallery:0,0,3:3.1', 'gallery:0,0,3:3.2'),
  },
  {
    title: 'A row made from the row above',
    body: [
      'Read this one from the top down. Each row is a line of cells, dark or light. A cell in the next row looks at the three cells above it and consults a table of eight answers. That table, written as a binary number, is the rule’s name.',
      'There are only 256 such rules. Some give stripes, some nested triangles, and a few, like rule 30, give patterns that look random. Rule 110 can carry out any computation at all.',
    ],
    tryIt: 'Floor 4',
    build: show('gallery:0,0,4:2.1', 'gallery:0,0,4:2.2', 'gallery:0,0,4:3.1'),
  },
  {
    title: 'Julia sets',
    body: [
      'Pick a number c. For each point z of the picture, square it and add c, then do the same to the result, again and again. Some points fly away; the ones that never do form the Julia set of c.',
      'Each frame here has its own c, taken from a circle where the sets are at their most intricate. A small change in c gives a very different shape.',
    ],
    tryIt: 'Floor 5',
    build: show('gallery:0,0,5:2.1', 'gallery:0,0,5:2.2', 'gallery:0,0,5:3.1'),
  },
  {
    title: 'Games with binary digits',
    body: [
      'Number the columns and rows of a grid. For each square, combine its column and row numbers digit by binary digit, with XOR, AND or OR, or simply multiply them. Divide by some number and colour the square by the remainder.',
      'Because binary digits repeat at every scale, so does the picture: squares within squares, and the Sierpinski triangle hiding in AND.',
    ],
    tryIt: 'Floor 7',
    build: show('gallery:0,0,7:2.1', 'gallery:0,0,7:2.2', 'gallery:0,0,7:3.2'),
  },
  {
    title: 'Nearest neighbours, and roses',
    body: [
      'Scatter some points. Colour every place by whichever point is nearest. The plane splits into cells with straight walls: a Voronoi diagram, the pattern of giraffe skin and dried mud.',
      'The rose, one floor down from the bit games, is a single curve, r = |cos(kθ ⁄ 2)|: the distance from the middle swings in and out k times in one turn, making k petals.',
    ],
    tryIt: 'Floors 8 and 6',
    build: show('gallery:0,0,8:2.1', 'gallery:0,0,6:2.1', 'gallery:0,0,6:2.2'),
  },
  {
    title: 'Write the rule yourself',
    body: [
      'Floor 9 shows a formula: xy*4*s. It means: take x, take y, multiply, take 4, multiply, then the sine of π times that. So the colour at each point is set by sin(4π·x·y), and the bands follow the curves where x·y is constant: hyperbolas.',
      'The next uses r and a, the distance and angle, and t, a number that differs from frame to frame. The last leaves three numbers, which become red, green and blue.',
    ],
    tryIt: 'On floor 9, type a formula into the box at the top',
    build: show('=xy*4*s:0,0,9:2.1', '=r6*a3*t+s+s:0,0,9:2.2', '=x3*sy3*sxy*5*s:0,0,9:3.1'),
  },
  {
    title: 'Rooms to your own plan',
    body: [
      'The rooms can be redrawn too. This gallery is eight-sided, with six hung walls, three pictures to a row and two rows: 36 pictures in a room, where the first had 8.',
      'The design is the first part of the address, g8.w6.v3.s2, so a copied link rebuilds the same gallery as well as the same spot in it.',
    ],
    tryIt: 'Rooms → Sides, Hung walls, Pictures in a row, Rows',
    build() {
      const start = stop('g8.w6.v3.s2:0,0,5');
      return [frame(start, 1.5, 2.0), frame({ ...start, yaw: start.yaw + 2.4 }, 12.0)];
    },
  },
  {
    title: 'Your turn',
    body: [
      'Walk through the rooms and up and down the floors, or type an address: gallery:12,-4,5:2.1 is the first picture on the second wall of a room of Julia sets. A scheme’s name works as well: julia:12,-4. The dice take you to a room at random.',
      'Under Rooms you can reshape the gallery; under Formula is the list of steps a formula can use. The page’s own address always holds where you are, so a link brings anyone to the very spot.',
    ],
    build: () => [frame(stop('gallery:0,0,0'), 1.5)],
  },
];
