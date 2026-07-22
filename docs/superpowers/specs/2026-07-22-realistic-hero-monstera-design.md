# Realistic Hero Monstera Design

## Goal

Replace the current geometric monstera SVG with one realistic, filled botanical illustration that matches the supplied dark-green reference and the Muy Rico visual system. The decoration must support the editorial hero without competing with the conchas photograph.

## Approved Direction

Create a transparent SVG illustration rather than importing the supplied raster image. The leaf will have:

- A natural, slightly asymmetrical silhouette with deeper lobes
- Realistic fenestration cutouts that reveal the surface behind the asset
- Layered forest-green and muted sage-green fills for depth
- A central petiole and varied vein detail
- A restrained hand-drawn quality that fits the existing botanical accents
- No white, checkerboard, or opaque rectangular background

The illustration will use the existing site palette instead of bright or photorealistic colors. It remains decorative, not content-bearing, so it continues to use an empty `alt` attribute and `aria-hidden="true"`.

## Hero Placement

The hero decoration will be moved from the full-width `.hero` grid to the `.hero-copy` element. Because `.hero-copy` is the left grid column and already establishes a positioned containing block, the leaf can be anchored to that column's upper-right edge without covering `.hero-photo`.

Desktop behavior:

- Position the leaf absolutely within `.hero-copy`
- Keep it inside the copy column with a right inset
- Give it a bounded width so it remains an accent rather than a second hero image
- Keep `pointer-events: none` and a decorative stacking level

Responsive behavior:

- Reduce the width and inset at tablet/mobile sizes
- Keep the leaf inside `.hero-copy` after the hero stacks photo-first on mobile
- Prevent the asset from changing document flow or creating horizontal overflow

## CTA Usage

The same SVG may continue to be used by the two CTA-band botanical accents to preserve visual continuity. The CTA instances will use a lower opacity than the hero instance so the text remains primary. Their placement and crop behavior will remain unchanged unless the new silhouette creates overflow at a tested breakpoint.

## Files and Boundaries

- `monstera-leaf.svg`: replace the current simplified paths with the layered realistic illustration
- `index.html`: move the hero image element inside `.hero-copy`; keep the CTA references pointed at the shared asset
- `style.css`: scope hero positioning to `.hero-copy`, define desktop/mobile sizing, and tune CTA opacity

No JavaScript, content, navigation, or image-loading behavior needs to change.

## Acceptance Criteria

1. The hero uses one realistic filled monstera illustration with a transparent background.
2. The leaf uses forest/sage tones that belong to the Muy Rico palette.
3. Fenestrations are transparent and do not appear as hard-coded white patches.
4. At desktop widths, no part of the leaf covers or sits above the conchas hero image.
5. At mobile widths, the leaf remains inside the text column, does not overlap the photo, and does not create horizontal scrolling.
6. The CTA decorations remain subtle and do not reduce text contrast.
7. The leaf remains non-interactive and hidden from assistive technology.

## Verification

- Inspect the SVG for a transparent background and valid markup.
- Run the existing project build/check command if available.
- Serve the site locally and inspect the hero at desktop and mobile viewport widths.
- Confirm the hero photo remains unobstructed and the document has no horizontal overflow.
- Deploy the verified static asset and confirm the production HTML references the updated asset.
