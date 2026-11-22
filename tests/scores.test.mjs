import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateHSR,calculateNutriScore,normalizeOpenFoodFacts,numberOrNull} from '../scores.mjs';
const base={energyKj:0,sugars:0,satFat:0,salt:0,sodiumMg:0,protein:0,fibre:0,fat:0,fvlNutri:0,fvnlHsr:0,hsrConcentrated:false,sweeteners:false,nutriCategory:'food',hsrCategory:'2'};
const withFields=parts=>({...base,...parts});

test('Official automatic exceptions: plain water and fresh produce',()=>{
  assert.equal(calculateNutriScore(withFields({nutriCategory:'water'})).grade,'A');
  assert.equal(calculateHSR(withFields({hsrCategory:'water'})).stars,5);
  assert.equal(calculateHSR(withFields({hsrCategory:'flavoured-water'})).stars,4.5);
  assert.equal(calculateHSR(withFields({hsrCategory:'fresh-produce'})).stars,5);
});

test('Nutri-Score 2023 general-food boundaries, including exact threshold rules',()=>{
  assert.deepEqual([calculateNutriScore(withFields({energyKj:335})).score,calculateNutriScore(withFields({energyKj:335.01})).score],[0,1]);
  assert.deepEqual([calculateNutriScore(withFields({salt:0.2})).score,calculateNutriScore(withFields({salt:0.2001})).score],[0,1]);
  assert.equal(calculateNutriScore(withFields({sugars:51.1,salt:4.1,energyKj:3500,satFat:11})).grade,'E');
  assert.equal(calculateNutriScore(withFields({protein:20})).score,-7);
  assert.equal(calculateNutriScore(withFields({fibre:8})).score,-5);
  assert.equal(calculateNutriScore(withFields({fvlNutri:100})).score,-5);
});

test('Nutri-Score excludes protein at 11+ negative points (except cheese)',()=>{
  const x=withFields({energyKj:3400,protein:20,sugars:4, satFat:0,salt:0}); // energy10 sugar1 =>N11
  assert.equal(calculateNutriScore(x).score,11);
  assert.equal(calculateNutriScore({...x,nutriCategory:'cheese'}).score,4);
});

test('Nutri-Score red meat limits protein credit to 2',()=>{
  assert.equal(calculateNutriScore(withFields({nutriCategory:'redmeat',protein:22})).score,-2);
  assert.equal(calculateNutriScore(withFields({nutriCategory:'food',protein:22})).score,-7);
});

test('Nutri-Score oils use saturates energy and fat ratio, not general food energy',()=>{
  const olive=withFields({nutriCategory:'fats',energyKj:3500, satFat:14, fat:100, fvlNutri:100});
  const result=calculateNutriScore(olive);
  assert.equal(result.status,'exact');
  assert.equal(result.points.energy,4);
  assert.equal(result.points.saturatedFat,1);
  assert.equal(result.grade,'B'); // The fats-and-oils algorithm only awards A at scores <= -6.
});

test('Nutri-Score beverages: only verified water A; sweeteners add four negative points',()=>{
  const z=withFields({nutriCategory:'drink',energyKj:0,sugars:0,protein:0,fibre:0});
  assert.equal(calculateNutriScore(z).grade,'B');
  assert.equal(calculateNutriScore({...z,sweeteners:true}).grade,'C');
  const cola=withFields({nutriCategory:'drink',energyKj:180,sugars:10.6,sweeteners:false});
  assert.equal(calculateNutriScore(cola).grade,'E');
});

test('Never silently interpret unknown favourable nutrients as zero',()=>{
  const p=withFields({fvlNutri:null,protein:null,fibre:null,energyKj:2000,sugars:20,salt:0.6});
  const r=calculateNutriScore(p);
  assert.equal(r.status,'range');
  assert.equal(r.grade,null);
  assert(r.missing.length===3);
  const h=calculateHSR(withFields({fvnlHsr:null,protein:null,fibre:null}));
  assert.equal(h.status,'range');
  assert.equal(h.stars,null);
  assert(h.missing.length===3);
});

test('HSR v9 category 1 baseline and rounding thresholds',()=>{
  const p=withFields({hsrCategory:'1',energyKj:31,sugars:0.1});
  assert.equal(calculateHSR(p).points.energy,1);
  assert.equal(calculateHSR(p).points.sugars,0);
  assert.equal(calculateHSR(p).stars,3.5);
  assert.equal(calculateHSR({...p,energyKj:32,sugars:1.7}).points.baseline,4);
  assert.equal(calculateHSR({...p,energyKj:280,sugars:14}).stars,0.5);
});

