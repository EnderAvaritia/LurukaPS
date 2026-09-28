import { technologyPayload } from './technology.js'
import { ensure } from './handlers/common.js'
export function ensureHome(tables, state) {
    if (state.home) return state.home
    const raw = tables.get('game').find((x) => x.title === 'HOME_DEFAULT_PLACEMENT')?.value
    const values = String(raw || '')
        .split('|')
        .map(Number)
    ensure(
        values.length === 5 && values.every(Number.isInteger) && values[0] === 13,
        'Invalid default home placement',
        1007,
    )
    const [, id, block, anchor, direction] = values,
        config = tables.find('home_building', id)
    ensure(config && tables.find('home_block', block), 'Missing initial home configuration', 1007)
    const group = tables.get('home_building_group').find((g) => g.groupId === config.groupId)
    ensure(group, 'Missing home building group', 1007)
    state.home = {
        name: Buffer.from('我的家园').toString('base64'),
        level: state.player.basic_info.home_lv || 1,
        exp: 0,
        inventory: [{ build_id: id, total_num: 1, used_num: 1, unlock: true }],
        builds: [
            {
                guid: 1,
                build_id: id,
                build_type: group.type,
                status: 1,
                locate: { block_id: block, anchor, direction },
            },
        ],
        shortcuts: [],
        wishlist: [],
        nextBuildGuid: 2,
        nextWishUid: 1,
    }
    state.homeRevision = (state.homeRevision || 0) + 1
    return state.home
}
export function homePayload(tables, state) {
    const h = ensureHome(tables, state)
    return {
        technology: technologyPayload(tables, state),
        home_lv: h.level,
        home_name: h.name,
        builds: h.inventory,
        home_builds: h.builds,
        shortcut_bars: h.shortcuts,
        wishlist: h.wishlist,
        formula: Object.entries(h.craftCounts || {}).map(([id, count]) => ({
            product_id: Number(id),
            craft_count: count,
        })),
        home_hub: { pos_infos: [], station_pets: h.stationPets ?? [] },
        home_level_new_base: { level: h.level, exp: h.exp, option_setting: 0 },
    }
}

function addBuildShortcut(home, id) {
    let bar = home.shortcuts.find((entry) => entry.type === 1)
    if (!bar) {
        bar = { type: 1, item_id: [] }
        home.shortcuts.push(bar)
    }
    if (bar.item_id.includes(id)) return false
    const empty = bar.item_id.findIndex((item) => item <= 0)
    if (empty >= 0) bar.item_id[empty] = id
    else if (bar.item_id.length < 32) bar.item_id.push(id)
    else return false
    return true
}

export function refreshAutoBuildShortcut(home, id) {
    const available = home.inventory.find((building) => building.build_id === id)
    const autoIds = (home.autoBuildShortcutIds ??= [])
    const bar = home.shortcuts.find((entry) => entry.type === 1)
    if (available?.unlock && available.total_num > available.used_num) {
        if (!home.suppressedBuildShortcuts?.includes(id) && addBuildShortcut(home, id)) autoIds.push(id)
    } else if (autoIds.includes(id)) {
        if (bar) bar.item_id = bar.item_id.map((item) => item === id ? 0 : item)
        home.autoBuildShortcutIds = autoIds.filter((item) => item !== id)
    }
}

export function reconcileHomeBuildShortcuts(tables, state) {
    const home = ensureHome(tables, state)
    if (home.buildShortcutVersion === 2) return
    if (home.buildShortcutVersion === 1) {
        const bar = home.shortcuts.find((entry) => entry.type === 1)
        if (bar) {
            bar.item_id = bar.item_id.map((id) => {
                const building = home.inventory.find((entry) => entry.build_id === id)
                return building?.unlock && building.total_num > building.used_num ? id : 0
            })
            home.autoBuildShortcutIds = bar.item_id.filter((id) => id > 0)
        }
    }
    for (const building of home.inventory)
        if (building.unlock && building.total_num > building.used_num && tables.find('home_building', building.build_id))
            refreshAutoBuildShortcut(home, building.build_id)
    home.buildShortcutVersion = 2
    state.homeRevision = (state.homeRevision || 0) + 1
}

export function addHomeBuildings(tables, state, id, count) {
    const config = tables.find('home_building', id)
    ensure(config, 'Unknown building reward', 1007)
    const home = ensureHome(tables, state)
    let row = home.inventory.find((b) => b.build_id === id)
    if (!row) {
        row = { build_id: id, total_num: 0, used_num: 0, unlock: true }
        home.inventory.push(row)
    }
    ensure(row.total_num + count <= 0xffffffff, 'Building quantity overflow')
    row.total_num += count
    if (count > 0) row.unlock = true
    if (count > 0) refreshAutoBuildShortcut(home, id)
    state.homeRevision = (state.homeRevision || 0) + 1
}
