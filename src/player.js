import {initialPetSkills} from './skills.js';
import fs from 'node:fs';
import path from 'node:path';
export const bytes = text => Buffer.from(text,'utf8').toString('base64');
export class Tables {
  constructor(dir) { this.dir=dir; this.cache=new Map(); this.indices=new Map(); }
  get(name) {
    if(!this.cache.has(name)) {
      const rows=JSON.parse(fs.readFileSync(path.join(this.dir,`${name}.json`),'utf8'));
      if(!Array.isArray(rows)) throw Error(`Invalid table ${name}`);
      this.cache.set(name,rows);
    }
    return this.cache.get(name);
  }
  find(name,id) { if(!this.indices.has(name))this.indices.set(name,new Map(this.get(name).map(x=>[x.id,x]))); return this.indices.get(name).get(Number(id)); }
  position(point) {
    const values=String(point.borthPoint).split('|').map(Number);
    if(values.length!==6 || values.some(x=>!Number.isFinite(x))) throw Error(`Invalid borthPoint ${point.id}`);
    return {map_id:point.cityId,point_id:point.id,pos:{x:Math.trunc(values[0]*100),y:Math.trunc(values[1]*100),z:Math.trunc(values[2]*100)},angle:Math.trunc(values[4]),area_id:point.cityId===100?100004:0};
  }
}
export function seedPlayer(tables,id,openId) {
  const heroes=tables.get('hero').filter(h=>h.isUsable===1).map(h=>({guid:((1n<<56n)|(BigInt(h.id)<<32n)|BigInt(id)).toString(),conf_id:h.id,hero_lv:1,hero_exp:0,hero_rank:1,hero_star:0,hero_grade:1,system_skill_levels:[1,1,1,1,1,1],type:0,favorability_lv:1,pet_id:'0',wguid:0}));
  if(!heroes.length) throw Error('No usable heroes in table');
  const pets=tables.get('pet').filter(p=>p.petStage>0&&p.IsCatch===1&&tables.find('template_value',p.id)).map((p,i)=>({guid:String(p.id),config_id:p.id,feature:1,comprehension:tables.get('pet_learningenum').map(x=>({attr_id:x.attributeEnum,level:1,cur_exp:0,value:100})),inherent_skills:initialPetSkills(p),lv:1,rank:1,exp:0,base_lv:1,favor_lv:1,favor_val:0,is_lock:true,box_id:(Math.floor(i/30)+1)*100+i%30+1,type:1,satiety_val:10000,hero_id:'0',roulette_pos:0}));
  const essences=tables.get('soulessence').map(e=>({guid:e.id,id:e.id,lv:1,rank:1,advance:0,exp:0,lock:true,wear_hero:'0'}));
  const selected=heroes.slice(0,3);
  const groups=Array.from({length:5},(_,i)=>({id:i+1,group_name:bytes(`队伍${i+1}`),heros:selected.map(h=>({hero_id:h.guid})),control:selected[0].guid}));
  const birth=tables.find('world_borthpos',10045)||tables.get('world_borthpos')[0];
  return {schema:1, player:{basic_info:{id,zone_id:1,name:bytes('AzurPlayer'),sex:2,lv:1,sign:bytes('azurjs'),gold:0,diamond:0,exp:0,account:bytes(openId),regtm:Math.floor(Date.now()/1000),home_lv:1,wardrobe:{sex:2,height:90,complexion:0},info:{},detail_info:{},lend_info:{can_lend_num:0,last_lend_time:0},language:1,birthday:{month:1,day:1},is_created:true,skip_guide:1,nest_guide_finish:1,apparel_info:{},clothes_info:{}},heros_info:{heros:heroes,battle_infos:[]},sbag_infos:{items:[]},attr_infos:{attrs:[]},soulessence_infos:{soulessences:essences},group_mgrs:[{type:1,cur_group:1,last_group:1,src:0,groups}],guide_infos:{infos:[]},settings:{entries:[]},home_settings:{entries:[]}},pets,petBoxes:Array.from({length:Math.ceil(pets.length/30)},(_,i)=>({id:i+1,box_name:bytes(`奇波小屋${i+1}`)})),world:{...tables.position(birth),weather:1,mount:'0',points:tables.get('world_borthpos').map(p=>p.id)},mail:[],tasks:[],claims:[],flags:{}};
}



