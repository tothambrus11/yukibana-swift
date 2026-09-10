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

import Foundation
import SwiftDiagnostics
import SwiftParser
import SwiftParserDiagnostics
import SwiftSyntax

struct Position: Encodable {
    let line: Int
    let column: Int
    let offset: Int
}

struct Diagnostic: Encodable {
    let severity: String
    let message: String
    let position: Position
    let highlights: [String]
    let notes: [String]
    let fixIts: [String]
}

struct Declaration: Encodable {
    let kind: String
    let name: String
    let position: Position
}

struct ParseResult: Encodable {
    let ok: Bool
    let diagnostics: [Diagnostic]
    let declarations: [Declaration]
    let statistics: Statistics

    struct Statistics: Encodable {
        let sourceBytes: Int
        let tokens: Int
        let nodes: Int
        let parseMilliseconds: Int
    }
}

/// Walks the top level and one nesting level in, which is all an outline view shows.
final class DeclarationCollector: SyntaxVisitor {
    private let converter: SourceLocationConverter
    private(set) var declarations: [Declaration] = []

    init(converter: SourceLocationConverter) {
        self.converter = converter
        super.init(viewMode: .sourceAccurate)
    }

    private func record(kind: String, name: String, node: some SyntaxProtocol) {
        let location = node.startLocation(converter: converter)
        declarations.append(
            Declaration(
                kind: kind,
                name: name,
                position: Position(
                    line: location.line,
                    column: location.column,
                    offset: location.offset
                )
            )
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

func severityName(_ severity: DiagnosticSeverity) -> String {
    switch severity {
    case .error: return "error"
    case .warning: return "warning"
    case .note: return "note"
    case .remark: return "remark"
    @unknown default: return "error"
    }
}

let source = String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self)

// ContinuousClock rather than Dispatch: Dispatch is not part of the wasm SDK.
let clock = ContinuousClock()
let started = clock.now
let tree = Parser.parse(source: source)
let elapsed = clock.now - started

let converter = SourceLocationConverter(fileName: "input.swift", tree: tree)

let diagnostics = ParseDiagnosticsGenerator.diagnostics(for: tree).map { diagnostic -> Diagnostic in
    let location = diagnostic.location(converter: converter)
    return Diagnostic(
        severity: severityName(diagnostic.diagMessage.severity),
        message: diagnostic.message,
        position: Position(line: location.line, column: location.column, offset: location.offset),
        highlights: diagnostic.highlights.map { $0.trimmedDescription },
        notes: diagnostic.notes.map(\.message),
        fixIts: diagnostic.fixIts.map(\.message.message)
    )
}

let collector = DeclarationCollector(converter: converter)
collector.walk(tree)

let result = ParseResult(
    ok: !diagnostics.contains { $0.severity == "error" },
    diagnostics: diagnostics,
    declarations: collector.declarations,
    statistics: ParseResult.Statistics(
        sourceBytes: source.utf8.count,
        tokens: tree.totalNodes(where: { $0.is(TokenSyntax.self) }),
        nodes: tree.totalNodes(where: { _ in true }),
        parseMilliseconds: Int(elapsed.components.seconds * 1000)
            + Int(elapsed.components.attoseconds / 1_000_000_000_000_000)
    )
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
FileHandle.standardOutput.write(try encoder.encode(result))
FileHandle.standardOutput.write(Data("\n".utf8))

extension SyntaxProtocol {
    /// Counts nodes matching a predicate without materialising the whole sequence twice.
    func totalNodes(where predicate: (Syntax) -> Bool) -> Int {
        var count = 0
        for node in Syntax(self).children(viewMode: .sourceAccurate) {
            if predicate(node) { count += 1 }
            count += node.totalNodes(where: predicate)
        }
        return count
    }
}
