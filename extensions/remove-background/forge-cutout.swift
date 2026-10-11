// forge-cutout: remove background with Apple Vision (macOS 14+).
// usage: forge-cutout <in> <out.png>
// Prints exactly one JSON line on stdout:
//   {"ok":true,"width":N,"height":N,"ms":N}
//   {"ok":false,"code":"no-subject"|"runtime-error","message":"..."}   (exit non-zero)
// Writes nothing except <out.png>.
import Foundation
import Vision
import CoreImage
import ImageIO

func jsonString(_ s: String) -> String {
  let data = try? JSONSerialization.data(withJSONObject: [s], options: [])
  let arr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
  return String(arr.dropFirst().dropLast())
}

func fail(_ code: String, _ message: String, _ status: Int32) -> Never {
  print("{\"ok\":false,\"code\":\"\(code)\",\"message\":\(jsonString(message))}")
  exit(status)
}

let args = Array(CommandLine.arguments.dropFirst())
guard args.count == 2 else {
  FileHandle.standardError.write("usage: forge-cutout <in> <out.png>\n".data(using: .utf8)!)
  fail("runtime-error", "usage: forge-cutout <in> <out.png>", 64)
}
let inURL = URL(fileURLWithPath: args[0]), outURL = URL(fileURLWithPath: args[1])
let t0 = DispatchTime.now()

// Read EXIF orientation so the mask matches the upright image.
var orient: CGImagePropertyOrientation = .up
if let src = CGImageSourceCreateWithURL(inURL as CFURL, nil),
   let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
   let o = props[kCGImagePropertyOrientation] as? UInt32,
   let oo = CGImagePropertyOrientation(rawValue: o) { orient = oo }

let handler = VNImageRequestHandler(url: inURL, orientation: orient, options: [:])
let req = VNGenerateForegroundInstanceMaskRequest()
do {
  try handler.perform([req])
  guard let obs = req.results?.first, !obs.allInstances.isEmpty else {
    fail("no-subject", "no foreground subject found", 2)
  }
  let buf = try obs.generateMaskedImage(ofInstances: obs.allInstances, from: handler, croppedToInstancesExtent: false)
  let ctx = CIContext(options: [.cacheIntermediates: false])
  try ctx.writePNGRepresentation(of: CIImage(cvPixelBuffer: buf), to: outURL, format: .RGBA8,
                                 colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
  let ms = Int((DispatchTime.now().uptimeNanoseconds - t0.uptimeNanoseconds) / 1_000_000)
  print("{\"ok\":true,\"width\":\(CVPixelBufferGetWidth(buf)),\"height\":\(CVPixelBufferGetHeight(buf)),\"ms\":\(ms)}")
} catch {
  fail("runtime-error", error.localizedDescription, 1)
}
