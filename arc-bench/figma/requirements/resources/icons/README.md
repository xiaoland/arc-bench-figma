# Figma icon library · 0.3.1

This project-local library supplies the exact SVG assets for the included Figma controls. It is not an npm package. The [manifest](manifest.json) gives stable namespace IDs, paths, hashes and native boxes. The [role map](roles.json) identifies control roles and states. The [gallery](index.html) displays every asset at its native size.

The supplied registry can embed the complete source files deterministically. The role map and gallery define the reference shapes, drawing boxes, and states. An implementation can draw equivalent glyphs using other methods.

```js
import {createIcon, iconMarkup, iconUrl} from '/resources/icons/registry.js';
moveButton.append(createIcon('editor/ToolMove'));
// The enclosing button supplies its accessible name, selected state and currentColor.
```

`createIcon(id, {label?, color?})` returns an SVG element with its native CSS box. Omit `label` for a decorative icon inside a named control. `iconMarkup(id)` returns the original SVG text for deterministic framework embedding. `iconUrl(id)` returns its file URL; an external SVG image does not inherit the enclosing HTML element's currentColor. Use an inline registry icon for controls whose color follows the selected, hover or disabled state.

For example, `editor/ToolMove` is the Toolbar icon and `editor/MenuMove` is the menu illustration. `ui/Check16` is a separate selected-option mark. Section and layer disclosure use `ui/ChevronRight16` and `ui/ChevronDown16`; the Toolbar's group arrow uses `ui/Dropdown24` in its specified trigger. A 24px asset does not become the 16px version by shrinking it.

The aliases `ui/Add24`, `ui/Close24`, `ui/Check16` and `ui/Dropdown24` reuse verified Paint, Effects, Editor and Layout assets. Existing feature-local names remain aliases for their namespaced IDs. Loading an icon does not define its button arrangement or interaction.

Shape/vector layer thumbnails follow current geometry. The Outline assets are examples. Paint swatches, Style previews, alignment diagrams, Scale anchors, checkboxes and selection handles have dynamic state or content; their owners define them. They are not substitutes for fixed control glyphs.

The [implementation guide](../../technical.md) describes example staging at `/resources/` for an application that uses the library.
