export function releaseLedger(state, kind, now, resetHour = 4) {
    if (!Number.isInteger(resetHour) || resetHour < 0 || resetHour > 23 || !Number.isSafeInteger(now) || now < 0)
        throw Error('Invalid release clock')
    const period = Math.floor((now + 8 * 3600 - resetHour * 3600) / 86400),
        old = state.releaseLedgers?.[kind]
    return old?.period === period ? { ...old } : { period, count: 0, lastTime: 0 }
}
export function releaseFields(state, kind, now, resetHour = 4) {
    const record = releaseLedger(state, kind, now, resetHour)
    return { free_reward_num: record.count, last_free_time: record.lastTime }
}
