import test from 'node:test';import assert from 'node:assert/strict';
import {configuration} from '../src/config.js';import {Tables} from '../src/player.js';import {Store} from '../src/store.js';import {Protocol} from '../src/protocol.js';import {Game} from '../src/game.js';import {TaskGraphs,makeNode} from '../src/tasks.js';
const cfg=configuration(),tables=new Tables(cfg.tables),protocol=new Protocol(cfg.base);
function setup(){const store=new Store(':memory:'),game=new Game(protocol,store,tables),session={};let seq=1;const call=(who,name,r={})=>{const e=protocol.byName.get('CSProto'+name);return game.dispatch(who,{id:e.id,seq:seq++,payload:protocol.encode(e.req,r)});};call(session,'EnterGame',{open_id:'currency-sync'});return {store,game,session,call,state:()=>store.load(session.id).state};}
const currency=(s,id)=>s.player.attr_infos.attrs.find(a=>a.attr_id===id)?.attr_val;
test('legacy wallet migration mirrors ordinary diamond and gold into CBT3 attribute store on login',()=>{const f=setup();try{
 f.store.transact(f.session.id,0,s=>{s.player.basic_info.diamond=77;s.player.basic_info.gold=123;s.player.attr_infos.attrs.find(a=>a.attr_id===1).attr_val='0';s.player.attr_infos.attrs.find(a=>a.attr_id===2).attr_val='0';});
 const login=f.call({},'EnterGame',{open_id:'currency-sync'}).find(p=>p.id===5001),data=protocol.decode('SCEnterGame',login.payload);assert.equal(currency(f.state(),1),'77');assert.equal(currency(f.state(),2),'123');assert.equal(data.data.attr_infos.attrs.find(a=>a.attr_id===1).attr_val,'77');
 }finally{f.store.close();}});
test('paid stars convert to client-visible free diamond attribute before exchange reply',()=>{const f=setup();try{
 f.store.transact(f.session.id,0,s=>{s.player.attr_infos.attrs.push({attr_id:901,attr_val:'60'},{attr_id:902,attr_val:'40'});});
 const packets=f.call(f.session,'MallExchangeDiamond',{u32:100}),state=f.state(),sync=packets.find(p=>p.id===protocol.byName.get('CSProtoSyncPlayerData').id),reply=packets.find(p=>p.id===18047);
 assert(sync&&reply&&packets.indexOf(sync)<packets.indexOf(reply));const wire=protocol.decode('PlayerData',sync.payload);
 assert.equal(state.player.basic_info.diamond,100);assert.equal(currency(state,1),'100');assert.equal(currency(state,901),'0');assert.equal(currency(state,902),'0');assert.equal(wire.attr_infos.attrs.find(a=>a.attr_id===1).attr_val,'100');assert.equal(wire.basic_info.diamond,100);
 const relog=f.call({},'EnterGame',{open_id:'currency-sync'}).find(p=>p.id===5001);assert.equal(protocol.decode('SCEnterGame',relog.payload).data.attr_infos.attrs.find(a=>a.attr_id===1).attr_val,'100');
 }finally{f.store.close();}});
test('configured task106009 grants free diamond and gold in both wallet fields before finish reply',()=>{const f=setup();try{
 const graph=new TaskGraphs(tables).get(106009);f.store.transact(f.session.id,0,s=>{s.tasks=[{task_id:106009,nodes:[makeNode(graph,graph.end,s)],finish_nodes:[graph.start],reward_nodes:[]}];s.taskRecords=[{task_id:106001,count:1,time:1},{task_id:106002,count:1,time:1}];});
 const packets=f.call(f.session,'TaskFinish',{u32:106009}),state=f.state(),sync=packets.find(p=>p.id===protocol.byName.get('CSProtoSyncPlayerData').id),reply=packets.find(p=>p.id===9852);
 assert(sync&&reply&&packets.indexOf(sync)<packets.indexOf(reply));const wire=protocol.decode('PlayerData',sync.payload);
 assert.equal(state.player.basic_info.diamond,60);assert.equal(state.player.basic_info.gold,1800);assert.equal(currency(state,1),'60');assert.equal(currency(state,2),'1800');assert.equal(wire.attr_infos.attrs.find(a=>a.attr_id===1).attr_val,'60');assert.equal(wire.attr_infos.attrs.find(a=>a.attr_id===2).attr_val,'1800');
 assert.equal(state.player.basic_info.lv,3);assert.equal(state.player.basic_info.exp,200);assert.equal(wire.basic_info.lv,3);assert.equal(wire.basic_info.exp,200);
 }finally{f.store.close();}});
