import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { enemyDefinition } from '../src/enemy-state.js'
const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, request = {}) => {
        const e = protocol.byName.get(name) ?? protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, request) })
    }
    call('EnterGame', { open_id: 'ai-hero-test' })
    store.transact(session.id, 0, (state) => {
        state.world.map_id = 100
        state.player.basic_info.lv = 20
        state.taskEpochs[107016] = 1
        state.tasks = [
            {
                task_id: 107016,
                nodes: [{ ...makeNode(new TaskGraphs(tables).get(107016), 10, state), client_before: true }],
                finish_nodes: [1, 3, 4, 5, 8, 9],
                reward_nodes: [],
            },
        ]
        state.taskRecords = tables
            .get('task')
            .filter((row) => row.type === 1 && row.id !== 107016)
            .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
    })
    return { store, session, call, state: () => store.load(session.id).state }
}
test('exact unknown9141 packet resolves configured Miti independently of owned heroes', () => {
    const f = fixture()
    try {
        const body = { enemy_pack_id: 10800301 },
            bytes = protocol.encode('CSWorldObjAIHeroInfoReq', body)
        assert.equal(bytes.length, 5)
        assert.equal(
            createHash('sha256').update(bytes).digest('hex'),
            '46a0b980a5217a47bd3e27caef6d1215d6284b849a660c4a4fd7b7305c5a54c4',
        )
        const before = f.state(),
            packets = f.call('CSWorldObjAIHeroInfo', body)
        const info = protocol.decode('SCWorldObjAIHeroInfoRsp', packets.find((p) => p.id === 9141).payload)
        assert.equal(info.enemy_pack_id, body.enemy_pack_id)
        assert.equal(BigInt(info.uuid) & 0xffffffffn, 107016009n)
        assert.ok(!before.player.heros_info.heros.some((hero) => hero.guid === info.uuid))
        assert.deepEqual(f.state().player.group_mgrs, before.player.group_mgrs)
        assert.deepEqual(f.state().player.heros_info, before.player.heros_info)
        const definition = enemyDefinition(tables, f.state(), info.uuid)
        assert.equal(definition.config_id, 108003)
        assert.equal(definition.level, 30)
        assert.ok(definition.max_hp > 0)
        const again = f.call('CSWorldObjAIHeroInfo', body)
        assert.equal(
            protocol.decode('SCWorldObjAIHeroInfoRsp', again.find((p) => p.id === 9141).payload).uuid,
            info.uuid,
        )
        assert.throws(() => f.call('CSWorldObjAIHeroInfo', { enemy_pack_id: 10310010 }), /Unknown AI/)
        f.store.transact(f.session.id, 0, (state) => {
            state.world.map_id = 701
        })
        assert.throws(() => f.call('CSWorldObjAIHeroInfo', body), /active task scene/)
    } finally {
        f.store.close()
    }
})
test('battle controller monsters receive authoritative death and unblock the configured node10 story', () => {
    const f = fixture()
    try {
        const source = f.state().player.heros_info.heros[0].guid
        const allyPackets = f.call('CSWorldObjAIHeroInfo', { enemy_pack_id: 10800301 })
        const ally = protocol.decode('SCWorldObjAIHeroInfoRsp', allyPackets.find((p) => p.id === 9141).payload).uuid
        f.call('BattleInfoReduce', {
            uint64_dic: [source, ally],
            battle_info: [{ hurt_info: { from_id: '1', tar_id: '2', hp_change: -8 } }],
        })
        for (let slot = 0; slot < 3; slot++) {
            const uuid = ((4n << 56n) | (BigInt(slot) << 32n) | 107016014n).toString()
            const definition = enemyDefinition(tables, f.state(), uuid)
            assert.equal(definition.pack_id, 10310010)
            assert.ok(definition.max_hp > 0)
            f.call('BattleInfoReduce', {
                uint64_dic: [source, uuid],
                battle_info: [{ hurt_info: { from_id: '1', tar_id: '2', hp_change: -definition.max_hp } }],
            })
            assert.equal(f.state().combat.entities[uuid].hp, 0)
            assert.equal(
                f.state().tasks.find((task) => task.task_id === 107016).nodes[0].node_values[0],
                slot === 2 ? 1 : 0,
            )
        }
        assert.ok(f.state().combat.entities[ally].hp > 0, 'living companion does not block the target enemy group')
        f.store.transact(f.session.id, 0, (state) => {
            // Old servers stored all three deaths but never recorded completion.
            delete state.taskEvents['107016:1:10:0']
            state.tasks.find((task) => task.task_id === 107016).nodes[0].node_values = [0]
        })
        const login = protocol.byId.get(5001),
            who = {},
            game = new Game(protocol, f.store, tables)
        game.dispatch(who, {
            id: 5001,
            seq: 1,
            payload: protocol.encode(login.req, { open_id: 'ai-hero-test', reconnect: true }),
        })
        assert.equal(f.state().tasks.find((task) => task.task_id === 107016).nodes[0].node_values[0], 1)
        f.call('TaskClientCondAfter', { task_id: 107016, node_id: 10, indexes: [0] })
        f.call('TaskClientAfter', { task_id: 107016, node_id: 10 })
        assert.equal(f.state().tasks.find((t) => t.task_id === 107016).nodes[0].node_id, 11)
        assert.equal(f.state().pendingTaskStorySync.stories[0].story_id, 101224)
    } finally {
        f.store.close()
    }
})
