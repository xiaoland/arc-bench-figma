# Fonts

These bundled faces provide reproducible font metrics. The editor starts with Inter and offers Noto Sans as a second family. Both families have regular and italic faces across weights 100–900. Noto Sans SC provides a Chinese fallback with normal weights 100–900.

| Weight | Inter style | Noto Sans style |
|---|---|---|
| 100 | Thin | Thin |
| 200 | Extra Light | ExtraLight |
| 300 | Light | Light |
| 400 | Regular | Regular |
| 500 | Medium | Medium |
| 600 | Semi Bold | SemiBold |
| 700 | Bold | Bold |
| 800 | Extra Bold | ExtraBold |
| 900 | Black | Black |

Each weight also has an italic face. Its style name adds `Italic`; weight 400 uses `Italic` alone. Use the regular optical size for Inter and the normal width for Noto Sans. These assets support ordinary named font styles; variable-axis controls are outside this scope.

[fonts.css](fonts.css) supplies ready-to-use family, weight, and italic mappings. Other loading methods can use the same files. Text layout, drawing, and editing use the selected face's actual metrics. Historical screenshots can use different font versions. A screenshot's measured width is a reference under its stated font conditions.

| Family | Pinned source | License |
|---|---|---|
| Inter 4.1 | [Inter release](https://github.com/rsms/inter/releases/tag/v4.1) | [SIL OFL 1.1](Inter-LICENSE.txt) |
| Noto Sans 2.015 | [Google Fonts source](https://github.com/google/fonts/tree/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notosans) | [SIL OFL 1.1](NotoSans-LICENSE.txt) |
| Noto Sans SC | [Pinned Google Fonts source](https://github.com/google/fonts/tree/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notosanssc) | [SIL OFL 1.1](NotoSansSC-LICENSE.txt) |

[Manifest](manifest.json) records each upstream file URL and SHA256. Files retain their upstream contents and licenses. With the example CanvasKit and HTML input setup, register the same face names and use the same fallback order in the font provider and CSS. Historical screenshots retain their original font conditions.
