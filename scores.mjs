/**
 * FoodLens scoring engines. Not an official Nutri-Score or HSR implementation.
 * Nutri-Score: 2023 revised algorithm (effective in France from March 2025).
 * HSR: Australian Health Star Rating Implementation Guide, version 9 (Dec 2025).
 * These are independently computed, with missing inputs represented as a range.
 */

export const SOURCES = Object.freeze({
  nutri: 'https://www.santepubliquefrance.fr/en/Nutri-Score',
  nutriTechnical: 'https://www.blv.admin.ch/dam/blv/de/dokumente/lebensmittel-und-ernaehrung/ernaehrung/nutri-score-fragen-antworten-en.pdf.download.pdf/QR_scientifique_technique_EN_011119.pdf',
  hsr: 'https://www.healthstarrating.gov.au/industry/health-star-rating-system-implementation-guide',
  off: 'https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/'
});

export const nutriCategories = [
  ['food','General food'], ['cheese','Cheese'], ['redmeat','Red meat'],
  ['fats','Fats, oils, nuts & seeds'], ['drink','Beverage'],
  ['water','Plain water (verified)'], ['ineligible','Not eligible']
];

export const hsrCategories = [
  ['2','2 · General food'], ['1','1 · Non-dairy beverage'],
  ['1D','1D · Milk / qualifying alternatives'], ['2D','2D · Other dairy'],
  ['3','3 · Oils & butter'], ['3D','3D · High-calcium cheese'],
  ['water','Verified plain water'], ['flavoured-water','Verified unsweetened flavoured water'],
  ['fresh-produce','Verified fresh/minimally processed produce'], ['ineligible','Not eligible']
];

const n = value => value === null || value === undefined || value === '' ? null : (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null);
const above = (value, thresholds) => thresholds.reduce((sum, t) => sum + Number(value > t), 0);
const atLeast = (value, thresholds) => thresholds.reduce((sum, t) => sum + Number(value >= t), 0);
const minMax = (vals) => [Math.min(...vals), Math.max(...vals)];
const seq = (start, step, length) => Array.from({length}, (_,i) => start + i*step);

const FOOD_SUGARS = [3.4,6.8,10,14,17,20,24,27,31,34,37,41,44,48,51];
const SALT_THRESHOLDS = seq(0.2,0.2,20).map(v => +v.toFixed(5));
const PROTEINS = [2.4,4.8,7.2,9.6,12,14,17];
const FIBRES = [3.0,4.1,5.2,6.3,7.4];
const DRINK_ENERGY = [30,90,150,210,240,270,300,330,360,390];
const DRINK_SUGARS = [0.5,2,3.5,5,6,7,8,9,10,11];
const DRINK_PROTEINS = [1.2,1.5,1.8,2.1,2.4,2.7,3.0];

function foodFvl(value) {
  if (value > 80) return 5;
  if (value > 60) return 2;
  if (value > 40) return 1;
  return 0;
}
function beverageFvl(value) {
  if (value > 80) return 6;
  if (value > 60) return 4;
  if (value > 40) return 2;
  return 0;
}
function nutriLetter(score, category) {
  if (category === 'drink') return score <= 2 ? 'B' : score <= 6 ? 'C' : score <= 9 ? 'D' : 'E';
  if (category === 'fats') return score <= -6 ? 'A' : score <= 2 ? 'B' : score <= 10 ? 'C' : score <= 18 ? 'D' : 'E';
  return score <= 0 ? 'A' : score <= 2 ? 'B' : score <= 10 ? 'C' : score <= 18 ? 'D' : 'E';
}

