import fs from 'node:fs'
const notices = JSON.parse(
    fs.readFileSync(new URL('../configs/announcements.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''),
)
export function announcementHttpData(baseUrl, now) {
    return {
        infos: notices
            .filter((n) => !n.hide && n.id > 0 && n.publishTime <= now && now <= n.endTime)
            .map((n) => ({
                id: n.id,
                name: 'LurukaPS',
                tabId: n.tabId,
                type: n.type,
                showPosition: n.showPosition,
                orderId: n.orderId,
                hide: n.hide,
                publishTime: n.publishTime,
                endTime: n.endTime,
                jumpId: '',
                meta: n.meta.map((m) => ({
                    ...m,
                    content: new URL('/announcements/' + n.id + '.html?v=' + n.revision, baseUrl).href,
                })),
            })),
        scrolling: [],
        gateway: {
            id: 0,
            meta: [],
            hide: true,
            name: 'LurukaPS',
            tabId: 1,
            type: 1,
            showPosition: 1,
            orderId: 0,
            publishTime: 0,
            endTime: 4102444800,
            jumpId: '',
        },
    }
}
export function announcementSnapshot(baseUrl, now) {
    return {
        notics: announcementHttpData(baseUrl, now).infos.map((n) => ({
            meta: n.meta,
            publish_time: String(n.publishTime),
            end_time: String(n.endTime),
            order_id: n.orderId,
            tab_id: n.tabId,
            id: n.id,
            type: n.type,
            jump_id: n.jumpId,
            hide: n.hide,
            showPosition: n.showPosition,
        })),
        scrolling: [],
    }
}
export function announcementBody(id, now) {
    const n = notices.find((n) => String(n.id) === id && !n.hide && n.publishTime <= now && now <= n.endTime)
    return n?.body
}
