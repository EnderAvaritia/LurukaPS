import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
export class Store {
  constructor(filename) {
    if(filename!==':memory:') fs.mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new Database(filename);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    // DELETE journal also works on VMware shared folders; use a local disk for production.
    this.db.pragma('journal_mode = DELETE');
    const version=this.db.pragma('user_version',{simple:true});
    if(version>1) throw Error(`Database schema ${version} is newer than this server`);
    this.db.transaction(()=>{
      this.db.exec(`CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, open_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS players(account_id INTEGER PRIMARY KEY REFERENCES accounts(id), state TEXT NOT NULL CHECK(json_valid(state)), revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS request_log(id INTEGER PRIMARY KEY, account_id INTEGER, message_id INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
      PRAGMA user_version = 1;`);
    })();
    this.accountByOpen=this.db.prepare('SELECT * FROM accounts WHERE open_id=?');
    this.playerById=this.db.prepare('SELECT state,revision FROM players WHERE account_id=?');
    this.savePlayer=this.db.prepare('UPDATE players SET state=?,revision=revision+1,updated_at=? WHERE account_id=?');
    this.log=this.db.prepare('INSERT INTO request_log(account_id,message_id,status,created_at) VALUES(?,?,?,?)');
  }
  login(openId, factory) {
    if(typeof openId!=='string' || !openId.trim() || Buffer.byteLength(openId)>128) throw Error('Invalid open_id');
    return this.db.transaction(()=>{
      let account=this.accountByOpen.get(openId);
      if(!account) {
        const id=Number(this.db.prepare('INSERT INTO accounts(open_id,created_at) VALUES(?,?)').run(openId,Date.now()).lastInsertRowid);
        account={id,open_id:openId};
        this.db.prepare('INSERT INTO players(account_id,state,updated_at) VALUES(?,?,?)').run(id,JSON.stringify(factory(id,openId)),Date.now());
      }
      return {id:account.id,...this.load(account.id)};
    }).immediate();
  }
  load(id) { const row=this.playerById.get(id); if(!row) throw Error('Player not found'); return {state:JSON.parse(row.state),revision:row.revision}; }
  transact(id,messageId,fn) {
    return this.db.transaction(()=>{
      const {state}=this.load(id);
      const result=fn(state);
      if(result?.then) throw Error('Asynchronous player transaction is forbidden');
      this.savePlayer.run(JSON.stringify(state),Date.now(),id);
      this.log.run(id,messageId,'ok',Date.now());
      return result;
    }).immediate();
  }
  close(){this.db.close();}
}