export function calculateNutriScore(profile) {
  const category = profile.nutriCategory || 'food';
  if (category === 'ineligible') return {status:'ineligible', notes:['This category is not eligible for Nutri-Score.']};
  if (category === 'water') return {status:'exact', grade:'A', minGrade:'A', maxGrade:'A', score:null, notes:['Automatic grade for verified plain water.'], missing:[]};
  const energy = n(profile.energyKj), sugar = n(profile.sugars), sat = n(profile.satFat), salt = n(profile.salt);
  const protein = n(profile.protein), fibre = n(profile.fibre), fruit = n(profile.fvlNutri), fat = n(profile.fat);
  const sweeteners = profile.sweeteners;
  const missingRequired = [
    ['energy (kJ)',energy],['total sugars',sugar],['saturated fat',sat],['salt',salt],
    ...(category === 'fats' ? [['total fat',fat]] : [])
  ].filter(([,v]) => v === null).map(([label]) => label);
  if (missingRequired.length) return {status:'missing', missing:missingRequired, notes:['Enter the required per-100 g or per-100 mL values to calculate this grade.']};
  const missing = [
    ...(protein === null ? ['protein'] : []),
    ...(fibre === null ? ['fibre'] : []),
    ...(fruit === null ? ['fruit, vegetable and legume percentage'] : []),
    ...(category === 'drink' && sweeteners !== true && sweeteners !== false ? ['non-nutritive sweeteners'] : [])
  ];
  let energyPts, sugarPts, satPts, saltPts;
  if (category === 'drink') {
    energyPts = DRINK_ENERGY.findIndex(v => energy <= v);
    energyPts = energyPts < 0 ? 10 : energyPts;
    sugarPts = DRINK_SUGARS.findIndex(v => sugar <= v);
    sugarPts = sugarPts < 0 ? 10 : sugarPts;
    satPts = above(sat,seq(1,1,10));
    saltPts = above(salt,SALT_THRESHOLDS);
  } else if (category === 'fats') {
    energyPts = above(sat * 37,seq(120,120,10));
    sugarPts = above(sugar,FOOD_SUGARS);
    const ratio = fat > 0 ? sat / fat * 100 : (sat > 0 ? 100 : 0);
    // Table 7 uses <10 = 0, <16 = 1, ... <64 = 9, >=64 = 10.
    satPts = [10,16,22,28,34,40,46,52,58,64].findIndex(v => ratio < v);
    if (satPts < 0) satPts = 10;
    saltPts = above(salt,SALT_THRESHOLDS);
  } else {
    energyPts = above(energy,seq(335,335,10));
    sugarPts = above(sugar,FOOD_SUGARS);
    satPts = above(sat,seq(1,1,10));
    saltPts = above(salt,SALT_THRESHOLDS);
  }
  const negative = energyPts + sugarPts + satPts + saltPts;
  const grades = [], scores = [];
  for (const p of protein === null ? [0,100] : [protein]) {
    for (const f of fibre === null ? [0,100] : [fibre]) {
      for (const v of fruit === null ? [0,100] : [fruit]) {
        for (const s of category === 'drink' && sweeteners !== true && sweeteners !== false ? [false,true] : [Boolean(sweeteners)]) {
          const proteinPts = category === 'drink' ? above(p,DRINK_PROTEINS) : above(p,PROTEINS);
          const proteinAdjusted = category === 'redmeat' ? Math.min(2,proteinPts) : proteinPts;
          const fibrePts = above(f,FIBRES);
          const fruitPts = category === 'drink' ? beverageFvl(v) : foodFvl(v);
          const nPts = negative + (category === 'drink' && s ? 4 : 0);
          const allowProtein = category === 'drink' || category === 'cheese' || nPts < (category === 'fats' ? 7 : 11);
          const score = nPts - fibrePts - fruitPts - (allowProtein ? proteinAdjusted : 0);
          scores.push(score);
          grades.push(nutriLetter(score,category));
        }
      }
    }
  }
  const [minScore,maxScore] = minMax(scores);
  const minGrade = nutriLetter(minScore,category), maxGrade = nutriLetter(maxScore,category);
  return {
    status: missing.length ? (minGrade === maxGrade ? 'stable' : 'range') : 'exact',
    grade: minGrade === maxGrade ? minGrade : null, minGrade,maxGrade,
    score: missing.length ? null : scores[0], minScore,maxScore,missing,
    points: {energy:energyPts,sugars:sugarPts,saturatedFat:satPts,salt:saltPts,negative},
    notes: missing.length ? ['Missing beneficial ingredient data can change the score; the displayed range includes all possibilities.'] : []
  };
}

