import {repairCharacterCreationMarker} from './character-creation.js';
import {syncCurrencyMirrors} from './currency.js';
import {registerTrialGroups,trialPayload,expireTaskTrialGroup} from './handlers/trial-groups.js';
import {prepareTaskScenes} from './task-scenes.js';
import {worldSync} from './handlers/world.js';
import {unlockAutomaticTasks,taskSnapshot,refreshTaskProgress} from './tasks.js';
import {repairSoulEssenceStars} from './equipment.js';
import {registerPlayableLifecycle,playableSnapshot} from './handlers/playable-lifecycle.js';
import {registerPetSkill} from './handlers/pet-skill.js';
import {registerRoulette,roulettePayload} from './handlers/roulette.js';
import {upgradeInventory} from './inventory.js';
import {registerMonthly,monthlyPayload} from './monthly-card.js';
import {registerPlayableSaves} from './handlers/playable-saves.js';
import {registerLocalPayments} from './handlers/local-payments.js';
import {registerChat,chatSnapshots} from './handlers/chat.js';
import {registerPlayableEnemies} from './handlers/playable-enemies.js';
import {registerGM} from './handlers/gm.js';
import {registerWorldEvents} from './handlers/world-events.js';
import {registerProfileQueries} from './handlers/profile-queries.js';
import {registerWorldObjects} from './handlers/world-objects.js';
import {registerWorldCombat} from './handlers/world-combat.js';
import {registerEcology} from './handlers/ecology.js';
import {registerMall} from './handlers/mall.js';
import {registerCombat} from './handlers/combat.js';
import {registerClientState} from './handlers/client-state.js';
import {registerRelease} from './handlers/release.js';
import {releaseFields} from './release-ledger.js';
import {registerHatching} from './handlers/hatching.js';
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
import {randomBytes,randomInt} from 'node:crypto';
import {seedPlayer} from './player.js';
import {GameError,ensure,textValue} from './handlers/common.js';
import {registerCore} from './handlers/core.js';
import {registerCollection} from './handlers/collection.js';
import {registerWorld} from './handlers/world.js';
import {registerMail} from './handlers/mail.js';
export class Game {
 constructor(protocol,store,tables,{clock=()=>Math.floor(Date.now()/1000),rng=randomInt,crcDelay=0,gmEnabled=true,offlinePayments=true}={}) { this.clock=clock;this.rng=rng;this.crcDelay=crcDelay;this.releaseResetHour=Number(tables.get('game').find(r=>r.title==='DAILY_REFRESH_TIME')?.value??4);
  this.protocol=protocol;this.store=store;this.tables=tables;this.handlers=new Map();
  const on=(name,handler)=>{const e=protocol.byName.get(name)||protocol.byName.get(`CSProto${name}`);if(!e)throw Error(`Unknown handler ${name}`);if(this.handlers.has(e.id))throw Error(`Duplicate handler ${name}`);this.handlers.set(e.id,handler);};
  registerTrialGroups(on,tables);registerPlayableSaves(on);registerRoulette(on);registerPetSkill(on);registerPlayableLifecycle(on,tables);
  const runGM=registerGM(on,{enabled:gmEnabled});
  registerCore(on);registerMonthly(on,tables);registerLocalPayments(on,tables,store,{enabled:offlinePayments});registerChat(on,store,{runGM});registerPlayableEnemies(on,tables,store);registerWorldEvents(on,tables);registerProfileQueries(on,tables,store);registerWorldObjects(on,tables);registerWorldCombat(on);registerEcology(on,tables);registerMall(on,tables);registerCombat(on);registerClientState(on);registerCollection(on);registerWorld(on);registerMail(on);registerProgression(on);this.finishPendingCharacterTask=registerTasks(on,tables);registerStory(on);registerItems(on);registerShops(on,tables);registerHome(on,tables);registerBuildingPlacement(on,tables);registerTechnology(on,tables);registerProduction(on,tables);registerHatching(on);registerRelease(on,tables);
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
   session.entryAttempt={message_id:e.id,sequence:frame.seq,reconnect:!!r.reconnect,has_server_token:!!r.server_token};
   ensure(!session.entered,'Already entered game');
   ensure(!session.openId || session.openId===r.open_id,'Account switch requires reconnect');
   const a=this.store.login(r.open_id,(id,openId)=>seedPlayer(this.tables,id,openId));
   session.id=a.id;session.openId=r.open_id;session.token=session.token||randomBytes(24).toString('hex');
   if(e.name==='CSProtoLogin'){session.entered=false;return [reply({open_id:r.open_id,pid:a.id,guid:a.id,server_token:session.token})];}
   const packets=this.store.transact(session.id,e.id,state=>{unlockAutomaticTasks(this.tables,state,now);repairCharacterCreationMarker(state);refreshTaskProgress(this.tables,state);prepareTaskScenes(this.tables,state,{login:true});expireTaskTrialGroup(this.tables,state);repairSoulEssenceStars(state);upgradeInventory(state);syncCurrencyMirrors(state.player);upgradeSkillState(this.tables,state);upgradeEggState(state);ensureHome(this.tables,state);refreshProduction(state,now);const battle=[];syncBattle({state,tables:this.tables,push:(name,value)=>battle.push(this.packet(name,value))});return [...this.loginPackets(state,session,r,frame,e.id),...battle];});
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
   const saddlesBefore=JSON.stringify(state.mountSaddles);
   const booksBefore=JSON.stringify(state.readingBooks??{});
   const basicBefore=JSON.stringify(state.player.basic_info),attrsBefore=JSON.stringify(state.player.attr_infos);
   const essenceBefore=JSON.stringify(state.player.soulessence_infos);repairSoulEssenceStars(state);
   const bagBefore=JSON.stringify(state.player.sbag_infos);upgradeInventory(state);
   const statePacket=(name,value,meta={})=>{if(name==='CSProtoSyncPlayerData'&&value){const {sbag_infos,soulessence_infos,basic_info,attr_infos,...other}=value;value=other;if(!Object.keys(value).length)return null;}return this.packet(name,value,meta);};
   const emit=(target,name,value,meta)=>{const p=statePacket(name,value,meta);if(p)target.push(p);};
   const petIdsBefore=state.pets.map(p=>p.guid);const eggIdsBefore=(state.petEggs||[]).map(e=>e.guid);const petRevision=state.petRevision||0;const playerLevelBefore=state.player.basic_info.lv;const homeBuildIdsBefore=(state.home?.builds||[]).map(b=>b.guid);const homeWishIdsBefore=(state.home?.wishlist||[]).map(x=>x.uid);const homeRevision=state.homeRevision||0;const eggRevision=state.eggRevision||0;const before=[];const pushes=[];const context={id:session.id,requestKey:frame.seq?session.token+':'+frame.id+':'+frame.seq:null,state,now,randomInt:this.rng,tables:this.tables,pushTo:(recipient,name,value)=>pushes.push(this.packet(name,value,{recipient})),broadcast:(audience,name,value)=>pushes.push(this.packet(name,value,{audience})),pushBefore:(name,value)=>emit(before,name,value),push:(name,value)=>emit(pushes,name,value,{pushSeq:frame.pushSeq})};
   refreshProduction(state,now);const response=handler(context,r);
   if(e.name==='CSProtoPlayerCustomData')this.finishPendingCharacterTask(context);
   syncCurrencyMirrors(state.player);
   const updatedTasks=refreshTaskProgress(this.tables,state);if(updatedTasks.length)context.push('CSProtoTaskSync',{tasks:updatedTasks});
   const newTasks=unlockAutomaticTasks(this.tables,state,now);if(newTasks.length)context.push('CSProtoTaskSync',{...taskSnapshot(this.tables,state),new_task_ids:newTasks});
   if(state.home?.technology&&state.player.basic_info.lv!==playerLevelBefore)state.homeRevision=(state.homeRevision||0)+1;
   if(prepareTaskScenes(this.tables,state)){worldSync({...context,push:context.pushBefore});syncBattle({...context,push:context.pushBefore});}
   if(expireTaskTrialGroup(this.tables,state)){context.pushBefore('CSProtoTrialDatas',trialPayload(state));context.pushBefore('CSProtoSyncPlayerData',{group_mgrs:state.player.group_mgrs});syncBattle({...context,push:context.pushBefore});}
   const petSync=(state.petRevision||0)!==petRevision?[this.packet('CSProtoPetInfoSync',{...releaseFields(state,'pet',now,this.releaseResetHour),pet_infos:{pets:state.pets,guid:petIdsBefore.filter(id=>!state.pets.some(p=>p.guid===id))}}),this.packet('CSProtoPetBoxInfoSync',{box_infos:state.petBoxes})]:[];
   if(petSync.length)syncBattle({...context,push:context.pushBefore});
   const packets=e.rsp?[reply(response||{})]:[];
   const eggSync=(state.eggRevision||0)!==eggRevision?[this.packet('CSProtoPetEggInfoSync',{...releaseFields(state,'egg',now,this.releaseResetHour),egg_infos:{eggs:state.petEggs||[],guid:eggIdsBefore.filter(id=>!(state.petEggs||[]).some(e=>e.guid===id))}})]:[];
   const homeSync=(state.homeRevision||0)!==homeRevision?[this.packet('CSProtoHomeSync',{...homePayload(this.tables,state),del_builds:homeBuildIdsBefore.filter(id=>!state.home.builds.some(b=>b.guid===id)),del_wishlist:homeWishIdsBefore.filter(id=>!state.home.wishlist.some(x=>x.uid===id))})]:[];
   const playerDelta={};if(JSON.stringify(state.player.sbag_infos)!==bagBefore)playerDelta.sbag_infos=state.player.sbag_infos;if(JSON.stringify(state.player.soulessence_infos)!==essenceBefore)playerDelta.soulessence_infos=state.player.soulessence_infos;if(JSON.stringify(state.player.basic_info)!==basicBefore)playerDelta.basic_info=state.player.basic_info;if(JSON.stringify(state.player.attr_infos)!==attrsBefore)playerDelta.attr_infos=state.player.attr_infos;
   const playerSync=Object.keys(playerDelta).length?[this.packet('CSProtoSyncPlayerData',playerDelta)]:[];
   const saddleSync=JSON.stringify(state.mountSaddles)!==saddlesBefore?[this.packet('CSProtoRideMountInfo',{mount_saddlerys:state.mountSaddles})]:[];
   const bookSync=JSON.stringify(state.readingBooks??{})!==booksBefore?[this.packet('CSProtoReadHandbookInfoSync',{infos:Object.values(state.readingBooks??{}),send_type:1})]:[];
   return [...playerSync,...saddleSync,...bookSync,...petSync,...before,...eggSync,...homeSync,...packets,...pushes];
  });
 }
 tick(id){const now=this.clock();if(!productionDue(this.store.load(id).state,now))return [];return this.store.transact(id,0,state=>{const eggRevision=state.eggRevision||0;if(!refreshProduction(state,now))return [];return [...((state.eggRevision||0)!==eggRevision?[this.packet('CSProtoPetEggInfoSync',{...releaseFields(state,'egg',now,this.releaseResetHour),egg_infos:{eggs:state.petEggs||[]}})]:[]),this.packet('CSProtoHomeSync',homePayload(this.tables,state))];});}
 loginPackets(state,session,r,frame,id) {
  const now=this.clock();
  return [this.packet('CSProtoEnterGameCallbackStart',{reconnect:!!r.reconnect,player_id:session.id,crc_rand_index:this.crcDelay,server_time:String(Date.now()),time_offset:'0'}),this.packet(id,{data:state.player,reconnect:!!r.reconnect,time_zone:8,time:now,time_msec:Date.now()%1000,player_id:session.id,server_token:session.token,rc4_key:'',ntf_seq:r.ntf_seq||0,req_seq:frame.seq,line_id:0,server_id:'azurjs',node_id:'azurjs-0'},{seq:frame.seq,pushSeq:frame.pushSeq}),...(state.trialGroup?[this.packet('CSProtoTrialDatas',trialPayload(state))]:[]),this.packet('CSProtoPetInfoSync',{...releaseFields(state,'pet',now,this.releaseResetHour),pet_infos:{pets:state.pets}}),this.packet('CSProtoPetEggInfoSync',{...releaseFields(state,'egg',now,this.releaseResetHour),egg_infos:{eggs:state.petEggs||[]}}),this.packet('CSProtoPetBoxInfoSync',{box_infos:state.petBoxes}),this.packet('CSProtoRideMountInfo',{mount_saddlerys:state.mountSaddles??this.tables.get('mount_saddle').map(s=>s.id)}),this.packet('CSProtoTaskSync',taskSnapshot(this.tables,state)),this.packet('CSProtoMailSync',{mails:state.mail}),this.packet('CSProtoStorySync',{infos:{infos:state.storyIds||[]}}),this.packet('CSProtoHomeSync',homePayload(this.tables,state)),this.packet('SCProtoMonthlyCardInfoSync',monthlyPayload(state)),this.packet('CSProtoReadHandbookInfoSync',{infos:Object.values(state.readingBooks??{}),send_type:0}),this.packet('CSProtoPlayableSync',playableSnapshot(state)),this.packet('CSProtoAllRouletteInfoSync',roulettePayload(state)),this.packet('CSProtoChatRoomSync',{chat_type:2,sysId:String(state.chatWorldRoom??1)}),this.packet('CSProtoChatListSync',chatSnapshots(this.store,state,session.id).list),this.packet('CSProtoChatMsgCntSync',chatSnapshots(this.store,state,session.id).counts)];
 }
}






































