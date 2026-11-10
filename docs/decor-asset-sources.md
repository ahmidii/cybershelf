# Decoration catalogue sources

The starter catalogue contains **100 curated decorations** rendered from real
CC0 models by **Kenney** and **Kay Lousberg**. These are static, transparent WebP
images with small thumbnails. The website does not need Blender, a 3D renderer,
third-party search credentials, or a live connection to the source websites to
display them.

## Original packs

All packs below were obtained from the creators' official free download flows
on 10 November 2026. Each source archive includes an original CC0 license file.
Those license files are retained in `public/decor-catalogue/licenses/`.

| Pack | Creator | Original source | Archive SHA-256 |
| --- | --- | --- | --- |
| Furniture Kit 2.0 | Kenney | <https://kenney.nl/assets/furniture-kit> | `e67652d0932cee41683f74711c03d3e192a2af9979ef8e6b237711f5482d46b0` |
| Toy Car Kit 1.2 | Kenney | <https://kenney.nl/assets/toy-car-kit> | `26c11bbb77102b8dd00cdaf7b2c7ab692416d750dd064de886d809acec346782` |
| Holiday Kit 2.0 | Kenney | <https://kenney.nl/assets/holiday-kit> | `fde4d514d7297388d98058e8933ff614e071886f7ce57f9aea4b00d7698dd769` |
| Food Kit 2.0 | Kenney | <https://kenney.nl/assets/food-kit> | `cdad90853682499b94c9fda2f87678b24bfd8f3264e0ed323f6b6a27fd7c6f6f` |
| Cube Pets 2.0 | Kenney | <https://kenney.nl/assets/cube-pets> | `b3bdc99a2ec92c687b875718c5d01e9231d2711ed0e2845f295b474bb42a1283` |
| Space Kit 2.0 | Kenney | <https://kenney.nl/assets/space-kit> | `d5d7cdf2635ed5a43a9187deaf409b6f47484e402321128341d3c3698e9ef4d9` |
| Furniture Bits 1.0 — Free | Kay Lousberg | <https://kaylousberg.itch.io/furniture-bits> | `e6d75f34c5545486b5a8f45f86209dbd49092f3e77ae23011bdb87edab89e7e4` |

The Furniture Kit page's update label and the version in the downloaded archive
can differ. The versions above follow each archive's included license file.
No paid KayKit EXTRA or SOURCE files are included.

License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
The prepared render images and thumbnails are also made available under CC0.
Creator/source credit is retained voluntarily; no creator endorsement is implied.

## Preparation and provenance

`scripts/render-decor-catalogue.py` contains the exact curated model list, titles,
search tags, categories, and suggested display sizes. It imports the original
glTF/GLB models and textures into Blender, frames each object using an
orthographic camera, and renders it against transparency with a consistent
lighting setup. It then crops empty alpha edges and creates full-size WebP
images and 160-pixel thumbnails. Model geometry and original textures are
retained; no generative image model is used.

`public/decor-catalogue/provenance.json` records the source model path and hash,
the source archive hash, the creator and source URL, and the prepared image
hash for every item. `lib/decor-catalogue.ts` is the typed, application-facing
catalogue generated from the same list.

The curated categories are plants, figures, toys, objects, seasonal, and food.
Food objects are miniature decorative representations. The millimetre sizes
are suggested sizes for arranging a digital shelf; they are **not measurements
of real products**. The image width and height are pixel dimensions of the
cropped raster. Each image has a centered horizontal anchor and an anchor at
its bottom edge, so it can rest on a shelf or another supporting item.

## Rebuilding

Requirements: Blender 4.3 or later; Python 3 and Pillow for final image encoding.
Blender and Pillow are offline development tools, not application dependencies.

1. Download the free archives using each official source page.
2. Save the archives in one directory with these names:
   `furniture-kit.zip`, `toy-car-kit.zip`, `holiday-kit.zip`, `food-kit.zip`,
   `cube-pets.zip`, `space-kit.zip`, and `kaykit-furniture.zip`.
3. Extract each archive into a directory with its corresponding name, omitting
   `.zip`. Preserve the internal folder structure.
4. Run the renderer from the repository root:

```sh
blender --background --python scripts/render-decor-catalogue.py -- \
  --source-root /absolute/path/to/packs \
  --output /absolute/path/to/raw-renders

python3 scripts/render-decor-catalogue.py --finish \
  --source-root /absolute/path/to/packs \
  --output /absolute/path/to/raw-renders
```

For a small visual review batch, pass `--ids` with comma-separated catalogue
IDs. `--skip-existing` resumes an interrupted render batch. The finish step
requires the complete set of rendered images. With `--finish --skip-existing`,
already encoded images newer than their raw render are reused while metadata
is regenerated; omit this flag for a complete clean re-encode.

The script checks the archive hashes and original CC0 license files before
rendering. If a creator updates a pack, review the new archive and its license
before changing a recorded hash. Rebuilds on different Blender versions or
rendering hardware may produce different pixels and image hashes; the source
model and archive hashes identify the original inputs.

## Adding sources later

Keep creator, source URL, license, and transformation history alongside every
new item. A third-party search result is not by itself permission to redistribute
the image. Future Poly Pizza imports should use its authorized download/API
interfaces and verify each model's license. Future Openverse imports should
verify the original host and license before becoming reusable catalogue items.
Do not silently import restricted stock images or scrape source catalogues.

Community contributions use their own permission, moderation, and storage
records. They are not automatically covered by the CC0 licenses of this starter
collection or the MIT license of the application code.
