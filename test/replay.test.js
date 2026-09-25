import test from 'node:test';import assert from 'node:assert/strict';import {ReplayWindow} from '../src/replay.js';
test('replay window bounds memory and rejects reused/expired sequences',()=>{
 const window=new ReplayWindow(8,2),f=n=>({seq:n,id:1,payload:Buffer.from('x')});window.save(f(1),[Buffer.from('abc')]);assert.equal(window.find(f(1))[0].toString(),'abc');
 assert.throws(()=>window.find({...f(1),payload:Buffer.from('y')}),/different/);
 window.save(f(2),[Buffer.from('def')]);assert.throws(()=>window.find(f(1)),/resynchronization|outside/);window.save(f(3),[Buffer.from('ghi')]);assert(window.bytes<=8);assert.throws(()=>window.find(f(1)),/outside/);assert.equal(window.find(f(4)),null);
});
test('uint32 rollover advances while zero-sequence messages are uncached',()=>{
 const window=new ReplayWindow();const f=seq=>({seq,id:5002,payload:Buffer.alloc(0)});window.save(f(0xffffffff),[]);assert.equal(window.find(f(1)),null);window.save(f(1),[]);assert.throws(()=>window.find(f(0xfffffffe)),/outside/);assert.equal(window.find(f(0)),null);
});

test('unsolicited updates invalidate cached state without permitting old mutations to replay',()=>{
 const window=new ReplayWindow(),frame={seq:9,id:6110,payload:Buffer.from('start')};window.save(frame,[Buffer.from('old queue')]);window.invalidate();assert.equal(window.bytes,0);assert.throws(()=>window.find(frame),/outside/);assert.equal(window.find({...frame,seq:10}),null);
});

test('actual reconnect trace accepts first arrival in a sequence gap without rewinding high watermark',()=>{
 const w=new ReplayWindow(),f=seq=>({seq,id:10807,payload:Buffer.from('hatred')});
 for(const seq of [3727,3732,3733,3734,3735,3736,3737,3738,3731]){assert.equal(w.find(f(seq)),null);w.save(f(seq),[Buffer.from(String(seq))]);}
 assert.equal(w.high,3738);assert.equal(w.find(f(3731))[0].toString(),'3731');assert.throws(()=>w.find({...f(3731),payload:Buffer.from('different')}),/different/);
 assert.throws(()=>w.find(f(3738)),/resynchronization/);w.invalidate();assert.throws(()=>w.find(f(3731)),/outside/);assert.equal(w.find(f(3730)),null);assert.throws(()=>w.find(f(3726)),/outside/);
});
test('evicted late responses retain mutation receipts and window bounds across uint32 wrap',()=>{
 const w=new ReplayWindow(1,8),f=seq=>({seq,id:6110,payload:Buffer.from('spend')});
 for(const seq of [0xfffffffc,2,0xfffffffe]){assert.equal(w.find(f(seq)),null);w.save(f(seq),[Buffer.from('large')]);}
 assert.equal(w.bytes,0);assert.equal(w.high,2);assert.throws(()=>w.find(f(0xfffffffe)),/outside/);w.save(f(10),[]);assert.throws(()=>w.find(f(1)),/outside/);assert(w.processed.size<=8);assert(w.cache.size<=8);
});
