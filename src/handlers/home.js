import {ensure,textValue} from './common.js';import {ensureHome} from '../home.js';
export function registerHome(on,tables){const change=c=>{c.state.homeRevision=(c.state.homeRevision||0)+1;};
 on('EnterHome',(c,r)=>{ensure(!r.creator_id||r.creator_id===c.id,'Visiting other homes is not implemented',1021);ensureHome(tables,c.state);change(c);return {};});
 on('SetHomeName',(c,r)=>{ensureHome(tables,c.state).name=textValue(r.name,30);change(c);return {};});
 on('HomeShortcutChange',(c,r)=>{ensure(r.shortcut_bar.length>0&&r.shortcut_bar.length<=2,'Invalid shortcut groups');const home=ensureHome(tables,c.state),types=new Set();for(const bar of r.shortcut_bar){ensure([1,2].includes(bar.type)&&!types.has(bar.type),'Invalid shortcut type');types.add(bar.type);ensure(bar.item_id.length<=64,'Too many shortcut slots');for(const id of bar.item_id){ensure(Number.isInteger(id)&&id>=-1,'Invalid shortcut item');if(id>0)ensure(tables.find(bar.type===1?'home_building':'common_item',id),'Unknown shortcut item');}const index=home.shortcuts.findIndex(x=>x.type===bar.type);if(index<0)home.shortcuts.push(bar);else home.shortcuts[index]=bar;}change(c);return {};});
 on('AddHomeMaterialWishList',(c,r)=>{const home=ensureHome(tables,c.state);ensure(tables.find('products',r.product_id),'Unknown product');ensure(Number.isInteger(r.count)&&r.count>0,'Invalid wishlist quantity');const limit=Number(tables.get('game').find(x=>x.title==='HOME_WISHLIST_LIMIT')?.value);ensure(Number.isInteger(limit)&&limit>0,'Invalid wishlist limit',1007);
  if(r.uid){const index=home.wishlist.findIndex(x=>x.uid===r.uid);ensure(index>=0,'Wishlist entry not owned');home.wishlist[index]={...r};}
  else {ensure(home.wishlist.length<limit,'Wishlist is full');ensure(home.nextWishUid<=0xffffffff,'Wishlist identity exhausted');home.wishlist.push({...r,uid:home.nextWishUid++});}change(c);return {};});
 on('DelHomeMaterialWishList',(c,r)=>{const home=ensureHome(tables,c.state);ensure(home.wishlist.some(x=>x.uid===r.u32),'Wishlist entry not owned');home.wishlist=home.wishlist.filter(x=>x.uid!==r.u32);change(c);return {};});
 for(const [name,value] of [['TraceHomeMaterialWishList',true],['UnTraceHomeMaterialWishList',false]])on(name,(c,r)=>{const row=ensureHome(tables,c.state).wishlist.find(x=>x.uid===r.u32);ensure(row,'Wishlist entry not owned');row.trace=value;change(c);return {};});
}

