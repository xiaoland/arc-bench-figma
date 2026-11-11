# Public application integration

This file defines the evaluator's public entry URL, starting data, accessible control names, and read-only document observations. The requirement tree defines the product behavior. The [fixtures](fixtures.yaml) supply starting states. The [implementation guide](technical.md) gives optional architectural and resource examples.

## Bundled runtime assets

Named glyphs and states in the product tree refer to their visible appearance. The supplied SVG library provides references and reusable assets. The application may draw equivalent glyphs using any method. The [icon catalogue](resources/icons/README.md) shows the shapes, box sizes and roles.

## Observable editor and output

A user edits and selects objects through the design viewport. Layers and the Design panel reflect those edits. Selection, hit tests, drawing and exports agree on current geometry, order, clipping and appearance. The evaluator observes the viewport, visible controls, editable document semantics and actual downloads. Rendering libraries, source asset formats and internal storage are implementation choices.

## Launch and starting states

The application provides one entry URL at its assigned host and port. It accepts `arc_seed=<seed name>` and `arc_workset=<workset identifier>`. The default seed is `blank`.

The first open of a workset creates its selected seed document. Different worksets have separate edits and saved documents. Reopen of the same workset restores its saved state. In the read-only observation, continuing layers use the same observed IDs across reopen. Replacement behavior, such as clipboard reconstruction or Detach, follows its product requirement.

Initialization creates pages and the object tree, geometry, text, appearance, layout, Style links, component sources, overrides, and resources. It then clears selection and history and opens the specified page. Within one parent, `objects` array order is back to front; `siblingIndex` starts at zero. Names are public aliases. The application assigns internal IDs.

The baseline content viewport is 1440 by 900 CSS pixels at DPR 1, en-US, and Asia/Shanghai. The canvas viewport uses the space allocated by editor layout. The document canvas can extend freely. Initial Zoom is 100%, pan is zero, and the document origin maps to the canvas viewport's top-left. Later UI operations change this view. Requirements and fixtures define the font conditions.

## Accessible controls

Controls have English accessible names. The mappings below support the evaluation interface. An equivalent fixed mapping can use the same user path.

| UI target | Meaning |
|---|---|
| `region: Design canvas` | The current visible canvas viewport. Coordinates are relative to its current top-left. Its bounds follow panel and window changes. |
| `separator: Left panel resize` / `Right panel resize` | The inner width-adjustment edges of the side panels. |
| `testId: layer:<global alias>` | A Layers row. `aria-selected` indicates selection. Aliases distinguish same-name descendants inside instances. |
| `testId: layer-name:<alias>` | The row's name label. A double-click starts rename. Commit updates the alias. |
| `textbox: Layer name` | The inline rename field. Enter commits and exits. |
| `testId: asset:<component name>` | A component entry in Assets. |
| `region: Pages` | The page list, which scopes page-row selection. |
| `tab: <page name>` | A page row. The current page has `aria-selected=true`. Click selects; double-click starts rename. |
| `textbox: Page name` | The inline page-name field. Enter commits and exits. |
| `button: Zoom options` / `textbox: Zoom` | The percentage opens the menu and its numeric input. Enter commits. The closed entry shows the visible zoom. |
| `textbox: X/Y/Width/Height/Fill` | Applicable properties for the selection. Enter commits. Hex colors use uppercase values without `#`. |
| `textbox: Text editor` | Text content input. Enter on a selected text layer starts text edit; the Layers name entry renames separately. |
| `button/option/menuitem/checkbox` | Tools, menu choices, options, and switches with the names used in the product scenarios. |
| `status: Save status` | The current save state, with `Saved` after completion. |
| `status: Selection count` | The number of selected layers. |

Each canvas action uses the current Design canvas screen bounds. Client coordinates first subtract its top-left, then use the current view transform. Canvas navigation gestures update `document.view`. Design canvas exposes the visible viewport bounds.

Image and SVG import use the browser file picker. Export produces browser downloads.

