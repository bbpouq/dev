"""Builds a valid 家影 backup with N mixed-size photos (default 500) for restore/perf tests."""
import hashlib, io, json, random, sys, uuid, zipfile, datetime
from PIL import Image, ImageDraw

out, n = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 500
random.seed(1)
persons = [{'id': str(uuid.uuid4()), 'displayName': name, 'createdAt': 0} for name in ['我', '妈妈', '爸爸', '外婆', '外公', '妹妹']]
rels = []
def rel(t, a, b):
    if t == 'partner_of' and a > b: a, b = b, a
    rels.append({'id': f'{t}:{a}:{b}', 'type': t, 'a': a, 'b': b})
P = {p['displayName']: p['id'] for p in persons}
rel('parent_of', P['妈妈'], P['我']); rel('parent_of', P['爸爸'], P['我']); rel('parent_of', P['妈妈'], P['妹妹'])
rel('partner_of', P['妈妈'], P['爸爸']); rel('parent_of', P['外婆'], P['妈妈']); rel('parent_of', P['外公'], P['妈妈'])
export_id = str(uuid.uuid4())
assets, photos, tags, files = [], [], [], []
for i in range(n):
    w = random.choice([640, 1200, 1800, 2400]); h = int(w * random.choice([0.66, 0.75, 1.33]))
    im = Image.new('RGB', (w, h), (random.randint(80, 200), random.randint(80, 200), random.randint(80, 200)))
    d = ImageDraw.Draw(im)
    for _ in range(12):
        x, y, r = random.randint(0, w), random.randint(0, h), random.randint(20, w // 6)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(random.randint(0, 255), random.randint(0, 255), random.randint(0, 255)))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=80); data = b.getvalue()
    ids = []
    for purpose in ('original', 'master'):
        aid = str(uuid.uuid4()); ids.append(aid)
        assets.append({'id': aid, 'purpose': purpose, 'type': 'image/jpeg', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'path': f'assets/{aid}.jpg', 'volume': 1})
        files.append((f'assets/{aid}.jpg', data))
    pid = str(uuid.uuid4())
    year = random.choice([None, 1965, 1978, 1983, 1991, 1999, 2004, 2012])
    photos.append({'id': pid, 'originalAssetId': ids[0], 'masterAssetId': ids[1], 'thumbAssetId': '', 'originalName': f'p{i}.jpg', 'originalType': 'image/jpeg',
        'exifOrientation': 1, 'width': w, 'height': h, 'edit': {'corners': [[0, 0], [1, 0], [1, 1], [0, 1]], 'rotation': 0, 'color': 'original', 'brightness': 0, 'contrast': 0},
        'template': {'kind': 'plain', 'title': '', 'showDate': True, 'showPeople': False},
        'date': {'precision': 'year', 'value': str(year)} if year else {'precision': 'unknown'},
        'title': f'照片 {i}', 'place': '', 'notes': '', 'organized': False, 'createdAt': 0, 'scannedAt': i, 'updatedAt': 0})
    for p in random.sample(persons, random.randint(0, 3)): tags.append({'photoId': pid, 'personId': p['id']})
manifest = {'format': 'jiaying-archive', 'schemaVersion': 1, 'archiveId': str(uuid.uuid4()), 'exportId': export_id,
    'exportedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'app': 'fixture', 'volumeCount': 1, 'meId': P['我'],
    'persons': persons, 'relationships': rels, 'photos': photos, 'photoPersons': tags, 'assets': assets,
    'totals': {'photos': n, 'persons': len(persons), 'relationships': len(rels), 'assetBytes': sum(a['size'] for a in assets)}}
with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as z:
    z.writestr('volume.json', json.dumps({'format': 'jiaying-archive', 'exportId': export_id, 'volume': 1, 'volumeCount': 1}))
    z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False))
    for name, data in files: z.writestr(name, data)
print(n, 'photos', manifest['totals']['assetBytes'] // 1e6, 'MB')
