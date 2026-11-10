#!/usr/bin/env python3
"""Reproduce Cybershelf's curated CC0 decoration renders with Blender 4.3+.

Download the free original packs listed in docs/decor-asset-sources.md, save
them as <pack-id>.zip, and extract each into <source-root>/<pack-id>/.
Run with Blender (Pillow is only needed for the separate --finish step):

  blender --background --python scripts/render-decor-catalogue.py -- \
    --source-root /path/to/packs --output /path/to/raw-renders
  python3 scripts/render-decor-catalogue.py --finish \
    --source-root /path/to/packs --output /path/to/raw-renders

This script never downloads assets or executes code supplied by asset packs.
Original model geometry/textures are rendered, not generated or redrawn.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"
PACKS = {
    "furniture-kit": {
        "title": "Kenney Furniture Kit 2.0", "creator": "Kenney",
        "sourceUrl": "https://kenney.nl/assets/furniture-kit",
        "modelDir": "Models/GLTF format", "extension": ".glb",
        "licensePath": "License.txt",
        "archiveSha256": "e67652d0932cee41683f74711c03d3e192a2af9979ef8e6b237711f5482d46b0",
    },
    "toy-car-kit": {
        "title": "Kenney Toy Car Kit", "creator": "Kenney",
        "sourceUrl": "https://kenney.nl/assets/toy-car-kit",
        "modelDir": "Models/GLB format", "extension": ".glb",
        "licensePath": "License.txt",
        "archiveSha256": "26c11bbb77102b8dd00cdaf7b2c7ab692416d750dd064de886d809acec346782",
    },
    "holiday-kit": {
        "title": "Kenney Holiday Kit", "creator": "Kenney",
        "sourceUrl": "https://kenney.nl/assets/holiday-kit",
        "modelDir": "Models/GLB format", "extension": ".glb",
        "licensePath": "License.txt",
        "archiveSha256": "fde4d514d7297388d98058e8933ff614e071886f7ce57f9aea4b00d7698dd769",
    },
    "food-kit": {
        "title": "Kenney Food Kit", "creator": "Kenney",
        "sourceUrl": "https://kenney.nl/assets/food-kit",
        "modelDir": "Models/GLB format", "extension": ".glb",
        "licensePath": "License.txt",
        "archiveSha256": "cdad90853682499b94c9fda2f87678b24bfd8f3264e0ed323f6b6a27fd7c6f6f",
    },
    "kaykit-furniture": {
        "title": "KayKit Furniture Bits 1.0 Free", "creator": "Kay Lousberg",
        "sourceUrl": "https://kaylousberg.itch.io/furniture-bits",
        "modelDir": "KayKit_Furniture_Bits_1.0_FREE/Assets/gltf", "extension": ".gltf",
        "licensePath": "KayKit_Furniture_Bits_1.0_FREE/License.txt",
        "archiveSha256": "e6d75f34c5545486b5a8f45f86209dbd49092f3e77ae23011bdb87edab89e7e4",
    },
    "cube-pets": {
        "title": "Kenney Cube Pets", "creator": "Kenney",
        "sourceUrl": "https://kenney.nl/assets/cube-pets",
        "modelDir": "Models/GLB format", "extension": ".glb",
        "licensePath": "License.txt",
        "archiveSha256": "b3bdc99a2ec92c687b875718c5d01e9231d2711ed0e2845f295b474bb42a1283",
    },
    "space-kit": {
        "title": "Kenney Space Kit", "creator": "Kenney",
        "sourceUrl": "https://kenney.nl/assets/space-kit",
        "modelDir": "Models/GLTF format", "extension": ".glb",
        "licensePath": "License.txt",
        "archiveSha256": "d5d7cdf2635ed5a43a9187deaf409b6f47484e402321128341d3c3698e9ef4d9",
    },
}

# pack, source model, title, category, suggested displayed height in mm, tags.
# Dimensions are shelf-miniature display defaults, never claims about real toys.
ITEMS = [
    ("furniture-kit", "plantSmall1", "Mini potted pine", "plants", 115, "plant pine tree potted green nature"),
    ("furniture-kit", "plantSmall2", "Small succulent", "plants", 90, "plant succulent green pot houseplant nature"),
    ("furniture-kit", "plantSmall3", "Tiny cactus", "plants", 100, "plant cactus succulent green pot desert nature"),
    ("furniture-kit", "pottedPlant", "Tall houseplant", "plants", 185, "plant tall leaf leafy green pot houseplant nature"),
    ("furniture-kit", "bear", "Bear wall ornament", "figures", 130, "bear animal ornament woodland lodge sculpture"),
    ("furniture-kit", "radio", "Retro radio", "objects", 85, "radio music retro vintage audio"),
    ("furniture-kit", "speakerSmall", "Little speaker", "objects", 95, "speaker music audio hifi"),
    ("furniture-kit", "lampRoundTable", "Round reading lamp", "objects", 145, "lamp light reading round cozy"),
    ("furniture-kit", "lampSquareTable", "Square reading lamp", "objects", 145, "lamp light reading square cozy"),
    ("furniture-kit", "books", "Little book collection", "objects", 100, "book books reading library miniature"),
    ("furniture-kit", "pillow", "Soft cushion", "objects", 65, "pillow cushion soft cozy"),
    ("furniture-kit", "pillowBlue", "Blue cushion", "objects", 65, "pillow cushion blue soft cozy"),
    ("furniture-kit", "toaster", "Mini toaster", "objects", 80, "toaster kitchen miniature breakfast retro"),
    ("furniture-kit", "laptop", "Mini laptop", "objects", 75, "laptop computer technology miniature"),
    ("furniture-kit", "televisionVintage", "Vintage television", "objects", 110, "television tv vintage retro miniature"),
    ("furniture-kit", "kitchenCoffeeMachine", "Mini coffee maker", "objects", 110, "coffee maker machine kitchen cafe miniature"),
    ("furniture-kit", "computerScreen", "Little monitor", "objects", 100, "monitor computer screen technology miniature"),
    ("kaykit-furniture", "cactus_small_A", "Round cactus", "plants", 95, "plant cactus succulent round green pot desert"),
    ("kaykit-furniture", "cactus_small_B", "Little branching cactus", "plants", 110, "plant cactus succulent branches green pot desert"),
    ("kaykit-furniture", "cactus_medium_A", "Tall cactus", "plants", 155, "plant cactus succulent tall green pot desert"),
    ("kaykit-furniture", "cactus_medium_B", "Branching cactus", "plants", 145, "plant cactus succulent branches green pot desert"),
    ("kaykit-furniture", "pictureframe_standing_A", "Standing picture frame", "objects", 130, "frame photo picture art standing"),
    ("kaykit-furniture", "pictureframe_standing_B", "Small standing frame", "objects", 110, "frame photo picture art standing small"),
    ("kaykit-furniture", "pictureframe_small_A", "Little picture frame", "objects", 125, "frame photo picture art"),
    ("kaykit-furniture", "pictureframe_small_B", "Small picture frame", "objects", 125, "frame photo picture art"),
    ("kaykit-furniture", "pictureframe_small_C", "Mini gallery frame", "objects", 125, "frame photo picture art print gallery"),
    ("kaykit-furniture", "lamp_table", "Cozy table lamp", "objects", 150, "lamp light reading cozy"),
    ("kaykit-furniture", "pillow_A", "Golden cushion", "objects", 70, "pillow cushion yellow gold soft cozy"),
    ("toy-car-kit", "vehicle-racer", "Toy racing car", "toys", 55, "car toy racer racing vehicle motorsport"),
    ("toy-car-kit", "vehicle-racer-low", "Low racing car", "toys", 45, "car toy racer racing vehicle low motorsport"),
    ("toy-car-kit", "vehicle-vintage-racer", "Vintage toy racer", "toys", 60, "car toy racer racing vintage vehicle motorsport"),
    ("toy-car-kit", "vehicle-speedster", "Toy speedster", "toys", 55, "car toy speedster racing vehicle motorsport"),
    ("toy-car-kit", "vehicle-suv", "Toy off-roader", "toys", 70, "car toy suv offroad vehicle adventure"),
    ("toy-car-kit", "vehicle-monster-truck", "Mini monster truck", "toys", 85, "truck toy monster wheels vehicle"),
    ("toy-car-kit", "vehicle-truck", "Little toy truck", "toys", 70, "truck toy vehicle transport"),
    ("toy-car-kit", "vehicle-drag-racer", "Toy drag racer", "toys", 50, "car toy drag racer racing vehicle motorsport"),
    ("holiday-kit", "lantern", "Little street lamp", "objects", 145, "lantern lamp light street cozy winter miniature"),
    ("holiday-kit", "reindeer", "Reindeer figure", "figures", 135, "animal reindeer deer figure winter christmas"),
    ("holiday-kit", "nutcracker", "Nutcracker figure", "figures", 165, "nutcracker soldier figure toy christmas winter"),
    ("holiday-kit", "snowman-hat", "Snowman in a hat", "seasonal", 140, "snowman snow winter christmas hat"),
    ("holiday-kit", "snowman", "Little snowman", "seasonal", 120, "snowman snow winter christmas"),
    ("holiday-kit", "gingerbread-man", "Gingerbread figure", "seasonal", 115, "gingerbread cookie figure christmas winter"),
    ("holiday-kit", "gingerbread-woman", "Gingerbread friend", "seasonal", 115, "gingerbread cookie figure christmas winter"),
    ("holiday-kit", "present-a-cube", "Ribbon gift box", "seasonal", 85, "present gift ribbon box birthday celebration christmas"),
    ("holiday-kit", "present-b-round", "Round gift box", "seasonal", 80, "present gift ribbon round box birthday celebration christmas"),
    ("holiday-kit", "tree-decorated", "Decorated little tree", "seasonal", 185, "tree christmas ornaments winter festive"),
    ("holiday-kit", "tree-snow-a", "Snowy little pine", "plants", 165, "tree pine forest snow winter miniature nature"),
    ("holiday-kit", "hanukkah-menorah-candles", "Hanukkah menorah", "seasonal", 140, "hanukkah menorah candles holiday celebration"),
    ("holiday-kit", "hanukkah-dreidel", "Dreidel", "seasonal", 90, "hanukkah dreidel toy holiday celebration"),
    ("holiday-kit", "kwanzaa-kinara", "Kwanzaa kinara", "seasonal", 130, "kwanzaa kinara candles holiday celebration"),
    ("holiday-kit", "train-locomotive", "Toy locomotive", "toys", 90, "train toy locomotive railway engine miniature"),
    ("holiday-kit", "train-wagon", "Toy train wagon", "toys", 70, "train toy wagon railway miniature"),
    ("holiday-kit", "sled", "Little wooden sled", "seasonal", 55, "sled winter snow wood miniature"),
    ("food-kit", "mug", "Reading mug", "food", 90, "mug cup coffee tea reading cozy drink"),
    ("food-kit", "cup-tea", "Cup of tea", "food", 65, "cup tea drink reading cozy"),
    ("food-kit", "cup-coffee", "Cup of coffee", "food", 65, "cup coffee drink reading cozy"),
    ("food-kit", "frappe", "Iced coffee", "food", 105, "frappe iced coffee drink straw cafe"),
    ("food-kit", "cupcake", "Tiny cupcake", "food", 75, "cupcake cake miniature bakery sweet dessert"),
    ("food-kit", "donut-sprinkles", "Sprinkle doughnut", "food", 55, "donut doughnut sprinkles miniature bakery sweet dessert"),
    ("food-kit", "croissant", "Little croissant", "food", 45, "croissant miniature bakery pastry breakfast"),
    ("food-kit", "cake-birthday", "Birthday cake", "food", 105, "cake birthday candles celebration dessert"),
    ("food-kit", "ice-cream", "Ice cream ornament", "food", 100, "ice cream cone miniature dessert summer"),
    ("food-kit", "rice-ball", "Rice ball miniature", "food", 65, "rice ball onigiri miniature sushi japan"),
    ("food-kit", "maki-salmon", "Salmon maki miniature", "food", 40, "maki salmon sushi miniature japan"),
    ("food-kit", "sushi-egg", "Egg sushi miniature", "food", 40, "egg sushi tamago miniature japan"),
    ("food-kit", "pumpkin", "Little pumpkin", "seasonal", 100, "pumpkin autumn fall halloween orange nature"),
    ("food-kit", "mushroom", "Little mushroom", "plants", 95, "mushroom fungi nature forest woodland cottage"),
    ("food-kit", "apple", "Apple ornament", "food", 70, "apple fruit miniature red nature"),
    ("food-kit", "pear", "Pear ornament", "food", 85, "pear fruit miniature green nature"),
    ("food-kit", "strawberry", "Strawberry ornament", "food", 65, "strawberry fruit miniature red summer"),
    ("food-kit", "pineapple", "Pineapple ornament", "food", 115, "pineapple fruit miniature tropical summer"),
    ("food-kit", "honey", "Honey pot", "food", 80, "honey pot jar bee sweet kitchen"),
    ("food-kit", "cookie-chocolate", "Chocolate cookie", "food", 35, "cookie biscuit chocolate miniature bakery sweet"),
    ("space-kit", "astronautA", "Astronaut figure", "figures", 145, "astronaut space sci-fi figure science moon explorer"),
    ("space-kit", "astronautB", "Space explorer figure", "figures", 145, "astronaut space sci-fi figure science moon explorer"),
    ("space-kit", "alien", "Little alien", "figures", 135, "alien space sci-fi figure extraterrestrial"),
    ("space-kit", "rover", "Moon rover miniature", "toys", 85, "rover moon mars space vehicle toy science"),
    ("space-kit", "craft_speederA", "Spacecraft miniature", "toys", 65, "spacecraft spaceship space sci-fi toy miniature"),
    ("space-kit", "rock_crystals", "Crystal cluster", "objects", 100, "crystal crystals gem mineral geology fantasy"),
    ("space-kit", "meteor_detailed", "Meteorite ornament", "objects", 85, "meteor meteorite rock stone geology science space"),
]

for animal, title, height in [
    ("cat", "Little cat", 100), ("dog", "Little dog", 105),
    ("bunny", "Little rabbit", 115), ("fox", "Little fox", 105),
    ("panda", "Little panda", 110), ("penguin", "Little penguin", 110),
    ("koala", "Little koala", 105), ("polar", "Little polar bear", 100),
    ("lion", "Little lion", 110), ("tiger", "Little tiger", 105),
    ("elephant", "Little elephant", 115), ("giraffe", "Little giraffe", 150),
    ("deer", "Little deer", 125), ("beaver", "Little beaver", 95),
    ("pig", "Little pig", 90), ("cow", "Little cow", 105),
    ("chick", "Little chick", 85), ("parrot", "Little parrot", 115),
    ("monkey", "Little monkey", 105), ("crab", "Little crab", 60),
]:
    ITEMS.append(("cube-pets", "animal-" + animal, title, "figures", height,
                  f"{animal} animal pet figure toy cute miniature"))


def item_id(item):
    return "dc_" + item[0].replace("-", "_") + "_" + re.sub(r"[^a-z0-9]+", "_", item[1].lower())


def model_path(item, source_root):
    pack = PACKS[item[0]]
    return source_root / item[0] / pack["modelDir"] / (item[1] + pack["extension"])


def validate_sources(source_root):
    for pack_id, pack in PACKS.items():
        archive = source_root / (pack_id + ".zip")
        if not archive.is_file():
            raise RuntimeError(f"Missing original archive: {archive}")
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        if digest != pack["archiveSha256"]:
            raise RuntimeError(f"Source archive changed for {pack_id}; review its contents and license before updating the recorded checksum.")
        text = (source_root / pack_id / pack["licensePath"]).read_text()
        if "Creative Commons Zero" not in text or "CC0" not in text:
            raise RuntimeError(f"Expected original CC0 license for {pack_id}")
    for item in ITEMS:
        if not model_path(item, source_root).is_file():
            raise RuntimeError(f"Missing source model: {model_path(item, source_root)}")


def render(item, source_root, output):
    import bpy
    from mathutils import Vector
    from bpy_extras.object_utils import world_to_camera_view

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(model_path(item, source_root)))
    scene = bpy.context.scene
    scene.frame_set(1)
    imported = list(scene.objects)
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh for {item_id(item)}")

    def corners():
        return [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]

    bpy.context.view_layer.update()
    points = corners()
    minimum = Vector([min(p[a] for p in points) for a in range(3)])
    maximum = Vector([max(p[a] for p in points) for a in range(3)])
    extent = maximum - minimum
    scale = 1 / max(extent)
    root = bpy.data.objects.new("Catalogue model", None)
    scene.collection.objects.link(root)
    for obj in imported:
        if obj.parent is None:
            obj.parent = root
    root.scale = (scale, scale, scale)
    root.location = (-scale * (minimum.x + maximum.x) / 2,
                     -scale * (minimum.y + maximum.y) / 2, -scale * minimum.z)
    # Car models read better as shelf miniatures when a little of their side is visible.
    if item[0] == "toy-car-kit":
        root.rotation_euler.z = math.radians(-28)
    elif item[0] == "space-kit" and item[1] in ("astronautA", "astronautB", "alien"):
        root.rotation_euler.z = math.pi
    bpy.context.view_layer.update()
    points = corners()
    minimum = Vector([min(p[a] for p in points) for a in range(3)])
    maximum = Vector([max(p[a] for p in points) for a in range(3)])
    target = (minimum + maximum) / 2

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 64
    # Some distribution Blender builds omit OpenImageDenoise; deterministic
    # sampling works on those builds too and avoids a runtime dependency.
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 6
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 4
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.world = bpy.data.worlds.new("Soft daylight")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.83, 0.88, 1.0, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.65

    for name, position, power, size, color in [
        ("Key", (-3, -4, 6), 350, 5, (1.0, 0.93, 0.83)),
        ("Fill", (4, -2, 3), 140, 4, (0.85, 0.91, 1.0)),
        ("Rim", (1, 4, 4), 180, 3, (1.0, 1.0, 1.0)),
    ]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.size, data.color = power, size, color
        light = bpy.data.objects.new(name, data)
        scene.collection.objects.link(light)
        light.location = Vector(position)
        light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()

    data = bpy.data.cameras.new("Shelf view")
    camera = bpy.data.objects.new("Shelf view", data)
    scene.collection.objects.link(camera)
    camera.location = target + Vector((4, -8, 3.1))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    data.type = "ORTHO"
    data.ortho_scale = 2
    scene.camera = camera
    bpy.context.view_layer.update()
    projected = [world_to_camera_view(scene, camera, p) for p in points]
    span = max(max(p.x for p in projected) - min(p.x for p in projected),
               max(p.y for p in projected) - min(p.y for p in projected))
    data.ortho_scale *= span * 1.12
    scene.render.filepath = str(output / (item_id(item) + ".png"))
    bpy.ops.render.render(write_still=True)
    print("CATALOGUE_RENDERED " + item_id(item), flush=True)


def finish(source_root, output, skip_existing=False):
    from PIL import Image
    destination = ROOT / "public/decor-catalogue"
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "licenses").mkdir(exist_ok=True)
    catalogue, evidence = [], []
    for item in ITEMS:
        ident = item_id(item)
        rendered_path = output / (ident + ".png")
        image = Image.open(rendered_path).convert("RGBA")
        # A low alpha cutoff removes nearly transparent noise beyond the silhouette.
        alpha = image.getchannel("A").point(lambda value: value if value > 3 else 0)
        image.putalpha(alpha)
        box = alpha.getbbox()
        if not box:
            raise RuntimeError(f"Empty render: {ident}")
        image = image.crop(box)
        image.thumbnail((512, 512), Image.Resampling.LANCZOS)
        image_path = destination / (ident + ".webp")
        thumbnail_path = destination / (ident + "_thumb.webp")
        current = (skip_existing and image_path.is_file() and thumbnail_path.is_file()
                   and image_path.stat().st_mtime >= rendered_path.stat().st_mtime
                   and thumbnail_path.stat().st_mtime >= rendered_path.stat().st_mtime)
        if not current:
            image.save(image_path, "WEBP", quality=92, method=6, exact=True)
            thumbnail = image.copy()
            thumbnail.thumbnail((160, 160), Image.Resampling.LANCZOS)
            thumbnail.save(thumbnail_path, "WEBP", quality=85, method=6, exact=True)
        pack = PACKS[item[0]]
        width, height = image.size
        default_height = item[4]
        default_width = round(default_height * width / height)
        if default_width > 190:
            default_height = round(default_height * 190 / default_width)
            default_width = 190
        catalogue.append({
            "id": ident, "kind": "decor", "title": item[2],
            "description": f"A shelf miniature from {pack['title']}, rendered for Cybershelf.",
            "tags": list(dict.fromkeys(item[5].split())), "category": item[3],
            "style": "low-poly", "imageUrl": f"/decor-catalogue/{ident}.webp",
            "thumbnailUrl": f"/decor-catalogue/{ident}_thumb.webp",
            "width": width, "height": height,
            "defaultWidthMm": default_width, "defaultHeightMm": default_height,
            "anchorX": 0.5, "anchorY": 1,
            "creator": pack["creator"], "sourceUrl": pack["sourceUrl"],
            "license": "CC0-1.0", "licenseUrl": LICENSE_URL,
        })
        evidence.append({"id": ident, "pack": item[0],
                         "modelPath": str(model_path(item, source_root).relative_to(source_root / item[0])),
                         "modelSha256": hashlib.sha256(model_path(item, source_root).read_bytes()).hexdigest(),
                         "renderSha256": hashlib.sha256((destination / (ident + ".webp")).read_bytes()).hexdigest()})
    for pack_id, pack in PACKS.items():
        shutil.copyfile(source_root / pack_id / pack["licensePath"], destination / "licenses" / (pack_id + ".txt"))
    (destination / "provenance.json").write_text(json.dumps({
        "preparedOn": "2026-11-10", "renderer": "Blender 4.3.2 / Cycles CPU / 64 samples",
        "license": "CC0-1.0", "licenseUrl": LICENSE_URL,
        "modifications": "Orthographic transparent rendering; cropped alpha edges; WebP encoding and thumbnails. Original model geometry and textures retained.",
        "packs": PACKS, "assets": evidence,
    }, indent=2) + "\n")
    interface = '''/** Curated, source-verified CC0 assets. Rebuild with scripts/render-decor-catalogue.py. */
export interface DecorCatalogueAsset {
  id: string;
  kind: 'decor';
  title: string;
  description: string;
  tags: string[];
  category: string;
  style: 'low-poly';
  imageUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  defaultWidthMm: number;
  defaultHeightMm: number;
  anchorX: number;
  anchorY: number;
  creator: string;
  sourceUrl: string;
  license: 'CC0-1.0';
  licenseUrl: string;
}

export const DECOR_CATALOGUE: readonly DecorCatalogueAsset[] = '''
    (ROOT / "lib/decor-catalogue.ts").write_text(interface + json.dumps(catalogue, indent=2, ensure_ascii=False) + ";\n")
    print(f"Prepared {len(catalogue)} assets and thumbnails in {destination}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--finish", action="store_true")
    parser.add_argument("--ids", help="Comma-separated IDs for a small visual review batch")
    parser.add_argument("--skip-existing", action="store_true")
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(arguments)
    validate_sources(args.source_root)
    args.output.mkdir(parents=True, exist_ok=True)
    if args.finish:
        finish(args.source_root, args.output, args.skip_existing)
        return
    wanted = set(args.ids.split(",")) if args.ids else None
    for item in ITEMS:
        ident = item_id(item)
        if wanted is not None and ident not in wanted:
            continue
        if args.skip_existing and (args.output / (ident + ".png")).is_file():
            continue
        render(item, args.source_root, args.output)


if __name__ == "__main__":
    main()