| Control group | Fixed names |
|---|---|
| Creation and navigation | `Move`, `Frame`, `Rectangle`, `Text`, `Section`, `Add page`, `Assets`, `Place image`, `Replace image`, `Create component` |
| Design controls | `Align left`, `Fill preview`, `Fill type`, `Close fill editor`, `Image mode`, `Add stroke`, `Stroke alignment`, `Add effect`, `Drop shadow`, `Font style`, `Text resizing`, `Horizontal constraint`, `Horizontal sizing`, `Vertical sizing`, `Layout direction`, `Layout alignment`, `Flow`, `Wrap`, `Toggle automatic positioning`, `Grid settings` |
| Style and instance controls | `Local styles`, `Create style`, `Create style confirm`, `Close style editor`, `Fill style`, `Fill style picker`, `Fill style actions`, `Text style`, `Text style picker`, `Text style actions`, `Instance actions` |
| Component definition editing | `Edit component property <property name>` opens that main component's property definition; `Component property default` identifies its current default-value input. These differ from an instance's exposed value input. |
| Export controls | `Add export`, `Export format`, `Export <selected layer name>` |
| Property fields | `X`, `Y`, `Width`, `Height`, `Fill`, `Opacity`, `Corner radius`, `Stroke color`, `Stroke width`, `Font size`, `Line height`, `Gap`, `Horizontal padding`, `Vertical padding`, `Gradient start color`, `Gradient end color`, `Shadow X`, `Shadow Y`, `Shadow blur`, `Shadow spread`, `Shadow opacity`, `Style name`, `Style color`, `Style font size`, `Export scale`, `Column span`, `Row span`, `Number of columns`, `Number of rows` |
| Checkboxes | `Visible`, `Locked`, `Ignore auto layout`; component Boolean properties use their own names. |
| Menu entries | `Group selection`, `Ungroup`, `Wrap in new section`, `Bring to front`, `Detach instance`, `Reset instance`, `Detach style` |
| Options | `Auto height`, `Auto width`, `Fixed size`, `Fill`, `Fit`, `Crop`, `Linear`, `Inside`, `Right`, `Left and right`, `Fill container`, `Hug contents`, `Freeform`, `Vertical`, `Horizontal`, `Grid`, `Center`, `Semi Bold`, `PNG`, `SVG` |

Object, Style, property, variant, and page names come from the current document.

## Read-only document observation

`window.arcBench.observe()` returns the following object or a Promise for it. The interface reads the same current state as the UI. The application can choose its internal structure.

```ts
{
  schemaVersion: 1,
  document: {
    id: string, worksetId: string, seed: string, name?: string,
    pages: { id: string, name: string }[], currentPageId: string,
    pageNames?: string[], currentPageName?: string,
    view?: { panX?: number, panY?: number, zoom?: number }
  },
  selectionIds: string[],
  objects: {
    id: string, type: string, name?: string, pageId: string,
    parentId: string | null, siblingIndex: number,
    geometry: { x: number, y: number, width: number, height: number },
    pageName?: string, visible: boolean, locked: boolean, selected: boolean,
    text?: string,
    textRuns?: { start: number, end: number, fontStyle?: string, fill?: string,
                 font?: { family?: string, style?: string, size?: number, lineHeight?: number | "auto" | { unit: "percent", value: number } },
                 styleSourceId?: string, styleSourceName?: string }[],
    textSizing?: "fixed" | "auto-height" | "auto-width",
    font?: { family?: string, style?: string, size?: number, lineHeight?: number | "auto" | { unit: "percent", value: number } },
    fill?: { color: string, opacity: number }, opacity?: number,
    cornerRadius?: number | Record<string, number>,
    stroke?: {
      color?: string, opacity?: number, visible?: boolean,
      paints?: { color: string, opacity: number, visible: boolean }[],
      width?: number, alignment?: string,
      sideWidths?: { left: number, top: number, right: number, bottom: number },
      style?: "solid" | "dashed" | "custom", dashes?: number[],
      dashCap?: string, join?: string, miterAngle?: number,
      startPoint?: string, endPoint?: string
    },
    shadow?: { x: number, y: number, blur: number, spread: number, color: string, opacity: number },
    gradient?: { type: string, stops: { position: number, color: string, opacity: number }[] },
    image?: { mode: "fill" | "fit" | "crop", sourceWidth: number, sourceHeight: number,
              cropOffsetX?: number, cropOffsetY?: number,
              cropWidth?: number, cropHeight?: number, cropRotation?: number },
    vector?: { pathCount: number },
    layout?: { width?: string, height?: string, ignore?: boolean, [key: string]: unknown },
    constraints?: { horizontal?: string, vertical?: string },
    component?: { sourceId: string, variant?: Record<string, string>,
                  properties?: Record<string, string | boolean> },
    styles?: { fillSourceId?: string, fillSourceName?: string,
               strokeSourceId?: string, strokeSourceName?: string, textSourceId?: string, textSourceName?: string }
  }[]
}
```

