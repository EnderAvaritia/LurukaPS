import {ensure} from './common.js';
const validId=n=>Number.isInteger(n)&&n>0&&n<=0xffffffff;
export function registerPlayableSaves(on){
 on('PlayableUploadSaveData',(c,r)=>{
  ensure(Number.isInteger(r.key_id)&&r.key_id>=0&&r.key_id<=0xffffffff,'Invalid archive request key');
  const rows=r.save_data??[];ensure(rows.length<=256,'Too many archive records');
  const saves=c.state.playableSaves??={},seen=new Set();
  for(const row of rows){
   ensure(validId(row.play_id)&&validId(row.sub_id),'Invalid archive identity');
   const key=`${row.play_id}:${row.sub_id}`;ensure(!seen.has(key),'Duplicate archive identity');seen.add(key);
   const bytes=Buffer.from(row.save_data??'','base64');ensure(bytes.length<=65536,'Archive record too large');
   saves[key]={play_id:row.play_id,sub_id:row.sub_id,save_data:bytes.toString('base64')};
  }
  ensure(Object.keys(saves).length<=8192&&Object.values(saves).reduce((n,row)=>n+Buffer.byteLength(row.save_data,'base64'),0)<=2*1024*1024,'Archive storage limit');
  return {key_id:r.key_id};
 });
 on('PlayableGetSaveData',(c,r)=>{
  const ids=r.play_ids??[];ensure(ids.length<=256&&ids.every(validId),'Invalid archive query');
  const records=Object.values(c.state.playableSaves??{}),save_data=[];
  for(const id of new Set(ids)){
   const found=records.filter(row=>row.play_id===id).sort((a,b)=>a.sub_id-b.sub_id);
   // CBT3 groups by play_id before skipping sub_id=0, then releases its waiter.
   save_data.push(...(found.length?found:[{play_id:id,sub_id:0,save_data:''}]));
  }
  return {save_data};
 });
}
