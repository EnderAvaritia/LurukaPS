import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
// Snapshot once at process startup so edits on disk do not relabel a running server.
export function sourceRevision(base){
 const root=path.join(base,'src'),hash=createHash('sha256');
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.js'))hash.update(path.relative(root,file).replaceAll('\\','/')).update('\0').update(fs.readFileSync(file)).update('\0');}}
 walk(root);return hash.digest('hex').slice(0,12);
}
