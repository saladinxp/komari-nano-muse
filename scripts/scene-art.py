#!/usr/bin/env python3
"""Build the scene artwork in public/scene-art/.

Two sources:

  duty room   vendor/server-breakroom/dist/assets (摸鱼机房 v4, lossless WebP, 8.9 MB)
  home office ChatGPT's home-v1 PNG masters (29 MB). They live on the Gitea
              branch codex/home-art-v1 and are not copied into this branch:

                git archive origin/codex/home-art-v1 art/home-v1 | tar -x -C /tmp/nm-art
                python3 scripts/scene-art.py --home /tmp/nm-art/art/home-v1/art

  desk poses  ChatGPT's desk-v2 PNG masters (branch codex/desk-art-v2):

                git archive origin/codex/desk-art-v2 art/desk-v2 | tar -x -C /tmp/nm-art
                python3 scripts/scene-art.py --desk /tmp/nm-art/art/desk-v2/art

              Without --home / --desk only the duty-room files are rebuilt.

Scenes draw characters at most ~300-400 device pixels tall and backgrounds at
most ~2200 px wide, so every atlas is scaled to about twice its CSS display
size and re-encoded as lossy WebP. Frame rectangles in the TypeScript data stay
in *source* pixels and are multiplied by the scale at draw time, so the scale
factors below must match:

  duty atlases  ATLASES in src/cast/roster.ts
  home atlases  HOME_ATLASES in src/pages/home/atlas.ts
  home crop     VIEW in src/pages/home/layout.ts
  desk atlases  DESK_CAST, STOOL, MUSE_WALK in src/cast/desk.ts

Usage:  python3 scripts/scene-art.py [--home DIR] [--desk DIR]
"""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

DUTY_SRC = Path('vendor/server-breakroom/dist/assets')
OUT = Path('public/scene-art')

# ── duty room ──
ROOMS = {
    'room-small-day': 'cozy-room-v2.webp',
    'room-small-night': 'cozy-room-night-v2.webp',
    'room-medium-day': 'cozy-room-medium-v3.webp',
    'room-medium-night': 'cozy-room-medium-night-v3.webp',
    'room-large-day': 'cozy-room-large-v3.webp',
    'room-large-night': 'cozy-room-large-night-v3.webp',
}
# Foreground strip: source rectangle in foreground-desks-v3.webp and the size it
# is drawn at in the 1600x1280 large-room scene (STRIP in pages/duty/layout.ts).
STRIP_SRC = (28, 188, 28 + 2118, 188 + 363)
STRIP_SIZE = (1470, 252)
ATLASES = {
    'cast-trio': ('chibi-workers-v2.webp', 0.82),
    'cast-aoi': ('character-aoi-v4.webp', 0.5),
    'cast-chestnut': ('character-chestnut-v4.webp', 0.5),
    'cast-yuzu': ('character-yuzu-v4.webp', 0.5),
    'cast-seina': ('character-seina-v4.webp', 0.5),
    'cast-wheat': ('character-wheat-v4.webp', 0.5),
}

# ── home office ──
# Visible part of the 1600x1000 background (x, y, w, h): drops the ceiling edge
# and the empty floor below the snack cabinet. VIEW in pages/home/layout.ts.
HOME_VIEW = (0, 40, 1600, 760)
# Coffee-table top, cut out of the background and drawn over seated characters.
# (x, y, w, h) in background pixels; TABLE in pages/home/layout.ts.
HOME_TABLE = (1040, 446, 308, 46)
HOME_ATLASES = {
    **{
        f'home-{k}': (f'character-{k}-home-v1.png', 0.55)
        for k in ('blue', 'orange', 'mint', 'aoi', 'chestnut', 'yuzu', 'seina', 'wheat')
    },
    'home-nanomuse': ('nanomuse-chibi-v1.png', 0.55),
    'home-plant': ('props-plant-v1.png', 0.3),
    'home-snacks': ('props-snacks-v1.png', 0.5),
    'home-phone': ('props-phone-v1.png', 0.2),
}

# ── desk poses (seated, back to the viewer) ──
DESK_ATLASES = {
    **{
        f'desk-{k}': (f'character-{k}-desk-v1.png', 0.6)
        for k in ('blue', 'orange', 'mint', 'aoi', 'chestnut', 'yuzu', 'seina', 'wheat')
    },
    'muse-walk': ('nanomuse-walk-v2.png', 0.55),
    'desk-stool': ('props-desk-stool-v1.png', 0.6),
}


