// swift-parse — Swift source in on stdin, a JSON summary out on stdout.
//
// Stage 1 of the Yukibana pipeline. swift-syntax is written in Swift, so it
// cross-compiles to wasm32-wasip1 with the stock Swift SDK for WebAssembly — no
// custom toolchain needed. That makes real Swift parsing and diagnostics available in
// the browser long before the full compiler is, which is what the editor needs for
// syntax errors, an outline, and formatting.
//
// The interface is deliberately a WASI command reading stdin: it is the same shape as
// every other tool Yukibana runs in a worker, so it needs no JS bridge.
//
// Nothing here imports Foundation. swift-syntax does not need it, and pulling it in
// would add tens of megabytes to a module the browser must download and compile.

#if canImport(WASILibc)
import WASILibc
#elseif canImport(Glibc)
import Glibc
#elseif canImport(Darwin)
import Darwin
#endif

import SwiftDiagnostics
import SwiftParser
import SwiftParserDiagnostics
import SwiftSyntax

// --- stdio --------------------------------------------------------------------

// Raw descriptors rather than the stdio FILE globals: `stdin`/`stdout` are mutable
// globals and so are not concurrency-safe under strict checking.
private let standardInput: Int32 = 0
private let standardOutput: Int32 = 1

func readAllStandardInput() -> String {
    var bytes: [UInt8] = []
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    while true {
        let count = buffer.withUnsafeMutableBytes { raw in
            read(standardInput, raw.baseAddress, raw.count)
        }
        if count <= 0 { break }
        bytes.append(contentsOf: buffer[0..<count])
    }
    return String(decoding: bytes, as: UTF8.self)
}

func writeStandardOutput(_ text: String) {
    let bytes = Array(text.utf8)
    bytes.withUnsafeBytes { raw in
        var offset = 0
        while offset < raw.count {
            let written = write(standardOutput, raw.baseAddress! + offset, raw.count - offset)
            if written <= 0 { return }
            offset += written
        }
    }
}

// --- model --------------------------------------------------------------------

func position(of node: some SyntaxProtocol, _ converter: SourceLocationConverter) -> JSON {
    let location = node.startLocation(converter: converter)
    return .object([
        ("line", .int(location.line)),
        ("column", .int(location.column)),
        ("offset", .int(location.offset)),
    ])
}

func severityName(_ severity: DiagnosticSeverity) -> String {
    switch severity {
    case .error: return "error"
    case .warning: return "warning"
    case .note: return "note"
    case .remark: return "remark"
    @unknown default: return "error"
    }
}

/// Walks the declarations an outline view shows.
final class DeclarationCollector: SyntaxVisitor {
    private let converter: SourceLocationConverter
    private(set) var declarations: [JSON] = []

    init(converter: SourceLocationConverter) {
        self.converter = converter
        super.init(viewMode: .sourceAccurate)
    }

    private func record(kind: String, name: String, node: some SyntaxProtocol) {
        declarations.append(
            .object([
                ("kind", .string(kind)),
                ("name", .string(name)),
                ("position", position(of: node, converter)),
            ])
        )
    }

    override func visit(_ node: StructDeclSyntax) -> SyntaxVisitorContinueKind {
        record(kind: "struct", name: node.name.text, node: node)
        return .visitChildren
    }

    override func visit(_ node: ClassDeclSyntax) -> SyntaxVisitorContinueKind {
        record(kind: "class", name: node.name.text, node: node)
        return .visitChildren
    }

    override func visit(_ node: EnumDeclSyntax) -> SyntaxVisitorContinueKind {
        record(kind: "enum", name: node.name.text, node: node)
        return .visitChildren
    }

    override func visit(_ node: ProtocolDeclSyntax) -> SyntaxVisitorContinueKind {
        record(kind: "protocol", name: node.name.text, node: node)
        return .visitChildren
    }

    override func visit(_ node: ActorDeclSyntax) -> SyntaxVisitorContinueKind {
        record(kind: "actor", name: node.name.text, node: node)
        return .visitChildren
    }

    override func visit(_ node: FunctionDeclSyntax) -> SyntaxVisitorContinueKind {
        record(kind: "func", name: node.name.text, node: node)
        return .visitChildren
    }

    override func visit(_ node: VariableDeclSyntax) -> SyntaxVisitorContinueKind {
        for binding in node.bindings {
            if let pattern = binding.pattern.as(IdentifierPatternSyntax.self) {
                record(kind: node.bindingSpecifier.text, name: pattern.identifier.text, node: node)
            }
        }
        return .visitChildren
    }
}

extension SyntaxProtocol {
    /// Counts nodes matching a predicate, and tokens among them, in one traversal.
    func counts() -> (nodes: Int, tokens: Int) {
        var nodes = 0
        var tokens = 0
        for node in Syntax(self).children(viewMode: .sourceAccurate) {
            nodes += 1
            if node.is(TokenSyntax.self) { tokens += 1 }
            let child = node.counts()
            nodes += child.nodes
            tokens += child.tokens
        }
        return (nodes, tokens)
    }
}

// --- main ---------------------------------------------------------------------

let source = readAllStandardInput()

// ContinuousClock rather than Dispatch: Dispatch is not part of the wasm SDK.
let clock = ContinuousClock()
let started = clock.now
let tree = Parser.parse(source: source)
let elapsed = clock.now - started

let converter = SourceLocationConverter(fileName: "input.swift", tree: tree)

var diagnostics: [JSON] = []
var hasError = false
for diagnostic in ParseDiagnosticsGenerator.diagnostics(for: tree) {
    let severity = severityName(diagnostic.diagMessage.severity)
    if severity == "error" { hasError = true }
    let location = diagnostic.location(converter: converter)
    diagnostics.append(
        .object([
            ("severity", .string(severity)),
            ("message", .string(diagnostic.message)),
            (
                "position",
                .object([
                    ("line", .int(location.line)),
                    ("column", .int(location.column)),
                    ("offset", .int(location.offset)),
                ])
            ),
            ("highlights", .array(diagnostic.highlights.map { .string($0.trimmedDescription) })),
            ("notes", .array(diagnostic.notes.map { .string($0.message) })),
            ("fixIts", .array(diagnostic.fixIts.map { .string($0.message.message) })),
        ])
    )
}

let collector = DeclarationCollector(converter: converter)
collector.walk(tree)

let totals = tree.counts()
let milliseconds =
    Int(elapsed.components.seconds) * 1000
    + Int(elapsed.components.attoseconds / 1_000_000_000_000_000)

let result = JSON.object([
    ("ok", .bool(!hasError)),
    ("diagnostics", .array(diagnostics)),
    ("declarations", .array(collector.declarations)),
    (
        "statistics",
        .object([
            ("sourceBytes", .int(source.utf8.count)),
            ("tokens", .int(totals.tokens)),
            ("nodes", .int(totals.nodes)),
            ("parseMilliseconds", .int(milliseconds)),
        ])
    ),
])

writeStandardOutput(result.serialized + "\n")
