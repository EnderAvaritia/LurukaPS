import { ensure } from './common.js'
import { syncBattle } from '../battle.js'
import { grantRewards } from '../rewards.js'
import { worldSync } from './world.js'
import {
    storyCampaignConfig,
    storyCampaignSnapshot,
    ensureStoryCampaignScene,
    storySceneDefeated,
} from '../story-campaign.js'

export function syncStoryCampaignEnemies(c) {
    const run = c.state.storyCampaign
    if (c.state.combat?.map_id !== run?.map_id) return
    const infos = Object.values(c.state.combat.entities ?? {}).map((enemy) => ({
        uuid: enemy.uuid,
        hp: enemy.hp,
        sp: enemy.sp ?? 0,
        alive_state: enemy.alive_state ?? (enemy.hp > 0 ? 0 : 1),
        reason: 1,
    }))
    if (infos.length) c.pushBefore('CSProtoObjBattleInfoSync', { infos })
}

export function enterStoryCampaignScene(c, r) {
    const run = c.state.storyCampaign
    const requestedScene = r.scene_id || run?.map_id
    ensure(run?.status === 2 && run.scenes.includes(requestedScene), 'Story dungeon is not active', 10275)
    ensure(!r.creator_id || r.creator_id === c.id, 'Dungeon creator mismatch')
    if (requestedScene !== run.map_id) {
        ensure(
            run.completed_scenes.includes(run.map_id) &&
                run.scenes.indexOf(requestedScene) === run.scenes.indexOf(run.map_id) + 1,
            'Previous story dungeon scene is not complete',
        )
        run.map_id = requestedScene
        Object.assign(c.state.world, c.tables.position(storyCampaignConfig(c.tables, 200, 1).scenes[1].point))
        delete c.state.combat
    }
    ensureStoryCampaignScene(c.tables, c.state, c.now)
    c.pushBefore('CSProtoCampaignInfoSync', storyCampaignSnapshot(c.state))
    worldSync({ ...c, push: c.pushBefore }, {}, 256, false)
    syncBattle({ ...c, push: c.pushBefore })
    syncStoryCampaignEnemies(c)
    return {}
}

export function settleStoryCampaignScene(c) {
    const run = c.state.storyCampaign
    if (!run || run.status !== 2 || run.completed_scenes.includes(run.map_id) || c.state.combat?.map_id !== run.map_id)
        return false
    const scene = c.tables.find('dungeon_scene', run.map_id)
    const [kind, spawner, , , count] = String(scene?.victoryCondition).split('#').map(Number)
    const waves = c.tables
        .get(`worldmap_${run.map_id}`)
        .filter((row) => row.spawnerId === spawner)
        .sort((a, b) => a.id - b.id)
    if (kind !== 2500 || waves.length !== count) return false
    let advanced = false
    while ((run.stage_index ?? 0) < waves.length) {
        const row = waves[run.stage_index ?? 0]
        const slots = String(c.tables.find('world_enemy_group', row.expandId)?.enemyList ?? '')
            .split('|')
            .filter(Boolean)
        if (
            !slots.length ||
            !slots.every(
                (_, slot) =>
                    c.state.combat.entities[((3n << 56n) | (BigInt(slot) << 32n) | BigInt(row.id)).toString()]?.hp ===
                    0,
            )
        )
            break
        run.stage_index = (run.stage_index ?? 0) + 1
        advanced = true
    }
    if (!advanced) return false
    c.state.worldObjects = { ...c.state.worldObjects }
    for (const row of c.tables.get(`worldmap_${run.map_id}`)) {
        if (c.tables.find('world_spawner', row.spawnerId)?.objectType !== 50) continue
        const key = `${run.map_id}:${row.id}`,
            old = c.state.worldObjects[key]
        if (!old) continue
        const index = waves.findIndex((entry) => entry.id === row.id)
        const complete = index < run.stage_index
        const record = {
            ...old,
            active: index === run.stage_index,
            complete,
            state_data: { ...old.state_data, step: complete ? 1 : 0, complete },
            expand_data: {
                ...old.expand_data,
                battle_group: {
                    ...old.expand_data?.battle_group,
                    monsters:
                        old.expand_data?.battle_group?.monsters?.map((monster) => ({
                            ...monster,
                            hp: c.state.combat.entities[monster.uid]?.hp ?? monster.hp,
                        })) ?? [],
                },
            },
        }
        c.state.worldObjects[key] = record
    }
    run.scene_objects = c.tables
        .get(`worldmap_${run.map_id}`)
        .map((row) => c.state.worldObjects[`${run.map_id}:${row.id}`])
    if (run.stage_index === waves.length && storySceneDefeated(c.tables, c.state)) run.completed_scenes.push(run.map_id)
    c.push('CSProtoCampaignInfoSync', storyCampaignSnapshot(c.state))
    c.push('CSProtoWorldMapSync', {
        cmd: 47,
        creator_id: c.id,
        map_id: run.map_id,
        map_info: { creator_id: c.id, map_id: run.map_id, objs: run.scene_objects },
    })
    if (!run.completed_scenes.includes(run.map_id)) {
        const next = waves[run.stage_index]
        const infos = Object.values(c.state.combat.entities)
            .filter((enemy) => enemy.object_id === next.id)
            .map((enemy) => ({
                uuid: enemy.uuid,
                hp: enemy.hp,
                sp: enemy.sp ?? 0,
                alive_state: enemy.alive_state ?? 0,
                reason: 1,
            }))
        if (infos.length) c.push('CSProtoObjBattleInfoSync', { infos })
    }
    return true
}

