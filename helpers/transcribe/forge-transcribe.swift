// forge-transcribe — Forge's transcribe helper (spec 2026-10-17-transcribe-design §4.1).
//
// Apple's speech recogniser (SpeechAnalyzer) writes the transcript; Apple's
// on-device model (FoundationModels) writes the notes. Every line on stdout
// is one JSON object: progress events while it works, then one result.
//
//   forge-transcribe status [--locale <id>]
//   forge-transcribe probe <file>
//   forge-transcribe run <file> [--locale <id>] [--notes [--detail brief|standard|detailed]]
//   forge-transcribe render <html> <out> --as docx|pdf
//
// Built by scripts/build.mjs on macOS with a 26+ SDK; original Forge code, MIT.
import AppKit
import AVFoundation
import CoreMedia
import CoreText
import Foundation
import FoundationModels
import Speech

// MARK: - Output

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes]),
          var line = String(data: data, encoding: .utf8) else { return }
    line += "\n"
    FileHandle.standardOutput.write(line.data(using: .utf8)!)
}

func fail(_ code: String, _ message: String) -> Never {
    emit(["ok": false, "code": code, "message": message])
    exit(1)
}

// MARK: - Arguments

struct Args {
    var command = ""
    var file: String?
    /// render's second path: where the document goes.
    var out: String?
    /// render's format: "docx" or "pdf".
    var format: String?
    var locale: String?
    var notes = false
    var detail = Detail.standard

    init(_ argv: [String]) {
        var rest = Array(argv.dropFirst())
        command = rest.isEmpty ? "" : rest.removeFirst()
        while !rest.isEmpty {
            let a = rest.removeFirst()
            switch a {
            case "--locale": locale = rest.isEmpty ? nil : rest.removeFirst()
            case "--notes": notes = true
            case "--detail": detail = Detail(rawValue: rest.isEmpty ? "" : rest.removeFirst()) ?? .standard
            case "--as": format = rest.isEmpty ? nil : rest.removeFirst()
            default: if file == nil { file = a } else if out == nil { out = a }
            }
        }
    }
}

// MARK: - Speech

func resolveLocale(_ wanted: String?) async -> Locale? {
    let locale = wanted.map { Locale(identifier: $0) } ?? Locale.current
    return await SpeechTranscriber.supportedLocale(equivalentTo: locale)
}

/// "available", "off" (Apple Intelligence is turned off or still getting ready) or "unsupported".
func notesState() -> String {
    switch SystemLanguageModel.default.availability {
    case .available: return "available"
    case .unavailable(.deviceNotEligible): return "unsupported"
    case .unavailable: return "off"
    }
}

func openAudio(_ path: String) async -> AVAudioFile {
    let url = URL(fileURLWithPath: path)
    if let file = try? AVAudioFile(forReading: url) { return file }
    // Tell a file with no sound from one AVFoundation cannot read at all.
    let asset = AVURLAsset(url: url)
    if let video = try? await asset.loadTracks(withMediaType: .video), !video.isEmpty {
        fail("no-sound", "It has no sound.")
    }
    fail("unreadable", "This file cannot be read.")
}

struct Segment { let start: Double; let end: Double; let text: String }

