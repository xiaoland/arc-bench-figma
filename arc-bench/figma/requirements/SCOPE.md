# Minimal Figma Design scope

The first release is a single-user Figma Design editor. A user creates content in design files, reuses components and styles, maintains the design, saves it, and exports PNG or SVG files.

## Fidelity

The requirement tree defines the included behavior and interaction paths. The same focus, tool, selection level, and gesture phase act on the same target. Input, visible changes, and exit behavior follow those conditions.

Reference images specify composition, proportions, information density, text and icon hierarchy, control shapes, and feedback for the included states. Font rasterization and small drawing differences can vary with the environment while those results remain recognizable.

The editor has adjustable left and right panels, a flexible canvas viewport between them, and a floating bottom toolbar. The page canvas is a free two-dimensional space with pan and zoom.

Frames have explicit dimensions, layout, and clipping. Group bounds follow their members. Sections organize content in named regions. Constraints, nested Auto Layout, Wrap, and size modes reflow content within each design.

## Included features

| Feature | First release | Later scope |
|---|---|---|
| Files, pages, and daily edits | Separate files; multiple pages and Frames; selection; Group and Section operations; copy, cut, paste, and cross-page movement; layer order; visibility and lock; geometry; alignment; Undo/Redo; save and reopen. | Complete Home, file metadata management, collaboration, comments, version history, branches, and team permissions. |
| Canvas aids | Mouse and keyboard navigation; ordinary and deep selection; marquee; temporary distance measurements; rulers and page/Frame guides. | Dev Mode annotations and advanced inspection modes. |
| Layout | Freeform Smart selection spacing and rearrangement; ordinary Frame Constraints; nested horizontal, vertical, and Grid Auto Layout; horizontal and vertical Wrap; Grid tracks, spans, and automatic/manual cell placement; Hug, Fill, and Fixed; gap, padding, alignment, min/max, and Ignore auto layout. | Complex automatic inference, legacy engines, and breakpoint-driven navigation, visibility, or variants. |
| Components | Local main components, nested instances, source updates, overrides, Reset, Detach, variants, and Text/Boolean/Instance swap properties. | Slots, complex property exposure, published updates, and shared libraries across files. |
| Styles | Local color and text styles; create, apply, edit, propagate, and detach. Independent layers and component content can use the same definition. | Variables, aliases, Modes, and theme, language, or size token sets. |
| Text and appearance | Editable text; font metrics and wrapping; text sizing; horizontal and vertical alignment; line height; character formatting; Chinese input; solid and basic Linear fills; strokes; opacity; corners; shadows. | Advanced typesetting, materials, and professional drawing. |
| Images and icons | Local image import and replacement; Fill, Fit, and Crop; basic shapes; simple SVG import, proportional Scale, and internal Fill/Stroke edits. | Pen and vector networks, complex node edits, Boolean operations, and advanced image processing. |
| Persistence and export | Saved page, layer, layout, component, Style, override, and resource relationships; further edits after reopen; Frame PNG/SVG and icon SVG. | PDF, Slice, .fig interchange, offline synchronization, and cross-device synchronization. |

The shared color editor provides Hex, RGB, CSS, HSL, HSB, direct color adjustment, canvas sampling, and current-page color swatches. It has a Color title and Close. On this page is a fixed heading. Existing property Style controls create and apply local styles.

Prototype, FigJam, Slides, plugins, and Dev Mode remain outside this release. Their appearance in a reference image does not add their features to the scope.

## Requirement entry

The [requirement tree](requirements.yaml) groups design files, editor workspace, canvas features, local components and styles, export, and complete design tasks. Canvas is a peer of Workspace. Frame, Shape, Text, Section, and Group each have their own folder. Pages, Layers, Assets, and Design describe their interface views.

Public starting data and integration details are in requirements/. Selected official and observed images provide the corresponding visual states. Independent evaluation examines behavior, visible results, continued editing, and exported files separately.
