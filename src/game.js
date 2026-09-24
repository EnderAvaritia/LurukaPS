import {registerProduction} from './handlers/production.js';
import {refreshProduction,productionDue} from './production.js';
import {registerTechnology} from './handlers/technology.js';
import {registerBuildingPlacement} from './handlers/buildings.js';
import {registerHome} from './handlers/home.js';
import {ensureHome,homePayload} from './home.js';
import {upgradeEggState} from './eggs.js';
import {registerShops} from './handlers/shops.js';
import {registerItems} from './handlers/items.js';
import {registerStory} from './handlers/story.js';
import {registerTasks} from './handlers/tasks.js';
import {registerProgression} from './handlers/progression.js';
import {syncBattle} from './battle.js';
import {upgradeSkillState} from './skills.js';
import {randomBytes} from 'node:crypto';
import {seedPlayer} from './player.js';
import {GameError,ensure,textValue} from './handlers/common.js';
import {registerCore} from './handlers/core.js';
import {registerCollection} from './handlers/collection.js';
import {registerWorld} from './handlers/world.js';
import {registerMail} from './handlers/mail.js';
export class Game {
 constructor(protocol,store,tables,{clock=()=>Math.floor(Date.now()/1000)}={}) { this.clock=clock;
  this.protocol=protocol;this.store=store;this.tables=tables;this.handlers=new Map();
  const on=(name,handler)=>{const e=protocol.byName.get(name)||protocol.byName.get(`CSProto${name}`);if(!e)throw Error(`Unknown handler ${name}`);if(this.handlers.has(e.id))throw Error(`Duplicate handler ${name}`);this.handlers.set(e.id,handler);};
  registerCore(on);registerCollection(on);registerWorld(on);registerMail(on);registerProgression(on);registerTasks(on,tables);registerStory(on);registerItems(on);registerShops(on,tables);registerHome(on,tables);registerBuildingPlacement(on,tables);registerTechnology(on,tables);registerProduction(on,tables);
 }
 packet(id,value={},meta={}) {const e=typeof id==='number'?this.protocol.byId.get(id):this.protocol.byName.get(id);if(!e?.rsp)throw Error(`No response schema for ${id}`);return {id:e.id,payload:this.protocol.encode(e.rsp,value),...meta};}
 dispatch(session,frame) {
  const e=this.protocol.byId.get(frame.id);const now=this.clock();
  if(!e)throw new GameError('Unknown message ID',1021);
  let r;try {r=this.protocol.decode(e.req,frame.payload);}catch{throw new GameError('Malformed request',1022);}
  const reply=v=>this.packet(e.id,v,{seq:frame.seq,pushSeq:frame.pushSeq});
  if(e.name==='CSProtoPing')return [reply({time_zone:8,time:now,time_msec:Date.now()%1000,client_ts:r.client_ts||'0'})];
  if(e.name==='CSProtoHeartbeat')return [reply({client_time:r.client_time||{},server_time:{time_zone:8,time:String(now),time_usec:(Date.now()%1000)*1000}})];
  if(['CSProtoLogin','CSProtoEnterGame','CSProtoRenterGame'].includes(e.name)) {
   ensure(!session.entered,'Already entered game');
   ensure(!session.openId || session.openId===r.open_id,'Account switch requires reconnect');
   const a=this.store.login(r.open_id,(id,openId)=>seedPlayer(this.tables,id,openId));
   session.id=a.id;session.openId=r.open_id;session.token=session.token||randomBytes(24).toString('hex');
   if(e.name==='CSProtoLogin'){session.entered=false;return [reply({open_id:r.open_id,pid:a.id,guid:a.id,server_token:session.token})];}
   const packets=this.store.transact(session.id,e.id,state=>{upgradeSkillState(this.tables,state);upgradeEggState(state);ensureHome(this.tables,state);refreshProduction(state,now);const battle=[];syncBattle({state,tables:this.tables,push:(name,value)=>battle.push(this.packet(name,value))});return [...this.loginPackets(state,session,r,frame,e.id),...battle];});
   session.entered=true;return packets;
  }
  ensure(session.id,'Login required',101);
  if(e.name==='CSProtoCreatePlayer') {
   return this.store.transact(session.id,e.id,state=>{if(r.name)state.player.basic_info.name=textValue(r.name,15);if(r.wardrobe_info){ensure([1,2].includes(r.wardrobe_info.sex));state.player.basic_info.wardrobe=r.wardrobe_info;state.player.basic_info.sex=r.wardrobe_info.sex;}return this.loginPackets(state,session,r,frame,e.id);});
  }
  if(e.name==='CSProtoLogout'||e.name==='CSProtoOffline'){session.close=true;return [];}
  if(e.name==='CSProtoRecycle')return [reply({})];
  const handler=this.handlers.get(e.id);if(!handler)throw new GameError(`Unsupported ${e.name}`,1021);
  return this.store.transact(session.id,e.id,state=>{
   const playerLevelBefore=state.player.basic_info.lv;const homeBuildIdsBefore=(state.home?.builds||[]).map(b=>b.guid);const homeWishIdsBefore=(state.home?.wishlist||[]).map(x=>x.uid);const homeRevision=state.homeRevision||0;const eggRevision=state.eggRevision||0;const pushes=[];const context={id:session.id,state,now,tables:this.tables,push:(name,value)=>pushes.push(this.packet(name,value,{pushSeq:frame.pushSeq}))};
   refreshProduction(state,now);const response=handler(context,r);
   if(state.home?.technology&&state.player.basic_info.lv!==playerLevelBefore)state.homeRevision=(state.homeRevision||0)+1;
   const packets=e.rsp?[reply(response||{})]:[];
   const eggSync=(state.eggRevision||0)!==eggRevision?[this.packet('CSProtoPetEggInfoSync',{egg_infos:{eggs:state.petEggs||[]}})]:[];
   const homeSync=(state.homeRevision||0)!==homeRevision?[this.packet('CSProtoHomeSync',{...homePayload(this.tables,state),del_builds:homeBuildIdsBefore.filter(id=>!state.home.builds.some(b=>b.guid===id)),del_wishlist:homeWishIdsBefore.filter(id=>!state.home.wishlist.some(x=>x.uid===id))})]:[];
   return [...eggSync,...homeSync,...packets,...pushes];
  });
 }
 tick(id){const now=this.clock();if(!productionDue(this.store.load(id).state,now))return [];return this.store.transact(id,0,state=>{if(!refreshProduction(state,now))return [];return [this.packet('CSProtoHomeSync',homePayload(this.tables,state))];});}
 loginPackets(state,session,r,frame,id) {
  const now=this.clock();
  return [this.packet('CSProtoEnterGameCallbackStart',{reconnect:!!r.reconnect,player_id:session.id,server_time:String(Date.now()),time_offset:'0'}),this.packet(id,{data:state.player,reconnect:!!r.reconnect,time_zone:8,time:now,time_msec:Date.now()%1000,player_id:session.id,server_token:session.token,rc4_key:'',ntf_seq:r.ntf_seq||0,req_seq:frame.seq,line_id:0,server_id:'azurjs',node_id:'azurjs-0'},{seq:frame.seq,pushSeq:frame.pushSeq}),this.packet('CSProtoPetInfoSync',{pet_infos:{pets:state.pets}}),this.packet('CSProtoPetEggInfoSync',{egg_infos:{eggs:state.petEggs||[]}}),this.packet('CSProtoPetBoxInfoSync',{box_infos:state.petBoxes}),this.packet('CSProtoRideMountInfo',{mount_saddlerys:this.tables.get('mount_saddle').map(s=>s.id)}),this.packet('CSProtoTaskSync',{tasks:state.tasks,task_records:state.taskRecords||[],trace_list:state.tasks.filter(t=>t.client_trace).map(t=>t.task_id)}),this.packet('CSProtoMailSync',{mails:state.mail}),this.packet('CSProtoStorySync',{infos:{infos:state.storyIds||[]}}),this.packet('CSProtoHomeSync',homePayload(this.tables,state))];
 }
}


















