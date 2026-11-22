import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateUKTraffic,calculateSingaporeGrade} from '../regional.mjs';
const food={nutriCategory:'food',hsrCategory:'2',unit:'g',fat:0,satFat:0,sugars:0,salt:0,portionSize:50,sweeteners:false};
const beverage={...food,nutriCategory:'drink',hsrCategory:'1',unit:'ml',drinkAsPrepared:true,portionSize:100};
const get=(r,k)=>r.items.find(x=>x.key===k);

test('UK food thresholds: green, amber and red at exact boundaries',()=>{
 for(const [key,low,high] of [['fat',3,17.5],['satFat',1.5,5],['sugars',5,22.5],['salt',.3,1.5]]) {
  assert.equal(get(calculateUKTraffic({...food,[key]:low}),key).level,'green');
  assert.equal(get(calculateUKTraffic({...food,[key]:low+.001}),key).level,'amber');
  assert.equal(get(calculateUKTraffic({...food,[key]:high}),key).level,'amber');
  assert.equal(get(calculateUKTraffic({...food,[key]:high+.001}),key).level,'red');
 }
});
test('UK drink-specific per 100mL thresholds',()=>{
 for(const [key,low,high] of [['fat',1.5,8.75],['satFat',.75,2.5],['sugars',2.5,11.25],['salt',.3,.75]]) {
  assert.equal(get(calculateUKTraffic({...beverage,[key]:low}),key).level,'green');
  assert.equal(get(calculateUKTraffic({...beverage,[key]:low+.001}),key).level,'amber');
  assert.equal(get(calculateUKTraffic({...beverage,[key]:high+.001}),key).level,'red');
 }
});
test('UK large portion can force red; exactly 100 g or 150 mL is not large',()=>{
 assert.equal(get(calculateUKTraffic({...food,portionSize:160,sugars:18}), 'sugars').level,'red');
 assert.equal(get(calculateUKTraffic({...food,portionSize:160,sugars:18}), 'sugars').highByPortion,true);
 assert.equal(get(calculateUKTraffic({...food,portionSize:100,sugars:18}), 'sugars').level,'amber');
 assert.equal(get(calculateUKTraffic({...beverage,portionSize:151,sugars:9.1}), 'sugars').level,'red');
 assert.equal(get(calculateUKTraffic({...beverage,portionSize:150,sugars:9.1}), 'sugars').level,'amber');
});
test('UK partial label does not infer unknown nutrients as zero',()=>{
 const r=calculateUKTraffic({...food,fat:null,portionSize:null,salt:null,sodiumMg:250});
 assert.equal(r.status,'missing');assert.equal(get(r,'fat').level,'unknown');assert.equal(get(r,'salt').value,.625);
 assert.equal(get(r,'salt').level,'amber');
});
test('Singapore threshold endpoints, saturated fat worse wins',()=>{
 for(const [sugar,grade] of [[1,'A'],[1.01,'B'],[5,'B'],[5.01,'C'],[10,'C'],[10.01,'D']]) {
  assert.equal(calculateSingaporeGrade({...beverage,sugars:sugar}).grade,grade);
 }
 assert.equal(calculateSingaporeGrade({...beverage,sugars:1,satFat:.71}).grade,'B');
 assert.equal(calculateSingaporeGrade({...beverage,sugars:1,satFat:1.21}).grade,'C');
 assert.equal(calculateSingaporeGrade({...beverage,sugars:1,satFat:2.81}).grade,'D');
});
test('Singapore A requires no non-sugar substitute; sweetener makes B',()=>{
 assert.equal(calculateSingaporeGrade({...beverage,sweeteners:true}).grade,'B');
 const unknown=calculateSingaporeGrade({...beverage,sweeteners:null});
 assert.equal(unknown.status,'uncertain');assert.equal(unknown.range,'A–B');
 assert.equal(calculateSingaporeGrade({...beverage,sweeteners:true,sugars:9}).grade,'C');
});
test('Singapore lactose and galactose may be subtracted when declared',()=>{
 assert.equal(calculateSingaporeGrade({...beverage,sugars:5.6,lactose:5,galactose:.3}).grade,'A');
 assert.equal(calculateSingaporeGrade({...beverage,sugars:5.6,lactose:6}).status,'invalid');
});
test('Singapore refuses solids, dry powders, and missing nutrition',()=>{
 assert.equal(calculateSingaporeGrade(food).status,'ineligible');
 assert.equal(calculateSingaporeGrade({...beverage,drinkAsPrepared:false}).status,'needs-preparation');
 assert.equal(calculateSingaporeGrade({...beverage,unit:'g'}).status,'needs-preparation');
 assert.equal(calculateSingaporeGrade({...beverage,sugars:null}).status,'missing');
});
