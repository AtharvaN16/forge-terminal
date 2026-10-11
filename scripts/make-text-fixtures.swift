// Generates the PDF text-extraction fixtures from a manifest, through
// CoreText, which lays out right-to-left scripts, CJK and ligatures the way a
// real Mac app's "Save as PDF" does. One-off: the PDFs are committed, so the
// test suite never needs Swift.
//
//   swift scripts/make-text-fixtures.swift tests/fixtures/text/manifest.json tests/fixtures/text
import CoreGraphics
import CoreText
import Foundation

struct Fixture: Decodable {
  let file: String
  let columns: Int
  let font: String
  let lines: [String]
}

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: make-text-fixtures.swift <manifest.json> <outdir>\n".data(using: .utf8)!)
  exit(2)
}
let manifest = try JSONDecoder().decode(
  [Fixture].self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
let outDir = URL(fileURLWithPath: args[2])

let pageWidth: CGFloat = 612
let pageHeight: CGFloat = 792
let margin: CGFloat = 54
let gutter: CGFloat = 24

for fixture in manifest {
  var box = CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight)
  let url = outDir.appendingPathComponent(fixture.file)
  guard let ctx = CGContext(url as CFURL, mediaBox: &box, nil) else {
    FileHandle.standardError.write("cannot create \(url.path)\n".data(using: .utf8)!)
    exit(1)
  }
  ctx.beginPDFPage(nil)
  let font = CTFontCreateWithName(fixture.font as CFString, 12, nil)
  let text = NSAttributedString(
    string: fixture.lines.joined(separator: "\n"),
    attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font]
  )
  let setter = CTFramesetterCreateWithAttributedString(text)
  let columns = CGFloat(fixture.columns)
  let width = (pageWidth - margin * 2 - gutter * (columns - 1)) / columns
  var start = 0
  for c in 0..<fixture.columns {
    let rect = CGRect(
      x: margin + CGFloat(c) * (width + gutter), y: margin,
      width: width, height: pageHeight - margin * 2)
    let frame = CTFramesetterCreateFrame(
      setter, CFRange(location: start, length: 0), CGPath(rect: rect, transform: nil), nil)
    CTFrameDraw(frame, ctx)
    start += CTFrameGetVisibleStringRange(frame).length
  }
  ctx.endPDFPage()
  ctx.closePDF()
  print("wrote \(url.path)")
}
