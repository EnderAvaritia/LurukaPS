import {configuration} from './config.js';
import {startServer} from './server.js';
const server=await startServer(configuration());
console.log(`azurjs CBT3: TCP ${server.tcp.address().address}:${server.tcp.address().port}, HTTP ${server.web.address().port}`);
console.log('Local sandbox: client connection and gameplay compatibility still under validation.');
let closing=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(closing)return;closing=true;await server.close();});
