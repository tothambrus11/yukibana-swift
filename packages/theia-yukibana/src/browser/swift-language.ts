import { injectable } from "@theia/core/shared/inversify";
import { FrontendApplicationContribution } from "@theia/core/lib/browser";
import * as monaco from "@theia/monaco-editor-core";

export const SWIFT_LANGUAGE_ID = "swift";

/**
 * Registers Swift with Monaco.
 *
 * Without this a .swift file opens as "Plain Text" — no highlighting, no comment
 * toggling, no bracket matching. Monaco ships no Swift grammar, and Theia's TextMate
 * support expects a VS Code extension to supply one, so this is a Monarch definition:
 * a tokenizer, not a parser. Anything needing real structure — diagnostics, outline —
 * comes from swift-syntax compiled to wasm, which already knows the language properly.
 */
@injectable()
export class SwiftLanguageContribution implements FrontendApplicationContribution {
    initialize(): void {
        if (monaco.languages.getLanguages().some((l) => l.id === SWIFT_LANGUAGE_ID)) {
            return;
        }

        monaco.languages.register({
            id: SWIFT_LANGUAGE_ID,
            extensions: [".swift"],
            aliases: ["Swift", "swift"],
            mimetypes: ["text/x-swift"],
        });

        monaco.languages.setLanguageConfiguration(SWIFT_LANGUAGE_ID, {
            comments: { lineComment: "//", blockComment: ["/*", "*/"] },
            brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
            autoClosingPairs: [
                { open: "{", close: "}" },
                { open: "[", close: "]" },
                { open: "(", close: ")" },
                { open: '"', close: '"', notIn: ["string"] },
            ],
            surroundingPairs: [
                { open: "{", close: "}" },
                { open: "[", close: "]" },
                { open: "(", close: ")" },
                { open: '"', close: '"' },
            ],
            indentationRules: {
                increaseIndentPattern: /^.*\{[^}"']*$|^.*\([^)"']*$|^\s*(case|default)\b.*:\s*$/,
                decreaseIndentPattern: /^\s*[})\]]|^\s*(case|default)\b.*:\s*$/,
            },
        });

        monaco.languages.setMonarchTokensProvider(SWIFT_LANGUAGE_ID, {
            defaultToken: "",
            tokenPostfix: ".swift",
            keywords: [
                "associatedtype", "class", "deinit", "enum", "extension", "fileprivate",
                "func", "import", "init", "inout", "internal", "let", "open", "operator",
                "private", "precedencegroup", "protocol", "public", "rethrows", "static",
                "struct", "subscript", "typealias", "var", "actor", "macro",
                "break", "case", "catch", "continue", "default", "defer", "do", "else",
                "fallthrough", "for", "guard", "if", "in", "repeat", "return", "throw",
                "switch", "where", "while",
                "as", "any", "await", "false", "is", "nil", "self", "Self", "super",
                "throws", "true", "try", "async", "consume", "borrowing", "consuming",
                "some", "each", "sending",
                "associativity", "convenience", "didSet", "dynamic", "final", "get",
                "indirect", "infix", "lazy", "mutating", "nonmutating", "optional",
                "override", "postfix", "prefix", "required", "set", "unowned", "weak",
                "willSet", "package", "nonisolated", "isolated",
            ],
            // Types are not resolvable by a tokenizer; capitalisation is the convention
            // Swift itself relies on, and matches how editors highlight it before a
            // compiler has run.
            typeKeywords: [
                "Int", "Int8", "Int16", "Int32", "Int64", "UInt", "UInt8", "UInt16",
                "UInt32", "UInt64", "Double", "Float", "Bool", "String", "Character",
                "Array", "Dictionary", "Set", "Optional", "Any", "AnyObject", "Void",
                "Result", "Error", "Task", "Sequence", "Collection",
            ],
            operators: [
                "=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=", "&&", "||",
                "++", "--", "+", "-", "*", "/", "&", "|", "^", "%", "<<", ">>", "+=",
                "-=", "*=", "/=", "&=", "|=", "^=", "%=", "->", "...", "..<", "??",
            ],
            symbols: /[=><!~?:&|+\-*/^%]+/,
            escapes: /\\(?:[abfnrtv\\"']|u\{[0-9A-Fa-f]{1,8}\})/,
            tokenizer: {
                root: [
                    [/@[a-zA-Z_]\w*/, "annotation"],
                    [/#[a-zA-Z_]\w*/, "keyword.directive"],
                    [
                        /[a-zA-Z_]\w*/,
                        {
                            cases: {
                                "@typeKeywords": "type.identifier",
                                "@keywords": "keyword",
                                "@default": "identifier",
                            },
                        },
                    ],
                    [/[A-Z][\w$]*/, "type.identifier"],
                    { include: "@whitespace" },
                    [/[{}()[\]]/, "@brackets"],
                    [
                        /@symbols/,
                        { cases: { "@operators": "operator", "@default": "" } },
                    ],
                    [/\d*\.\d+([eE][-+]?\d+)?/, "number.float"],
                    [/0[xX][0-9a-fA-F_]+/, "number.hex"],
                    [/0[bB][01_]+/, "number.binary"],
                    [/[\d_]+/, "number"],
                    [/[;,.]/, "delimiter"],
                    [/"""/, { token: "string.quote", bracket: "@open", next: "@multiline" }],
                    [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
                ],
                whitespace: [
                    [/[ \t\r\n]+/, ""],
                    [/\/\*/, "comment", "@comment"],
                    [/\/\/.*$/, "comment"],
                ],
                comment: [
                    [/[^/*]+/, "comment"],
                    [/\/\*/, "comment", "@push"], // Swift block comments nest.
                    [/\*\//, "comment", "@pop"],
                    [/[/*]/, "comment"],
                ],
                string: [
                    [/[^\\"\\\\]+/, "string"],
                    [/\\\(/, { token: "delimiter.bracket", next: "@interpolation" }],
                    [/@escapes/, "string.escape"],
                    [/\\./, "string.escape.invalid"],
                    [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
                ],
                multiline: [
                    [/[^\\"]+/, "string"],
                    [/\\\(/, { token: "delimiter.bracket", next: "@interpolation" }],
                    [/@escapes/, "string.escape"],
                    [/"""/, { token: "string.quote", bracket: "@close", next: "@pop" }],
                    [/"/, "string"],
                ],
                // String interpolation is real Swift code, so recurse into root.
                interpolation: [
                    [/\)/, { token: "delimiter.bracket", next: "@pop" }],
                    { include: "root" },
                ],
            },
        });
    }
}
