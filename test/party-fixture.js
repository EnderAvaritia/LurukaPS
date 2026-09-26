// Explicit populated party for tests about replacing/swapping owned members.
// New production accounts intentionally start with empty formations.
export function populateParty(state) {
    const group = state.player.group_mgrs[0].groups.find((g) => g.id === 1)
    group.heros = state.player.heros_info.heros.slice(0, 3).map((h) => ({ hero_id: h.guid, pet_id: '0' }))
    group.control = group.heros[0].hero_id
    state.initialFormationVersion = 1
}