function creditStoryCampaign(c, dungeonId) {
    const clears = (c.state.storyCampaignClears ??= {})
    if (clears[dungeonId]) return false
    clears[dungeonId] = { count: 1, time: c.now }
    const exp = c.tables.find('dungeon', dungeonId)?.userExp
    if (exp > 0) {
        const rewards = grantRewards(c.tables, c.state, [{ itemtype: 10, itemid: 10, itemnum: exp }])
        if (c.state.storyCampaign) c.state.storyCampaign.rewards = rewards
        c.pushBefore?.('CSProtoSyncPlayerData', { basic_info: c.state.player.basic_info })
    }
    return true
}

export function recoverStoryCampaignClear(c) {
    if (c.state.storyCampaignClears?.[10010]) return false
    const task = c.state.tasks?.find((entry) => entry.task_id === 106014)
    if (!task?.nodes.some((node) => node.node_id === 11)) return false
    const scene = c.tables.find('dungeon_scene', 6200)
    const [kind, spawner, , , count] = String(scene?.victoryCondition).split('#').map(Number)
    const groups = c.tables.get('worldmap_6200').filter((row) => row.spawnerId === spawner)
    if (
        kind !== 2500 ||
        groups.length !== count ||
        !groups.every((row) => {
            const saved = c.state.worldObjects?.[`6200:${row.id}`]
            const expected = String(c.tables.find('world_enemy_group', row.expandId)?.enemyList ?? '')
                .split('|')
                .filter(Boolean).length
            return (
                saved?.complete &&
                saved.state_data?.step === 1 &&
                saved.expand_data?.battle_group?.monsters?.length === expected &&
                saved.expand_data.battle_group.monsters.every((monster) => monster.hp === 0)
            )
        })
    )
        return false
    return creditStoryCampaign(c, 10010)
}

export function endStoryCampaignScene(c, r) {
    const run = c.state.storyCampaign
    ensure(run?.status === 2 && c.state.world.map_id === run.map_id, 'No active story dungeon')
    ensure([1, 3, 4].includes(r.result), 'Invalid dungeon result')
    if (r.result === 3) {
        ensure(run.completed_scenes.includes(run.map_id), 'Story dungeon enemies are not defeated')
        run.status = 3
        run.end_time = c.now
        creditStoryCampaign(c, run.dungeon_id)
    } else {
        run.status = r.result
        run.end_time = c.now
    }
    c.pushBefore('CSProtoCampaignInfoSync', storyCampaignSnapshot(c.state))
    return {}
}

export function exitStoryCampaign(c) {
    const run = c.state.storyCampaign
    ensure(run, 'No active story dungeon', 10276)
    if (run.status === 2 && run.completed_scenes.includes(run.map_id) && storySceneDefeated(c.tables, c.state)) {
        run.status = 3
        run.end_time = c.now
        creditStoryCampaign(c, run.dungeon_id)
        c.pushBefore('CSProtoCampaignInfoSync', storyCampaignSnapshot(c.state))
    }
    const final = run.status === 3 ? 5 : 1
    c.pushBefore('CSProtoCampaignInfoSync', { ...storyCampaignSnapshot(c.state), status: final })
    Object.assign(c.state.world, run.return_world)
    delete c.state.storyCampaign
    delete c.state.combat
    worldSync({ ...c, push: c.pushBefore })
    c.pushBefore('CSProtoOnlineModeChange', { mode: 1 })
    syncBattle({ ...c, push: c.pushBefore })
    return {}
}

export function registerStoryCampaign(on, tables) {
    on('CampaignCreate', (c, r) => {
        const config = storyCampaignConfig(tables, r.group_id, r.difficulty)
        const node = c.state.tasks
            ?.find((task) => task.task_id === 106014)
            ?.nodes?.find((entry) => entry.node_id === 11)
        ensure(node && c.state.player.basic_info.lv >= 15, 'Story dungeon task is not active')
        ensure(!c.state.entrust?.run && !c.state.multiCampaign && !c.state.storyCampaign, 'Another dungeon is active')
        const w = c.state.world
        const run = (c.state.storyCampaign = {
            dungeon_id: config.dungeon.id,
            group_id: r.group_id,
            difficulty: r.difficulty,
            instance_id: c.state.nextStoryCampaignInstanceId ?? 1,
            scenes: config.scenes.map(({ scene }) => scene.id),
            map_id: config.scenes[0].scene.id,
            completed_scenes: [],
            status: 2,
            start_time: c.now,
            return_world: {
                map_id: w.map_id,
                point_id: w.point_id,
                area_id: w.area_id,
                pos: { ...w.pos },
                angle: w.angle,
            },
        })
        c.state.nextStoryCampaignInstanceId = run.instance_id + 1
        Object.assign(w, tables.position(config.scenes[0].point))
        ensureStoryCampaignScene(tables, c.state, c.now)
        c.pushBefore('CSProtoCampaignInfoSync', storyCampaignSnapshot(c.state))
        worldSync(
            { ...c, push: c.pushBefore },
            {
                campaign_start: {
                    group_id: r.group_id,
                    difficulty: r.difficulty,
                },
            },
            256,
            false,
        )
        syncBattle({ ...c, push: c.pushBefore })
        syncStoryCampaignEnemies(c)
        return {}
    })
}
