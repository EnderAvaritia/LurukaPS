import {ensure} from './handlers/common.js';import {spend} from './inventory.js';
export function deliveryKey(state,taskId,nodeId,index){return `${taskId}:${state.taskEpochs?.[taskId]||0}:${nodeId}:${index}`;}
export function deliveryRequirements(condition){const data=condition.__type_TaskConditionBaseData?.__type_TaskCondSubItemData;ensure(condition.conditionId===2501&&data,'Not an exact-item submission condition');const rows=Array.isArray(data.itemDatas)?data.itemDatas:data.itemDatas?[data.itemDatas]:[];ensure(rows.length>0,'Empty item requirement',1007);const requirements=new Map();for(const row of rows){ensure(Number.isInteger(row.itemId)&&row.itemId>0&&Number.isInteger(row.count)&&row.count>0,'Invalid task item requirement',1007);const key=`${data.itemBigType}:${row.itemId}`;requirements.set(key,(requirements.get(key)||0)+row.count);}return {data,requirements};}
export function deliveryComplete(state,condition,context){if(!context)return false;const {requirements}=deliveryRequirements(condition),record=state.taskDeliveries?.[deliveryKey(state,context.taskId,context.nodeId,context.index)]||{};return [...requirements].every(([key,n])=>(record[key]||0)>=n);}
export function submitTaskItems(c,condition,context,items){
 const {data,requirements}=deliveryRequirements(condition);ensure([3,10].includes(data.itemBigType),'This task item category is not implemented',1021);
 const mapId=data.mapId||condition.__type_TaskConditionBaseData?.mapData?.sceneId;ensure(!mapId||c.state.world.map_id===mapId,'Task submission is in a different map');
 ensure(Array.isArray(items)&&items.length>0&&items.length<=100,'Invalid submission list');const amounts=new Map();
 for(const item of items){ensure(item.item_type===data.itemBigType&&(!item.item_guid||item.item_guid==='0'),'Wrong task item category or instance');ensure(Number.isInteger(item.item_count)&&item.item_count>0,'Invalid task item count');const key=`${item.item_type}:${item.item_id}`;ensure(requirements.has(key),'Item not requested by task');const n=(amounts.get(key)||0)+item.item_count;ensure(Number.isSafeInteger(n)&&n<=0xffffffff,'Task item quantity overflow');amounts.set(key,n);}
 c.state.taskDeliveries??={};const key=deliveryKey(c.state,context.taskId,context.nodeId,context.index),record=c.state.taskDeliveries[key]||{};
 for(const [id,n] of amounts)ensure((record[id]||0)+n<=requirements.get(id),'Task item requirement already fulfilled');
 const costs=new Map(),wallet=[];for(const [key,n] of amounts){const [type,id]=key.split(':').map(Number);if(type===3)costs.set(id,n);else wallet.push([id,n]);}
 for(const [id,n] of wallet){const value=id===1?c.state.player.basic_info.diamond:id===2?c.state.player.basic_info.gold:BigInt(c.state.player.attr_infos.attrs.find(a=>a.attr_id===id)?.attr_val||0);ensure(BigInt(value)>=BigInt(n),'Insufficient task currency');}
 const changed=costs.size?spend(c.state,costs,0,c.now):[];
 for(const [id,n] of wallet){if(id===1)c.state.player.basic_info.diamond-=n;else if(id===2)c.state.player.basic_info.gold-=n;else{const a=c.state.player.attr_infos.attrs.find(a=>a.attr_id===id);a.attr_val=String(BigInt(a.attr_val)-BigInt(n));}}
 for(const [id,n] of amounts)record[id]=(record[id]||0)+n;c.state.taskDeliveries[key]=record;
 c.push('CSProtoSyncPlayerData',{basic_info:c.state.player.basic_info,attr_infos:c.state.player.attr_infos,sbag_infos:{items:changed}});
}