func transcribe(_ file: AVAudioFile, locale: Locale, seconds: Double) async throws -> [Segment] {
    let transcriber = SpeechTranscriber(
        locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
        // macOS fetches the speech model for this language once; report its real progress.
        let watch = Task {
            while !Task.isCancelled {
                emit(["event": "model", "fraction": request.progress.fractionCompleted])
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
        defer { watch.cancel() }
        do { try await request.downloadAndInstall() } catch { fail("model", "The speech model could not be downloaded.") }
    }
    async let collected: [Segment] = transcriber.results.reduce(into: []) { acc, result in
        let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        acc.append(Segment(start: result.range.start.seconds, end: result.range.end.seconds, text: text))
        emit(["event": "heard", "seconds": min(result.range.end.seconds, seconds), "of": seconds])
    }
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    if let last = try await analyzer.analyzeSequence(from: file) {
        try await analyzer.finalizeAndFinish(through: last)
    } else {
        await analyzer.cancelAndFinishNow()
    }
    return try await collected
}

// MARK: - Notes

/// How much the notes say (the Detail pill on Transcribe to). Standard is what was measured
/// (spike 2026-10-17); brief and detailed change the part size, the points per part and the
/// summary's length. The schemas differ only in those counts, which a @Guide fixes at compile time.
enum Detail: String {
    case brief, standard, detailed

    /// The share of the window a part may fill: smaller parts, more of them, finer notes.
    var budget: Double { self == .detailed ? 0.30 : 0.55 }
    var maxPoints: Int { self == .brief ? 3 : self == .detailed ? 8 : 5 }
    var instructions: String {
        let base = "Write notes on part of a talk transcript. Use only what the transcript says."
        switch self {
        case .brief: return base + " Cover the whole part, not only its start: one short point for each main topic."
        case .standard: return base
        case .detailed: return base + " Cover the whole part, with a point for every topic it raises, keeping names, numbers and examples."
        }
    }
    var pointStyle: String {
        self == .detailed ? "one or two sentences each" : self == .brief ? "one short sentence each" : "one sentence each"
    }
    var summaryAsk: String {
        switch self {
        case .brief: return "In one or two sentences, what is this talk about?"
        case .standard: return "In two or three sentences, what is this talk about?"
        case .detailed: return "In a short paragraph of four to six sentences, what is this talk about?"
        }
    }
}

protocol PartWriting: Generable {
    var heading: String { get }
    var points: [String] { get }
}

@Generable
struct PartNotes: PartWriting {
    @Guide(description: "A short heading for this part of the talk, at most six words")
    var heading: String
    @Guide(description: "The main points made in this part, one sentence each", .maximumCount(5))
    var points: [String]
}

@Generable
struct BriefPartNotes: PartWriting {
    @Guide(description: "A short heading for this part of the talk, at most six words")
    var heading: String
    @Guide(description: "The main points made in this part, one short sentence each", .maximumCount(3))
    var points: [String]
}

@Generable
struct DetailedPartNotes: PartWriting {
    @Guide(description: "A short heading for this part of the talk, at most six words")
    var heading: String
    @Guide(description: "One point for each topic raised in this part, in order, one or two sentences each", .maximumCount(8))
    var points: [String]
}

protocol OverviewWriting: Generable {
    var summary: String { get }
    var headings: [String] { get }
}

@Generable
struct Overview: OverviewWriting {
    @Guide(description: "What the whole talk is about, in two or three sentences")
    var summary: String
    @Guide(description: "One distinct heading of at most six words for each part, in order")
    var headings: [String]
}

@Generable
struct BriefOverview: OverviewWriting {
    @Guide(description: "What the whole talk is about, in one or two sentences")
    var summary: String
    @Guide(description: "One distinct heading of at most six words for each part, in order")
    var headings: [String]
}

@Generable
struct DetailedOverview: OverviewWriting {
    @Guide(description: "What the whole talk is about, in a short paragraph of four to six sentences")
    var summary: String
    @Guide(description: "One distinct heading of at most six words for each part, in order")
    var headings: [String]
}

struct Part {
    let start: Double
    let text: String
    var heading = ""
    var points: [String] = []
    var refused = false
}

/// Paragraphs as the .md writes them (src/core/transcribe/markdown.ts), the unit a part is cut from.
func paragraphs(_ segments: [Segment]) -> [(start: Double, text: String)] {
    var out: [(start: Double, text: String)] = []
    var cur: (start: Double, end: Double, text: String, words: Int)?
    for s in segments {
        let n = s.text.split(whereSeparator: \.isWhitespace).count
        if var c = cur {
            let gap = s.start - c.end
            if gap > 10 || (gap > 1 && c.words >= 60) || c.words >= 140 {
                out.append((c.start, c.text))
                cur = (s.start, s.end, s.text, n)
            } else {
                c.text += " " + s.text; c.end = s.end; c.words += n; cur = c
            }
        } else { cur = (s.start, s.end, s.text, n) }
    }
    if let c = cur { out.append((c.start, c.text)) }
    return out
}

func tokens(_ model: SystemLanguageModel, _ text: String) async -> Int {
    if #available(macOS 26.4, *), let n = try? await model.tokenCount(for: text) { return n }
    return text.count / 3
}

func window(_ model: SystemLanguageModel) async -> Int {
    if #available(macOS 26.4, *) { return model.contextSize }
    return 4096
}

let greedy = GenerationOptions(sampling: .greedy)

/// One part's notes: structured first; if Apple's model refuses or fails, once more with the
/// looser filter and a plain-text reply (the only kind it applies to); then give up on this part.
func structured<T: PartWriting>(_ type: T.Type, _ prompt: String, _ detail: Detail, _ model: SystemLanguageModel) async throws -> (String, [String]) {
    let r = try await LanguageModelSession(model: model, instructions: detail.instructions)
        .respond(to: prompt, generating: type, options: greedy)
    return (r.content.heading, r.content.points)
}

func notes(for part: inout Part, model: SystemLanguageModel, detail: Detail) async {
    let prompt = "Transcript:\n\(part.text)"
    do {
        let (heading, points) = try await {
            switch detail {
            case .brief: return try await structured(BriefPartNotes.self, prompt, detail, model)
            case .standard: return try await structured(PartNotes.self, prompt, detail, model)
            case .detailed: return try await structured(DetailedPartNotes.self, prompt, detail, model)
            }
        }()
        part.heading = heading
        part.points = Array(points.prefix(detail.maxPoints))
        return
    } catch {}
    let lax = SystemLanguageModel(guardrails: .permissiveContentTransformations)
    let ask = prompt + "\n\nReply with a heading of at most six words on the first line, then up to \(detail.maxPoints) main points, \(detail.pointStyle), one per line, each starting with \"- \"."
    do {
        let r = try await LanguageModelSession(model: lax, instructions: detail.instructions).respond(to: ask, options: greedy)
        let lines = r.content.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        part.heading = (lines.first ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "#* "))
        part.points = Array(lines.dropFirst()
            .filter { $0.hasPrefix("-") || $0.hasPrefix("*") || $0.hasPrefix("•") }
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "-*• ")) }
            .prefix(detail.maxPoints))
        if part.heading.isEmpty || part.points.isEmpty { part.refused = true }
    } catch {
        part.refused = true
    }
}

