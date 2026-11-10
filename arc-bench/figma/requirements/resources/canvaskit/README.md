# Optional CanvasKit runtime

Pinned dependency: `canvaskit-wasm` **0.42.0**, `bin/full` build, BSD-3-Clause. The [manifest](manifest.json) records the npm package integrity and file hashes. The complete [license](LICENSE.txt) and [API declarations](api.d.ts) accompany the runtime.

```js
import {loadCanvasKit} from '/resources/canvaskit/init.js';
const CanvasKit = await loadCanvasKit();
const surface = CanvasKit.MakeCanvasSurface(canvasElement);
```

The loader uses the local JS and WASM. Wait for this Promise and required font bytes before measuring or drawing text. Use the bundled fonts, including Noto Sans SC for Chinese glyphs. WASM objects own memory; release Paint, Path, Paragraph, font and surface objects when their owner no longer needs them.

For this version, an explicitly named `TypefaceFontProvider` is passed to `ParagraphBuilder.MakeFromFontProvider`, not `ParagraphBuilder.Make` (which takes a `FontMgr`). Construct `new CanvasKit.ParagraphStyle(...)` to supply the required style defaults:

```js
const fonts = CanvasKit.TypefaceFontProvider.Make();
fonts.registerFont(interBytes, 'Inter');
fonts.registerFont(chineseBytes, 'Noto Sans SC');
const style = new CanvasKit.ParagraphStyle({
  textStyle: {fontFamilies: ['Inter', 'Noto Sans SC'], fontSize: 16, color: CanvasKit.BLACK}
});
const builder = CanvasKit.ParagraphBuilder.MakeFromFontProvider(style, fonts);
```

CanvasKit supplies drawing and text shaping. The [implementation guide](../../technical.md) illustrates how a renderer can work with an editable document, layout, input sessions, hit tests, history, persistence and export.

Official documentation: [CanvasKit](https://docs.skia.org/docs/user/modules/canvaskit/) and [Quickstart](https://skia.org/docs/user/modules/quickstart/). The examples may use older versions; the bundled API declarations identify this version's API.
