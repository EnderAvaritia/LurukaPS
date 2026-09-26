import {expireTaskTrialGroup,trialPayload} from './trial-groups.js';
import {validateTaskTransfer} from '../task-scenes.js';
import {syncBattle} from '../battle.js';
import {ensure,group} from './common.js';
export function worldSync(c,r={},cmd=256) {
 if(expireTaskTrialGroup(c.tables,c.state)){c.push('CSProtoTrialDatas',trialPayload(c.state));c.push('CSProtoSyncPlayerData',{heros_info:c.state.player.heros_info,group_mgrs:c.state.player.group_mgrs});}
 const s=c.state,w=s.world,g=group(s);const ids=g.heros.filter(h=>h.hero_id&&h.hero_id!=='0').map(h=>h.hero_id);
 c.push('CSProtoWorldMapPointSync',{u32s:w.points});
 c.push('CSProtoWorldMapSync',{cmd,creator_id:c.id,map_id:w.map_id,player_id:c.id,notify_id:c.id,zone_id:0,client_trans_data:r.client_trans_data||0,map_info:{creator_id:c.id,map_id:w.map_id,exist:true,area_id:w.area_id,objs:Object.entries(s.worldObjects??{}).filter(([key])=>key.startsWith(w.map_id+':')).map(([,record])=>{const {claims,...obj}=record;return obj;}),players:[{player_id:c.id,move:[{pos:w.pos,angle:w.angle,area_id:w.area_id,move_status:1,timestamp:String(c.now*1000)}],status:0,host:true,name:s.player.basic_info.name,face:s.player.basic_info.wardrobe,group:{heros:ids,hero_mid:ids,control:g.control},mount:w.mount,apparel_info:s.player.basic_info.apparel_info,clothes_info:s.player.basic_info.clothes_info}]}});
 for(const [id,capture]of Object.entries(s.petCaptureResults??{}))if(capture.map_id===w.map_id)c.push('SCProtoObjDisappearNtf',{agent_uid:id});
}
export function rememberMap(c,destination){
 const w=c.state.world;if(w.map_id===destination)return;
 const history=c.state.worldHistory??=[];history.push({map_id:w.map_id,area_id:w.area_id,pos:{...w.pos},angle:w.angle});if(history.length>8)history.shift();
}
export function registerWorld(on) {
 on('WorldMapActiveBehavior',(c,r)=>{
  ensure(r.type===3,'Active behavior type is not implemented',1021);
  // TaskHelper.SendActiveBehavior sends PAB_NEAR_TRANS_POINT after the white
  // mask. cmd19 drives the native same-map transfer and its flow-end event.
  const w=c.state.world,unlocked=new Set(w.points??[]);
  const points=c.tables.get('world_borthpos').filter(p=>p.cityId===w.map_id&&unlocked.has(p.id));
  ensure(points.length,'No unlocked transfer point in current scene');
  const distance=p=>{const pos=c.tables.position(p).pos;return ['x','y','z'].reduce((sum,key)=>sum+(pos[key]-w.pos[key])**2,0);};
  points.sort((a,b)=>distance(a)-distance(b)||a.id-b.id);
  Object.assign(w,c.tables.position(points[0]));worldSync(c,{},19);syncBattle(c);return {};
 });
 on('EnterWorldMap',(c,r)=>{const w=c.state.world,taskPoint=validateTaskTransfer(c.tables,c.state,r);if(c.state.pendingTaskScene&&!taskPoint&&(!(r.point_id>0)||r.reconnect)){r={...r,map_id:w.map_id,point_id:0};}delete c.state.pendingTaskScene;if(r.map_id&&r.map_id!==w.map_id || r.point_id>0) {const p=taskPoint??(r.point_id>0?c.tables.find('world_borthpos',r.point_id):c.tables.get('world_borthpos').find(p=>p.cityId===r.map_id));ensure(p&&(!r.map_id||p.cityId===r.map_id),'Invalid map/point');rememberMap(c,p.cityId);Object.assign(w,c.tables.position(p));}worldSync(c,r);syncBattle(c);return {};});
 on('WorldPoint',(c,r)=>{const p=c.tables.find('world_borthpos',r.point_id);ensure(p&&c.state.world.points.includes(p.id),'Point is not unlocked');rememberMap(c,p.cityId);Object.assign(c.state.world,c.tables.position(p));worldSync(c,r,19);syncBattle(c);return {};});
 on('WorldPointAck',c=>{c.state.world.last_point_ack={map_id:c.state.world.map_id,point_id:c.state.world.point_id,time:c.now};});
 on('WorldMapReturnLast',c=>{const previous=c.state.worldHistory?.pop();const fallback=previous?null:c.tables.find('world_borthpos',10045);ensure(previous||fallback,'No return destination');const target=previous??c.tables.position(fallback);ensure(c.tables.get('world_borthpos').some(p=>p.cityId===target.map_id),'Return map unavailable');Object.assign(c.state.world,target);worldSync(c);syncBattle(c);return {};});
 on('StateUpdate',(c,r)=>{const m=r.move_msg;if(!m)return;ensure(m.map_id===c.state.world.map_id,'Wrong map');const g=group(c.state);ensure((m.move??[]).length<=256,'Too many movement records');let confirmed;for(const item of m.move||[]) {if(item.uuid!==g.control)continue;const i=item.info;ensure(i?.pos,'Missing movement position');const pos=Object.fromEntries(['x','y','z'].map(k=>[k,i.pos[k]??0]));ensure(Object.values(pos).every(v=>Number.isInteger(v)&&Math.abs(v)<100000000),'Invalid coordinates');c.state.world.pos=pos;c.state.world.angle=i.angle??0;if(i.area_id!==undefined)c.state.world.area_id=i.area_id;confirmed={uuid:item.uuid,info:{...i,pos,angle:i.angle??0}};}if(confirmed)c.push('CSProtoStateUpdateBC',{move_msg:{map_id:m.map_id,move:[confirmed]}});});
 on('DayWeatherSync',(c,r)=>{ensure(r.weather>0,'Invalid weather');c.state.world.weather=r.weather;return {weather:r.weather};});
 on('WorldMapPlayerMountStatus',(c,r)=>{ensure(r.u32<=10);c.state.world.mount_status=r.u32;return {};});
}



