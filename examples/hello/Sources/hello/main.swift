// The Stage 0 fixture: a program that exercises enough of the standard library
// (generics, protocols, string interpolation, collections, error handling) that a
// successful wasm run means more than "the linker produced a file".

struct Fibonacci: Sequence, IteratorProtocol {
    private var current = 0
    private var upcoming = 1

    mutating func next() -> Int? {
        defer {
            let sum = current + upcoming
            current = upcoming
            upcoming = sum
        }
        return current
    }
}

enum GreetingError: Error {
    case empty
}

func greet(_ name: String) throws -> String {
    guard !name.isEmpty else { throw GreetingError.empty }
    return "Hello from Swift on WebAssembly, \(name)!"
}

let name = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "browser"
print(try greet(name))

let fibs = Array(Fibonacci().prefix(10))
print("fib: \(fibs.map(String.init).joined(separator: ", "))")

do {
    _ = try greet("")
} catch {
    print("caught: \(error)")
}