const HSR_ENERGY = seq(335,335,11);
const HSR_SAT_1 = [1,2,3,4,5,6,7,8,9,10,11.2,12.5,13.9,15.5,17.3,19.3,21.6,24.1,26.9,30,33.5,37.4,41.7,46.6,52.0,58.0,64.7,72.3,80.6,90.0];
const HSR_SUGAR_1 = [5,8.9,12.8,16.8,20.7,24.6,28.5,32.4,36.3,40.3,44.2,48.1,52,55.9,59.8,63.8,67.7,71.6,75.5,79.4,83.3,87.3,91.2,95.1,99.0];
const HSR_SUGAR_3 = [5,9,13.5,18,22.5,27,31,36,40,45];
const HSR_SODIUM = seq(90,90,30);
const HSR_PROTEIN = [1.6,3.2,4.8,6.4,8,9.6,11.6,13.9,16.7,20,24,28.9,34.7,41.6,50];
const HSR_FIBRE = [.9,1.9,2.8,3.7,4.7,5.4,6.3,7.3,8.4,9.7,11.2,13,15,17.3,20];
// Rows in guide are: >1.6, >=3.2, >4.8, etc.
const hsrProteinPoints = v => HSR_PROTEIN.reduce((k,t,i) => k + (i === 1 ? Number(v >= t) : Number(v > t)),0);
const HSR_V_NON = [40,60,67,75,80,90,95,100];
const HSR_V_CON = [25,43,52,63,67,80,90,100];
const HSR_V_DRINK = [25,33,41,49,57,65,73,81,89,96];

function hsrFruitPoints(pct, category, isConcentrated) {
  if (category === '1') return atLeast(pct,HSR_V_DRINK);
  if (isConcentrated) return atLeast(pct,HSR_V_CON);
  return HSR_V_NON.slice(0,7).reduce((sum,t) => sum + Number(pct > t),0) + Number(pct === 100);
}

const HSR_RATING_MAX = {
  '1D': [-2,-1,0,1,2,3,4,5,6],
  '2': [-11,-7,-2,2,6,11,15,20,24],
  '2D': [-2,0,2,3,5,7,8,10,12],
  '3': [13,16,20,23,27,30,34,37,41],
  '3D': [24,26,28,30,31,33,35,37,39]
};
function hsrStars(score, category) {
  if (category === '1') return score <= 0 ? 4 : score <= 1 ? 3.5 : score <= 3 ? 3 : score <= 5 ? 2.5 : score <= 7 ? 2 : score <= 9 ? 1.5 : score <= 11 ? 1 : .5;
  const limits = HSR_RATING_MAX[category];
  if (!limits) return null;
  const i = limits.findIndex(max => score <= max);
  return i < 0 ? .5 : 5-i*.5;
}

export function calculateHSR(profile) {
  const category = profile.hsrCategory || '2';
  if (category === 'ineligible') return {status:'ineligible', notes:['The product category is excluded from HSR.']};
  const automatic = {'water':5,'flavoured-water':4.5,'fresh-produce':5};
  if (category in automatic) return {status:'exact', stars:automatic[category], minStars:automatic[category],maxStars:automatic[category], missing:[], notes:['Automatic HSR for the verified product category; check the eligibility criteria.']};
  const energy = n(profile.energyKj), sugar = n(profile.sugars), sat = n(profile.satFat), sodium = n(profile.sodiumMg);
  const fibre = n(profile.fibre), protein = n(profile.protein), fvnl = n(profile.fvnlHsr);
  const required = category === '1' ? [['energy (kJ)',energy],['total sugars',sugar]] : [['energy (kJ)',energy],['total sugars',sugar],['saturated fat',sat],['sodium (mg)',sodium]];
  const missingRequired = required.filter(([,v]) => v===null).map(([label])=>label);
  if (missingRequired.length) return {status:'missing', missing:missingRequired,notes:['Enter the required per-100 g or per-100 mL values to calculate a star rating.']};
  const missing = [
    ...(fvnl === null ? ['fruit, vegetable, nut and legume percentage'] : []),
    ...(category !== '1' && protein === null ? ['protein'] : []),
    ...(!['1','1D'].includes(category) && fibre === null ? ['fibre'] : [])
  ];
  let energyPts, sugarPts, satPts = 0, sodiumPts = 0;
  if (category === '1') {
    energyPts = energy <= 31 ? 1 : 1 + above(energy,[31,61,91,121,151,181,211,241,271]);
    sugarPts = sugar <= .1 ? 0 : 1 + above(sugar,[1.6,3.1,4.6,6.1,7.6,9.1,10.6,12.1,13.6]);
  } else {
    energyPts = above(energy,HSR_ENERGY);
    satPts = above(sat,category === '3' || category === '3D' ? seq(1,1,30) : HSR_SAT_1);
    sugarPts = above(sugar,category === '3' || category === '3D' ? HSR_SUGAR_3 : HSR_SUGAR_1);
    sodiumPts = above(sodium,HSR_SODIUM);
  }
  const baseline = energyPts + sugarPts + satPts + sodiumPts;
  const possibleStars = [], possibleScores=[];
  for (const v of fvnl === null ? [0,100] : [fvnl]) {
    for (const p of category === '1' ? [0] : protein === null ? [0,100] : [protein]) {
      for (const f of ['1','1D'].includes(category) ? [0] : fibre === null ? [0,100] : [fibre]) {
        const vPts = hsrFruitPoints(v,category,Boolean(profile.hsrConcentrated));
        const pPts = category !== '1' && (baseline < 13 || vPts >= 5) ? hsrProteinPoints(p) : 0;
        const fPts = ['1','1D'].includes(category) ? 0 : above(f,HSR_FIBRE);
        const score = baseline - vPts - pPts - fPts;
        possibleScores.push(score);possibleStars.push(hsrStars(score,category));
      }
    }
  }
  const [minScore,maxScore] = minMax(possibleScores), [minStars,maxStars] = minMax(possibleStars);
  return {
    status: missing.length ? (minStars === maxStars ? 'stable' : 'range') : 'exact',
    stars: minStars === maxStars ? minStars : null, minStars,maxStars,
    score: missing.length ? null : possibleScores[0], minScore,maxScore,
    missing, points: {energy:energyPts,sugars:sugarPts,saturatedFat:satPts,sodium:sodiumPts,baseline},
    notes: missing.length ? ['Missing ingredient percentages or nutrients may change the rating. Enter them to narrow the range.'] : []
  };
}

