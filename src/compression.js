// CBT3: CompressUtility.DecompressLZ4 RVA 0x448B1B0 calls raw-block LZ4 decode.
export function decompressLz4(input, maxOutput = 4 * 1024 * 1024) {
    const out = Buffer.alloc(maxOutput)
    let ip = 0,
        op = 0
    const read = () => {
        if (ip >= input.length) throw Error('Truncated LZ4 block')
        return input[ip++]
    }
    const length = (n) => {
        if (n === 15) {
            let b
            do {
                b = read()
                n += b
                if (n > maxOutput) throw Error('LZ4 size limit')
            } while (b === 255)
        }
        return n
    }
    while (ip < input.length) {
        const token = read()
        const literals = length(token >>> 4)
        if (ip + literals > input.length || op + literals > maxOutput) throw Error('Invalid LZ4 literals')
        input.copy(out, op, ip, ip + literals)
        ip += literals
        op += literals
        if (ip === input.length) break
        const offset = read() | (read() << 8)
        if (offset === 0 || offset > op) throw Error('Invalid LZ4 offset')
        const match = length(token & 15) + 4
        if (op + match > maxOutput) throw Error('LZ4 output limit')
        for (let i = 0; i < match; i++) out[op + i] = out[op - offset + i]
        op += match
    }
    return out.subarray(0, op)
}
