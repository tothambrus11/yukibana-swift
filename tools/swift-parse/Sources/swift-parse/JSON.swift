// A minimal JSON writer.
//
// Foundation's JSONEncoder would be the obvious choice, but importing Foundation into a
// wasm module costs tens of megabytes that the browser has to download and compile, and
// this tool needs exactly one direction of exactly one shape. swift-syntax itself has no
// Foundation dependency, so avoiding it here keeps Foundation out of the module entirely.

enum JSON {
    case string(String)
    case int(Int)
    case bool(Bool)
    case array([JSON])
    case object([(String, JSON)])

    func write(into out: inout String) {
        switch self {
        case .string(let value):
            JSON.writeString(value, into: &out)
        case .int(let value):
            out += String(value)
        case .bool(let value):
            out += value ? "true" : "false"
        case .array(let elements):
            out += "["
            for (index, element) in elements.enumerated() {
                if index > 0 { out += "," }
                element.write(into: &out)
            }
            out += "]"
        case .object(let members):
            out += "{"
            for (index, member) in members.enumerated() {
                if index > 0 { out += "," }
                JSON.writeString(member.0, into: &out)
                out += ":"
                member.1.write(into: &out)
            }
            out += "}"
        }
    }

    var serialized: String {
        var out = ""
        write(into: &out)
        return out
    }

    private static func writeString(_ value: String, into out: inout String) {
        out += "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                // Control characters must be escaped; everything else is emitted as
                // UTF-8, which JSON permits.
                if scalar.value < 0x20 {
                    let hex = String(scalar.value, radix: 16)
                    out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
    }
}
