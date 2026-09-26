import {ensure} from './common.js';

const ids=text=>String(text??'').split('|').filter(Boolean).map(Number);
export const lockedDuelSlot=98;
export function ensureArenaFormationManager(state){
 const managers=state.player.group_mgrs??=([]);let arena=managers.find(m=>m.type===6);
 if(!arena){arena={type:6,cur_group:1,last_group:1,src:0,groups:[]};managers.push(arena);}
 arena.groups??=[];
 if(!arena.cur_group)arena.cur_group=1;
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
 return {slot:lockedDuelSlot,pet_guids:selected,hero,hero_skills:[],duel_id:row.id,index:Number(row.kiboLock)||0};
}
export function registerKiboDuel(on,tables,protocol){
 on('KiboDuelGetGroup',(c,r)=>{
  const row=tables.find('kibo_duel',r.u32);ensure(row,'Unknown Kibo duel');
  const arena=ensureArenaFormationManager(c.state),groups=c.state.kiboDuelGroups??={};
  let group=groups[lockedDuelSlot];
  if(!group||group.duel_id!==row.id||group.pet_guids?.length!==8)group=lockedFormation(tables,c.state,row);
  delete groups[0];groups[lockedDuelSlot]=group;c.state.kiboDuelSlot=1;
  const serialized=protocol.encode('cs.PetDuelGroupInfo',group).toString('base64');
  const saved=arena.groups.find(g=>g.id===lockedDuelSlot);
  if(saved)saved.pet_duel_group_info=serialized;
  else arena.groups.push({id:lockedDuelSlot,heros:[],control:'0',pet_duel_group_info:serialized});
  // Arena (type 6) lives in PlayerData; 10740 only populates KiBoDuelStore.
  c.pushBefore('CSProtoSyncPlayerData',{group_mgrs:[arena]});
  c.pushBefore('CSProtoKiboDuelGroupInfoSync',kiboDuelSnapshot(c.state));return {};
 });
}
