import fs from 'node:fs';
import path from 'node:path';
import protobuf from 'protobufjs';
export class Protocol {
  constructor(base) {
    this.entries = JSON.parse(fs.readFileSync(path.join(base, 'data/protocol.json')));
    this.byId = new Map(this.entries.map(e => [e.id, e]));
    this.byName = new Map(this.entries.map(e => [e.name, e]));
    const dir = path.join(base, 'proto/lua/proto');
    this.root = new protobuf.Root();
    this.root.resolvePath = (_, target) => path.join(dir, path.basename(target));
    const merged = { nested: {} };
    const merge = (target, source, prefix='') => {
      for (const [name, value] of Object.entries(source)) {
        if (!target[name]) target[name]=value;
        else if (value.nested && !value.fields && !value.values) merge(target[name].nested, value.nested, `${prefix}.${name}`);
        else if (JSON.stringify(target[name]) !== JSON.stringify(value)) throw Error(`Conflicting protobuf definition ${prefix}.${name}`);
      }
    };
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.proto'))) {
      const parsed=protobuf.parse(fs.readFileSync(path.join(dir,f),'utf8'),{keepCase:true}).root.toJSON();
      merge(merged.nested,parsed.nested);
    }
    this.root = protobuf.Root.fromJSON(merged);
    this.root.resolveAll();
    this.missing = [];
    for (const e of this.entries) for (const side of ['req','rsp']) {
      if (e[side]) { try { this.root.lookupType(e[side]); } catch { this.missing.push({ id:e.id, side, type:e[side] }); } }
    }
  }
  type(name) { return this.root.lookupType(name.startsWith('cs.') ? name : `cs.${name}`); }
  encode(name, value) {
    if (!name) return Buffer.alloc(0);
    const type = this.type(name);
    // Reject silently discarded field names, including nested objects.
    this.checkFields(type, value);
    const msg = type.fromObject(value);
    const error = type.verify(msg);
    if (error) throw Error(`${name}: ${error}`);
    return Buffer.from(type.encode(msg).finish());
  }
  checkFields(type, value) {
    for (const [key,v] of Object.entries(value)) {
      const f = type.fields[key];
      if (!f) throw Error(`Unknown field ${type.fullName}.${key}`);
      if (f.resolvedType instanceof protobuf.Type && v != null) {
        for (const item of f.repeated ? v : f.map ? Object.values(v) : [v]) this.checkFields(f.resolvedType,item);
      }
    }
  }
  decode(name, bytes) {
    if (!name) { if (bytes.length) throw Error('Unexpected request payload'); return {}; }
    const type = this.type(name);
    return type.toObject(type.decode(bytes), { longs: String, bytes: String, defaults: false, arrays: true, objects:true });
  }
}

