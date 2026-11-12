# RatMath Worlds on the web

The app's worlds as static web pages, drawn with WebGL 2: the same pictures,
guided tours and control panels as the native app. `index.html` is the library,
with a card for each world. There is no build step and nothing to install.

The native app (Swift, SwiftUI and Metal, for macOS, iOS and visionOS) is kept in a
separate repository; the "Native" file names below refer to it.

## Run it

Serve this folder with any static file server and open it in a browser:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>. Opening `index.html` straight from disk does
not work, because browsers refuse to load JavaScript modules from `file://`.

Every world's page takes `?tourStep=N` to open directly on that tour stop,
mirroring the native launch argument, and keeps the scene on screen in its address
after `#`, so a copied link opens the same view. A scene in the hash takes
precedence over a launch argument; launch arguments are removed when the scene
is saved. Mandelbulb includes its shape, camera and orbit-explorer settings.
Babel and the gallery include zoom as a fifth view number; old four-number
addresses remain readable.

## Publish it

The repository includes a GitHub Pages workflow
(`.github/workflows/pages.yml`) that checks it on pull requests and publishes
successful pushes to `main`. Deployment waits only for the quick checks: the
numerical regressions, Babel reference vectors and local link checks, a few
seconds in all. The Chromium browser scenarios are run on your own machine
before pushing (see Checks).
Only HTML, CSS, the favicon, `thumbs/` and `src/` go into the published `_site/` folder;
repository files and tests stay out of the deployment. After
pushing the repository to GitHub, switch it on once under
**Settings → Pages → Source: GitHub Actions**. The site then appears at
`https://<user>.github.io/<repository>/`.

All paths in the page are relative, so the folder also works unchanged on any
other static host. A headset needs the page served over `https`, which Pages
provides.

## Controls and reading

Each world's controls include **Share view**, **Bookmark view**, **Bookmarks**
and **Picture quality**. Bookmarks stay in the current browser; storage or
clipboard restrictions show a usable fallback. **Auto** adjusts resolution while
moving and caps it on phones; **Economy** reduces the workload; **High** raises
the resolution cap. A lost WebGL context shows a recovery message and rebuilds
its resources when restored, preserving the scene.

Babel always opens each book with its original page layout, including on a phone.
**Reader mode** switches to larger, wrapping text with vertical scrolling and
fixed page controls. The toggle applies to the current book and stays active
when changing its pages; a newly opened book or a reload starts in the original
layout. Empty shelves disable page controls.

Eversion and attractors pause on the displayed frame and resume from it. Both
have playback speed controls. Shared links capture a still frame. The browser's
reduced-motion preference disables automatic playback and makes guided tours
move directly to their destination. Background tabs stop drawing and advancing
playback.

The gallery's formula field reports stack underflow and overflow, maximum stack
use, and how its results become colours. Invalid edits leave the last working
picture visible.

## Arriving in a world

A world opened with nothing after `#` greets the visitor: a card with what the
world is, the ways in (guided tour, ride, explore alone) and its sights to ride
to, while the picture flies in from farther off. Touching the picture puts the
card away. A link to a place (`#…`), `?tourStep=` and `?ride` skip the
greeting, and `?plain` opens the world as it stands, for pictures and tests.
The pictures on the library's cards live in `thumbs/` and are made by
`shared/make-thumbnails.mjs` in the supervisor repository. Babel, the gallery
and the Mandelbulb have pages of their own; they show the same card
(`src/welcome.js`), whose stops open the tour at that place.

Every world has the app's explorer (the gallery has none in either): one
point, set by clicking the picture, typing or the arrow keys, the verdict on
it, a table of steps, and the chosen step worked out. The engine shows a
world's `explorer`, which has the same fields as the app's `WorldExplorer`;
each world's report is carried over from its Swift file. The Mandelbulb's
explorer is its page's own.

Every world has a ride. Six find their own way and never repeat: the
Mandelbrot set dives into its border, the Menger sponge is flown through by
its tunnels, the Lorenz attractor is ridden along its path, spherical space
and the hyperbolic room are wandered through on foot, and the Escher stairs
are climbed, doors and all (`?ride=7` gives the same route every time). In
the other worlds the ride goes round the sights, one after another, with
settings for the pace and the pause at each. When a picture comes to rest, the
sharper drawing of it fades in over the rough one in a quarter of a second.

## Checks

The site itself still needs no dependencies or build step. Development checks
use Node.js 22 or newer:

```bash
npm test
```

This covers every world's tour states and scene serialization, malformed input,
playback, formula evaluation rules, graphics recovery and XR startup cleanup.
It also runs the Swift/JavaScript Babel reference vectors.

The Chromium browser suite covers all world pages, tours, the welcome and
rides to sights, sharing, the phone reader, empty shelves, keyboard navigation,
bookmarks and actual WebGL context loss/restoration. It takes about a minute
and is run on your own machine, not on GitHub. Once:

```bash
npm ci
npx playwright install chromium
```

Then, before pushing, everything together:

```bash
npm run check
```

`npm run hooks` switches on a pre-push hook that does this for you on every
push (`git push --no-verify` skips it once). A push to GitHub runs only
`npm test`, which takes a few seconds and installs nothing, and then
publishes; so a push that skips the local check can publish a page the browser
tests would have caught.

## Mandelbulb

`mandelbulb.html` has the orbit explorer as well as the tour; `?explorer=1` opens
in it.

| Web | Native |
| --- | --- |
| `src/shaders.js` | `Renderer/Shaders/Mandelbulb.metal` |
| `src/math.js` | `Model/MandelbulbParameters.swift` |
| `src/model.js` | `Model/MandelbulbModel.swift` |
| `src/tour.js` | `Model/MandelbulbTour.swift` |
| `src/renderer.js` | `Renderer/MandelbulbMetalView.swift` |
| `src/xr.js` | `Immersive/` |
| `src/main.js`, `style.css` | `App/` views |

The shader's field and shading functions are a line-for-line translation of the
Metal source, and the tour text is copied from the Swift file. A change to either
native file needs the same change here.

## Immersive mode

On a browser with WebXR (Safari on Apple Vision Pro, the Meta Quest browser), the
Mandelbulb's control panel shows **Enter immersive space**. It places the Mandelbulb about
1.45 m ahead at sculpture scale. Pinch and move one hand to rotate; hold two
pinches and change their separation to resize.

This path has not yet been run on a headset. Its resolution scale, ray-step budget
and gesture gains in `src/xr.js` are first guesses that need tuning on a device.
Compared with the native visionOS renderer it has no passthrough, no eye-tracked
foveation and no in-space control window.

## Library of Babel

`babel.html` is the Library of Babel world: the same galleries, books and addresses
as the app. Whatever follows `#` in the address is the place on screen, in the code
the app's address bar takes, with where you stand added after `~`:

```
babel.html#borges:7K2M-9QXD:2.4.17.112~0.00,1.77,0,-3
```

so a copied link opens the same room, book, page and view anywhere. `?tourStep=N`
(0 to 10) opens on a tour stop.

| Web | Native |
| --- | --- |
| `src/babel/library.js` | `Worlds/Babel/BabelLibrary.swift`, `BabelAddress.swift` |
| `src/babel/world.js` | `Worlds/Babel/BabelWorld.swift` |
| `src/babel/shader.js` | `Worlds/Shaders/Babel.metal` and the `BabelRoom` headers, by `make-shaders.py` |
| `src/babel/main.js`, `tour.js` | `Worlds/Babel/BabelViews.swift` and the shared world screen |

The two versions must produce the same book for the same address. `node
babel-test.mjs` checks the JavaScript against `babel-vectors.txt`, a list of
addresses with the answers the Swift version gives.

## Art gallery

`gallery.html` is the art gallery world: the library's rooms hung with pictures that
are worked out from a scheme and the place each frame hangs, a different scheme on
every floor. The address after `#` is `design:column,row,floor:wall.picture`, as in
the app, with where you stand after `~`:

```
gallery.html#g8.w6.v3.s2:0,0,5:2.1
gallery.html#=xy*4*s:0,0,9
```

`src/gallery/logic.js` is `Worlds/Gallery/GalleryWorld.swift`, and
`src/gallery/shader.js` is `Worlds/Shaders/Gallery.metal`.

## The other worlds

| Page | World | Web | Native |
| --- | --- | --- | --- |
| `menger.html` | Menger sponge | `src/worlds/menger.js` | `Worlds/Menger/MengerWorld.swift` |
| `hyperbolic-plane.html` | Hyperbolic plane | `src/worlds/hyperbolic-plane.js` | `Worlds/Hyperbolic/HyperbolicPlaneWorld.swift` |
| `hyperbolic-space.html` | Hyperbolic room | `src/worlds/hyperbolic-space.js` | `Worlds/Hyperbolic/HyperbolicSpaceWorld.swift` |
| `spherical-space.html` | Spherical space | `src/worlds/spherical-space.js` | `Worlds/Spherical/SphericalSpaceWorld.swift` |
| `recursive-room.html` | Recursive room | `src/worlds/recursive-room.js` | `Worlds/Recursive/RecursiveRoomWorld.swift` |
| `escher.html` | Escher stairs | `src/worlds/escher.js` | `Worlds/Escher/EscherWorld.swift` |
| `four-d.html` | 4D slices | `src/worlds/four-d.js` | `Worlds/FourD/FourDWorld.swift` |
| `quaternion-julia.html` | Quaternion Julia set | `src/worlds/quaternion-julia.js` | `Worlds/FourD/QuaternionJuliaWorld.swift` |
| `topology.html` | One-sided surfaces | `src/worlds/topology.js` | `Worlds/Topology/TopologyWorld.swift` |
| `eversion.html` | Sphere eversion | `src/worlds/eversion.js` | `Worlds/Eversion/EversionWorld.swift` |
| `attractors.html` | Strange attractors | `src/worlds/attractors.js` | `Worlds/Dynamics/AttractorWorld.swift` |
| `lorentz.html` | Near the speed of light | `src/worlds/lorentz.js` | `Worlds/Relativity/LorentzWorld.swift` |
| `geodesics.html` | Geodesics | `src/worlds/geodesics.js` | `Worlds/Geodesics/GeodesicWorld.swift` |
| `knots.html` | Knots | `src/worlds/knots.js` | `Worlds/Knots/KnotWorld.swift` |