export function normalizeOpenFoodFacts(product = {}, barcode = '') {
  const m = product.nutriments || {};
  const get = (...keys) => { for (const k of keys) {const v=n(m[k]); if(v!==null) return v;} return null;};
  const salt = get('salt_100g');
  const sodiumG = get('sodium_100g');
  const sodiumMg = sodiumG !== null ? sodiumG * 1000 : salt !== null ? salt * 400 : null;
  const kj = get('energy-kj_100g','energy_100g');
  const kcal = get('energy-kcal_100g');
  const categories = Array.isArray(product.categories_tags) ? product.categories_tags : [];
  const cats = categories.join(' ').toLowerCase();
  const has = regex => regex.test(cats);
  const calciumG = get('calcium_100g');
  let nutriCategory='food',hsrCategory='2';
  let classificationNote='Automatically suggested categories. Check them, especially for dairy alternatives or mixed products.';
  if (has(/en:(mineral-waters|spring-waters|waters)( |$)/) && !has(/flavo[u]?red|sweetened|sodas/)) { nutriCategory='water';hsrCategory='water';classificationNote='Plain-water category inferred from database; verify the ingredients.'; }
  else if (has(/en:(beverages|soft-drinks|juices|fruit-juices|sodas|energy-drinks|ice-teas|teas-and-infusions|plant-based-milks|milk-drinks)/) && !has(/en:(milk|milks|cow-milk|goat-milk)( |$)/)) {
    nutriCategory='drink';hsrCategory='1';
    if (has(/en:(plant-based-milks|soy-milks|almond-milks|oat-milks)/)) classificationNote='Plant-based milks may qualify for HSR 1D depending on calcium and ingredient content. Please confirm.';
  }
  if (has(/en:(cow-milk|goat-milk|milks|milk)( |$)/)) {nutriCategory='drink';hsrCategory='1D';}
  if (has(/en:(yogurts|yoghurts|yogurt|yoghurt|dairy-desserts|cream-cheeses|ricotta|cottage-cheeses)/)) {nutriCategory='food';hsrCategory='2D';}
  if (has(/en:(cheeses|cheese|hard-cheeses|soft-cheeses|brie|camembert)/)) {nutriCategory='cheese';hsrCategory=calciumG !== null && calciumG > .32 ? '3D' : '2D';classificationNote='Confirm cheese calcium content (>320 mg/100 g for 3D), and at least 75% dairy ingredients.';}
  if (has(/en:(edible-oils|vegetable-oils|olive-oils|fats|butters|margarines|sunflower-oils|canola-oils|rapeseed-oils)/)) {nutriCategory='fats';hsrCategory='3';}
  if (has(/en:(nuts|seeds|peanuts|almonds|walnuts|cashews)( |$)/) && hsrCategory==='2') nutriCategory='fats';
  if (has(/en:(beef|pork|lamb|veal|red-meats|mutton)( |$)/) && nutriCategory==='food') nutriCategory='redmeat';
  const ingredients = String(product.ingredients_text || product.ingredients_text_en || '');
  // Open Food Facts uses _100g as a canonical nutrient field even for drinks.
  // That alone does not prove the label describes 100 mL of a prepared drink.
  const nutritionBasis = String(product.nutrition_data_per || '').toLowerCase();
  const isPer100ml = nutritionBasis.includes('100ml') || nutritionBasis.includes('100 ml') || Object.keys(m).some(k=>k.endsWith('_100ml'));
  const isBeverage = ['drink','water'].includes(nutriCategory) || ['1','1D'].includes(hsrCategory);
  const portion = n(product.serving_quantity);
  const additiveNames = Array.isArray(product.additives_tags) ? product.additives_tags : [];
  // Presence can be inferred from listed E-codes, but absence cannot be inferred.
  const detectedSweeteners = /\b(?:aspartame|acesulfame|sucralose|saccharin|stevia|steviol glycosides|cyclamate|neotame|advantame|e95[0-9]|e96[0-9])\b/i.test(ingredients+' '+additiveNames.join(' '));
  const grade = typeof product.nutriscore_grade === 'string' && /^[abcde]$/i.test(product.nutriscore_grade) ? product.nutriscore_grade.toUpperCase() : null;
  return {
    barcode: String(barcode||product.code||''),
    name: String(product.product_name || product.product_name_en || 'Unnamed product'),
    brand: String(product.brands||''),
    quantity: String(product.quantity||''),
    image: safeImage(product.image_front_url || product.image_url || product.image_front_small_url),
    ingredients, categories, additives: additiveNames.length, nova: [1,2,3,4].includes(Number(product.nova_group)) ? Number(product.nova_group) : null,
    allergens: (Array.isArray(product.allergens_tags) ? product.allergens_tags : []).slice(0,12),
    energyKj: kj !== null ? kj : kcal !== null ? +(kcal * 4.184).toFixed(1) : null,
    kcal: kcal !== null ? kcal : kj !== null ? +(kj / 4.184).toFixed(1) : null,
    sugars: get('sugars_100g'),satFat:get('saturated-fat_100g'), salt: salt !== null ? salt : sodiumG !== null ? sodiumG * 2.5 : null,
    sodiumMg,protein:get('proteins_100g'),fibre:get('fiber_100g','fibre_100g'),fat:get('fat_100g'),
    fvlNutri:null,fvnlHsr:null,hsrConcentrated:false,sweeteners:detectedSweeteners ? true : null,
    portionSize:portion!==null && portion<=2500?portion:null,lactose:get('lactose_100g'),galactose:get('galactose_100g'),
    drinkAsPrepared:isBeverage && isPer100ml ? true : null,dbLookup:'found',
    nutriCategory,hsrCategory,offGrade:grade,categoryNote:classificationNote,
    from:'Open Food Facts',updated:Number(product.last_modified_t)||null,
    unit: isBeverage ? 'ml' : 'g',
    edited:false
  };
}
function safeImage(url) {
  if (typeof url!=='string') return '';
  try { const u=new URL(url);return u.protocol==='https:' && /(^|\.)openfoodfacts\.org$/.test(u.hostname) ? url : ''; } catch {return '';}
}

