/**
 * Two additional, independent front-of-pack methods. These are unofficial
 * calculations for personal comparison, NOT certification or endorsed labels.
 * UK Department of Health/FSA Front of Pack Guide (November 2016), Tables 2-3.
 * Singapore Health Promotion Board Nutri-Grade beverages, 2022 guidance (current in 2026).
 */
import {numberOrNull} from './scores.mjs';

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
