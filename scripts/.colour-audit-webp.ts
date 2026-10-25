import sharp from 'sharp'

for (const id of [
  'home',
  'extract',
  'extract-deeper',
  'scale-empty',
  'scale',
  'scale-alpha',
  'scale-neutral',
  'scale-tweak',
  'scale-steps',
  'mix',
  'palette-empty',
  'palette',
  'palette-mode',
  'palette-tweak',
  'wrong',
  'extract-to-scale',
  'scale-centre-back',
]) {
  const i = await sharp(`/tmp/colour-audit/shots/${id}.png`)
    .resize({ width: 1000 })
    .webp({ quality: 88 })
    .toFile(`mockups/colour-audit-2026-10/${id}.webp`)
  console.log(id, i.size)
}
