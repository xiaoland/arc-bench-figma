# Position icon resources

These SVGs are reusable references with native 24 × 24 CSS-pixel drawing boxes. The SVGs inherit currentColor from the control.

| Resource | Control |
|---|---|
| [AlignLeft](AlignLeft.svg) | Align left |
| [AlignHorizontalCenters](AlignHorizontalCenters.svg) | Align horizontal centers |
| [AlignRight](AlignRight.svg) | Align right |
| [AlignTop](AlignTop.svg) | Align top |
| [AlignVerticalCenters](AlignVerticalCenters.svg) | Align vertical centers |
| [AlignBottom](AlignBottom.svg) | Align bottom |
| [RotateRight90](RotateRight90.svg) | Rotate 90˚ right |
| [FlipHorizontal](FlipHorizontal.svg) | Flip horizontal |
| [FlipVertical](FlipVertical.svg) | Flip vertical |
| [PositionMore](PositionMore.svg) | PositionMore |
| [Rotation](Rotation.svg) | Rotation |
| [Constraints](Constraints.svg) | Expand or collapse Constraints |
| [ConstraintHorizontal](ConstraintHorizontal.svg) | Horizontal constraint prefix |
| [ConstraintVertical](ConstraintVertical.svg) | Vertical constraint prefix |

X and Y are text prefixes. PositionMore is the observed menu trigger beside alignment. [Manifest](manifest.json).

The opening button combines one horizontal state and one vertical state in the same 24 × 24 box. Overlay or inline the two supplied SVGs. Each file contains that axis's edge and center marks, including inactive marks. Keep its path geometry, transforms, round line caps, and stroke widths. Active and inactive colors use --constraint-active and --constraint-inactive.

| Horizontal mode | Resource | Vertical mode | Resource |
|---|---|---|---|
| Left | [ConstraintHorizontalLeft](ConstraintHorizontalLeft.svg) | Top | [ConstraintVerticalTop](ConstraintVerticalTop.svg) |
| Right | [ConstraintHorizontalRight](ConstraintHorizontalRight.svg) | Bottom | [ConstraintVerticalBottom](ConstraintVerticalBottom.svg) |
| Left + Right | [ConstraintHorizontalBoth](ConstraintHorizontalBoth.svg) | Top + Bottom | [ConstraintVerticalBoth](ConstraintVerticalBoth.svg) |
| Center | [ConstraintHorizontalCenter](ConstraintHorizontalCenter.svg) | Center | [ConstraintVerticalCenter](ConstraintVerticalCenter.svg) |
| Scale | [ConstraintHorizontalScale](ConstraintHorizontalScale.svg) | Scale | [ConstraintVerticalScale](ConstraintVerticalScale.svg) |
| Mixed (display only) | [ConstraintHorizontalMixed](ConstraintHorizontalMixed.svg) | Mixed (display only) | [ConstraintVerticalMixed](ConstraintVerticalMixed.svg) |

Scale uses outward arrowheads in this button. The larger interactive diagram uses its own geometry: Scale leaves that axis's marks inactive. The two picker prefix icons stay unchanged. Constraints.svg is the earlier complete Right/Center sample; the state assets supply every current mode.

Mixed is a display state, not an assignable mode. Its button asset preserves the observed marks for that axis; the large diagram leaves that axis inactive. The two Mixed assets come from the actual button paths and computed transforms in `evidence/figma-group-membership-20261101/mixed-preview-computed.json`.

## Scale controls

| Control | Asset |
|---|---|
| Scale factor prefix | [ScaleFactor.svg](ScaleFactor.svg) |
| Close Scale controls | [ScaleClose.svg](ScaleClose.svg) |
| Scale tool in the toolbar | [ScaleTool.svg](ScaleTool.svg) |

These are complete SVGs from Figma on 2026-10-31, at native 24px. The factor glyph and toolbar glyph have different geometry. Use `layout-icons/ChevronDown.svg` for the separate preset button. The nine-point anchor is an interactive diagram, defined by Scale controls.
