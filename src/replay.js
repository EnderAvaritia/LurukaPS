import {createHash} from 'node:crypto';
const after=(a,b)=>{const d=(a-b)>>>0;return d>0&&d<0x80000000;};
export class ReplayWindow {
 constructor(maxBytes=8*1024*1024,maxEntries=256){this.maxBytes=maxBytes;this.maxEntries=maxEntries;this.bytes=0;this.high=null;this.floor=null;this.last=null;this.cache=new Map();this.processed=new Set();}
 invalidate(){this.cache.clear();this.bytes=0;}
 fingerprint(frame){return createHash('sha256').update(String(frame.id)).update(':').update(frame.payload).digest('hex');}
 find(frame){
  if(!frame.seq)return null;const key=this.fingerprint(frame),record=this.cache.get(frame.seq);
  if(record){if(frame.seq!==this.last)throw Error('Stale retry requires state resynchronization');if(record.key!==key)throw Error('Sequence reused for a different request');return record.buffers;}
  if(this.high!==null){
   if(this.processed.has(frame.seq)||!after(frame.seq,this.floor))throw Error('Request is outside replay window');
   if(!after(frame.seq,this.high)&&((this.high-frame.seq)>>>0)>=this.maxEntries)throw Error('Request is outside replay window');
  }
  return null;
 }
 save(frame,buffers){
  if(!frame.seq)return;
  if(this.high===null){this.high=frame.seq;this.floor=frame.seq;}
  else if(after(frame.seq,this.high)){this.high=frame.seq;if(((this.high-this.floor)>>>0)>=this.maxEntries)this.floor=(this.high-this.maxEntries)>>>0;}
  this.last=frame.seq;this.processed.add(frame.seq);
  // Receipt tombstones survive response-cache invalidation and byte eviction.
  for(const seq of this.processed)if(!after(seq,this.floor))this.processed.delete(seq);
  for(const [seq,record]of this.cache)if(!after(seq,this.floor)){this.cache.delete(seq);this.bytes-=record.size;}
  const previous=this.cache.get(frame.seq);if(previous)this.bytes-=previous.size;
  const size=buffers.reduce((n,b)=>n+b.length,0);this.cache.set(frame.seq,{key:this.fingerprint(frame),buffers,size});this.bytes+=size;
  while(this.cache.size>this.maxEntries||this.bytes>this.maxBytes){const [seq,record]=this.cache.entries().next().value;this.cache.delete(seq);this.bytes-=record.size;}
 }
}
