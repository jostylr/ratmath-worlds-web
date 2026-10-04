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
after `#`, so a copied link opens the same view.

## Publish it

The repository includes a GitHub Pages workflow
(`.github/workflows/pages.yml`) that publishes it on every push to `main`. After
pushing the repository to GitHub, switch it on once under
**Settings → Pages → Source: GitHub Actions**. The site then appears at
`https://<user>.github.io/<repository>/`.

All paths in the page are relative, so the folder also works unchanged on any
other static host. A headset needs the page served over `https`, which Pages
provides.

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
| `recursive-room.html` | Recursive room | `src/worlds/recursive-room.js` | `Worlds/Recursive/RecursiveRoomWorld.swift` |
| `escher.html` | Escher stairs | `src/worlds/escher.js` | `Worlds/Escher/EscherWorld.swift` |
| `four-d.html` | 4D slices | `src/worlds/four-d.js` | `Worlds/FourD/FourDWorld.swift` |
| `quaternion-julia.html` | Quaternion Julia set | `src/worlds/quaternion-julia.js` | `Worlds/FourD/QuaternionJuliaWorld.swift` |
| `topology.html` | One-sided surfaces | `src/worlds/topology.js` | `Worlds/Topology/TopologyWorld.swift` |
| `eversion.html` | Sphere eversion | `src/worlds/eversion.js` | `Worlds/Eversion/EversionWorld.swift` |
| `attractors.html` | Strange attractors | `src/worlds/attractors.js` | `Worlds/Dynamics/AttractorWorld.swift` |

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
