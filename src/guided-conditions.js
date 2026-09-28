import fs from 'node:fs'

const conditions = new Map(
    JSON.parse(fs.readFileSync(new URL('../data/task-tables/task_condition.json', import.meta.url), 'utf8')).map(
        (row) => [row.id, row],
    ),
)
const buildingGroups = new Map(
    JSON.parse(fs.readFileSync(new URL('../data/client-tables/home_building.json', import.meta.url), 'utf8')).map(
        (row) => [row.id, row.groupId],
    ),
)
const fieldGroups = new Set([2016, 2033])
const petGroups = new Map(
    JSON.parse(fs.readFileSync(new URL('../data/task-tables/pet_rank.json', import.meta.url), 'utf8')).map((row) => [
        row.petId,
        row.petGroup,
    ]),
)

export function guidedRequirement(id) {
    const param = Number(conditions.get(id)?.param)
    return Number.isInteger(param) && param > 0 ? param : 1
}

export function guidedConditionValue(id, state, context) {
    const row = conditions.get(id)
    if (!row) return 0
    const parts = String(row.condition || '')
        .split('|')
        .map(Number)
    // TODO: remove this local bypass after Kibo Duel condition50002 has a
    // server implementation and its result has been verified against CBT3.
    // TODO: remove after server-side Kibo Duel condition 50002 is
    // implemented and its result is validated against the official server.
    if (context && parts[0] === 50002) return guidedRequirement(id)
    // CBT3 common_condition 12030 is ActivationPoint. The local server seeds
    // all configured transfer points, so evaluate the configured point ID
    // against that authoritative unlocked-point list.
    if (
        parts.length === 2 &&
        parts[0] === 12030 &&
        Number.isInteger(parts[1]) &&
        parts[1] > 0
    )
        return (state.world?.points ?? []).includes(parts[1]) ? 1 : 0
    // CBT3 conditionNode_12027 reads HomeStore buildingBag.used_num by group.
    if (
        parts.length === 3 &&
        parts[0] === 12027 &&
        Number.isInteger(parts[1]) &&
        Number.isInteger(parts[2]) &&
        parts[2] > 0
    ) {
        // The client counts dry and fertile fields from placed home builds.
        if (fieldGroups.has(parts[1]))
            return (state.home?.builds ?? []).filter((build) => buildingGroups.get(build.build_id) === parts[1]).length
        return (state.home?.inventory ?? []).reduce(
            (sum, entry) =>
                sum + (buildingGroups.get(entry.build_id) === parts[1] ? Math.max(0, Number(entry.used_num) || 0) : 0),
            0,
        )
    }
    // common_condition 12067 is PortableProduction. The table specifies the
    // produced reward type and ID; only settled quick-production output counts.
    if (
        parts.length === 4 &&
        parts[0] === 12067 &&
        [parts[1], parts[2], parts[3]].every((n) => Number.isInteger(n) && n > 0)
    )
        return state.simpleProduced?.[`${parts[1]}:${parts[2]}`] ?? 0
    // BuildingCollectionSituation counts products collected from the configured
    // building recipe. craftCounts advances only when ProductFinish grants the
    // output, so already collected items remain credited after they are used.
    if (
        parts.length === 4 &&
        parts[0] === 13025 &&
        [parts[1], parts[2], parts[3], row.formulaId].every((n) => Number.isInteger(n) && n > 0)
    )
        return state.home?.craftCounts?.[row.formulaId] ?? 0
    // HomeHubKibo mode 1 counts pets actually stationed in the home hub.
    if (
        parts.length === 3 &&
        parts[0] === 12070 &&
        parts[1] === 1 &&
        Number.isInteger(parts[2]) &&
        parts[2] > 0
    ) {
        const stationed = new Set((state.home?.stationPets ?? []).map(String))
        return (state.pets ?? []).filter((pet) => stationed.has(String(pet.guid)) && pet.work_status === 7).length
    }
    // common_condition 12040 is HavePet. Its rows identify a pet group,
    // optional exact pet ID (0 means any within the group), and count.
    if (
        parts.length === 4 &&
        parts[0] === 12040 &&
        Number.isInteger(parts[1]) &&
        parts[1] > 0 &&
        Number.isInteger(parts[2]) &&
        parts[2] >= 0 &&
        Number.isInteger(parts[3]) &&
        parts[3] > 0
    )
        return (state.pets ?? []).filter(
            (p) => petGroups.get(p.config_id) === parts[1] && (!parts[2] || p.config_id === parts[2]),
        ).length
    return 0
}