def save(img: Image.Image, name: str, quality: int) -> None:
    path = OUT / f'{name}.webp'
    img.save(path, 'WEBP', quality=quality, method=6)
    print(f'{path}  {img.size[0]}x{img.size[1]}  {path.stat().st_size / 1024:.0f} KB')


def scaled(img: Image.Image, scale: float) -> Image.Image:
    return img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)


def duty() -> None:
    for name, src in ROOMS.items():
        save(Image.open(DUTY_SRC / src).convert('RGB'), name, 74)
    strip = Image.open(DUTY_SRC / 'foreground-desks-v3.webp').convert('RGBA').crop(STRIP_SRC)
    save(strip.resize(STRIP_SIZE, Image.LANCZOS), 'room-large-front', 80)
    for name, (src, scale) in ATLASES.items():
        save(scaled(Image.open(DUTY_SRC / src).convert('RGBA'), scale), name, 82)


def home(src: Path) -> None:
    x, y, w, h = HOME_VIEW
    tx, ty, tw, th = HOME_TABLE
    for t in ('day', 'night'):
        bg = Image.open(src / f'home-{t}-v1.png').convert('RGB')
        assert bg.size == (1600, 1000), bg.size
        save(bg.crop((x, y, x + w, y + h)), f'home-{t}', 76)
        # Rounded table top with a soft 1 px edge.
        table = bg.crop((tx, ty, tx + tw, ty + th)).convert('RGBA')
        mask = Image.new('L', (tw * 4, th * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle((8, 8, tw * 4 - 8, th * 4 - 8), radius=th * 2 - 8, fill=255)
        table.putalpha(mask.resize((tw, th), Image.LANCZOS))
        save(table, f'home-table-{t}', 90)
    for name, (file, scale) in HOME_ATLASES.items():
        save(scaled(Image.open(src / file).convert('RGBA'), scale), name, 82)


def desk(src: Path) -> None:
    for name, (file, scale) in DESK_ATLASES.items():
        save(scaled(Image.open(src / file).convert('RGBA'), scale), name, 82)


def opaque_components(img: Image.Image):
    """Find alpha>40 bodies over the WHOLE master, including grid-crossing feet.

    Pillow + standard Python only: artwork rebuilding needs no SciPy/OpenCV.
    Tiny disconnected export specks are not pose bodies.
    """
    width, height = img.size
    remaining = bytearray(img.getchannel('A').point(lambda a: 1 if a > 40 else 0).tobytes())
    bodies = []
    for start in range(len(remaining)):
        if not remaining[start]:
            continue
        remaining[start] = 0
        stack, pixels = [start], []
        left, top, right, bottom = width, height, 0, 0
        while stack:
            pos = stack.pop()
            pixels.append(pos)
            y, x = divmod(pos, width)
            left, top, right, bottom = min(left,x), min(top,y), max(right,x+1), max(bottom,y+1)
            for adjacent in ((pos-1 if x else -1), (pos+1 if x+1<width else -1),
                             (pos-width if y else -1), (pos+width if y+1<height else -1)):
                if adjacent >= 0 and remaining[adjacent]:
                    remaining[adjacent] = 0
                    stack.append(adjacent)
        if len(pixels) >= 15:
            bodies.append({'pixels': pixels, 'bounds': (left, top, right, bottom)})
    return sorted(bodies, key=lambda c: len(c['pixels']), reverse=True)


def chair_parts(img: Image.Image):
    bodies = opaque_components(img)
    assert len(bodies) == 4 and all(len(b['pixels']) > 10000 for b in bodies)
    cell, parts = img.width // 2, {}
    for body in bodies:
        l,t,r,b = body['bounds']
        index = int((t+b)/2 >= cell)*2 + int((l+r)/2 >= cell)
        assert index not in parts, 'Two bodies assigned to one pose'
        # Preserve anti-aliased edge pixels up to three pixels outside the solid
        # connected body, without importing the neighbouring pose's boot tips.
        support = bytearray(img.width * img.height)
        for pos in body['pixels']:
            support[pos] = 255
        mask = Image.frombytes('L', img.size, bytes(support)).filter(ImageFilter.MaxFilter(7))
        alpha = ImageChops.multiply(img.getchannel('A'), mask).point(lambda a: a if a >= 8 else 0)
        clean = img.copy()
        clean.putalpha(alpha)
        bounds = (max(0,l-3),max(0,t-3),min(img.width,r+3),min(img.height,b+3))
        parts[index] = (clean.crop(bounds), bounds, len(body['pixels']))
    return [parts[i] for i in range(4)]


def chair(src: Path) -> None:
    """Pack complete bodies using explicit lower-body anchors; originals stay intact."""
    anchors = json.loads((src/'anchors.json').read_text())
    workers = {}
    manifest = {'version': 2, 'cell': 800, 'hip': [400, 600],
                'extraction': 'Whole-master alpha>40 connected bodies, 3px edge, alpha<8 cleared',
                'anchors': 'anchors.json', 'workers': {}}
    for key in ('blue', 'orange', 'mint', 'aoi', 'chestnut', 'yuzu', 'seina', 'wheat'):
        img = Image.open(src / f'worker-{key}.png').convert('RGBA')
        cell = img.width // 2
        assert img.width == img.height and img.width % 2 == 0
        parts = chair_parts(img)
        atlas = Image.new('RGBA', (1600,1600))
        frames, origins = [], []
        for i, (part, box, area) in enumerate(parts):
            l,t,r,b = box
            source_x,source_y = i%2*cell,i//2*cell
            hip = anchors['workers'][key]['hips'][i]
            dx,dy = 400-hip[0],600-hip[1]
            px,py = i%2*800+dx+l-source_x,i//2*800+dy+t-source_y
            assert px>=i%2*800 and py>=i//2*800 and px+r-l<=(i%2+1)*800 and py+b-t<=(i//2+1)*800,(key,i)
            atlas.alpha_composite(part,(px,py))
            frames.append([px,py,r-l,b-t])
            origins.append({'raw_bounds':[l-source_x,t-source_y,r-source_x,b-source_y],
                            'source_bounds':box,'component_area':area,'raw_hip':hip,'translation':[dx,dy]})
        dx,dy=origins[0]['translation']
        hand=[anchors['workers'][key]['hand'][0]+dx,anchors['workers'][key]['hand'][1]+dy]
        data={'art':'chair-worker-'+key,'scale':.55,'cell':800,'hip':[400,600], 'hand':hand,'frames':frames}
        workers[key]=data
        manifest['workers'][key]={'master':f'worker-{key}.png','size':list(img.size),'poses':origins,**data}
        save(scaled(atlas,.55),data['art'],84)
    empty=Image.open(src/'chair-empty.png').convert('RGBA')
    empty.putalpha(empty.getchannel('A').point(lambda a:a if a>=8 else 0))
    box=empty.getchannel('A').point(lambda a:255 if a>=48 else 0).getbbox()
    l,t,r,b=box
    chair_data={'art':'chair-empty','scale':.5,'frame':[l,t,r-l,b-t], 'seat':[640,650], 'split':650,'legSplit':760}
    save(scaled(empty,.5),'chair-empty',86)
    manifest['chair']=chair_data
    (src/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    Path('src/cast/chair-data.ts').write_text('// Generated by scripts/scene-art.py --chair; source pixels, hip-anchored.\nexport const WORKER_DATA = '+json.dumps(workers,ensure_ascii=False,indent=2)+'\nexport const CHAIR_DATA = '+json.dumps(chair_data,indent=2)+'\n')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--home', type=Path, help='directory with the home-v1 PNG masters')
    ap.add_argument('--desk', type=Path, help='directory with the desk-v2 PNG masters')
    ap.add_argument('--chair', type=Path, help='directory with chair-v1 PNG masters')
    ap.add_argument('--only-chair', action='store_true', help='build only the chair-v1 assets')
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if not args.only_chair:
        duty()
    if args.home:
        home(args.home)
    if args.desk:
        desk(args.desk)
    if args.chair:
        chair(args.chair)
    total = sum(p.stat().st_size for p in OUT.glob('*.webp'))
    print(f'total {total / 1024:.0f} KB')


if __name__ == '__main__':
    main()
