import {calculateNutriScore, calculateHSR, normalizeOpenFoodFacts, nutriCategories, hsrCategories, numberOrNull} from './scores.mjs';

const $=sel=>document.querySelector(sel);
const $$=sel=>Array.from(document.querySelectorAll(sel));
const STORAGE_KEY='foodlens-library-1';
const OFF_FIELDS='code,product_name,product_name_en,brands,quantity,image_front_url,image_url,image_front_small_url,ingredients_text,ingredients_text_en,categories_tags,additives_tags,allergens_tags,nova_group,nutriments,nutriscore_grade,nutriscore_score,nutriscore_data,nutrition_data_per,last_modified_t';
const SAMPLE_BARCODE='3017620422003'; // Nutella, for live API demonstration, not a hardcoded score.
const MAX_HISTORY=70;
let storage = readStorage();
let current = null;
let activeTab = 'scan';
let activeFilter = 'all';
let editorOpen = false;
let requestId = 0;
let camera = null;
let nativeStream = null;
let nativeFrame = 0;
let openingCamera = false;
let toastTimeout;

function esc(value='') { return String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(value,digits=1) {const v=numberOrNull(value); return v===null?'—':new Intl.NumberFormat('en-MY',{maximumFractionDigits:digits}).format(v);}
function safeImage(url) {try {const u=new URL(url);return u.protocol==='https:' && /(^|\.)openfoodfacts\.org$/.test(u.hostname) ? esc(url) : '';}catch{return '';}}
function readStorage(){try {const obj=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');return {items:Array.isArray(obj.items)?obj.items.slice(0,MAX_HISTORY):[]};} catch{return {items:[]};}}
function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(storage));}catch{notify('Storage is full or disabled; scans cannot be saved on this device.');}}
function getKey(p){return String(p?.barcode || p?.manualId || '');}
function existing(p){const k=getKey(p);return storage.items.find(x=>x && x.key===k);}
function remember(p,{favorite}={}){
  const k=getKey(p);if(!k) return;
  const prev=storage.items.find(x=>x.key===k);
  const entry={key:k,profile:structuredClone(p),favorite:favorite??prev?.favorite??false,time:Date.now()};
  storage.items=[entry,...storage.items.filter(x=>x.key!==k)].slice(0,MAX_HISTORY);persist();
}
function notify(msg){const el=$('#toast');el.textContent=msg;el.hidden=false;clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.hidden=true,3800);}
function status(message,type='info'){const el=$('#status-message');el.hidden=!message;el.textContent=message||'';el.className='message '+type;}
function switchTab(tab,scroll=true){
  if(!['scan','saved','about'].includes(tab)) tab='scan';activeTab=tab;
  $$('.view').forEach(v=>v.hidden=v.dataset.view!==tab);
  $$('[data-tab]').forEach(el=>{const selected=el.dataset.tab===tab;el.classList.toggle('active',selected);el.classList.toggle('selected',selected);if(el.matches('.mobile-tab'))el.setAttribute('aria-current',selected?'page':'false');});
  if(tab==='saved')renderSaved();
  if(scroll)window.scrollTo({top:0,behavior:'smooth'});
  history.replaceState(null,'','#'+tab);
}
function formatDate(epoch){if(!epoch)return '';try{return new Date(epoch*1000).toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'});}catch{return '';}}
async function lookupBarcode(raw){
  const barcode=String(raw||'').replace(/[\s-]/g,'');
  if(!/^\d{8,14}$/.test(barcode)){status('Please enter a barcode with 8–14 digits.','error');$('#barcode-input').focus();return;}
  $('#barcode-input').value=barcode;switchTab('scan',false);editorOpen=false;
  const mine=++requestId;
  status('Looking up the product in Open Food Facts…','loading');
  const ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),14000);
  try{
    const url=`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`;
    const response=await fetch(url,{mode:'cors',credentials:'omit',headers:{Accept:'application/json'},signal:ctrl.signal});
    if(!response.ok)throw new Error(response.status===429?'Open Food Facts is rate limiting requests.':`The food database returned HTTP ${response.status}.`);
    const obj=await response.json();if(mine!==requestId)return;
    if(obj.status!==1 || !obj.product){
      const saved=storage.items.find(x=>x.key===barcode);
      if(saved?.profile){current=structuredClone(saved.profile);editorOpen=false;renderCurrent();status('Product not currently available in the database. Showing your locally saved record.');return;}
      current=blankProfile(barcode);editorOpen=true;renderCurrent();status('Barcode not found. Enter the nutrition details from the product label below.');return;
    }
    current=normalizeOpenFoodFacts(obj.product,barcode);
    // Prefer the user's previously corrected label values, not a later unverified database update.
    const previous=storage.items.find(x=>x.key===barcode && x.profile?.edited);
    if(previous)current=structuredClone(previous.profile);
    remember(current);status('');renderCurrent();
  }catch(e){
    if(mine!==requestId)return;
    const saved=storage.items.find(x=>x.key===barcode);
    if(saved?.profile){current=structuredClone(saved.profile);renderCurrent();status('Offline or database unavailable. Showing your locally saved data.');}
    else status(e.name==='AbortError'?'Product lookup timed out. Please retry, or enter the label details manually.':`Unable to fetch this product: ${e.message}. You can still enter its nutrition label manually.`,'error');
  }finally{clearTimeout(timer);}
}
function blankProfile(barcode=''){
  return {barcode,manualId:barcode?'':`manual-${Date.now()}`,name:'My food product',brand:'',quantity:'',image:'',ingredients:'',categories:[],additives:0,nova:null,allergens:[],
    energyKj:null,kcal:null,sugars:null,satFat:null,salt:null,sodiumMg:null,protein:null,fibre:null,fat:null,
    fvlNutri:null,fvnlHsr:null,hsrConcentrated:false,sweeteners:null,nutriCategory:'food',hsrCategory:'2',offGrade:null,
    categoryNote:'Please select the correct categories using the information on the package.',from:'Manually entered',updated:null,unit:'g',edited:true};
}
function gradeView(p,calc){
  const officialFromDB=!p.edited&&/^[A-E]$/.test(p.offGrade||'');
  if(officialFromDB)return {value:p.offGrade,status:'database',label:'Open Food Facts grade',desc:'From the database · verify the algorithm version on the pack'};
  if(calc.status==='ineligible')return {value:'—',status:'ineligible',label:'Not eligible',desc:'This category is excluded'};
  if(calc.status==='missing')return {value:'?',status:'missing',label:'Missing required nutrients',desc:'Fill in the food label to calculate'};
  if(calc.grade)return {value:calc.grade,status:calc.status,label:calc.status==='exact'?'Calculated grade':'Grade stable across possible values',desc:calc.status==='exact'?`2023 algorithm · score ${calc.score}`:'Provisional · some inputs missing'};
  return {value:`${calc.minGrade}–${calc.maxGrade}`,status:'range',label:'Possible grades',desc:'Fill in missing inputs to narrow this range'};
}
function starsView(calc){
  if(calc.status==='ineligible')return {stars:null,status:'ineligible',value:'—',label:'Not eligible',desc:'Excluded product category'};
  if(calc.status==='missing')return {stars:null,status:'missing',value:'?',label:'Missing required nutrients',desc:'Enter the nutrition label to calculate'};
  if(calc.stars!==null && calc.stars!==undefined)return {stars:calc.stars,status:calc.status,value:calc.stars.toFixed(1),label:calc.status==='exact'?'Calculated rating':'Stars stable across possible values',desc:calc.status==='exact'?`HSR v9 · score ${calc.score??'automatic'}`:'Provisional · some inputs missing'};
  return {stars:null,status:'range',value:`${calc.minStars.toFixed(1)}–${calc.maxStars.toFixed(1)}`,label:'Possible star ratings',desc:'Fill in missing inputs to narrow this range'};
}
function starsHtml(stars){
  if(stars===null)return '';
  let html='';for(let i=1;i<=5;i++)html+=`<span class="${stars>=i?'':stars>=i-.5?'half':'empty'}" aria-hidden="true">★</span>`;
  return `<div class="stars-row" aria-label="${stars} of 5 stars">${html}</div>`;
}
function gradeScale(selected){return `<div class="grade-strip" aria-label="Nutri-Score scale from A to E">${'ABCDE'.split('').map(g=>`<span class="grade-bar ${g.toLowerCase()} ${g===selected?'active':''}">${g}</span>`).join('')}</div>`;}
function nutrientRow(label,value,unit,max,more=''){
  const raw=numberOrNull(value),width=raw===null?0:Math.min(100,Math.max(1,raw/max*100));
  const isHigh=(label==='Sugars'&&raw>22.5)||(label==='Saturated fat'&&raw>5)||(label==='Salt'&&raw>1.5);
  return `<div class="nutri-item"><span class="nutri-label">${esc(label)}</span><strong class="nutri-value">${fmt(raw)} ${esc(unit)}</strong><div class="nutri-track" title="Relative bar, not a daily value"><div class="nutri-fill ${isHigh?'warn':''}" style="width:${width}%"></div></div></div>`;
}
function missText(missing){if(!missing?.length)return '';return missing.map(s=>esc(s)).join(', ');}
function renderCurrent(){
  const el=$('#result-container');const p=current;if(!p){el.innerHTML='';$('#first-time').hidden=false;return;}
  $('#first-time').hidden=true;
  const nut=calculateNutriScore(p),hsr=calculateHSR(p),nView=gradeView(p,nut),hView=starsView(hsr);
  const saved=existing(p), image=safeImage(p.image);
  const unresolved=[...(p.edited?nut.missing||[]:[]),...(hsr.missing||[])];
  const uniqueMissing=[...new Set(unresolved)];
  const productBarcode=/^\d{8,14}$/.test(p.barcode)?p.barcode:null;
  const details=esc(p.ingredients).slice(0,900);
  const isEstimated=nView.status==='range'||nView.status==='stable'||hView.status==='range'||hView.status==='stable';
  const categoryWarning=esc(p.categoryNote || 'Please check the product categories for both algorithms.');
  el.innerHTML=`
    <div class="result-header"><div><span class="section-overline">02 / YOUR RESULT</span><h2>Inside the label</h2></div><div class="result-actions"><button type="button" id="favorite-btn" class="outline-btn ${saved?.favorite?'faved':''}" aria-pressed="${saved?.favorite?'true':'false'}"><svg class="icon"><use href="#i-heart"/></svg>${saved?.favorite?'Saved':'Save'}</button><button type="button" id="edit-btn-top" class="outline-btn"><svg class="icon"><use href="#i-pencil"/></svg>Edit</button></div></div>
    <div class="result-main"><article class="product-panel"><div class="product-photo">${image?`<img src="${image}" alt="Product packaging" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:`<div class="product-placeholder">◈<span>Product image unavailable</span></div>`}</div><div class="product-ident"><span class="product-brand">${esc(p.brand||'PRODUCT DETAILS')}</span><h3 class="product-name">${esc(p.name)}</h3>${p.quantity?`<span class="product-quantity">${esc(p.quantity)}</span>`:''}${productBarcode?`<div class="barcode-pill">▥ ${esc(p.barcode)}</div>`:''}${productBarcode?`<a class="openfood-link" href="https://world.openfoodfacts.org/product/${encodeURIComponent(productBarcode)}" target="_blank" rel="noopener noreferrer">See on Open Food Facts ↗</a>`:''}</div></article>
    <article class="scores-panel"><div class="panel-kicker"><span class="kicker-line"></span> TWO WAYS TO LOOK AT IT</div><div class="ratings-grid">
      <div class="rating-card"><div class="rating-region"><span class="rating-flag">FR</span> FRANCE</div><div class="rating-value ${/^[A-E]$/.test(nView.value)?`grade-${nView.value.toLowerCase()}`:nView.status==='range'?'range':'unavailable'}">${esc(nView.value)}</div><div class="rating-name">Nutri-Score</div><div class="rating-meta">${esc(nView.label)}</div>${/^[A-E]$/.test(nView.value)?gradeScale(nView.value):''}</div>
      <div class="rating-card hsr-card"><div class="rating-region"><span class="rating-flag">AU</span> AUSTRALIA</div><div class="rating-value ${hView.stars!==null?'hsr':hView.status==='range'?'range':'unavailable'}">${esc(hView.value)}${hView.stars!==null?'<small>/ 5</small>':''}</div>${starsHtml(hView.stars)}<div class="rating-name">Health Star Rating</div><div class="rating-meta">${esc(hView.label)}</div></div>
    </div><div class="rating-details"><div class="confidence ${uniqueMissing.length?'warning':''}"><svg class="icon"><use href="#i-info"/></svg><span>${uniqueMissing.length?`Incomplete data: ${missText(uniqueMissing)}. The app displays calculated ranges rather than assuming these are zero.`:(isEstimated?'Some values are unknown; the displayed rating remains stable across their possible values.':'Scores are available for the supplied information; confirm the category and packaging values.')}</span></div><div class="confidence"><svg class="icon"><use href="#i-info"/></svg><span>${categoryWarning}</span></div></div><div class="edit-cta"><span>Details don't match the packaging?<br>Correct them for a more reliable score.</span><button type="button" class="mini-primary" id="edit-btn">Edit nutrition <span aria-hidden="true">↗</span></button></div></article></div>
    <div class="result-bottom"><article class="nutrition-panel"><div class="panel-kicker"><span class="kicker-line"></span> THE NUMBERS</div><h3 class="small-heading">What's in 100 ${esc(p.unit==='ml'?'mL':'g')}?</h3><p class="description">Nutrients are normalised per 100 ${esc(p.unit==='ml'?'mL':'g')}. Bars provide relative context, not daily allowances.</p><div class="nutri-list">${nutrientRow('Energy',p.energyKj,'kJ',2500)}${nutrientRow('Sugars',p.sugars,'g',50)}${nutrientRow('Saturated fat',p.satFat,'g',20)}${nutrientRow('Salt',p.salt,'g',5)}${nutrientRow('Protein',p.protein,'g',30)}${nutrientRow('Fibre',p.fibre,'g',20)}</div></article>
    <article class="details-panel"><div class="panel-kicker"><span class="kicker-line"></span> THE BIGGER PICTURE</div><h3 class="small-heading">Beyond the scores</h3><p class="description">The systems don't measure everything — processing and ingredients matter too.</p><div class="details-block"><div class="details-title">NOVA processing group</div><p class="details-text">${p.nova?`Group ${p.nova} · ${['','Unprocessed or minimally processed','Processed culinary ingredients','Processed foods','Ultra-processed foods'][p.nova]}`:'Not recorded in the product database'}${p.nova===4?' · This is independent of nutritional scoring.':''}</p></div><div class="details-block"><div class="details-title">Ingredients</div><p class="details-text">${details||'Not provided. Look at the packaging for ingredient percentages.'}${p.ingredients.length>900?'…':''}</p></div><div class="details-block"><div class="details-title">Additional information</div><p class="details-text">${p.allergens?.length?`Allergens tagged: ${esc(p.allergens.map(t=>String(t).replace(/^en:/,'')).join(', '))}.`: 'Allergens not recorded — this is not an allergen-free guarantee.'} ${p.additives?`${fmt(p.additives,0)} additive tags recorded.`:''}</p></div><div class="details-block"><div class="details-title">Source and method</div><p class="details-text">${p.edited?'Your manually verified/edited values':esc(p.from||'Open Food Facts')}${p.updated?` · Last database update ${formatDate(p.updated)}`:''}. French: ${esc(nView.desc)}. Australia: ${esc(hView.desc)}. <a class="source-link" href="#about" id="methods-link">Read the methodology ↗</a></p></div></article></div>
    <div id="editor-container"></div>`;
  $('#favorite-btn').addEventListener('click',()=>{const entry=existing(p);remember(p,{favorite:!entry?.favorite});renderCurrent();notify(!entry?.favorite?'Added to favourites':'Removed from favourites');});
  const edit=()=>{editorOpen=!editorOpen;renderEditor();if(editorOpen)$('#nutrition-form')?.scrollIntoView({behavior:'smooth',block:'center'});};
  $('#edit-btn').addEventListener('click',edit);$('#edit-btn-top').addEventListener('click',edit);
  $('#methods-link').addEventListener('click',e=>{e.preventDefault();switchTab('about');});
  renderEditor();
}
function inputField(key,label,extra='',opts={}) {
  const value=current?.[key];const max=opts.max|| (key==='sodiumMg'?40000:key==='energyKj'?5000:key==='fvlNutri'||key==='fvnlHsr'?100:100);
  return `<div class="field"><label for="field-${esc(key)}">${esc(label)}</label><input id="field-${esc(key)}" name="${esc(key)}" type="number" inputmode="decimal" min="0" max="${max}" step="any" placeholder="Unknown" value="${value===null||value===undefined?'':esc(value)}"><small>${esc(extra||'Per 100 g/mL')}</small></div>`;
}
function dropdown(key,label,options){return `<div class="field"><label for="field-${esc(key)}">${esc(label)}</label><select id="field-${esc(key)}" name="${esc(key)}">${options.map(([val,name])=>`<option value="${esc(val)}" ${current?.[key]===val?'selected':''}>${esc(name)}</option>`).join('')}</select></div>`;}
function renderEditor(){
  const root=$('#editor-container');if(!root)return;
  if(!editorOpen){root.innerHTML='';return;}
  root.innerHTML=`<div class="editor"><div class="editor-top"><div><span class="section-overline">COMPLETE THE LABEL</span><h3>Make the numbers yours.</h3><p>Use values per 100 g or 100 mL, never per serving.</p></div><button class="editor-close" type="button" id="editor-close" aria-label="Close editor"><svg class="icon small"><use href="#i-close"/></svg></button></div>
  <form id="nutrition-form" novalidate>
    <div class="form-block"><h4>Product</h4><div class="field-grid"><div class="field"><label for="field-name">Product name</label><input id="field-name" name="name" maxlength="180" required value="${esc(current.name)}"></div><div class="field"><label for="field-brand">Brand</label><input id="field-brand" name="brand" maxlength="100" value="${esc(current.brand)}"></div><div class="field"><label for="field-quantity">Pack size</label><input id="field-quantity" name="quantity" maxlength="80" value="${esc(current.quantity)}"></div>${dropdown('unit','Label units',[['g','Per 100 g'],['ml','Per 100 mL']])}</div></div>
    <div class="form-block"><h4>Nutrition per 100 g / mL</h4><div class="field-grid">${inputField('energyKj','Energy (kJ)','If only kcal: multiply by 4.184')}${inputField('sugars','Total sugars (g)')}${inputField('satFat','Saturated fat (g)')}${inputField('fat','Total fat (g)')}${inputField('salt','Salt (g)','Salt = sodium × 0.0025')}${inputField('sodiumMg','Sodium (mg)','Sodium = salt × 400')}${inputField('protein','Protein (g)')}${inputField('fibre','Dietary fibre (g)')}</div></div>
    <div class="form-block"><h4>Important category choices</h4><div class="field-grid">${dropdown('nutriCategory','French scoring category',nutriCategories)}${dropdown('hsrCategory','Australian scoring category',hsrCategories)}${inputField('fvlNutri','France: qualifying F/V/L (%)','Fruit, vegetables, legumes only')}${inputField('fvnlHsr','Australia: FVNL (%)','Also includes nuts; read guide')}<div class="field"><label for="field-hsrConcentrated">Australian FVNL form</label><select id="field-hsrConcentrated" name="hsrConcentrated"><option value="false" ${!current.hsrConcentrated?'selected':''}>Non-concentrated</option><option value="true" ${current.hsrConcentrated?'selected':''}>100% concentrated ingredients</option></select><small>Mixed concentrated + fresh require the guide's adjusted percentage.</small></div><div class="field"><label for="field-sweeteners">Non-nutritive sweeteners</label><select id="field-sweeteners" name="sweeteners"><option value="unknown" ${current.sweeteners===null?'selected':''}>Not confirmed</option><option value="true" ${current.sweeteners===true?'selected':''}>Present (beverages)</option><option value="false" ${current.sweeteners===false?'selected':''}>Absent (checked label)</option></select><small>Important for French drink scores.</small></div></div><p class="form-note">The French and Australian fruit/vegetable percentages differ. For example, nuts usually do not count for the French general-food FVL component, but can count for Australia. Only enter zero if you have checked that the ingredient does not qualify. HSR dairy-alternative categories have additional calcium and percentage conditions.</p></div>
    <div id="form-error" class="form-error" hidden></div><div class="form-buttons"><button class="text-button" type="button" id="editor-cancel">Cancel</button><button class="save-button" type="submit">Update ratings <span aria-hidden="true">→</span></button></div></form></div>`;
  $('#editor-close').addEventListener('click',closeEditor);$('#editor-cancel').addEventListener('click',closeEditor);
  for(const key of ['salt','sodiumMg']){
    $(`#field-${key}`).addEventListener('input',()=>{
      const source=$(`#field-${key}`),other=$(`#field-${key==='salt'?'sodiumMg':'salt'}`);
      if(!source.value){other.value='';return;}
      const v=Number(source.value);if(!Number.isFinite(v)||v<0)return;
      other.value=key==='salt'?+(v*400).toFixed(2):+(v/400).toFixed(4);
    });
  }
  $('#nutrition-form').addEventListener('submit',saveForm);
}
function closeEditor(){editorOpen=false;renderEditor();}
function saveForm(event){
  event.preventDefault();const form=event.currentTarget;const data=new FormData(form);
  const p=structuredClone(current),name=String(data.get('name')||'').trim();
  if(!name){setFormError('Please give the product a name.');return;}
  for(const key of ['energyKj','sugars','satFat','salt','sodiumMg','protein','fibre','fat','fvlNutri','fvnlHsr']){
    const raw=String(data.get(key)||'').trim();
    const max=key==='sodiumMg'?40000:key==='energyKj'?5000:100;
    if(raw && (!Number.isFinite(Number(raw))||Number(raw)<0||Number(raw)>max)){setFormError(`${key} must be between 0 and ${max}, or left blank if unknown.`);return;}
    p[key]=raw===''?null:Number(raw);
  }
  p.name=name;p.brand=String(data.get('brand')||'').trim().slice(0,100);p.quantity=String(data.get('quantity')||'').trim().slice(0,80);
  p.unit=data.get('unit')==='ml'?'ml':'g';p.nutriCategory=String(data.get('nutriCategory'));p.hsrCategory=String(data.get('hsrCategory'));
  p.hsrConcentrated=data.get('hsrConcentrated')==='true';p.sweeteners=data.get('sweeteners')==='unknown'?null:data.get('sweeteners')==='true';
  // Persist source data and omit previous reported Nutri-Score after any manual edits.
  p.edited=true;p.offGrade=null;p.from='User-entered / edited nutrition label';p.categoryNote='Category and qualifying ingredient percentages entered by you. Verify with the official eligibility guidance.';
  p.kcal=p.energyKj===null?null:+(p.energyKj/4.184).toFixed(1);
  current=p;editorOpen=false;remember(p);status('');renderCurrent();notify('Nutrition label updated. Scores recalculated.');
}
function setFormError(text){const el=$('#form-error');el.hidden=false;el.textContent=text;el.scrollIntoView({behavior:'smooth',block:'nearest'});}
function renderSaved(){
  const el=$('#saved-content');const filtered=storage.items.filter(x=>x && x.profile && (activeFilter==='all'||x.favorite));
  $$('.filter-btn').forEach(b=>b.classList.toggle('selected',b.dataset.filter===activeFilter));
  if(!filtered.length){el.innerHTML=`<div class="empty-state"><div class="empty-state-icon"><svg class="icon"><use href="#i-heart"/></svg></div><h2>${activeFilter==='favorites'?'Nothing bookmarked yet.':'Your food library starts here.'}</h2><p>Scan a barcode to save a product and compare its nutrition ratings.</p><button class="save-button" id="empty-scan" type="button">Scan a product →</button></div>`;$('#empty-scan').addEventListener('click',()=>switchTab('scan'));return;}
  el.innerHTML=`<div class="saved-grid">${filtered.map(x=>{const p=x.profile,image=safeImage(p.image);return `<article class="saved-card"><div class="saved-image">${image?`<img src="${image}" alt="" loading="lazy">`:'◈'}</div><div class="saved-card-body"><strong title="${esc(p.name)}">${esc(p.name)}</strong><small>${esc(p.brand || 'Product')} · ${new Date(x.time).toLocaleDateString('en-MY')}</small><div class="saved-card-actions"><button type="button" class="open-saved" data-key="${esc(x.key)}">View</button><button type="button" class="remove-saved" data-key="${esc(x.key)}">Remove</button></div></div></article>`;}).join('')}</div>`;
  $$('.open-saved').forEach(b=>b.addEventListener('click',()=>{const entry=storage.items.find(x=>x.key===b.dataset.key);if(!entry)return;current=structuredClone(entry.profile);editorOpen=false;switchTab('scan');renderCurrent();setTimeout(()=>$('#result-container')?.scrollIntoView({behavior:'smooth'}),50);status('Showing your locally saved product record.');}));
  $$('.remove-saved').forEach(b=>b.addEventListener('click',()=>{storage.items=storage.items.filter(x=>x.key!==b.dataset.key);persist();renderSaved();notify('Removed from local history.');}));
}
function exportLibrary(){
  const body=JSON.stringify({app:'FoodLens',version:1,exportedAt:new Date().toISOString(),items:storage.items},null,2);
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob([body],{type:'application/json'}));a.href=url;a.download=`foodlens-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
async function importLibrary(ev){const f=ev.target.files?.[0];if(!f)return;if(f.size>2_000_000){notify('Backup file is too large.');return;}
  try{const obj=JSON.parse(await f.text());if(obj?.app!=='FoodLens'||!Array.isArray(obj?.items))throw Error('Not a FoodLens backup.');
    const clean=obj.items.slice(0,MAX_HISTORY).filter(x=>x&&typeof x.key==='string'&&x.key.length<=45&&x.profile&&typeof x.profile.name==='string'&&x.profile.name.length<=180).map(x=>({key:x.key,profile:x.profile,time:Number(x.time)||Date.now(),favorite:!!x.favorite}));
    const map=new Map();for(const item of [...storage.items,...clean])map.set(item.key,item);
    storage.items=Array.from(map.values()).sort((a,b)=>b.time-a.time).slice(0,MAX_HISTORY);persist();renderSaved();notify(`${clean.length} products imported.`);
  }catch(e){notify('Could not import this backup: '+e.message);}finally{ev.target.value='';}
}

function loadExternal(src){return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.async=true;script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('Library unavailable'));};document.head.appendChild(script);});}
async function loadScannerLibrary(){
  if(window.Html5Qrcode)return;
  for(const url of ['https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js','https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js']){
    try{await loadExternal(url);if(window.Html5Qrcode)return;}catch{}
  }
  throw Error('Camera decoder could not be loaded. Check your internet connection.');
}
async function openCamera(){
  if(openingCamera||!$('#camera-modal').hidden)return;
  openingCamera=true;$('#camera-modal').hidden=false;document.body.style.overflow='hidden';$('#camera-hint').textContent='Requesting camera access…';
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera scanning requires HTTPS and a supported phone browser.');
    try{
      await loadScannerLibrary();
      const formats=window.Html5QrcodeSupportedFormats;
      camera=new window.Html5Qrcode('reader',{formatsToSupport:[formats.EAN_13,formats.EAN_8,formats.UPC_A,formats.UPC_E,formats.CODE_128,formats.ITF],verbose:false});
      await camera.start({facingMode:'environment'},{fps:10,qrbox:(w,h)=>({width:Math.min(290,Math.max(130,w-30)),height:Math.min(150,Math.max(90,h-30))}),aspectRatio:1.3,disableFlip:true},onBarcode,()=>{});
    }catch(libraryError){
      if(!('BarcodeDetector' in window))throw libraryError;
      await startNativeCamera();
    }
    $('#camera-hint').textContent='Hold the barcode steady inside the frame. The scan happens automatically.';
  }catch(e){$('#camera-hint').textContent=`${e.message||'Camera unavailable.'} You can still enter the barcode manually.`;}
  finally{openingCamera=false;}
}
let scanLock=false;
async function onBarcode(decoded){
  const code=String(decoded||'').trim();if(scanLock||!/^\d{8,14}$/.test(code))return;
  scanLock=true;try{await closeCamera();await lookupBarcode(code);}finally{scanLock=false;}
}
async function startNativeCamera(){
  if(!('BarcodeDetector' in window))throw Error('No barcode detector available');
  nativeStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
  const video=document.createElement('video');video.setAttribute('playsinline','');video.muted=true;video.autoplay=true;video.id='native-video';video.srcObject=nativeStream;$('#reader').replaceChildren(video);await video.play();
  const formats=['ean_13','ean_8','upc_a','upc_e','code_128','itf'];const supported=await window.BarcodeDetector.getSupportedFormats();const detector=new window.BarcodeDetector({formats:formats.filter(s=>supported.includes(s))});
  async function frame(){if(!nativeStream)return;try{const hits=await detector.detect(video);if(hits.length){await onBarcode(hits[0].rawValue);return;}}catch{}nativeFrame=setTimeout(frame,200);}
  frame();
}
async function closeCamera(){
  $('#camera-modal').hidden=true;document.body.style.overflow='';clearTimeout(nativeFrame);
  if(nativeStream){nativeStream.getTracks().forEach(t=>t.stop());nativeStream=null;}
  if(camera){const old=camera;camera=null;try{await old.stop();}catch{}try{old.clear();}catch{}}
  $('#reader').replaceChildren();openingCamera=false;
}
function bind(){
  $$('[data-tab]').forEach(el=>el.addEventListener('click',()=>switchTab(el.dataset.tab)));
  $('#brand-home').addEventListener('click',e=>{e.preventDefault();switchTab('scan');});
  $('#about-back').addEventListener('click',e=>{e.preventDefault();switchTab('scan');});
  $('#scan-btn').addEventListener('click',openCamera);
  $('#lookup-btn').addEventListener('click',()=>lookupBarcode($('#barcode-input').value));
  $('#barcode-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();lookupBarcode(e.target.value);}});
  $('#example-btn').addEventListener('click',()=>lookupBarcode(SAMPLE_BARCODE));
  $('#manual-btn').addEventListener('click',()=>{++requestId;current=blankProfile();editorOpen=true;switchTab('scan');status('Add your product details from the packaging.');renderCurrent();$('#nutrition-form')?.scrollIntoView({behavior:'smooth',block:'start'});});
  $('#camera-close').addEventListener('click',closeCamera);$('#camera-manual').addEventListener('click',async()=>{await closeCamera();$('#barcode-input').focus();});
  $('#camera-modal').addEventListener('click',e=>{if(e.target.id==='camera-modal')closeCamera();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#camera-modal').hidden)closeCamera();});
  $$('.filter-btn').forEach(b=>b.addEventListener('click',()=>{activeFilter=b.dataset.filter;renderSaved();}));
  $('#export-btn').addEventListener('click',exportLibrary);$('#import-input').addEventListener('change',importLibrary);
  window.addEventListener('hashchange',()=>{const tab=location.hash.slice(1);if(['scan','saved','about'].includes(tab))switchTab(tab,false);});
}
function init(){bind();switchTab(['scan','saved','about'].includes(location.hash.slice(1))?location.hash.slice(1):'scan',false);
  const code=new URLSearchParams(location.search).get('barcode');if(code)lookupBarcode(code);
  if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
init();
