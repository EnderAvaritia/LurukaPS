import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeFrame, decodeFrame, FrameReader, HEADER_SIZE } from '../src/wire.js'
import { decompressLz4 } from '../src/compression.js'
import key from '../data/wire-key.json' with { type: 'json' }
test('CBT3 header matches native layout, uint32 sequences and uint64 signature', () => {
    const b = encodeFrame(
        { id: 5001, error: 1024, seq: 0x12345678, pushSeq: 0xabcdef01, signature: 0xfedcba9876543210n },
        Buffer.from([8, 1]),
    )
    const plain = Buffer.from(b)
    for (let i = 7; i < plain.length; i++) plain[i] ^= key[(Math.floor(plain.length / 3) + i - 7) % key.length]
    assert.equal(HEADER_SIZE, 25)
    assert.equal(plain.subarray(0, 25).toString('hex'), '0000001b001389040012345678abcdef01fedcba9876543210')
    const p = decodeFrame(b)
    assert.equal(p.seq, 0x12345678)
    assert.equal(p.signature, 0xfedcba9876543210n)
    assert.deepEqual(p.payload, Buffer.from([8, 1]))
})
test('fragmentation, concatenation, and malformed lengths', () => {
    const a = encodeFrame({ id: 5002, seq: 99999 }, Buffer.from('abc')),
        b = encodeFrame({ id: 503 }, Buffer.from('xyz'))
    const r = new FrameReader()
    const output = []
    for (const x of Buffer.concat([a, b])) output.push(...r.feed(Buffer.from([x])))
    assert.equal(output.length, 2)
    assert.equal(output[0].seq, 99999)
    assert.equal(output[1].payload.toString(), 'xyz')
    for (const n of [0, 21, 24, 0xffffffff]) {
        const bad = Buffer.alloc(4)
        bad.writeUInt32BE(n)
        assert.throws(() => new FrameReader().feed(bad))
    }
})
test('raw LZ4 handles overlapping matches and rejects bad blocks', () => {
    assert.equal(decompressLz4(Buffer.from([0x32, 97, 98, 99, 3, 0, 0x10, 33]), 100).toString(), 'abcabcabc!')
    assert.throws(() => decompressLz4(Buffer.from([0, 0, 0])))
    assert.throws(() => decompressLz4(Buffer.from([0xf0])))
    assert.throws(() => decompressLz4(Buffer.from([0x32, 97, 98, 99, 3, 0]), 8))
})
