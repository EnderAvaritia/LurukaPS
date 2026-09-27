import { bytes } from './player.js'

const INITIAL_FORMATION_VERSION = 3
const blankGroup = (group) =>
    group.heros.every((slot) => !slot.hero_id || slot.hero_id === '0') && (!group.control || group.control === '0')

export function initializeCharacterFormation(tables, state) {
    if (state.initialFormationVersion >= INITIAL_FORMATION_VERSION) return false
    const groups = state.player.group_mgrs.find((m) => m.type === 1)?.groups
    if (!groups) return false
    const game = tables.get('game'),
        maleId = Number(game.find((row) => row.title === 'AVATAR_HERO_ID_MALE')?.value),
        femaleId = Number(game.find((row) => row.title === 'AVATAR_HERO_ID_FEMALE')?.value),
        id = state.player.basic_info.sex === 1 ? maleId : femaleId,
        main = state.player.heros_info.heros.find((h) => h.conf_id === id),
        heroes = state.player.heros_info.heros,
        legacy = heroes.slice(0, 3).map((h) => h.guid),
        placeholder = heroes[0]?.guid
    if (!main) throw Error('Configured protagonist is not available')
    if (!placeholder) throw Error('Starter placeholder hero is not available')

    const isDefaultParty = (group) =>
        group.heros.length === 3 &&
        group.heros.every((slot, i) => slot.hero_id === legacy[i]) &&
        group.control === legacy[0]
    const isPlaceholderParty = (group) =>
        group.heros.length === 3 &&
        group.heros[0].hero_id === placeholder &&
        group.heros.slice(1).every((slot) => !slot.hero_id || slot.hero_id === '0') &&
        group.control === placeholder
    const isLegacySelectedParty = (group) =>
        group.heros.length === 3 &&
        group.heros[0].hero_id === main.guid &&
        group.heros[1].hero_id === legacy[1] &&
        group.heros[2].hero_id === legacy[2] &&
        group.control === main.guid
    const setParty = (group, ids) => {
        group.heros = Array.from({ length: 3 }, (_, i) => ({
            hero_id: ids[i] ?? '0',
            pet_id: '0',
        }))
        group.control = ids[0] ?? '0'
    }
    const restoreCompanion = () => {
        if (
            !(state.tasks ?? []).some((t) => [106001, 106002].includes(t.task_id)) ||
            (main.pet_id && main.pet_id !== '0')
        )
            return false
        const old = heroes[0],
            pet = state.pets.find((p) => p.guid === old.pet_id && p.hero_id === old.guid)
        if (
            !pet ||
            old.guid === main.guid ||
            groups.filter((g) => g.id !== 0).some((g) => g.heros.some((slot) => slot.hero_id === old.guid))
        )
            return false
        old.pet_id = '0'
        main.pet_id = pet.guid
        pet.hero_id = main.guid
        for (const group of groups)
            for (const slot of group.heros)
                if (slot.hero_id === main.guid && (!slot.pet_id || slot.pet_id === '0')) slot.pet_id = pet.guid
        return true
    }

    let changed = false
    if (!state.characterCustomized) {
        // Keep one valid actor so the client can finish loading, but leave the
        // remaining nine teams empty until the player chooses a protagonist.
        for (const group of groups) {
            if (group.id === 0) continue
            if (group.id === 1) {
                if (blankGroup(group) || isDefaultParty(group)) {
                    setParty(group, [placeholder])
                    changed = true
                }
            } else if (isDefaultParty(group)) {
                setParty(group, [])
                changed = true
            }
        }
        return changed
    }

    for (const group of groups) {
        if (group.id === 0) continue
        if (
            group.id === 1 &&
            (blankGroup(group) || isPlaceholderParty(group) || isDefaultParty(group) || isLegacySelectedParty(group))
        ) {
            setParty(group, [main.guid])
            changed = true
        } else if (group.id !== 1 && isDefaultParty(group)) {
            // Version 3 removes each exact legacy default party, even when the
            // same formation was deliberately configured by the player.
            setParty(group, [])
            changed = true
        }
    }
    changed = restoreCompanion() || changed
    state.initialFormationVersion = INITIAL_FORMATION_VERSION
    return changed
}

// CBT3 L_PlayerStore:getIsNewPlayer uses the first character of the decoded
// player name. Legacy placeholder names omitted the required '&' prefix.
export function repairCharacterCreationMarker(state) {
    if (state.characterCustomized || state.player.basic_info.name !== bytes('AzurPlayer')) return false
    if (!(state.tasks ?? []).some((t) => t.task_id === 106001)) return false
    state.player.basic_info.name = bytes('&AzurPlayer')
    return true
}
