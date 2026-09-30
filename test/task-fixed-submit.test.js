import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {configuration} from '../src/config.js'
import {Protocol} from '../src/protocol.js'
import {Tables} from '../src/player.js'
import {Store} from '../src/store.js'
import {Game} from '../src/game.js'
import {TaskGraphs,makeNode} from '../src/tasks.js'
import {taskItemCount, applyTaskItemActions} from '../src/task-items.js'
import {grantRewards} from '../src/rewards.js'
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
  const after=f.call('TaskClientAfter',{task_id:106015,node_id:30})
  assert.equal(taskItemCount(f.state(),450125),1)
  const potionSync=after.find(packet=>packet.id===p.byName.get('CSProtoTaskSync').id)
  assert.deepEqual(p.decode(p.byName.get('CSProtoTaskSync').rsp,potionSync.payload).task_items,
   [{item_id:450125,item_num:1}])
  assert.ok(after.indexOf(potionSync)<after.findIndex(packet=>packet.id===p.byName.get('CSProtoTaskClientAfter').id))
  assert.ok(f.state().pendingTaskStorySync, 'item sync must not depend on finishing story101155')
  f.call('TaskClientAfter',{task_id:106015,node_id:30})
  assert.equal(taskItemCount(f.state(),450125),1)
  assert.equal(f.state().tasks[0].nodes[0].node_id,33)
  f.call('TaskSubmitItem',request)
  assert.deepEqual(f.state().player.sbag_infos,inventory)
  assert.equal(taskItemCount(f.state(),450125),1)
  f.call('TaskClientBefore',{task_id:106015,node_id:33})
  const potionRequest={...request,node_id:33}
  const consumed=f.call('TaskSubmitItem',potionRequest)
  assert.equal(taskItemCount(f.state(),450125),0)
  assert.deepEqual(f.state().taskDeliveries['106015:1:33:0'],{'20:450125':1})
  assert.ok(consumed.some(packet=>packet.id===p.byName.get('CSProtoTaskSync').id &&
   p.decode(p.byName.get('CSProtoTaskSync').rsp,packet.payload).del_task_items.includes(450125)))
  f.call('TaskSubmitItem',potionRequest)
  f.call('TaskClientCondAfter',{task_id:106015,node_id:33,indexes:[0]})
  f.call('TaskClientAfter',{task_id:106015,node_id:33})
  assert.equal(f.state().tasks[0].nodes[0].node_id,65)
  f.call('EnterGame',{open_id:'fixed-submit',reconnect:true},{})
  assert.equal(taskItemCount(f.state(),450125),0)
  assert.deepEqual(f.state().player.sbag_infos,inventory)
  f.call('EnterGame',{open_id:'fixed-submit',reconnect:true},{})
  f.call('TaskSubmitItem',request)
  assert.deepEqual(f.state().player.sbag_infos,inventory)
 }finally{f.store.close()}
})

test('legacy completed fruit node restores missing potion once without charging fruits or advancing the task',()=>{
 const f=fixture();try{
  f.call('TaskSubmitItem',request)
  f.call('TaskClientAfter',{task_id:106015,node_id:30})
  f.store.transact(f.session.id,0,s=>{
   delete s.taskItems;delete s.taskItemRevision;delete s.taskItemActionReceipts
   s.tasks[0].nodes[0].client_before=true
  })
  const inventory=structuredClone(f.state().player.sbag_infos)
  const login=f.call('EnterGame',{open_id:'fixed-submit',reconnect:true},{})
  assert.equal(taskItemCount(f.state(),450125),1)
  assert.equal(f.state().tasks[0].nodes[0].node_id,33)
  assert.deepEqual(f.state().player.sbag_infos,inventory)
  assert.ok(login.some(packet=>packet.id===p.byName.get('CSProtoTaskSync').id &&
   p.decode(p.byName.get('CSProtoTaskSync').rsp,packet.payload).task_items.some(item=>item.item_id===450125&&item.item_num===1)))
  f.call('EnterGame',{open_id:'fixed-submit',reconnect:true},{})
  assert.equal(taskItemCount(f.state(),450125),1)
  f.call('TaskSubmitItem',{...request,node_id:33})
  f.call('EnterGame',{open_id:'fixed-submit',reconnect:true},{})
  assert.equal(taskItemCount(f.state(),450125),0, 'submitted potion must not be restored')
  assert.deepEqual(f.state().player.sbag_infos,inventory)
 }finally{f.store.close()}
})

test('potion cannot be invented without a completed creation node; resource20 rewards and graph actions share the task bag',()=>{
 const f=fixture();try{
  f.store.transact(f.session.id,0,s=>{
   s.tasks[0].nodes=[{...makeNode(new TaskGraphs(t).get(106015),33,s),client_before:true}]
  })
  f.call('EnterGame',{open_id:'fixed-submit',reconnect:true},{})
  const before=f.state()
  assert.throws(()=>f.call('TaskSubmitItem',{...request,node_id:33}),/Insufficient task items/)
  assert.deepEqual(f.state(),before)
  f.store.transact(f.session.id,0,s=>{
   const pets=structuredClone(s.pets)
   grantRewards(t,s,[{itemtype:20,itemid:450125,itemnum:1}])
   const beforeGraph=new TaskGraphs(t).get(216004)
   applyTaskItemActions(t,s,216004,3,beforeGraph.nodes.get(3),'before')
   applyTaskItemActions(t,s,216004,3,beforeGraph.nodes.get(3),'before')
   assert.equal(taskItemCount(s,450066),1)
   const graph=new TaskGraphs(t).get(206021)
   applyTaskItemActions(t,s,206021,9,graph.nodes.get(9),'after')
   assert.equal(taskItemCount(s,450097),3)
   applyTaskItemActions(t,s,206021,10,graph.nodes.get(10),'after')
   assert.equal(taskItemCount(s,450097),0)
   applyTaskItemActions(t,s,206021,9,graph.nodes.get(9),'after')
   assert.equal(taskItemCount(s,450097),0, 'replayed creation cannot undo deletion')
   assert.deepEqual(s.pets,pets)
  })
  f.call('TaskSubmitItem',{...request,node_id:33})
  assert.equal(taskItemCount(f.state(),450125),0)
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
