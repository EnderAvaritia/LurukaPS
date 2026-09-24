import {createHash} from 'node:crypto';
export class ReplayWindow {
 constructor(maxBytes=8*1024*1024,maxEntries=256){this.maxBytes=maxBytes;this.maxEntries=maxEntries;this.bytes=0;this.high=null;this.cache=new Map();}
 invalidate(){this.cache.clear();this.bytes=0;}
 fingerprint(frame){return createHash('sha256').update(String(frame.id)).update(':').update(frame.payload).digest('hex');}
 find(frame){
  if(!frame.seq)return null;const key=this.fingerprint(frame),record=this.cache.get(frame.seq);
  if(record){if(frame.seq!==this.high)throw Error('Stale retry requires state resynchronization');if(record.key!==key)throw Error('Sequence reused for a different request');return record.buffers;}
  if(this.high!==null){const distance=(frame.seq-this.high)>>>0;if(distance===0||distance>=0x80000000)throw Error('Request is outside replay window');}
  return null;
 }
 save(frame,buffers){if(!frame.seq)return;const size=buffers.reduce((n,b)=>n+b.length,0);this.high=frame.seq;this.cache.set(frame.seq,{key:this.fingerprint(frame),buffers,size});this.bytes+=size;
  while(this.cache.size>this.maxEntries||this.bytes>this.maxBytes){const [seq,record]=this.cache.entries().next().value;this.cache.delete(seq);this.bytes-=record.size;}
 }
}


