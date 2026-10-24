# Fonts for transcript PDFs

`NotoSans-Regular.ttf.gz` and `NotoSans-Bold.ttf.gz` are Noto Sans, from
Google Fonts' `ofl/notosans` (the variable font `NotoSans[wdth,wght].ttf`), cut
down for `src/engines/pages-pdf.ts`. Licence: SIL Open Font License 1.1, in
`OFL.txt`; the font declares no Reserved Font Name. The build copies these to
`dist/fonts` and adds the licence to `third-party-licenses.txt`.

To make them again (fonttools with brotli):

```bash
U="0020-007E,00A0-017F,0192,01A0-01A1,01AF-01B0,0218-021B,02BB-02BC,02C6,02C7,02D8-02DD,0300-0304,0306-030C,0323,0326-0328,0370-03FF,0400-04FF,0500-052F,1E3E-1E3F,1EA0-1EF9,2010-2015,2018-201E,2020-2022,2026,2030,2032-2033,2039-203A,20AC,20B4,20B8,20BA,20BD,2116,2122,2190-2193,2212,2215,2260,2264-2265,25CF,FFFD"
for w in 400 700; do
  fonttools varLib.instancer 'NotoSans[wdth,wght].ttf' wght=$w wdth=100 -o inst$w.ttf
  pyftsubset inst$w.ttf --unicodes="$U" --layout-features='' --no-hinting \
    --drop-tables+=GDEF,GPOS,GSUB,STAT,DSIG,kern --name-IDs='*' --notdef-outline \
    --output-file=sub$w.ttf
done
gzip -9 -c sub400.ttf > NotoSans-Regular.ttf.gz
gzip -9 -c sub700.ttf > NotoSans-Bold.ttf.gz
```

What is covered: Basic Latin and Latin-1, Latin Extended-A (Polish, Czech,
Turkish, Romanian…), Vietnamese, Greek, Cyrillic, general punctuation and a few
symbols. Chinese, Japanese, Korean, Arabic, Hebrew, Hindi and the like are not:
the writer sets "?" for them.