export const numberOrNull = n;


// The UK and Singapore engines are embedded in this file because the currently
// configured static-host build commands copy scores.mjs as a single module.
/**
 * Two additional, independent front-of-pack methods. These are unofficial
 * calculations for personal comparison, NOT certification or endorsed labels.
 * UK Department of Health/FSA Front of Pack Guide (November 2016), Tables 2-3.
 * Singapore Health Promotion Board Nutri-Grade beverages, 2022 guidance (current in 2026).
 */

export const REGIONAL_SOURCES = Object.freeze({
  uk: 'https://www.gov.uk/government/publications/front-of-pack-nutrition-labelling-guidance',
  singapore: 'https://www.hpb.gov.sg/healthy-living/food-and-beverage/nutri-grade/'
});

const UK_LIMITS = Object.freeze({
  g: {fat:[3,17.5,21],satFat:[1.5,5,6],sugars:[5,22.5,27],salt:[0.3,1.5,1.8]},
  ml:{fat:[1.5,8.75,10.5],satFat:[0.75,2.5,3],sugars:[2.5,11.25,13.5],salt:[0.3,0.75,0.9]}
});
const UK_NAMES={fat:'Fat',satFat:'Saturates',sugars:'Sugars',salt:'Salt'};
export function calculateUKTraffic(profile={}) {
  if(profile.nutriCategory==='ineligible') return {status:'ineligible',reason:'Product is marked outside the packaged-food scheme.',items:[]};
  const unit=profile.unit==='ml'?'ml':'g';
  const threshold=UK_LIMITS[unit],portion=numberOrNull(profile.portionSize);
  const substantial=portion!==null && portion>(unit==='g'?100:150);
  const entries=Object.entries(UK_NAMES).map(([key,label])=>{
    const value=key==='salt' ? (numberOrNull(profile.salt)??(numberOrNull(profile.sodiumMg)===null?null:numberOrNull(profile.sodiumMg)/400)) : numberOrNull(profile[key]);
    if(value===null)return {key,label,value:null,level:'unknown',highByPortion:false};
    const [low,high,portionHigh]=threshold[key];
    const highByPortion=substantial && value*portion/100>portionHigh;
    const level=(value>high || highByPortion)?'red':value>low?'amber':'green';
    return {key,label,value,level,highByPortion};
  });
  const missing=entries.filter(x=>x.value===null).map(x=>x.label.toLowerCase());
  return {status:missing.length?'missing':portion===null?'per100':'exact',unit,portion,missing,items:entries,
    warning:portion===null?'Serving size unknown. Colours use per-100 values only; large portions can trigger additional red warnings.':null};
}

