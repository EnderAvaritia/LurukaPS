import {technologyPayload} from './technology.js';
import {ensure} from './handlers/common.js';
export function ensureHome(tables,state){
 if(state.home)return state.home;
 const raw=tables.get('game').find(x=>x.title==='HOME_DEFAULT_PLACEMENT')?.value;const values=String(raw||'').split('|').map(Number);ensure(values.length===5&&values.every(Number.isInteger)&&values[0]===13,'Invalid default home placement',1007);
 const [,id,block,anchor,direction]=values,config=tables.find('home_building',id);ensure(config&&tables.find('home_block',block),'Missing initial home configuration',1007);const group=tables.get('home_building_group').find(g=>g.groupId===config.groupId);ensure(group,'Missing home building group',1007);
 state.home={name:Buffer.from('我的家园').toString('base64'),level:state.player.basic_info.home_lv||1,exp:0,inventory:[{build_id:id,total_num:1,used_num:1,unlock:true}],builds:[{guid:1,build_id:id,build_type:group.type,status:1,locate:{block_id:block,anchor,direction}}],shortcuts:[],wishlist:[],nextBuildGuid:2,nextWishUid:1};state.homeRevision=(state.homeRevision||0)+1;return state.home;
}
export function homePayload(tables,state){const h=ensureHome(tables,state);return {technology:technologyPayload(tables,state),home_lv:h.level,home_name:h.name,builds:h.inventory,home_builds:h.builds,shortcut_bars:h.shortcuts,wishlist:h.wishlist,formula:Object.entries(h.craftCounts||{}).map(([id,count])=>({product_id:Number(id),craft_count:count})),home_hub:{pos_infos:[],station_pets:[]},home_level_new_base:{level:h.level,exp:h.exp,option_setting:0}};}
export function addHomeBuildings(tables,state,id,count){const config=tables.find('home_building',id);ensure(config,'Unknown building reward',1007);const home=ensureHome(tables,state);let row=home.inventory.find(b=>b.build_id===id);if(!row){row={build_id:id,total_num:0,used_num:0,unlock:true};home.inventory.push(row);}ensure(row.total_num+count<=0xffffffff,'Building quantity overflow');row.total_num+=count;state.homeRevision=(state.homeRevision||0)+1;}


