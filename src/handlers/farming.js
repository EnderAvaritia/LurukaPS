import { ensureHome } from '../home.js'
import { validatePlacement } from '../home-grid.js'
import { ensure } from './common.js'

function homeInScene(tables, state) {
    const mapId = Number(tables.get('game').find((row) => row.title === 'HOME_ID')?.value)
    ensure(state.world.map_id === mapId, 'Field work requires the home scene')
    return ensureHome(tables, state)
}

export function registerFarming(on, tables) {
    on('FieldOpen', (c, r) => {
        const home = homeInScene(tables, c.state),
            fieldType = tables.find('home_fieldtype', r.field_type)
        ensure(fieldType?.homeBuildingId && r.locate, 'Unknown field type or location')
        const buildId = fieldType.homeBuildingId,
            existing = home.builds.find((build) =>
                build.build_id === buildId &&
                build.locate.block_id === r.locate.block_id &&
                build.locate.anchor === r.locate.anchor,
            )
        if (existing) return existing
        const group = validatePlacement(tables, c.state, buildId, r.locate),
            maxGuid = [...home.builds, ...(home.storedBuilds ?? [])].reduce(
                (max, build) => Math.max(max, build.guid), 0,
            ),
            guid = Math.max(home.nextBuildGuid || 1, maxGuid + 1)
        ensure(guid <= 0xffffffff, 'Home building GUID space exhausted')
        home.nextBuildGuid = guid + 1
        const build = {
            guid,
            build_id: buildId,
            build_type: group.type,
            status: 1,
            locate: { ...r.locate, direction: r.locate.direction ?? 0 },
            crop_info: {
                field_type: r.field_type,
                water_num: fieldType.waterMax,
                water_max: fieldType.waterMax,
            },
        }
        home.builds.push(build)
        c.state.homeRevision = (c.state.homeRevision || 0) + 1
        return build
    })

    on('FieldClose', (c, r) => {
        const home = homeInScene(tables, c.state),
            build = home.builds.find((item) => item.guid === r.field_id)
        ensure(build && tables.get('home_fieldtype').some((row) => row.homeBuildingId === build.build_id),
            'Farmland is not owned')
        ensure(!build.crop_info?.seed_id, 'Planted farmland cannot be closed')
        home.builds = home.builds.filter((item) => item.guid !== build.guid)
        c.state.homeRevision = (c.state.homeRevision || 0) + 1
        return { rewards: [] }
    })
}
