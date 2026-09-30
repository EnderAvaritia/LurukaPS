import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode, taskUnlocked, conditionValue } from '../src/tasks.js'
const cfg=configuration(), protocol=new Protocol(cfg.base), tables=new Tables(cfg.tables), graphs=new TaskGraphs(tables)

test('logged dynamic and fixed NPC quests208007,206036,208013 accept after their configured prerequisites', () => {
    const store=new Store(':memory:'), game=new Game(protocol,store,tables), session={}
    let seq=1
    const call=(name,request) => {const e=protocol.byName.get('CSProto'+name)
        return game.dispatch(session,{id:e.id,seq:seq++,payload:protocol.encode(e.req,request)})}
    try {
        call('EnterGame',{open_id:'step-unlock'})
        store.transact(session.id,0,state => {
            state.world.map_id=200
            state.world.pos={x:662,y:1645,z:3334}
            state.player.basic_info.lv=16
            state.taskRecords=tables.get('task').filter(row=>row.type===1 && row.id!==106015)
                .map(row=>({task_id:row.id,count:1,time:1}))
            state.tasks=[{task_id:106015,nodes:[{...makeNode(graphs.get(106015),10,state),client_before:true}],
                finish_nodes:[1,71,3,4,5,6,7,8],reward_nodes:[],client_trace:true}]
        })
        for(const id of [208007,206036,208013]) {
            const before=store.load(session.id).state
            assert.equal(taskUnlocked(graphs.get(id),before),true)
            const reply=call('TaskAccept',{u32:id})
            assert.ok(reply.some(packet=>packet.id===9850))
            assert.ok(store.load(session.id).state.tasks.some(task=>task.task_id===id))
        }
    } finally {store.close()}
})

test('fixed NPC208013 offer checks its actual scene and configured20m interaction range', () => {
    const graph=graphs.get(208013),state={world:{map_id:200,pos:{x:662,y:1645,z:3334}},
        player:{basic_info:{lv:16}},tasks:[],taskRecords:[{task_id:106013,count:1}]}
    const context={tables,accepting:true}
    assert.equal(taskUnlocked(graph,state,context),true)
    assert.equal(graph.requirements[0].__type_TaskConditionBaseData.__type_TaskCondStoryOpenTaskData.hasTime,0)
    // Dormant start/end-hour values do not become a time gate when hasTime=0.
    state.world.world_time=23*60*60
    assert.equal(taskUnlocked(graph,state,context),true)
    state.world.pos.x+=5000
    assert.equal(taskUnlocked(graph,state,context),false)
    state.world.pos={x:662,y:1645,z:3334}
    state.world.map_id=100
    assert.equal(taskUnlocked(graph,state,context),false)
    state.world.map_id=200;state.player.basic_info.lv=13
    assert.equal(taskUnlocked(graph,state,context),false)
    state.player.basic_info.lv=16;state.taskRecords=[]
    assert.equal(taskUnlocked(graph,state,context),false)
})

test('task-step prerequisites reject incomplete nodes and still enforce level, map and story gates', () => {
    const state={player:{basic_info:{lv:16}},world:{map_id:200},taskRecords:[],
        tasks:[{task_id:106015,nodes:[{node_id:8}],finish_nodes:[1,71,3,4,5,6,7]}]}
    const shells=graphs.get(206036),gems=graphs.get(208007)
    assert.equal(taskUnlocked(shells,state),false)
    state.tasks[0].finish_nodes.push(8)
    assert.equal(taskUnlocked(shells,state),true)
    assert.equal(taskUnlocked(gems,state),false)
    state.taskRecords.push({task_id:106013,count:1})
    assert.equal(taskUnlocked(gems,state),true)
    state.player.basic_info.lv=13
    assert.equal(taskUnlocked(gems,state),false)
    state.player.basic_info.lv=16
    state.world.map_id=100
    assert.equal(taskUnlocked(gems,state),false)
    assert.equal(taskUnlocked(shells,state),false)
    state.world.map_id=200
    const offer=structuredClone(gems.requirements[0])
    offer.__type_TaskConditionBaseData.__type_TaskCondStoryOpenTaskData.isNowCreate=0
    assert.equal(conditionValue(offer,state),0)
    offer.__type_TaskConditionBaseData.__type_TaskCondStoryOpenTaskData.isNowCreate=1
    offer.__type_TaskConditionBaseData.__type_TaskCondStoryOpenTaskData.storyId=12345
    assert.equal(conditionValue(offer,state),0)
    assert.equal(taskUnlocked({config:{unlockcondition:'12045#106015'},requirements:[]},state),false)
    assert.equal(taskUnlocked({config:{unlockcondition:'12045#106015#8#9'},requirements:[]},state),false)
})
