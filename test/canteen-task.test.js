import test from 'node:test'
import assert from 'node:assert/strict'
import {configuration} from '../src/config.js'
import {Protocol} from '../src/protocol.js'
import {Tables} from '../src/player.js'
import {Store} from '../src/store.js'
import {Game} from '../src/game.js'
import {TaskGraphs,makeNode} from '../src/tasks.js'
import {guidedConditionValue} from '../src/guided-conditions.js'
import {grantRewards} from '../src/rewards.js'
import {ensureHomeCanteens} from '../src/home.js'
const cfg=configuration(),protocol=new Protocol(cfg.base),tables=new Tables(cfg.tables)
function fixture(){
 const store=new Store(':memory:'),game=new Game(protocol,store,tables),session={};let seq=1
 const call=(name,r={},who=session)=>{const e=protocol.byName.get('CSProto'+name)
  return game.dispatch(who,{id:e.id,seq:seq++,payload:protocol.encode(e.req,r)})}
 call('EnterGame',{open_id:'canteen-task'})
 store.transact(session.id,0,state=>{
  state.world.map_id=701;state.player.basic_info.lv=16
  state.tasks=[{task_id:106015,nodes:[{...makeNode(new TaskGraphs(tables).get(106015),69,state),client_before:true}],
   finish_nodes:[1,71,3,4,5,6,7,8,10,11,12,13,14,43,73,23,62,68,67],reward_nodes:[],client_trace:true}]
  state.taskRecords=tables.get('task').filter(r=>r.type===1&&r.id!==106015).map(r=>({task_id:r.id,count:1,time:1}))
  state.taskEpochs[106015]=1
  state.home.builds.push({guid:19,build_id:10011,build_type:6,status:1,locate:{block_id:101,anchor:7536681,direction:0}})
  state.home.inventory.push({build_id:10011,total_num:1,used_num:1,unlock:true})
  ensureHomeCanteens(tables,state)
  grantRewards(tables,state,[{itemtype:3,itemid:9002901,itemnum:10}])
 })
 return {store,session,call,state:()=>store.load(session.id).state}
}
test('adding real pet food updates main106015/69 and collecting/removing food keeps condition accurate',()=>{
 const f=fixture();try{
  assert.equal(guidedConditionValue(10048,f.state()),0)
  f.call('AddPetFood',{build_guid:19,operate_type:1,items:[{itemid:9002901,itemnum:2}]})
  assert.equal(guidedConditionValue(10048,f.state()),1)
  assert.equal(f.state().tasks[0].nodes[0].node_values[0],1)
  f.call('AddPetFood',{build_guid:19,operate_type:0,items:[{itemid:9002901,itemnum:2}]})
  assert.equal(guidedConditionValue(10048,f.state()),0)
  assert.equal(f.state().tasks[0].nodes[0].node_values[0],0)
  const before=f.state()
  assert.throws(()=>f.call('AddPetFood',{build_guid:19,operate_type:1,items:[{itemid:9002901,itemnum:1000}]}))
  assert.deepEqual(f.state(),before)
  f.call('AddPetFood',{build_guid:19,operate_type:1,items:[{itemid:9002901,itemnum:1}]})
  f.call('TaskClientCondAfter',{task_id:106015,node_id:69,indexes:[0]})
  f.call('TaskClientAfter',{task_id:106015,node_id:69})
  assert.equal(f.state().tasks[0].nodes[0].node_id,15)
 }finally{f.store.close()}
})
test('existing stocked dishes satisfy the main quest on login without another inventory debit',()=>{
 const f=fixture();try{
  f.store.transact(f.session.id,0,state=>{
   const table=state.home.builds.find(b=>b.guid===19)
   table.pet_canteen.foods=[{itemtype:3,itemid:9002901,itemnum:32},{itemtype:3,itemid:306000,itemnum:5}]
   table.pet_canteen.food_value=805
  })
  const inventory=structuredClone(f.state().player.sbag_infos)
  const packets=f.call('EnterGame',{open_id:'canteen-task',reconnect:true},{})
  const task=protocol.decode('SCTaskSync',packets.find(p=>p.id===9853).payload).tasks.find(t=>t.task_id===106015)
  assert.equal(task.nodes[0].node_values[0],2)
  assert.equal(guidedConditionValue(10056,f.state()),2)
  assert.deepEqual(f.state().player.sbag_infos,inventory)
 }finally{f.store.close()}
})
test('food type count ignores bag food, duplicate types, zero quantities and stored or unrelated buildings',()=>{
 const table=(foods)=>({build_type:6,locate:{block_id:101},pet_canteen:{foods}})
 const food={itemid:9002901,itemnum:10}
 const state={home:{builds:[table([food,food,{itemid:306000,itemnum:0}]),table([food]),
  {build_type:16,locate:{},pet_canteen:{foods:[{itemid:306000,itemnum:5}]}},
  {build_type:6,pet_canteen:{foods:[{itemid:306000,itemnum:5}]}}],storedBuilds:[table([{itemid:306000,itemnum:5}])]}}
 assert.equal(guidedConditionValue(10048,state),1)
 state.home.builds[1].pet_canteen.foods.push({itemid:306000,itemnum:5})
 assert.equal(guidedConditionValue(10048,state),2)
})