func writeNotes(_ segments: [Segment], detail: Detail) async -> [String: Any]? {
    let model = SystemLanguageModel.default
    guard case .available = model.availability else { return nil }
    // A part, its instructions, the schema and the reply all share the window.
    let budget = Int(Double(await window(model)) * detail.budget)
    var parts: [Part] = []
    var start = 0.0
    var text = ""
    for p in paragraphs(segments) {
        let trial = text.isEmpty ? p.text : text + "\n\n" + p.text
        if !text.isEmpty, await tokens(model, trial) > budget {
            parts.append(Part(start: start, text: text))
            start = p.start
            text = p.text
        } else {
            if text.isEmpty { start = p.start }
            text = trial
        }
    }
    if !text.isEmpty { parts.append(Part(start: start, text: text)) }

    for i in parts.indices {
        emit(["event": "notes", "part": i + 1, "of": parts.count])
        await notes(for: &parts[i], model: model, detail: detail)
    }

    // The summary and the headings last, with every part's notes in view, so headings differ.
    let outline = parts.enumerated().map { i, p in
        "Part \(i + 1): " + (p.refused ? "(no notes)" : p.points.joined(separator: " "))
    }.joined(separator: "\n")
    var summary = ""
    func overview<T: OverviewWriting>(_ type: T.Type) async throws -> (String, [String]) {
        let r = try await LanguageModelSession(model: model, instructions: "Summarise a talk from notes on each of its parts.")
            .respond(to: "Notes on the talk's \(parts.count) parts:\n\(outline)", generating: type, options: greedy)
        return (r.content.summary, r.content.headings)
    }
    do {
        let (written, headings) = try await {
            switch detail {
            case .brief: return try await overview(BriefOverview.self)
            case .standard: return try await overview(Overview.self)
            case .detailed: return try await overview(DetailedOverview.self)
            }
        }()
        summary = written
        if headings.count == parts.count {
            for i in parts.indices where !parts[i].refused { parts[i].heading = headings[i] }
        }
    } catch {
        let lax = SystemLanguageModel(guardrails: .permissiveContentTransformations)
        if let r = try? await LanguageModelSession(model: lax, instructions: "Summarise a talk from notes on each of its parts.")
            .respond(to: "\(detail.summaryAsk)\n\(outline)", options: greedy) {
            summary = r.content.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }
    return [
        "summary": summary,
        "parts": parts.map { ["start": $0.start, "heading": $0.heading, "points": $0.points, "refused": $0.refused] },
    ]
}

// MARK: - Documents

/// A transcript's HTML (from Forge's Markdown) set as Word or PDF by AppKit's own
/// HTML reader, the one TextEdit and textutil use. Word is written whole; PDF is
/// laid out by Core Text a page at a time, on the paper this Mac's region uses.
@MainActor
func render(html: String, out: String, format: String) {
    guard let data = FileManager.default.contents(atPath: html),
          let text = try? NSAttributedString(
              data: data,
              options: [.documentType: NSAttributedString.DocumentType.html,
                        .characterEncoding: String.Encoding.utf8.rawValue],
              documentAttributes: nil)
    else { fail("render", "The transcript could not be read.") }
    let url = URL(fileURLWithPath: out)
    switch format {
    case "docx":
        let whole = NSRange(location: 0, length: text.length)
        guard let docx = try? text.data(from: whole, documentAttributes: [.documentType: NSAttributedString.DocumentType.officeOpenXML]),
              (try? docx.write(to: url)) != nil
        else { fail("render", "The Word document could not be written.") }
    case "pdf":
        // US Letter where the region measures in inches, A4 everywhere else.
        let letter = Locale.current.measurementSystem == .us
        var page = CGRect(x: 0, y: 0, width: letter ? 612 : 595, height: letter ? 792 : 842)
        guard let pdf = CGContext(url as CFURL, mediaBox: &page, nil) else {
            fail("render", "The PDF could not be written.")
        }
        let setter = CTFramesetterCreateWithAttributedString(text as CFAttributedString)
        let area = CGPath(rect: page.insetBy(dx: 64, dy: 64), transform: nil)
        var at = 0
        repeat {
            pdf.beginPDFPage(nil)
            let frame = CTFramesetterCreateFrame(setter, CFRange(location: at, length: 0), area, nil)
            CTFrameDraw(frame, pdf)
            let shown = CTFrameGetVisibleStringRange(frame).length
            pdf.endPDFPage()
            // A frame that fits nothing would page for ever.
            if shown == 0 { break }
            at += shown
        } while at < text.length
        pdf.closePDF()
    default:
        fail("usage", "render makes docx or pdf")
    }
    emit(["ok": true])
}

// MARK: - Main

@main
struct Main {
    static func main() async {
        let args = Args(CommandLine.arguments)
        switch args.command {
        case "status":
            let locale = await resolveLocale(args.locale)
            emit([
                "ok": true,
                "speech": SpeechTranscriber.isAvailable,
                "locale": locale?.identifier ?? NSNull(),
                "notes": notesState(),
            ])
        case "probe":
            guard let path = args.file else { fail("usage", "probe needs a file") }
            let file = await openAudio(path)
            emit(["ok": true, "seconds": Double(file.length) / file.processingFormat.sampleRate, "sound": true])
        case "run":
            guard let path = args.file else { fail("usage", "run needs a file") }
            guard SpeechTranscriber.isAvailable else { fail("unsupported", "Speech recognition is not available on this Mac.") }
            guard let locale = await resolveLocale(args.locale) else {
                fail("locale", "Apple's speech recogniser does not support \(args.locale ?? Locale.current.identifier).")
            }
            let file = await openAudio(path)
            let seconds = Double(file.length) / file.processingFormat.sampleRate
            do {
                let segments = try await transcribe(file, locale: locale, seconds: seconds)
                var result: [String: Any] = [
                    "ok": true,
                    "locale": locale.identifier,
                    "seconds": seconds,
                    "segments": segments.map { ["start": $0.start, "end": $0.end, "text": $0.text] },
                ]
                if args.notes, let notes = await writeNotes(segments, detail: args.detail) { result["notes"] = notes }
                emit(result)
            } catch {
                fail("speech", "Transcription failed: \(error.localizedDescription)")
            }
        case "render":
            guard let html = args.file, let out = args.out, let format = args.format else {
                fail("usage", "render needs <html> <out> --as docx|pdf")
            }
            await MainActor.run { render(html: html, out: out, format: format) }
        default:
            fail("usage", "usage: forge-transcribe status|probe|run|render")
        }
    }
}
