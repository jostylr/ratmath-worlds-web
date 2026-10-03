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
