import {ensure} from './common.js';
import {rememberMap,worldSync} from './world.js';
import {heroModules,petModules} from '../battle.js';
import {petData,petGrade} from '../pets.js';

const ids=text=>String(text??'').split('|').filter(Boolean).map(Number);
const duelSkills=row=>ids(row.skillList).map((skill_id,i)=>({skill_id,skill_lv:1,skill_slot:701+i,type:1}));
export const lockedDuelSlot=98;
const arenaLockedSlot=0;
function arenaPetGuid(state,entry){
 const id=String(entry.id??'0');
 if(id==='0')return '0';
 return entry.is_trial?((9n<<56n)|(BigInt(id)<<32n)|BigInt(state.player.basic_info.id)).toString():id;
}
function normalizeArenaPets(state,entries){return entries.map(entry=>({guid:arenaPetGuid(state,entry),is_trial:!!entry.is_trial,id:String(entry.id??'0')}));}
export function repairPendingDuelEntry(state,now=Math.floor(Date.now()/1000)){
 const info=state.multiCampaign;
 if(!info||info.status!==2||state.world.map_id!==info.map_id)return false;
 if(info.arena_status&&(!Number.isFinite(Number(now))||Number(now)-Number(info.start_time)<60))return false;
 const previous=state.worldHistory?.pop();if(!previous)return false;
 Object.assign(state.world,previous);delete state.multiCampaign;delete state.kiboDuelLoadingCompleteAt;delete state.kiboDuelFirstGuid;delete state.kiboDuelFirstConfirmedAt;return true;
}
export function ensureArenaFormationManager(state){
 const managers=state.player.group_mgrs??=([]);let arena=managers.find(m=>m.type===6);
 if(!arena){arena={type:6,cur_group:1,last_group:1,src:0,groups:[]};managers.push(arena);}
 arena.groups??=[];
 if(arena.cur_group==null)arena.cur_group=1;
 return arena;
}
export function kiboDuelSnapshot(state){return {use_slot:state.kiboDuelSlot??1,groups:Object.values(state.kiboDuelGroups??{}),records:Object.values(state.kiboDuelRecords??{})};}
function lockedFormation(tables,state,row){
 const trialIds=ids(row.kiboList);ensure(trialIds.every(id=>tables.find('trial_pet',id)),'Kibo duel trial pet unavailable',1007);
 const selected=trialIds.map(id=>({is_trial:true,id:String(id)}));
 const usedConfigs=new Set(trialIds.map(id=>tables.find('trial_pet',id).trialPet));
 for(const configId of ids(row.kiboLockList)){
  if(selected.length>=8)break;
  if(usedConfigs.has(configId))continue;
  const pet=state.pets.find(p=>Number(p.config_id)===configId);
  if(!pet)continue;
  selected.push({is_trial:false,id:String(pet.guid)});usedConfigs.add(configId);
 }
 while(selected.length<8)selected.push({is_trial:false,id:'0'});
 const heroConfig=Number(tables.get('game').find(g=>g.title===(state.player.basic_info.sex===1?'AVATAR_HERO_ID_MALE':'AVATAR_HERO_ID_FEMALE'))?.value);
 const hero=state.player.heros_info.heros.find(h=>h.conf_id===heroConfig)?.guid??'0';
 const hero_skills=duelSkills(row);
 return {slot:lockedDuelSlot,pet_guids:normalizeArenaPets(state,selected),hero,hero_skills,duel_id:row.id,index:Number(row.kiboLock)||0};
}
export function arenaAttributePayload(tables,state){
 const group=state.kiboDuelGroups?.[arenaLockedSlot];ensure(group?.pet_guids?.length===8,'Arena formation unavailable');
 const hero=state.player.heros_info.heros.find(h=>h.guid===group.hero);ensure(hero,'Arena hero unavailable');
 const heroBase=heroModules(tables,state,hero),infos=[];
 for(const entry of group.pet_guids){
  if(entry.id==='0')continue;
  let profile;
  if(entry.is_trial){
   const trial=tables.find('trial_pet',Number(entry.id));ensure(trial,'Trial pet configuration unavailable',1007);
   const source=state.pets.find(p=>p.config_id===trial.trialPet)??state.kiboDuelTrialProfiles?.[entry.id];
   ensure(source,'Trial pet profile unavailable',1007);
   profile={...source,guid:entry.guid,config_id:trial.trialPet,lv:trial.trialPetLevel,hero_id:'0'};
  }else profile=state.pets.find(p=>p.guid===entry.id);
  ensure(profile,'Arena pet unavailable');
  const modules=petModules(tables,state,profile,[]),sub=modules.modules[0].sub_modules[0];
  infos.push({pet_guid:entry,attrs:sub.attrs,skills:modules.modules,pet_conf_id:profile.config_id,pet_lv:profile.lv,pet_color:profile.color??0,special:profile.special??0,gene_list:(profile.gene_infos??[]).map(g=>g.gene_id)});
 }
 return {infos,hero_info:{hero_guid:hero.guid,hero_conf_id:hero.conf_id,hero_lv:hero.hero_lv,hero_star:hero.hero_star,hero_grade:hero.hero_grade,attrs:heroBase.modules[0].sub_modules[0].attrs,skills:group.hero_skills??[]}};
}
function saveArenaGroup(arena,protocol,group){
 const serialized=protocol.encode('cs.PetDuelGroupInfo',group).toString('base64');
 const saved=arena.groups.find(g=>g.id===group.slot);
 if(saved)saved.pet_duel_group_info=serialized;
 else arena.groups.push({id:group.slot,heros:[],control:'0',pet_duel_group_info:serialized});
}
export function registerKiboDuel(on,tables,protocol){
 on('KiboDuelGetGroup',(c,r)=>{
  const row=tables.find('kibo_duel',r.u32);ensure(row,'Unknown Kibo duel');
  for(const id of ids(row.kiboList)){
   const trial=tables.find('trial_pet',id);ensure(trial,'Trial pet configuration unavailable',1007);
   if(c.state.pets.some(p=>p.config_id===trial.trialPet)||c.state.kiboDuelTrialProfiles?.[id])continue;
   const profile=petData(tables,trial.trialPet,arenaPetGuid(c.state,{is_trial:true,id}),0);
   profile.lv=trial.trialPetLevel;profile.grade=petGrade(tables,profile);
   (c.state.kiboDuelTrialProfiles??={})[id]=profile;
  }
  const arena=ensureArenaFormationManager(c.state),groups=c.state.kiboDuelGroups??={};
  let group=groups[lockedDuelSlot];
  if(!group||group.duel_id!==row.id||group.pet_guids?.length!==8)group=lockedFormation(tables,c.state,row);
  else if(!group.hero_skills?.length&&row.skillList)group={...group,hero_skills:duelSkills(row)};
  group={...group,pet_guids:normalizeArenaPets(c.state,group.pet_guids)};
  groups[lockedDuelSlot]=group;
  // CBT3's native KiBoDuelStore uses 98; the arena Lua page uses 0.
  let arenaGroup=groups[arenaLockedSlot]?.duel_id===row.id&&groups[arenaLockedSlot].pet_guids?.length===8?groups[arenaLockedSlot]:{...group,slot:arenaLockedSlot};
  if(!arenaGroup.hero_skills?.length&&row.skillList)arenaGroup={...arenaGroup,hero_skills:duelSkills(row)};
  arenaGroup={...arenaGroup,pet_guids:normalizeArenaPets(c.state,arenaGroup.pet_guids)};
  groups[arenaLockedSlot]=arenaGroup;c.state.kiboDuelSlot=1;
  saveArenaGroup(arena,protocol,arenaGroup);saveArenaGroup(arena,protocol,group);
  // Arena (type 6) lives in PlayerData; 10740 only populates KiBoDuelStore.
  c.pushBefore('CSProtoSyncPlayerData',{group_mgrs:[arena]});
  c.pushBefore('CSProtoKiboDuelGroupInfoSync',kiboDuelSnapshot(c.state));return {};
 });
 on('KiboDuelGroupChange',(c,r)=>{
  ensure(r.type===6&&r.group,'Invalid arena group type');const slot=Number(r.group.slot??0);
  ensure(Number.isInteger(slot)&&(slot===arenaLockedSlot||slot===lockedDuelSlot||slot>=1&&slot<=5),'Invalid arena group slot');
  ensure(Array.isArray(r.group.pet_guids)&&r.group.pet_guids.length===8,'Invalid arena pet slots');
  const row=tables.find('kibo_duel',r.group.duel_id);ensure(row,'Unknown Kibo duel');
  const pet_guids=r.group.pet_guids.map(p=>{
   const id=String(p.id??'0'),is_trial=!!p.is_trial;
   if(id!=='0')ensure(is_trial?!!tables.find('trial_pet',Number(id)):c.state.pets.some(pet=>pet.guid===id),'Invalid arena pet');
   return {is_trial,id};
  });
  const existing=c.state.kiboDuelGroups?.[slot],hero=String(r.group.hero??existing?.hero??'0');
  ensure(hero==='0'||c.state.player.heros_info.heros.some(h=>h.guid===hero),'Arena hero not owned');
  const hero_skills=r.group.hero_skills??[];ensure(hero_skills.length<=8,'Invalid arena skills');
  const group={slot,pet_guids:normalizeArenaPets(c.state,pet_guids),hero,hero_skills,duel_id:row.id,index:Number(r.group.index??existing?.index??0)};
  const arena=ensureArenaFormationManager(c.state);saveArenaGroup(arena,protocol,group);
  if(slot===arenaLockedSlot||slot===lockedDuelSlot)(c.state.kiboDuelGroups??={})[slot]=group;
  c.pushBefore('CSProtoSyncPlayerData',{group_mgrs:[arena]});return {};
 });
 on('SetKiboDuelCurGroup',(c,r)=>{
  ensure(r.type===6,'Invalid arena group type');const slot=Number(r.cur_group??0),arena=ensureArenaFormationManager(c.state);
  ensure(Number.isInteger(slot)&&(slot>=1&&slot<=5||arena.groups.some(g=>g.id===slot)),'Unknown arena group');
  arena.last_group=arena.cur_group;arena.cur_group=slot;
  c.pushBefore('CSProtoSyncPlayerData',{group_mgrs:[arena]});return {};
 });
 on('MultiCampaignCreate',(c,r)=>{
  const dungeon=tables.find('dungeon',r.dungeon_id),duel=dungeon&&tables.find('kibo_duel',dungeon.gameplayID);
  ensure(dungeon?.dungeonType===400&&duel?.dungeonId===dungeon.id,'Unsupported dungeon',1021);
  const map=tables.find('kibo_duel_map',duel.mapId),scene=Number(map?.art),coords=String(dungeon.position??'').split('|').map(Number);
  ensure(Number.isInteger(scene)&&scene>0&&coords.length===6&&coords.every(Number.isFinite),'Invalid arena scene configuration',1007);
  const arena=ensureArenaFormationManager(c.state),formation=c.state.kiboDuelGroups?.[arenaLockedSlot];
  ensure(formation?.duel_id===duel.id&&formation.pet_guids?.length===8,'Arena formation unavailable');
  const petGuids=formation.pet_guids.filter(p=>p.id!=='0').map(p=>p.guid);
  ensure(petGuids.length>=Number(duel.minimumKibo),'Not enough arena pets');
  const active=c.state.multiCampaign;
  ensure(!active||active.dungeon_id===dungeon.id&&active.status>=2&&active.status<=3,'Another dungeon is active');
  if(!active){
   rememberMap(c,scene);
   const w=c.state.world;w.map_id=scene;w.point_id=0;w.area_id=0;w.pos={x:Math.round(coords[0]*100),y:Math.round(coords[1]*100),z:Math.round(coords[2]*100)};w.angle=Math.round(coords[4]);
   c.state.multiCampaign={dungeon_id:dungeon.id,duel_id:duel.id,status:2,start_time:String(c.now),dungeon_scene_id:scene,map_id:scene,line_id:1,arena_status:3};
  }
  const {duel_id,arena_status,...info}=c.state.multiCampaign;
  const hero=c.state.player.heros_info.heros.find(h=>h.guid===formation.hero);
  ensure(hero,'Arena hero unavailable');
  c.state.kiboDuelFirstGuid=petGuids[0];
  const name=Buffer.from(c.state.player.basic_info.name,'base64').toString('utf8');
  c.pushBefore('CSProtoKiboDuelFightingInfoSync',{id:duel.id,status:2,start_time:c.now});
  c.pushBefore('CSProtoMultiCampaignInfoSync',{camp:[info]});
  c.pushBefore('CSProtoCurMultiCampaignInfoSync',info);
  c.pushBefore('CSProtoMultiCampaignBaseInfoSync',{dungeon_id:dungeon.id,dungeon_scene_id:scene,player_list:[{player_id:c.id,hero_id:hero.conf_id,name,lv:c.state.player.basic_info.lv,heros:[{hero_id:hero.conf_id}]}],team_option_list:[{player_id:c.id,stay:true}],player_status_list:[{player_id:c.id,status:1}]});
  c.pushBefore('CSProtoKiboDuelArenaPlayerBaseInfo',{infos:[{player_id:c.id,name,player_camp:1,hero_guid:hero.guid,hero_conf_id:hero.conf_id}]});
  c.pushBefore('CSProtoKiboDuelAttrInfoSync',arenaAttributePayload(tables,c.state));
  c.pushBefore('SCProtoKiboDuelArenaCardInfoSync',{pet_guids:petGuids});
  c.pushBefore('SCProtoKiboDuelArenaFirstInfoSync',{id:c.id,pet_guid:c.state.kiboDuelFirstGuid});
  worldSync(c);
  const arenaInfo={status_endtime:String(c.now+Number(duel.time||300)),enter_type:0};
  c.push('SCProtoKiboDuelArenaInfoSync',{...arenaInfo,status:2});
  c.push('SCProtoKiboDuelArenaInfoSync',{...arenaInfo,status:3});
  return {};
 });
 on('StartDungeonClientOk',c=>{
  const info=c.state.multiCampaign;ensure(info?.status>=2&&c.state.world.map_id===info.map_id,'No active dungeon');
  info.status=3;const {duel_id,arena_status,...wire}=info;c.pushBefore('CSProtoCurMultiCampaignInfoSync',wire);return {};
 });
 on('MultiCampaignPlayerLoadingPageComplete',c=>{
  const info=c.state.multiCampaign;ensure(info?.arena_status===3&&c.state.world.map_id===info.map_id,'No active arena loading');
  c.state.kiboDuelLoadingCompleteAt??=c.now;return {};
 });
 on('KiboDuelArenaSetFirstReq',(c,r)=>{
  const info=c.state.multiCampaign,group=c.state.kiboDuelGroups?.[arenaLockedSlot],guid=String(r.pet_guid??'0');
  ensure(info?.arena_status===3&&group?.pet_guids.some(p=>p.guid===guid&&p.id!=='0'),'First pet is not in arena formation');
  c.state.kiboDuelFirstGuid=guid;c.pushBefore('SCProtoKiboDuelArenaFirstInfoSync',{id:c.id,pet_guid:guid});return {};
 });
 on('KiboDuelArenaFirstConfirmReq',c=>{
  const info=c.state.multiCampaign,group=c.state.kiboDuelGroups?.[arenaLockedSlot],guid=c.state.kiboDuelFirstGuid;
  if(info?.arena_status===4&&c.state.kiboDuelFirstConfirmedAt)return {};
  ensure(info?.arena_status===3&&group?.pet_guids.some(p=>p.guid===guid&&p.id!=='0'),'No first arena pet selected');
  c.state.kiboDuelFirstConfirmedAt=c.now;info.arena_status=4;
  c.pushBefore('SCProtoKiboDuelArenaFirstConfirmInfoSync',{confirm_infos:[{player_id:c.id,isConfirm:true}]});
  c.pushBefore('SCProtoKiboDuelArenaInfoSync',{status:4,status_endtime:String(c.now+Number(tables.find('kibo_duel',info.duel_id)?.time||300)),enter_type:0});
  return {};
 });
 on('MultiCampaignQuit',c=>{
  const info=c.state.multiCampaign;ensure(info&&info.status>=2,'No active dungeon');
  info.status=1;info.end_time=String(c.now);const {duel_id,arena_status,...wire}=info;
  c.pushBefore('CSProtoMultiCampaignInfoSync',{camp:[wire]});c.pushBefore('CSProtoCurMultiCampaignInfoSync',wire);
  c.pushBefore('SCProtoKiboDuelArenaInfoSync',{status:7});
  const previous=c.state.worldHistory?.pop();ensure(previous,'Dungeon return position unavailable');
  Object.assign(c.state.world,previous);worldSync(c);delete c.state.multiCampaign;delete c.state.kiboDuelLoadingCompleteAt;delete c.state.kiboDuelFirstGuid;delete c.state.kiboDuelFirstConfirmedAt;return {};
 });
}
