import sys
from PIL import Image, ImageDraw
scenario, name, x, y, size = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
order = ['gt', 'lanczos', 'today', 'compact2x-multijpg', 'lsdir4x', 'span2x', 'today-int8', 'compact2x-otf'] if scenario != 'real' else ['gt', 'lanczos', 'today', 'today-int8', 'compact2x-multijpg', 'lsdir4x', 'span2x']
Z = 3
tiles = []
for m in order:
    im = Image.open(f'/tmp/boost-lin/out/{scenario}/{name}-{m}.png').convert('RGB').crop((x, y, x + size, y + size)).resize((size * Z, size * Z), Image.NEAREST)
    tiles.append((m, im))
W = size * Z
sheet = Image.new('RGB', (W * 4 + 30, (W + 18) * 2 + 10), 'white')
d = ImageDraw.Draw(sheet)
for i, (m, im) in enumerate(tiles):
    cx, cy = (i % 4) * (W + 10), (i // 4) * (W + 22)
    sheet.paste(im, (cx, cy + 14)); d.text((cx + 2, cy), m, fill='black')
sheet.save(f'/tmp/boost-lin/out/montage-{scenario}-{name}.png')
print(sheet.size)
