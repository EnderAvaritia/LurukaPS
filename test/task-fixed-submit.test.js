import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {configuration} from '../src/config.js'
import {Protocol} from '../src/protocol.js'
import {Tables} from '../src/player.js'
import {Store} from '../src/store.js'
import {Game} from '../src/game.js'
import {TaskGraphs,makeNode} from '../src/tasks.js'
const cfg=configuration(),p=new Protocol(cfg.base),t=new Tables(cfg.tables)
function fixture(){
 const store=new Store(':memory:'),game=new Game(p,store,t,{clock:()=>1800000000}),session={};let seq=1
 const call=(name,r={},who=session)=>{const e=p.byName.get('CSProto'+name)
  return game.dispatch(who,{id:e.id,seq:seq++,payload:p.encode(e.req,r)})}
 call('EnterGame',{open_id:'fixed-submit'})
 store.transact(session.id,0,s=>{
  s.world.map_id=100;s.player.basic_info.lv=16;s.taskEpochs[106015]=1
  s.tasks=[{task_id:106015,nodes:[{...makeNode(new TaskGraphs(t).get(106015),30,s),client_before:true}],
   finish_nodes:[1,71,3,4,5,6,7,8,10,11,12,13,14,43,73,23,62,68,67,69,15,17,18,19,20,21,22,24,25,63,26,46,27,28,45,29],reward_nodes:[],client_trace:true}]
  s.taskRecords=t.get('task').filter(r=>r.type===1&&r.id!==106015).map(r=>({task_id:r.id,count:1,time:1}))
  s.player.sbag_infos.items=[{itemid:306002,itemnum:30,guid:'12',itemtype:3},
   {itemid:306003,itemnum:6,guid:'13',itemtype:3},{itemid:306000,itemnum:1,guid:'14',itemtype:3}]
 })
 return {store,session,call,state:()=>store.load(session.id).state}
}
const request={task_id:106015,node_id:30,node_index:0,items:[]}
test('actual empty9854 request consumes only the configured three fruits and remains idempotent across task advance/relogin',()=>{
 const f=fixture();try{
  assert.equal(createHash('sha256').update(p.encode(p.byId.get(9854).req,request)).digest('hex'),
   '70038f920d5f8363541772f3331da07d675db23bd7db36b9fbf91f0281bd6ade')
  const packets=f.call('TaskSubmitItem',request)
  let s=f.state();assert.deepEqual(s.player.sbag_infos.items.map(i=>i.itemnum),[29,5,0])
  assert.equal(s.tasks[0].nodes[0].node_id,30);assert.equal(s.tasks[0].nodes[0].node_values[0],1)
  assert.deepEqual(s.taskDeliveries['106015:1:30:0'],{'3:306002':1,'3:306003':1,'3:306000':1})
  assert.ok(packets.findIndex(packet=>packet.id===5008)<packets.findIndex(packet=>packet.id===9854))
  const inventory=structuredClone(s.player.sbag_infos)
  f.call('TaskSubmitItem',request)
  assert.deepEqual(f.state().player.sbag_infos,inventory)
  f.call('TaskClientCondAfter',{task_id:106015,node_id:30,indexes:[0]})
  f.call('TaskClientAfter',{task_id:106015,node_id:30})
  assert.equal(f.state().tasks[0].nodes[0].node_id,33)
  f.call('TaskSubmitItem',request)
  assert.deepEqual(f.state().player.sbag_infos,inventory)
  f.call('EnterGame',{open_id:'fixed-submit',reconnect:true},{})
  f.call('TaskSubmitItem',request)
  assert.deepEqual(f.state().player.sbag_infos,inventory)
 }finally{f.store.close()}
})
test('empty fixed submission fills only missing costs after partial delivery; insufficient/expired stocks roll back together',()=>{
 const f=fixture();try{
  f.call('TaskSubmitItem',{...request,items:[{item_type:3,item_id:306002,item_count:1}]})
  assert.equal(f.state().tasks[0].nodes[0].node_values[0],0)
  f.store.transact(f.session.id,0,s=>{s.player.sbag_infos.items.find(i=>i.itemid===306000).deadtime=1799999999})
  const before=f.state()
  assert.throws(()=>f.call('TaskSubmitItem',request),/Insufficient items/)
  assert.deepEqual(f.state(),before)
  f.store.transact(f.session.id,0,s=>{delete s.player.sbag_infos.items.find(i=>i.itemid===306000).deadtime})
  f.call('TaskSubmitItem',request)
  assert.deepEqual(f.state().player.sbag_infos.items.map(i=>i.itemnum),[29,5,0])
  assert.equal(f.state().tasks[0].nodes[0].node_values[0],1)
 }finally{f.store.close()}
})