The library's **2D worlds** card opens a second shelf, `flat.html`, of flat pictures
that are dragged to pan, scrolled or pinched to zoom about the pointer, and
double-clicked to dive into. Their panels lead back to the shelf.

| Page | World | Web | Native |
| --- | --- | --- | --- |
| `mandelbrot.html` | Mandelbrot and Julia sets | `src/worlds/mandelbrot.js` | `Worlds/Flat/MandelbrotWorld.swift` |
| `logistic.html` | Logistic map | `src/worlds/logistic.js` | `Worlds/Flat/LogisticWorld.swift` |
| `newton.html` | Newton's method | `src/worlds/newton.js` | `Worlds/Flat/NewtonWorld.swift` |
| `newton-lab.html` | Newton's laboratory | `src/worlds/newton-lab.js`, `formula-program.js` | `Worlds/Flat/NewtonLabWorld.swift`, `FormulaProgram.swift` |
| `henon.html` | Hénon's attractor | `src/worlds/henon.js` | `Worlds/Flat/HenonWorld.swift` |
| `chaos-game.html` | Chaos game | `src/worlds/chaos-game.js` | `Worlds/Flat/ChaosGameWorld.swift` |
| `pendulum.html` | Magnetic pendulum | `src/worlds/pendulum.js` | `Worlds/Flat/PendulumWorld.swift` |
| `penrose.html` | Penrose tilings | `src/worlds/penrose.js` | `Worlds/Flat/PenroseWorld.swift` |
| `apollonian.html` | Apollonian gasket | `src/worlds/apollonian.js` | `Worlds/Flat/ApollonianWorld.swift` |
| `flatland.html` | Flatland | `src/worlds/flatland.js` | `Worlds/Flat/FlatlandWorld.swift` |

A flat world may also give the engine `flatCentre` (which values hold the centre of
the view, so that zooms keep their target still), `zoomTarget` (the state a
double-click or the wheel leads to), `tap`, `labels` (lettering over the picture,
such as the numbers along the logistic map's axes) and `urlDigits`. A world may also give
`shaderData`, a longer table of numbers that reaches its shader as a float texture
(`wData`); the Mandelbrot set uses it for the reference orbit that lets it zoom
past a shader's seven digits. Newton's laboratory uses it for the program its typed
formula is read into, and `extend`, which lets a world add furniture of its own to
the control panel, for the box the formula is typed in. Beyond 10¹²× its centre and that orbit are kept in
double-double arithmetic (`src/worlds/wide.js`, about 32 digits; `flatCentreLow`
names the values holding the small halves), which reaches 10²⁶×. The later four set
`flatFocus` instead and pan and zoom with the camera's own focus and distance, looking
straight down, so that a fragment shader and the line renderer agree on places. They share
`src/worlds/flat-support.js`.

These all run on `src/worlds/engine.js`, which is `Worlds/Core` for the web: the
state and its thirty-two numbers, keyframed tours, the control panel built from a
world's control groups, the orbit camera, and the renderers for glowing lines and
triangle meshes. A world is one module exporting an object with the same fields as
the app's `World`, translated by hand from its Swift file; the tour's words are
copied. A change to a Swift world needs the same change in its module. The
explorers and the immersive mode are not part of the web version.

What follows `#` is the scene, written as the numbers that differ from the
world's defaults: `v` the world's own values, `c` the camera's yaw, pitch and
distance, `f` the point it orbits and `p` the colour scheme:

```
menger.html#v=5,0,1&c=0.785398,-0.6155,3.3&p=2
```

## Shaders

Apart from the Mandelbulb, every world is drawn by the same shader code in the app
and here. The Metal files are the source, and

```bash
python3 shared/make-shaders.py
```

run from the supervisor repository that holds the app and this repository side by
side, rewrites `src/babel/shader.js`, `src/gallery/shader.js` and the files in
`src/worlds/shaders/` from them. Run it after changing any `.metal` file or header
in `Worlds/Shaders`. The shaders for lines and meshes (`WorldLines.metal`,
`WorldMesh.metal`) are small and written out by hand in `src/worlds/engine.js`.

## Licence

MIT; see [LICENSE](LICENSE).