test('HSR v9 category 2 baseline energy/sugars/sodium threshold',()=>{
  assert.equal(calculateHSR(withFields({hsrCategory:'2',energyKj:335})).points.energy,0);
  assert.equal(calculateHSR(withFields({hsrCategory:'2',energyKj:336})).points.energy,1);
  assert.equal(calculateHSR(withFields({hsrCategory:'2',sugars:8.9})).points.sugars,1);
  assert.equal(calculateHSR(withFields({hsrCategory:'2',sugars:8.91})).points.sugars,2);
  assert.equal(calculateHSR(withFields({hsrCategory:'2',sodiumMg:90.01})).points.sodium,1);
});

test('HSR v9 category 2 & 3 different saturated fat thresholds',()=>{
  const x=withFields({satFat:12.1,hsrCategory:'2'});
  assert.equal(calculateHSR(x).points.saturatedFat,11);
  assert.equal(calculateHSR({...x,hsrCategory:'3'}).points.saturatedFat,12);
  assert.equal(calculateHSR({...x,hsrCategory:'2',satFat:90}).points.saturatedFat,29);
});

test('HSR category rules and modifying points for FVNL, protein, fibre',()=>{
  const x=withFields({hsrCategory:'2',energyKj:0,protein:3.2,fibre:1.9,fvnlHsr:100});
  assert.equal(calculateHSR(x).score, -11); // 8 V, 2 P and 1 F (1.9 > 0.9)
  assert.equal(calculateHSR(x).stars,5);
  assert.equal(calculateHSR({...x,hsrConcentrated:true,fvnlHsr:25}).score, -4); // 1 V, 2 P, 1 F
});

test('HSR protein ineligible when baseline >= 13 unless FVNL points >=5',()=>{
  const x=withFields({hsrCategory:'2',sodiumMg:1300,protein:60, fibre:0, fvnlHsr:0});
  const r=calculateHSR(x);
  assert(r.points.baseline>=13);
  assert.equal(r.score,r.points.baseline);
  const y=calculateHSR({...x,fvnlHsr:100});
  assert.equal(y.score,y.points.baseline-8-15);
});

test('HSR 1D excludes fibre and 3D has different stars from 2D',()=>{
  const x=withFields({energyKj:700,sugars:9,satFat:4.2,sodiumMg:500,fibre:50,protein:0,hsrCategory:'1D'});
  assert.equal(calculateHSR(x).score,calculateHSR({...x,fibre:0}).score);
  const y=withFields({energyKj:1000,sugars:6,satFat:2,sodiumMg:400,hsrCategory:'2D'});
  assert.notEqual(calculateHSR({...y,hsrCategory:'3D'}).stars,calculateHSR(y).stars);
});

test('HSR category 3 olive oil sanity check',()=>{
  const p=withFields({hsrCategory:'3',energyKj:3400,satFat:14,fat:100});
  const r=calculateHSR(p);
  assert.equal(r.points.baseline,23);
  assert.equal(r.stars,3.5);
});

test('HSR and Nutri-Score refuse required missing baseline data',()=>{
  assert.equal(calculateNutriScore(withFields({sugars:null})).status,'missing');
  assert.equal(calculateHSR(withFields({hsrCategory:'2',sodiumMg:null})).status,'missing');
  assert.equal(calculateHSR(withFields({hsrCategory:'1',sodiumMg:null})).status,'exact');
  assert.equal(calculateNutriScore(withFields({nutriCategory:'fats',fat:null})).status,'missing');
});

test('Open Food Facts normalization converts sodium/salt and does not fake FVNL values',()=>{
  const p=normalizeOpenFoodFacts({product_name:'Sample',brands:'Brand',categories_tags:['en:chocolate-spreads'],nutriscore_grade:'e',nutriments:{'energy-kj_100g':2240,salt_100g:0.14,sugars_100g:56.3,'saturated-fat_100g':10.6,proteins_100g:6.3,fat_100g:30.9,fiber_100g:3.4}},'3017620422003');
  assert(Math.abs(p.sodiumMg-56)<1e-6);
  assert.equal(p.offGrade,'E');
  assert.equal(p.fvnlHsr,null);
  assert.equal(p.fvlNutri,null);
  assert.equal(p.nutriCategory,'food');
});

test('Open Food Facts image URLs are only allowed from its domains',()=>{
  const x=normalizeOpenFoodFacts({image_url:'https://evil.example/pic.png'});
  assert.equal(x.image,'');
  const y=normalizeOpenFoodFacts({image_url:'https://images.openfoodfacts.org/img.png'});
  assert.equal(y.image,'https://images.openfoodfacts.org/img.png');
});

test('Numeric null and zero values remain distinct',()=>{
  assert.equal(numberOrNull(undefined),null);
  assert.equal(numberOrNull(''),null);
  assert.equal(numberOrNull('0'),0);
  assert.equal(numberOrNull(-1),null);
});
