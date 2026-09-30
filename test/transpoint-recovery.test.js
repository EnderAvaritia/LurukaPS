import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import {heroBattleLimits,heroModules,petModules} from '../src/battle.js'
const cfg=configuration(), protocol=new Protocol(cfg.base), tables=new Tables(cfg.tables)
for (const map of [100,200]) test(`near star node in scene${map} restores formation HP without teleport, attribute/party reload or energy refill`, () => {
    const store=new Store(':memory:'),game=new Game(protocol,store,tables),session={}
    let seq=1
    const call=(name,request={}) => {const e=protocol.byName.get('CSProto'+name)
        return game.dispatch(session,{id:e.id,seq:seq++,payload:protocol.encode(e.req,request)})}
    try {
        call('EnterGame',{open_id:'node-'+map})
        let hero,pet,bench
        store.transact(session.id,0,state => {
            state.world.map_id=map
            state.world.pos={x:789,y:2835,z:-6760}
            state.world.angle=271
            const manager=state.player.group_mgrs.find(entry=>entry.type===1),group=manager.groups.find(entry=>entry.id===manager.cur_group)
            hero=state.player.heros_info.heros[0]; bench=state.player.heros_info.heros[1]
            for(const slot of group.heros) slot.hero_id='0'
            group.heros[0].hero_id=hero.guid;group.control=hero.guid
            const h=state.player.heros_info.battle_infos.find(info=>info.hero_id===hero.guid)
            Object.assign(h,{hp:1,sp:7,alive_state:0})
            state.player.heros_info.battle_infos.find(info=>info.hero_id===bench.guid).hp=2
            pet=state.pets.find(item=>tables.find('template_value',item.config_id))
            for(const item of state.pets) item.hero_id='0'
            pet.hero_id=hero.guid
            state.combat={map_id:map,skills:{},bullets:{},elements:{},petSp:{[pet.guid]:9},
                entities:{[pet.guid]:{uuid:pet.guid,hp:0,alive_state:1},
                    enemy:{uuid:'enemy',hp:10,alive_state:0}}}
        })
        const before=store.load(session.id).state
        const modules=[heroModules(tables,before,hero)]
        const heroMax=heroBattleLimits(modules[0]).hp,petMax=heroBattleLimits(petModules(tables,before,pet,modules)).hp
        const packets=call('WorldMapActiveBehavior',{type:3})
        const after=store.load(session.id).state
        assert.deepEqual(after.world,before.world)
        assert.deepEqual(after.player.group_mgrs,before.player.group_mgrs)
        const sync=packets.find(packet=>packet.id===10009)
        assert.ok(sync)
        assert.equal(packets.filter(packet=>packet.id===10009).length,1)
        assert.ok(!packets.some(packet=>[9103,5008].includes(packet.id)))
        assert.equal(packets.at(-1).id,9102)
        const infos=protocol.decode('SCObjBattleInfoSync',sync.payload).infos
        assert.deepEqual(new Set(infos.map(info=>info.uuid)),new Set([hero.guid,pet.guid]))
        assert.equal(infos.find(info=>info.uuid===hero.guid).hp,heroMax)
        assert.equal(infos.find(info=>info.uuid===pet.guid).hp,petMax)
        assert.ok(infos.every(info=>info.reason===1 && info.alive_state===0 && info.sp===undefined))
        const saved=after.player.heros_info.battle_infos.find(info=>info.hero_id===hero.guid)
        assert.equal(saved.hp,heroMax);assert.equal(saved.sp,7)
        assert.equal(after.combat.petSp[pet.guid],9)
        assert.equal(after.combat.entities[pet.guid].hp,petMax)
        assert.equal(after.player.heros_info.battle_infos.find(info=>info.hero_id===bench.guid).hp,2)
        assert.deepEqual(after.combat.entities.enemy,before.combat.entities.enemy)
        call('WorldMapActiveBehavior',{type:3})
        assert.deepEqual(store.load(session.id).state.world,before.world)
        const stable=store.load(session.id).state
        assert.throws(()=>call('WorldMapActiveBehavior',{type:99}),/not implemented/)
        assert.deepEqual(store.load(session.id).state,stable)
        // A deliberate teleport remains available through its own protocol.
        call('WorldPoint',{point_id:map===200?20005:10045})
        assert.equal(store.load(session.id).state.world.point_id,map===200?20005:10045)
    } finally {store.close()}
})