function gradeLevel(value,limits){return value<=limits[0]?0:value<=limits[1]?1:value<=limits[2]?2:3;}
const GRADE=['A','B','C','D'];
export function calculateSingaporeGrade(profile={}) {
  const beverage = ['drink','water'].includes(profile.nutriCategory) || ['1','1D'].includes(profile.hsrCategory);
  if(!beverage)return {status:'ineligible',grade:null,reason:'Singapore Nutri-Grade currently applies to beverages, not ordinary solid foods.'};
  if(profile.unit!=='ml' || profile.drinkAsPrepared!==true) {
    return {status:'needs-preparation',grade:null,reason:'Confirm nutrition values are for 100 mL of the drink as consumed. Dry tea, syrups and powdered drinks cannot be graded from dry-weight data.'};
  }
  const sugar=numberOrNull(profile.sugars), sat=numberOrNull(profile.satFat);
  const missing=[...(sugar===null?['total sugars']:[]),...(sat===null?['saturated fat']:[])];
  if(missing.length)return {status:'missing',grade:null,missing,reason:`Missing ${missing.join(' and ')} per 100 mL.`};
  // Under the industry guidance, lactose and galactose are subtracted only when
  // individually declared; otherwise their declared amounts are treated as zero.
  const lactose=numberOrNull(profile.lactose)??0,galactose=numberOrNull(profile.galactose)??0;
  if(lactose+galactose>sugar+0.001)return {status:'invalid',grade:null,reason:'Lactose and galactose cannot exceed declared total sugars. Check the label.'};
  const effectiveSugar=Math.max(0,sugar-lactose-galactose);
  let level=Math.max(gradeLevel(effectiveSugar,[1,5,10]),gradeLevel(sat,[0.7,1.2,2.8]));
  if(level===0 && (profile.sweeteners===null || profile.sweeteners===undefined)){
    return {status:'uncertain',grade:null,range:'A–B',effectiveSugar,reason:'Grade A requires confirming no non-sugar sweetener was added; otherwise this drink would be B.'};
  }
  if(profile.sweeteners===true)level=Math.max(1,level);
  return {status:'exact',grade:GRADE[level],effectiveSugar,hasSweeteners:profile.sweeteners===true,
    reason:'Uses the less favourable of the sugar and saturated-fat grades; non-sugar sweeteners prevent an A.'};
}
