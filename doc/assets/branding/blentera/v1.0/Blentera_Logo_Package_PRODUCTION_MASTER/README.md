# Blentera Logo Package — Production Master

This package is built from a single clean vector master reconstructed against the approved **Horizontal Option 4** reference. The production assets do **not** use raster tracing as final geometry.

## Master principles

- SVG masters use clean path geometry and native linear gradients.
- No embedded raster images in logo SVGs.
- No live text / external font dependency in distributed logo SVGs.
- No filters, masks, clip paths, strokes, or tracing-noise paths in master logo files.
- PNG files are exported from the same SVG masters, not independently redrawn.
- The 16 px and 32 px favicons use an optically simplified two-lobe micro-mark for better pixel clarity.
- App / PWA icons use square source canvases and dedicated maskable variants.

## Primary logo

Use `svg/blentera-horizontal-color.svg` as the default master for website headers, presentations, documents, sales material, and general brand use.

Recommended minimum displayed width: **160 px**. Below that, prefer the symbol-only mark.

## Variants

### Horizontal
- color
- ink / near-black
- black
- white

### Vertical / stacked
- color
- ink / near-black
- black
- white

### Symbol-only
- color
- ink
- black
- white

### Wordmark-only
- ink
- black
- white

### Small icons
- `favicon/favicon-micro.svg` is optically simplified for very small raster outputs.
- `favicon/favicon.svg` is the full-color scalable favicon source.
- `.ico` includes multiple raster sizes.

### App / PWA
- 1024×1024 default, dark, and tinted app-icon sources.
- 192×192 and 512×512 PWA icons.
- Dedicated 192×192 and 512×512 maskable PWA icons with an opaque background and safe-zone-aware mark size.
- Apple touch icon at 180×180.

## Core colors

- Ink: `#0E1B29`
- Blue deep: `#0758B3`
- Blue: `#2187D0`
- Cyan: `#48BCE3`
- Teal dark: `#067873`
- Teal: `#0A887A`
- Green: `#3FC78E`
- Green light: `#77DD91`

## Clear space

Keep free space around the primary lockup equal to at least **0.5× the symbol width** on all sides when practical. Do not place other text or graphics inside this area.

## Background use

- On white or very light backgrounds: color + ink wordmark.
- On dark backgrounds: white mono lockup or color symbol + white wordmark when contrast is sufficient.
- On noisy photographic backgrounds: prefer a controlled solid container or the white mono version.

## Do not

- add outlines, shadows, glows, or bevels to the logo;
- distort the symbol or wordmark independently;
- change the internal gradient relationships;
- use the full wordmark inside favicons or small app icons;
- pre-round Apple app-icon source files; the platform applies final masking.

## QA

See `qa/` for:
- approved reference vs. production master;
- 4096 px edge inspection;
- favicon size review;
- cross-renderer verification;
- machine-readable QA report.

## Technical references used for packaging decisions

- W3C SVG 2: https://www.w3.org/TR/SVG/
- Apple Human Interface Guidelines — App icons: https://developer.apple.com/design/human-interface-guidelines/app-icons/
- MDN — Define your app icons: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons
- MDN — Web app manifest icons: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons

## Font note

No font software is included in this package. The distributed wordmark is converted to vector outlines and has no runtime font dependency.