`document.worksetId` and `seed` match the launch input. `pages` keeps page order, with names corresponding to IDs. `selectionIds` matches each object's `selected` value. Objects describe editable document layers. `parentId` and source IDs refer to actual layer identities.

Types include `frame`, `rectangle`, `ellipse`, `line`, `arrow`, `text`, `group`, `section`, `vector`, `component`, and `instance`. Group bounds follow members. Section uses an explicit region. Group/Ungroup and Section removal keep continuing members as specified.

`geometry.x/y` is relative to the direct parent, or the page for a top-level layer. Dimensions are effective post-layout dimensions. Design can display a different coordinate basis, such as page coordinates for top-level Group members. Both representations resolve to the same canvas position.

`view.zoom` is a ratio. Colors use uppercase RGB hex without `#`. Opacity is 0 to 1; UI percentages are separate display values.

`textRuns` uses half-open character ranges `[start,end)` for resolved font values, Fill, and Text Style bindings. A range can carry its Style source ID and name; a local range has resolved formatting without that binding. A uniform layer binding can use `styles.textSourceId/textSourceName`. Mixed bindings remain distinguishable by range. `textSizing` is `fixed`, `auto-height`, or `auto-width`. `font.lineHeight` is a pixel number, `auto`, or `{ unit: "percent", value: number }`. The percentage remains a percentage when font size changes.

`layout.width/height` is `fixed`, `hug`, or `fill`. `ignore` marks a child outside automatic flow. Constraints uses values such as `left`, `right`, and `left-right` for the applicable axis. Fixtures specify the other layout fields.

`stroke.paints` follows the Stroke row order. A single-paint stroke can also expose its color, opacity, and visibility directly. Shared stroke fields describe the contour for all paints. Side widths and dash/gap lengths use document units.

Gradient positions are 0 to 1; the editor shows percentages from 0% to 100%. Shadow values use local geometry units. Image `sourceWidth/sourceHeight` is the source pixel size. `cropOffsetX/Y` is the image center's displacement from the host center, in host-local units. `cropWidth/Height` is the rendered image size before its crop rotation; `cropRotation` is its rotation relative to the host, in degrees. An untransformed Fill can omit these crop fields and use its centered cover size. Layer geometry describes the clipping bounds independently. Applying an image transform retains mode `crop`. `vector.pathCount` is the number of vector paths.

Component source IDs, variant values, and named properties describe the current links and overrides. Style IDs and names describe actual bindings. Optional fields appear for layers with those properties. Visible behavior, continued edits, and exported files remain independent observations of the product result.

## Visual reference input

The generation pack includes local images referenced by descriptions. Captions state their interface information. `pages` declares the same references. PNG/JPEG key states show layouts and interaction feedback. Reference adaptations identify the included controls; original evidence retains the source screen. Expanded leaf descriptions carry applicable shared references.

A visual consumer decodes the supplied formats and records the images or animation frames actually sent to its model. A text consumer reads the layout and control descriptions. Image availability and actual image input are separate facts.
