import test from 'node:test';import assert from 'node:assert/strict';
import {configuration} from '../src/config.js';import {Tables} from '../src/player.js';import {Store} from '../src/store.js';import {Protocol} from '../src/protocol.js';import {Game} from '../src/game.js';import {TaskGraphs,makeNode} from '../src/tasks.js';import {deliveryComplete} from '../src/task-delivery.js';
const c=configuration(),tables=new Tables(c.tables),protocol=new Protocol(c.base);
function setup(){const store=new Store(':memory:'),game=new Game(protocol,store,tables),session={};let seq=1;const call=(name,r)=>{const e=protocol.byName.get('CSProto'+name);return game.dispatch(session,{id:e.id,seq:seq++,pushSeq:0,payload:protocol.encode(e.req,r)});};call('EnterGame',{open_id:'delivery'});
 const graph=new TaskGraphs(tables).get(100002);store.transact(session.id,0,s=>{s.world.map_id=924;s.taskEpochs={100002:1};s.tasks=[{task_id:100002,start_time:1,finish_nodes:[],reward_nodes:[],nodes:[{...makeNode(graph,20,s),client_before:true}]}];s.player.sbag_infos.items=[{itemid:355005,itemnum:2},{itemid:301006,itemnum:1}];});
 return {store,session,call,graph};}
const req=items=>({task_id:100002,node_id:20,node_index:0,items});
test('actual task 100002 node20 consumes exact configured items and stores partial delivery',()=>{const {store,session,call,graph}=setup();try{
 call('TaskSubmitItem',req([{item_type:3,item_id:355005,item_count:1}]));let s=store.load(session.id).state;assert.equal(s.tasks[0].nodes[0].node_values[0],0);assert.equal(s.player.sbag_infos.items[0].itemnum,1);
 const partial=store.load(session.id);assert.throws(()=>call('TaskClientAfter',{task_id:100002,node_id:20}),/conditions/);assert.deepEqual(store.load(session.id),partial);
 call('TaskSubmitItem',req([{item_type:3,item_id:301006,item_count:1}]));s=store.load(session.id).state;assert.equal(s.tasks[0].nodes[0].node_values[0],1);assert.equal(s.player.sbag_infos.items[1].itemnum,0);
 const finished=store.load(session.id);assert.throws(()=>call('TaskSubmitItem',req([{item_type:3,item_id:355005,item_count:1}])));assert.deepEqual(store.load(session.id),finished);
 const condition=graph.nodes.get(20).__type_TaskConditionNodeData.conditionList;assert(deliveryComplete(s,condition,{taskId:100002,nodeId:20,index:0}));s.taskEpochs[100002]=2;assert(!deliveryComplete(s,condition,{taskId:100002,nodeId:20,index:0}));
}finally{store.close();}});
test('wrong items, quantities, indices and maps do not alter inventory or receipts',()=>{const {store,session,call}=setup();try{
 const original=store.load(session.id);for(const request of [req([{item_type:3,item_id:355005,item_count:2}]),req([{item_type:3,item_id:355005,item_count:1},{item_type:3,item_id:355005,item_count:1}]),req([{item_type:3,item_id:400000,item_count:1}]),{...req([{item_type:3,item_id:355005,item_count:1}]),node_index:99},req([{item_type:10,item_id:355005,item_count:1}])]){assert.throws(()=>call('TaskSubmitItem',request));assert.deepEqual(store.load(session.id),original);}
 store.transact(session.id,0,s=>{s.world.map_id=100;});const away=store.load(session.id);assert.throws(()=>call('TaskSubmitItem',req([{item_type:3,item_id:355005,item_count:1}])),/different map/);assert.deepEqual(store.load(session.id),away);
}finally{store.close();}});
test('configured currency submission debits gold and leaves other objectives pending',()=>{const {store,session,call,graph}=setup();try{
 store.transact(session.id,0,s=>{s.tasks[0].nodes=[{...makeNode(graph,21,s),client_before:true}];s.player.basic_info.gold=12;});
 call('TaskSubmitItem',{task_id:100002,node_id:21,node_index:2,items:[{item_type:10,item_id:2,item_count:10}]});const s=store.load(session.id).state;assert.equal(s.player.basic_info.gold,2);assert.equal(s.tasks[0].nodes[0].node_values[2],1);assert.equal(s.tasks[0].nodes[0].node_values[0],0);
 const before=store.load(session.id);assert.throws(()=>call('TaskSubmitItem',{task_id:100002,node_id:21,node_index:2,items:[{item_type:10,item_id:2,item_count:1}]}));assert.deepEqual(store.load(session.id),before);
}finally{store.close();}});
