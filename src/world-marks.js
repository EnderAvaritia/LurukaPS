import {ensure} from './handlers/common.js';

const uint32=(value,name)=>{ensure(Number.isInteger(value)&&value>=0&&value<=0xffffffff,`Invalid ${name}`);return value;};
const int32=(value,name)=>{ensure(Number.isInteger(value)&&value>=-0x80000000&&value<=0x7fffffff,`Invalid ${name}`);return value;};
function markFields(state,input,existing,guid){
 const mapId=uint32(input.map_id??existing?.map_id??state.world.map_id,'map id');ensure(mapId>0,'Invalid map id');
 const mark={guid,map_id:mapId,mark_id:uint32(input.mark_id??existing?.mark_id??0,'mark id'),pos:String(input.pos??existing?.pos??''),notes:String(input.notes??existing?.notes??''),pos_x:int32(input.pos_x??existing?.pos_x??0,'mark x'),pos_y:int32(input.pos_y??existing?.pos_y??0,'mark y'),state:uint32(input.state??existing?.state??0,'mark state'),pos_z:int32(input.pos_z??existing?.pos_z??0,'mark z'),area_id:uint32(input.area_id??existing?.area_id??0,'mark area'),is_set_pos_y:Boolean(input.is_set_pos_y??existing?.is_set_pos_y??false)};
 ensure(mark.pos.length<=1024&&mark.notes.length<=1024,'Map mark text is too long');return mark;
}
function nextGuid(state){
 state.worldMarkNextGuid??=1;ensure(Number.isInteger(state.worldMarkNextGuid)&&state.worldMarkNextGuid>0&&state.worldMarkNextGuid<=0xffffffff,'Map mark identity exhausted');
 const used=new Set((state.worldMarks??[]).map(mark=>mark.guid));let guid=state.worldMarkNextGuid;
 while(used.has(guid)){guid++;ensure(guid<=0xffffffff,'Map mark identity exhausted');}
 state.worldMarkNextGuid=guid+1;return guid;
}
export function addWorldMark(state,input){
 state.worldMarks??=[];ensure(state.worldMarks.length<1024||input.guid,'Too many map marks');
 const existing=input.guid?state.worldMarks.find(mark=>mark.guid===input.guid):undefined,guid=input.guid||nextGuid(state),mark=markFields(state,input,existing,guid);
 if(existing)Object.assign(existing,mark);else state.worldMarks.push(mark);if(guid>=Number(state.worldMarkNextGuid??1))state.worldMarkNextGuid=guid+1;return mark;
}
export function updateWorldMarks(state,infos){
 ensure(Array.isArray(infos)&&infos.length<=256,'Too many map mark updates');return infos.map(input=>{ensure(input.guid>0,'Map mark update is missing guid');const existing=(state.worldMarks??[]).find(mark=>mark.guid===input.guid);ensure(existing,'Map mark not found');return addWorldMark(state,input);});
}
export function deleteWorldMarks(state,guids){
 ensure(Array.isArray(guids)&&guids.length<=256,'Too many map marks to delete');const ids=new Set(guids.filter(id=>id>0));const deleted=(state.worldMarks??[]).filter(mark=>ids.has(mark.guid)).map(mark=>mark.guid);state.worldMarks=(state.worldMarks??[]).filter(mark=>!ids.has(mark.guid));if(ids.has(state.worldMarkTrace))state.worldMarkTrace=0;return deleted;
}
export function setWorldMarkTrace(state,guid){
 ensure(Number.isInteger(guid)&&guid>=0&&guid<=0xffffffff,'Invalid map mark trace');if(guid)ensure((state.worldMarks??[]).some(mark=>mark.guid===guid),'Map mark not found');state.worldMarkTrace=guid;return guid;
}
export function worldMarkPayload(state,delMarkList=[]){return {marks:structuredClone(state.worldMarks??[]),trace:state.worldMarkTrace??0,del_mark_list:[...delMarkList]};}
