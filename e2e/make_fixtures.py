"""Generates synthetic test photos (photo-on-table shots) for the e2e run."""
import random, struct, sys
from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1]
random.seed(7)

def photo(w, h, hue):
    im = Image.new('RGB', (w, h), (225, 215, 190))
    d = ImageDraw.Draw(im)
    m = int(min(w, h) * 0.06)
    d.rectangle([m, m, w - m, h - m], fill=(120 + hue, 140, 110))
    for _ in range(25):
        x, y = random.randint(m, w - m), random.randint(m, h - m)
        r = random.randint(10, 60)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(random.randint(60, 200), random.randint(60, 180), random.randint(50, 160)))
    return im

def on_table(ph, W, H, quad, bg=(45, 40, 36)):
    table = Image.new('RGB', (W, H), bg)
    noise = Image.effect_noise((W, H), 12).convert('RGB')
    table = Image.blend(table, noise, 0.08)
    # perspective: map output quad -> photo rect
    w, h = ph.size
    coeffs = find_coeffs(quad, [(0, 0), (w, 0), (w, h), (0, h)])
    warped = ph.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).polygon(quad, fill=255)
    table.paste(warped, (0, 0), mask)
    return table.filter(ImageFilter.GaussianBlur(0.6))

def find_coeffs(pa, pb):
    import numpy as np
    A = []
    for (x, y), (X, Y) in zip(pa, pb):
        A.append([x, y, 1, 0, 0, 0, -X * x, -X * y])
        A.append([0, 0, 0, x, y, 1, -Y * x, -Y * y])
    A = np.array(A, dtype=float); B = np.array(pb, dtype=float).reshape(8)
    return list(np.linalg.solve(A, B))

def exif_orientation(o):
    # Minimal big-endian TIFF with Orientation tag
    ifd = struct.pack('>H', 1) + struct.pack('>HHIHH', 0x0112, 3, 1, o, 0) + struct.pack('>I', 0)
    return b'MM\x00\x2a' + struct.pack('>I', 8) + ifd

# 1: tilted landscape photo on dark table (4000x3000 ~ 12 MP)
t1 = on_table(photo(1500, 1050, 20), 4000, 3000, [(700, 420), (3350, 640), (3180, 2560), (520, 2300)])
t1.save(f'{out}/01-tilted.jpg', quality=90)
# 2: same scene stored landscape but EXIF orientation 6 (display rotated 90° CW → portrait)
t2 = on_table(photo(1200, 900, -10), 2400, 1800, [(300, 260), (2050, 200), (2120, 1560), (260, 1600)])
t2.save(f'{out}/02-exif6.jpg', quality=90, exif=b'Exif\x00\x00' + exif_orientation(6))
# 3: PNG on light table
t3 = on_table(photo(800, 1100, 40), 1200, 1600, [(200, 180), (1000, 220), (980, 1420), (180, 1380)], bg=(170, 160, 150))
t3.save(f'{out}/03-portrait.png')
# 4: corrupt JPEG
open(f'{out}/04-corrupt.jpg', 'wb').write(b'\xff\xd8\xff\xe0' + bytes(random.getrandbits(8) for _ in range(5000)))
# 5: HEIC-looking file this browser cannot decode
open(f'{out}/05-iphone.heic', 'wb').write(b'\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic' + bytes(4000))
# 6..: more ordinary photos for batch size
for i in range(6, 21):
    W, H = 1600, 1200
    j = random.randint(-60, 60)
    t = on_table(photo(900, 650, i), W, H, [(250 + j, 200), (1350, 220 - j), (1330 + j, 1000), (230, 980 + j)])
    t.save(f'{out}/{i:02d}-batch.jpg', quality=85)
print('ok')
