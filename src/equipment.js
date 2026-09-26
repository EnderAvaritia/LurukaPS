// Wire advance is one-based. Client UI and skill lookup both subtract one.
export function repairSoulEssenceStars(state) {
    for (const item of state.player.soulessence_infos.soulessences) {
        if (item.advance === undefined || item.advance === 0) item.advance = 1
    }
}
export function soulEssenceGrade(item) {
    return Math.max(0, (item.advance ?? 1) - 1)
}
