// CBT3 Translator.Gen256Key/Encrypt: RC4 KSA and a fresh PRGA per packet.
export function strongTransform(buffer,password,start=7) {
 if(!(password instanceof Uint8Array)||password.length===0)throw Error('Strong encryption requires a nonempty byte key');
 const box=Uint8Array.from({length:256},(_,i)=>i);let j=0;
 for(let i=0;i<256;i++){j=(j+box[i]+password[i%password.length])&255;[box[i],box[j]]=[box[j],box[i]];}
 let i=0;j=0;
 for(let p=start;p<buffer.length;p++){i=(i+1)&255;j=(j+box[i])&255;[box[i],box[j]]=[box[j],box[i]];buffer[p]^=box[(box[i]+box[j])&255];}
 return buffer;
}
