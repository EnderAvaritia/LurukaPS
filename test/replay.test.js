import test from 'node:test';import assert from 'node:assert/strict';import {ReplayWindow} from '../src/replay.js';
test('replay window bounds memory and rejects reused/expired sequences',()=>{
 const window=new ReplayWindow(8,2),f=n=>({seq:n,id:1,payload:Buffer.from('x')});window.save(f(1),[Buffer.from('abc')]);assert.equal(window.find(f(1))[0].toString(),'abc');
 assert.throws(()=>window.find({...f(1),payload:Buffer.from('y')}),/different/);
 window.save(f(2),[Buffer.from('def')]);assert.throws(()=>window.find(f(1)),/resynchronization/);window.save(f(3),[Buffer.from('ghi')]);assert(window.bytes<=8);assert.throws(()=>window.find(f(1)),/outside/);assert.equal(window.find(f(4)),null);
});
test('uint32 rollover advances while zero-sequence messages are uncached',()=>{
 const window=new ReplayWindow();const f=seq=>({seq,id:5002,payload:Buffer.alloc(0)});window.save(f(0xffffffff),[]);assert.equal(window.find(f(1)),null);window.save(f(1),[]);assert.throws(()=>window.find(f(0xfffffffe)),/outside/);assert.equal(window.find(f(0)),null);
});

test('unsolicited updates invalidate cached state without permitting old mutations to replay',()=>{
 const window=new ReplayWindow(),frame={seq:9,id:6110,payload:Buffer.from('start')};window.save(frame,[Buffer.from('old queue')]);window.invalidate();assert.equal(window.bytes,0);assert.throws(()=>window.find(frame),/outside/);assert.equal(window.find({...frame,seq:10}),null);
});
