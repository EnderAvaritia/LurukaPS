import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { startServer } from '../src/server.js'
import { announcementSnapshot, announcementHttpData } from '../src/announcements.js'
test('CBT3 local notice is delivered by login/TCP and HTTP with a downloadable rich-text body', async () => {
    const s = await startServer({ ...configuration(), database: ':memory:', gamePort: 0, httpPort: 0 }, { warn() {} })
    try {
        const root = 'http://127.0.0.1:' + s.web.address().port
        const data = await (
            await fetch(root + '/version/client/announceV1', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ zoneId: 22, serverId: 320229, channel: '', deviceType: 0 }),
            })
        ).json()
        assert.equal(data.code, 0)
        assert.equal(data.data.infos.length, 1)
        assert.deepEqual(data.data.scrolling, [])
        const notice = data.data.infos[0]
        assert.equal(notice.type, 1)
        assert.equal(notice.tabId, 1)
        assert.equal(notice.showPosition, 2)
        assert.equal(new URL(notice.meta[0].content).origin, root)
        const page = await fetch(notice.meta[0].content)
        assert.equal(page.status, 200)
        assert.match(page.headers.get('content-type'), /text\/html/)
        assert.match(await page.text(), /测试公告/)
        assert.equal((await fetch(root + '/announcements/123.html')).status, 404)
        assert.equal((await fetch(root + '/announcements/900000001.html', { method: 'HEAD' })).status, 200)
        const session = {}
        let seq = 1
        const call = (name, r = {}) => {
            const e = s.protocol.byName.get('CSProto' + name)
            return s.game.dispatch(session, { id: e.id, seq: seq++, payload: s.protocol.encode(e.req, r) })
        }
        const packets = call('EnterGame', { open_id: 'announcement-test' })
        const e = s.protocol.byName.get('CSProtoAnnouncementNotify')
        const p = packets.find((p) => p.id === e.id)
        assert.ok(p)
        const wire = s.protocol.decode(e.rsp, p.payload)
        assert.equal(wire.notics[0].id, notice.id)
        assert.equal(wire.notics[0].meta[0].content, notice.meta[0].content)
        const req = s.protocol.byName.get('CSProtoAnnounceRequest')
        const response = call('AnnounceRequest', { u32: 0 }).find((p) => p.id === req.id)
        assert.equal(s.protocol.decode(req.rsp, response.payload).notics[0].id, notice.id)
        assert.equal(announcementHttpData(root, 4102444801).infos.length, 0)
        assert.equal(announcementSnapshot(root, 4102444801).notics.length, 0)
    } finally {
        await s.close()
    }
})
