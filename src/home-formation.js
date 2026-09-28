export function isHomeMap(tables, state) {
    const homeMapId = Number(tables.get('game').find((row) => row.title === 'HOME_ID')?.value)
    return Number.isInteger(homeMapId) && homeMapId > 0 && state.world?.map_id === homeMapId
}

// Migrate saves affected by the former solo-team workaround. The client's
// HomePlayerUnitAdapter builds its own default-hero formation independently.
export function restoreLegacyHomeFormation(state) {
    const backup = state.homeFormationBackup
    if (!backup) return false
    if (backup.type !== 1 || !Array.isArray(backup.groups)) throw Error('Invalid saved home formation backup')
    const managers = state.player.group_mgrs,
        index = managers.findIndex((manager) => manager.type === 1)
    if (index < 0) managers.push(backup)
    else managers[index] = backup
    delete state.homeFormationBackup
    return true
}
