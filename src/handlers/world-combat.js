import {ensure} from './common.js';
import {actor} from './combat.js';
import {u64,combatState,boundedSet} from '../combat-state.js';
function runtime(c){const state=combatState(c.state,c.now);state.summons??={};state.summonRequests??={};state.hatred??={objects:{},players:{}};return state;}
function syncHatred(c,battle){c.pushBefore('SCProtoWorldHatredSync',{obj_info:Object.values(battle.hatred.objects),player_info:Object.values(battle.hatred.players)});}
function clearHatred(battle,id,isPlayer=false){
 let changed=false;const table=battle.hatred[isPlayer?'players':'objects'];if(table[id]){delete table[id];changed=true;}
 for(const entries of Object.values(battle.hatred))for(const [key,info]of Object.entries(entries)){
  const field=isPlayer?'player_obj_ids':'target_obj_ids',next=info[field].filter(value=>String(value)!==id);if(next.length!==info[field].length){info[field]=next;changed=true;if(!info.target_obj_ids.length&&!info.player_obj_ids.length)delete entries[key];}
 }
 return changed;
}
function removeAssociated(battle,id){delete battle.skills[id];delete battle.entities[id];for(const [key,b]of Object.entries(battle.bullets))if(b.unit_id===id)delete battle.bullets[key];for(const [key,e]of Object.entries(battle.elements))if(e.tar_id===id||e.buff?.creator_id===id)delete battle.elements[key];}
export function registerWorldCombat(on){
 for(const [name,field]of [['ObjHatredIncSync','objects'],['PlayerHatredIncSync','players']])on(name,(c,r)=>{
  ensure(r.info,'Missing hatred data');const id=actor(c,r.info.id),targets=r.info.target_obj_ids??[],players=r.info.player_obj_ids??[];ensure(targets.length<=256&&players.length<=64,'Hatred list too large');
  const targetIds=[...new Set(targets.map(id=>actor(c,id)))],playerIds=[...new Set(players)];ensure(playerIds.every(n=>Number.isInteger(n)&&n>0),'Invalid hatred player');
  const battle=runtime(c),table=battle.hatred[field],previous=table[id]??{id,target_obj_ids:[],player_obj_ids:[]};
  const value={id,target_obj_ids:r.inc?[...new Set([...previous.target_obj_ids,...targetIds])]:previous.target_obj_ids.filter(x=>!targetIds.includes(x)),player_obj_ids:r.inc?[...new Set([...previous.player_obj_ids,...playerIds])]:previous.player_obj_ids.filter(x=>!playerIds.includes(x))};
  ensure(value.target_obj_ids.length<=256&&value.player_obj_ids.length<=64,'Hatred list too large');if(!value.target_obj_ids.length&&!value.player_obj_ids.length)delete table[id];else boundedSet(table,id,value,512);
  syncHatred(c,battle);return {inc:!!r.inc,info:{id,target_obj_ids:targetIds,player_obj_ids:playerIds}};
 });
 on('HatredResetSync',(c,r)=>{const id=actor(c,r.obj_id),battle=runtime(c);clearHatred(battle,id,!!r.is_player);syncHatred(c,battle);return {is_player:!!r.is_player,obj_id:id};});
 on('HatredResetToHomeSync',(c,r)=>{const id=actor(c,r.obj_id),battle=runtime(c);clearHatred(battle,id);syncHatred(c,battle);return {obj_id:id};});
 on('CreateSummon',(c,r)=>{
  const owner=u64(r.unit_id);if(owner!=='0')actor(c,owner);const info=r.summon_info;ensure(info?.config_id>0&&[1,2,3,4,5].includes(info.summon_type),'Invalid summon data');ensure((info.attrButeInfos??[]).length<=256,'Too many summon attributes');
  const index=u64(r.verify_info?.battle_index);ensure(index!=='0','Missing summon battle index');const battle=runtime(c),requestKey=index,previous=battle.summonRequests[requestKey];
  if(previous){ensure(previous.owner_id===owner&&previous.config_id===info.config_id&&previous.summon_type===info.summon_type,'Summon index reused for another object');c.push('SCProtoCreateSummon',{unit_id:previous.removed?'0':previous.unit_id,battle_index:index});return;}
  ensure(Object.keys(battle.summons).length<256,'Too many active summons');let id=u64(info.unit_id);
  if(id!=='0'){ensure(info.summon_type===3,'Unexpected client summon ID');ensure((BigInt(id)>>56n)===17n&&(BigInt(id)&0xffffffffn)===BigInt(c.id),'Invalid client summon owner');}
  else {const sequence=BigInt(c.state.nextSummonSequence??'0')+1n;ensure(sequence<0x800000n,'Summon identity exhausted');id=((17n<<56n)|((0x800000n+sequence)<<32n)|BigInt(c.id)).toString();c.state.nextSummonSequence=sequence.toString();}
  ensure(!battle.summons[id],'Summon identity already in use');const record={unit_id:id,owner_id:owner,battle_index:index,config_id:info.config_id,summon_type:info.summon_type,info:{...structuredClone(info),unit_id:id},created_at:c.now,request_key:requestKey};
    if(Object.keys(battle.summonRequests).length>=1024){const obsolete=Object.keys(battle.summonRequests).find(key=>battle.summonRequests[key].removed);ensure(obsolete,'Summon request cache full');delete battle.summonRequests[obsolete];}
  battle.summons[id]=record;battle.summonRequests[requestKey]={unit_id:id,owner_id:owner,config_id:info.config_id,summon_type:info.summon_type};
  c.push('SCProtoCreateSummon',{unit_id:id,battle_index:index});
 });
 on('RemoveSummon',(c,r)=>{const id=u64(r.unit_id),battle=runtime(c),record=battle.summons[id];if(!record)return;delete battle.summons[id];if(battle.summonRequests[record.request_key])battle.summonRequests[record.request_key].removed=true;removeAssociated(battle,id);if(clearHatred(battle,id))syncHatred(c,battle);c.push('CSProtoRemoveSummonSync',{unit_id:id,op:r.op??0,op_time:u64(r.op_time)});});
 on('FightBreak',(c,r)=>{const infos=r.infos??[];ensure(infos.length<=256,'Too many break values');const battle=runtime(c);battle.breakValues??={};for(const info of infos){const id=actor(c,info.tarId);ensure(info.val&&Number.isInteger(info.val.val),'Missing break value');boundedSet(battle.breakValues,id,{...info.val,updated_at:c.now},512);}});
}


