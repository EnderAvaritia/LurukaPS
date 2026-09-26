import { bytes } from './player.js'
export function initializeCharacterFormation(tables, state) {
    if (state.initialFormationVersion >= 2) return false
    const groups = state.player.group_mgrs.find((m) => m.type === 1)?.groups
    if (!groups) return false
    const key = state.player.basic_info.sex === 1 ? 'AVATAR_HERO_ID_MALE' : 'AVATAR_HERO_ID_FEMALE'
    const id = Number(tables.get('game').find((row) => row.title === key)?.value),
        main = state.player.heros_info.heros.find((h) => h.conf_id === id)
    if (!main) throw Error('Configured protagonist is not available')
    const restoreCompanion = () => {
        if (
            !(state.tasks ?? []).some((t) => [106001, 106002].includes(t.task_id)) ||
            (main.pet_id && main.pet_id !== '0')
        )
            return false
        const old = state.player.heros_info.heros[0],
            pet = state.pets.find((p) => p.guid === old.pet_id && p.hero_id === old.guid)
        if (
            !pet ||
            old.guid === main.guid ||
            groups.filter((g) => g.id !== 0).some((g) => g.heros.some((h) => h.hero_id === old.guid))
        )
            return false
        old.pet_id = '0'
        main.pet_id = pet.guid
        pet.hero_id = main.guid
        for (const g of groups)
            for (const slot of g.heros)
                if (slot.hero_id === main.guid && (!slot.pet_id || slot.pet_id === '0')) slot.pet_id = pet.guid
        return true
    }
    if (state.initialFormationVersion === 1) {
        const changed = restoreCompanion()
        state.initialFormationVersion = 2
        return changed
    }
    const legacy = state.player.heros_info.heros.slice(0, 3).map((h) => h.guid)
    for (const g of groups) {
        if (g.id === 0) continue
        const empty = g.heros.every((h) => !h.hero_id || h.hero_id === '0')
        const oldDefault =
            g.heros.length === 3 &&
            g.heros.every((h, i) => h.hero_id === legacy[i] && (!h.pet_id || h.pet_id === '0')) &&
            g.control === legacy[0]
        if (!empty && !oldDefault) continue
        g.heros = Array.from({ length: 3 }, () => ({ hero_id: '0', pet_id: '0' }))
        g.control = '0'
        if (g.id === 1 && state.characterCustomized) {
            g.heros[0].hero_id = main.guid
            g.control = main.guid
        }
    }
    if (state.characterCustomized) {
        restoreCompanion()
        state.initialFormationVersion = 2
    }
    return true
}
// CBT3 L_PlayerStore:getIsNewPlayer uses the first character of the decoded
// player name. Legacy placeholder names omitted the required '&' prefix.
export function repairCharacterCreationMarker(state) {
    if (state.characterCustomized || state.player.basic_info.name !== bytes('AzurPlayer')) return false
    if (!(state.tasks ?? []).some((t) => t.task_id === 106001)) return false
    state.player.basic_info.name = bytes('&AzurPlayer')
    return true
}
