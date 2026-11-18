# Implementation guidance

This guide gives the Factory a concrete starting point for implementation. The requirement tree defines product behavior. [Public integration](integration.md) defines the launch and observation interface. The evaluator checks visible behavior, editing results, and exported files. It accepts any implementation that produces those results.

## Optional resources and runtime

The pack supplies a Figma icon reference library, CanvasKit/Skia WASM 0.42.0, Inter and Noto Sans fonts, and their licenses. The icon role map identifies the reference glyphs, states and drawing boxes. The files can be used directly when they fit the chosen implementation. See the [resource inventory](resources/runtime-manifest.json) and [icon role map](resources/icons/roles.json).

For the example Node web layout, the optional stager accepts the path to the application root. Set `ARC_PACK_RESOURCES` to the pack's `requirements/resources` directory when using this route.

```sh
node "$ARC_PACK_RESOURCES/stage-assets.cjs" <application-root>
```

The stager verifies the listed bytes and copies them into `frontend/public/resources` and `frontend/dist/resources`. An application using these files can retain its public copy for later builds. The [registry](resources/icons/README.md) and [CanvasKit loader](resources/canvaskit/README.md) document the example entrypoints.

## Document and effective scene

Keep the editable document independent of DOM nodes and render objects. Pages, layers, definitions and imported resources have stable identities. A layer has a page ID, a direct layer parent, an ordered position, content, local geometry and applicable appearance, layout and source properties. A top-level layer has a parent of `null`.

Store source references and local overrides explicitly. Resolve Component and Style values per property or character range when the source or override changes.

```text
editable document + definitions + resources
                 |
       resolve source / overrides
                 |
    layout and shared text measurement
                 |
           effective scene
       /         |          \
    draw      hit/select    PNG / SVG
```

The effective scene has current geometry, order, ancestor transforms and clipping, resolved paints and shaped text. Drawing, hit tests, selection feedback, measurement and export use those same results. They may use different output backends; they do not independently reinterpret the document.

## Coordinate systems and bounds

Use explicit transforms between direct-parent local coordinates, page coordinates, viewport CSS coordinates and device pixels. Pointer coordinates subtract the current viewport origin and use the inverse view transform. DPR maps viewport CSS pixels to device pixels. Store pan and zoom in view state.

An object's local axes and its page-aligned bounds are different. A rotated object's Design X/Y use its specified page-aligned bounds, while Width/Height remain along its local axes. Group member fields use the coordinate basis outside the Group, as defined by the Group feature. Frame and Section children use their own container basis. Resolve these displays from the document's transforms; do not treat every property field as a direct local translation.

Keep geometry bounds, visual bounds, hit regions and export bounds distinguishable. A shadow can extend visible pixels without enlarging the object's geometry. Ancestor clipping affects content according to the product rule.

The document parent and geometric containment are separate facts. Parent choice follows the shared layer parent relationships (CANVAS-HIERARCHY). The operation and destination rules determine the result within those constraints. Convert between parent bases where the product preserves page position. Apply the destination layout or paste-placement rule where it defines a new position.

Validate the proposed result subtree, including cycles, before applying a structural operation. A copied subtree has its own nodes. Do not reject it solely because its source is an ancestor of the destination. Use the operation's product rules for target choice, layout-mode changes, and completion. A transient scene preview does not define the completed hierarchy.

## Rendering, text and layout

Start with a CanvasKit surface for the design viewport, alongside HTML controls and native text input. This is the recommended architecture for the current Factory. Canvas, Paint, Path and Paragraph provide drawing and text layout. CanvasKit draws the resolved scene. The application handles hit testing, input routing, tool state, and edit sessions against the current scene and viewport. With any renderer, keep selection, text layout and output aligned with the visible design. The browser environment may use the supplied Inter and Noto Sans SC fonts to reproduce the reference metrics and Chinese fallback.

If using CanvasKit, release resources when their scene, paragraph or surface owner no longer needs them. See the [bundled API declarations](resources/canvaskit/api.d.ts).

Use one layout computation for effective child position and size. Horizontal/Vertical/Wrap and Grid have the product's separate rules for participation, Hug/Fill/Fixed, tracks, spans, min/max, gap, padding and alignment. Frame resize, text changes, source changes and property edits recompute affected layout before drawing and hit testing. A CSS/Flexbox library can assist but does not define Figma Grid or sizing semantics.

## Interaction and history

### Canvas interaction and creation

The toolbar and canvas can share active-tool state. Resolve pointer positions against the current viewport when handling a gesture. Keep a creation draft in the interaction session and commit the new layer when the gesture completes. Use the committed layer ID for selection feedback in the canvas, Layers and Design.

### Shared interaction sessions and history

Model a continuous interaction as a session with a target, tool, starting state, pointer/modifiers and completion or cancellation. Selection, direct manipulation, temporary Hand, marquee, text edit, color drag, Crop and gradient handles use their own state transitions. Pointer capture and release preserve the intended target as the pointer leaves a control. Keyboard dispatch respects the active editor and actual IME composition.

Panels, Canvas and Layers edit the same document values. Local input drafts can remain in a control until their owner applies or cancels them. Commit one completed operation once; Enter followed by blur must not add a duplicate document edit. Selection and page history follow SAVE-01, including their defined steps. A shared history mechanism does not change each feature's commit/cancel profile.

Undo and Redo restore the document, selection and page state specified by the feature.

## Save, initialization and exports

Create a seed only on the first open of a new workset. Reopen hydrates the stored editable document, definitions, overrides, imported bytes/references and per-layer export settings; it does not replace them with seed objects. Saved appears after the relevant state is stored. Changes to an instance after reopen still propagate or remain local according to its links.

PNG and SVG are actual downloads of current selected content. They use the effective scene's geometry, order, clipping, paint/alpha and text meaning. PNG uses the product's export bounds and scale. SVG keeps the promised vector content and Outline text setting; Drawing/export can use separate backends with one resolved scene.

The read-only observation interface reflects the same document/scene as the UI. Verify the editor through visible input, continued editing after reopen and actual exported files.
