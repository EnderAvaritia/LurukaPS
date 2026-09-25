// Verified against CBT3 CrcUtility and TcpSocket.ToSend hotfix IL.
export function crcModbus(bytes,initial=0xffff){
 let crc=initial;
 for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc&1)?(crc>>>1)^0xa001:crc>>>1;}
 return crc;
}
export function requestCrc(frame){
 const header=Buffer.alloc(16);header.writeUInt32BE(frame.seq??0,0);header.writeUInt32BE(frame.pushSeq??0,4);header.writeBigUInt64BE(BigInt(frame.signature??0),8);
 return crcModbus(frame.payload??Buffer.alloc(0),crcModbus(header));
}
export class DelayedCrc {
 constructor(delay=0){this.queue=[];this.setDelay(delay);}
 setDelay(delay){if(!Number.isInteger(delay)||delay<0||delay>64)throw Error('CRC delay must be an integer between 0 and 64');this.delay=delay;}
 accept(frame){
  // An empty queue leaves NetMsgData.crc16 unchanged; recycled/retried messages
  // may carry a previous value. Only validate when the client would Peek().
  if(this.queue.length&&frame.error!==this.queue[0])throw Error('Delayed request CRC mismatch');
  this.queue.push(requestCrc(frame));if(this.queue.length>this.delay)this.queue.shift();
 }
}
