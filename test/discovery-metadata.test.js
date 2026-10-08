import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { configuration } from '../src/config.js'
import { readAppConfig, signBody, discoveryMetadata } from '../../azurjs/scripts/query-cbt3-discovery.js'
test('signed CBT3 query uses exact UTF8 JSON bytes and refuses an unsuccessful configuration update', () => {
    const raw = '{"timestamp":123,"lang":"chs"}'
    assert.equal(
        signBody(raw, 'test-secret'),
        createHash('sha256')
            .update(raw + 'test-secret')
            .digest('hex'),
    )
    assert.notEqual(signBody(raw, 'test-secret'), signBody(raw + ' ', 'test-secret'))
    assert.throws(
        () => discoveryMetadata({ code: 150002 }, { code: 0, data: { cdn: 'https://example.test' } }, 'source'),
        /unchanged/,
    )
    const c = configuration()
    assert.match(c.hotRevision, /^\d+(\.\d+){4}$/)
    assert.notEqual(c.hotRevision.split('.')[4], c.hotRevision.split('.')[0])
    assert.equal(c.jobName, 'CBT3-Client-PC-Release-V0.3.0')
})
test('appConfig reader checks Unity TextAsset length without requiring a running client', () => {
    // Real appConfig is exercised by the saved successful script request; malformed
    // extent is rejected here before any signing or network operation.
    const dir = fs.mkdtempSync(new URL('./discovery-reader-', import.meta.url))
    const file = dir + '/resources.assets'
    try {
        fs.writeFileSync(
            file,
            Buffer.concat([Buffer.from([255, 255, 255, 127]), Buffer.from('{"innerRegionConfig":{}}')]),
        )
        assert.throws(() => readAppConfig(file), /length/)
    } finally {
        fs.unlinkSync(file)
        fs.rmdirSync(dir)
    }
})
