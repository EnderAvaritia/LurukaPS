import {syncBattle} from '../battle.js';
import {ensure,group} from './common.js';
export function worldSync(c,r={}) {
 const s=c.state,w=s.world,g=group(s);const ids=g.heros.filter(h=>h.hero_id&&h.hero_id!=='0').map(h=>h.hero_id);
 c.push('CSProtoWorldMapPointSync',{u32s:w.points});
 c.push('CSProtoWorldMapSync',{cmd:256,creator_id:c.id,map_id:w.map_id,player_id:c.id,notify_id:c.id,zone_id:0,client_trans_data:r.client_trans_data||0,map_info:{creator_id:c.id,map_id:w.map_id,exist:true,area_id:w.area_id,players:[{player_id:c.id,move:[{pos:w.pos,angle:w.angle,area_id:w.area_id,move_status:1,timestamp:String(c.now)}],status:0,host:true,name:s.player.basic_info.name,face:s.player.basic_info.wardrobe,group:{heros:ids,hero_mid:ids,control:g.control},mount:w.mount,apparel_info:s.player.basic_info.apparel_info,clothes_info:s.player.basic_info.clothes_info}]}});
}
export function registerWorld(on) {
 on('EnterWorldMap',(c,r)=>{const w=c.state.world;if(r.map_id&&r.map_id!==w.map_id || r.point_id>0) {const p=r.point_id>0?c.tables.find('world_borthpos',r.point_id):c.tables.get('world_borthpos').find(p=>p.cityId===r.map_id);ensure(p&&(!r.map_id||p.cityId===r.map_id),'Invalid map/point');Object.assign(w,c.tables.position(p));}worldSync(c,r);syncBattle(c);return {};});
 on('WorldPoint',(c,r)=>{const p=c.tables.find('world_borthpos',r.point_id);ensure(p&&c.state.world.points.includes(p.id),'Point is not unlocked');Object.assign(c.state.world,c.tables.position(p));worldSync(c,r);syncBattle(c);return {};});
 on('StateUpdate',(c,r)=>{const m=r.move_msg;if(!m)return;ensure(m.map_id===c.state.world.map_id,'Wrong map');const g=group(c.state);for(const item of m.move||[]) {if(item.uuid!==g.control)continue;const i=item.info;ensure(i?.pos&&['x','y','z'].every(k=>Number.isInteger(i.pos[k])&&Math.abs(i.pos[k])<100000000),'Invalid coordinates');c.state.world.pos=i.pos;if(i.angle!==undefined)c.state.world.angle=i.angle;if(i.area_id!==undefined)c.state.world.area_id=i.area_id;}});
 on('DayWeatherSync',(c,r)=>{ensure(r.weather>0,'Invalid weather');c.state.world.weather=r.weather;return {weather:r.weather};});
 on('WorldMapPlayerMountStatus',(c,r)=>{ensure(r.u32<=10);c.state.world.mount_status=r.u32;return {};});
}

