import {ensure} from './common.js';import {MallCatalog} from '../mall.js';
export function registerMall(on,tables){const catalog=new MallCatalog(tables);
 on('PlayerMallGetPayGoodsList',(c,r)=>({pay_shop_id:r.pay_shop_id??0,pay_goods_id:r.pay_goods_id??0,pay_goods_list:catalog.list(true,r.pay_shop_id,r.pay_goods_id,c.state,c.now)}));
 on('PlayerMallGetDiamondGoodsList',(c,r)=>({diamond_shop_id:r.diamond_shop_id??0,diamond_goods_list:catalog.list(false,r.diamond_shop_id,0,c.state,c.now)}));
 on('PlayerMallGetRechargeDiamond',c=>{const records=c.state.mall?.recharges??[];return {purchase_sdk_id_list:records.map(r=>r.purchase_sdk_id),first_recharge_time_list:records.map(r=>String(r.first_recharge_time))};});
 on('GetRechargePopupData',c=>c.state.mall?.popupQueue?.shift()??c.state.mall?.pendingPopup??{popup_id:0});
 on('MallReddotSet',(c,r)=>{const mall=c.state.mall??={},dots=mall.reddots??={diamond_reddot:[],pay_reddot:[]};
  for(const [field,goods]of [['diamond_reddot',catalog.diamond],['pay_reddot',catalog.pay]]){ensure((r[field]??[]).length<=goods.size,'Too many mall red dots');const current=new Map(dots[field].map(x=>[x.goods_id,x]));for(const item of r[field]??[]){ensure(goods.has(item.goods_id)&&Number.isInteger(item.status)&&item.status>=0&&item.status<=0xffffffff,'Invalid mall red dot');current.set(item.goods_id,{goods_id:item.goods_id,status:item.status});}dots[field]=[...current.values()];}
  c.pushBefore('SCProtoMallReddotSync',dots);return {};
 });
}


