# RatMath Worlds on the web

The Mandelbulb experiment as a static web page: the same ray-marched object,
guided tour, control panel and orbit explorer as the native app, drawn with
WebGL 2. There is no build step and nothing to install.

## Run it

Serve this folder with any static file server and open it in a browser:

```bash
python3 -m http.server 8000 --directory web
```

Then visit <http://localhost:8000>. Opening `index.html` straight from disk does
not work, because browsers refuse to load JavaScript modules from `file://`.

`?tourStep=N` (0 to 10) opens directly on that tour stop and `?explorer=1` opens in
the orbit explorer, mirroring the native launch arguments.

## Publish it

The repository includes a GitHub Pages workflow
(`.github/workflows/pages.yml`) that publishes this folder whenever a push to
`main` changes it. After pushing the repository to GitHub, switch it on once under
**Settings → Pages → Source: GitHub Actions**. The site then appears at
`https://<user>.github.io/<repository>/`. Pages on a private repository needs a
paid GitHub plan.

All paths in the page are relative, so the folder also works unchanged on any
other static host. A headset needs the page served over `https`, which Pages
provides.

## How it maps to the native app

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
control panel shows **Enter immersive space**. It places the Mandelbulb about
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
web/babel-test.mjs` checks the JavaScript against `babel-vectors.txt`, a list of
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

## Shaders

The library and the gallery are drawn by the same code in the app and here. The
Metal files are the source, and

```bash
python3 web/make-shaders.py
```

rewrites `src/babel/shader.js` and `src/gallery/shader.js` from them. Run it after
changing `Babel.metal`, `Gallery.metal` or the `BabelRoom` headers.
