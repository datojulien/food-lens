import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const file=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const html=file('index.html');
const app=file('app.mjs');
const sw=file('sw.js');
const scoresFile=file('scores.mjs');

test('deployed scoring module exports every required named function',async()=>{
  assert.match(app,/import \* as scoring from ['"]\.\/scores\.mjs\?v=\d+['"]/);
  const mod=await import(new URL('../scores.mjs?v=9',import.meta.url).href);
  for(const key of ['calculateNutriScore','calculateHSR','normalizeOpenFoodFacts','calculateUKTraffic','calculateSingaporeGrade','numberOrNull']) {
    assert.equal(typeof mod[key],'function',`${key} must be exported`);
  }
  for(const key of ['nutriCategories','hsrCategories']) assert.ok(Array.isArray(mod[key]),key);
  assert.match(scoresFile,/export function calculateUKTraffic/);
  assert.match(scoresFile,/export function calculateSingaporeGrade/);
  assert.match(app,/regionalEngineOutdated/);
});

test('HTML, app module and PWA cache use one release ID',()=>{
  const appVersion=app.match(/from ['"]\.\/scores\.mjs\?v=(\d+)['"]/)?.[1];
  const scriptVersion=html.match(/src="app\.mjs\?v=(\d+)"/)?.[1];
  const styleVersion=html.match(/href="styles\.css\?v=(\d+)"/)?.[1];
  const cacheVersion=sw.match(/foodlens-app-v(\d+)/)?.[1];
  assert.ok(appVersion);
  assert.equal(scriptVersion,appVersion);
  assert.equal(styleVersion,appVersion);
  assert.equal(cacheVersion,appVersion);
  assert.match(sw,new RegExp('scores\\.mjs\\?v='+appVersion));
  assert.match(app,new RegExp('sw\\.js\\?v='+appVersion));
});

test('failed JavaScript requests never receive the HTML fallback',()=>{
  assert.match(sw,/if\(navigation\)return \(await caches\.match\('\.\/index\.html'\)\)/);
  assert.match(sw,/return Response\.error\(\); \/\/ Never serve index\.html as a JS module/);
});

test('national graphics stay visible without misleading numeric rating',()=>{
  assert.match(app,/function hsrBadgeHtml\(stars,\{status='exact'\}=\{\}\)/);
  assert.match(app,/if\(!valid\)return `<polygon/);
  assert.match(app,/hsrBadgeHtml\(hView\.stars,\{status:hView\.status\}\)/);
  assert.match(app,/Possible: \$\{esc\(hView\.value\)\} stars/);
  assert.doesNotMatch(app,/hView\.stars!==null\?hsrBadgeHtml/);
  assert.match(app,/function nutriScoreBadgeHtml\(grade\)/);
  assert.match(app,/function ukCard\(r,p\)/);
  assert.match(app,/function sgCard\(r,p\)/);
  assert.match(app,/grade\?`<div class=\\?"sg-nutrigrade-mark/);
});

// Regression test for the blue Health Star Rating cap in the user's reference.
test('Australian Health Star emblem fills the upper dome, including behind every star',()=>{
  // The cap apex (y=28) is above the top star (y=60, tip at y=39),
  // unlike the older y=71 dome that left a large white gap and cropped stars.
  assert.match(app,/M29 209 C29 109 87\\.6 28 160 28 C232\\.4 28 291 109 291 209 Z/);
  assert.match(app,/const places=\\[\\[62,167\\],\\[91,99\\],\\[160,60\\],\\[229,99\\],\\[258,167\\]\\]/);
  assert.match(app,/cy=\\\"155\\\" r=\\\"54\\\" fill=\\\"#fff\\\"/);
  assert.doesNotMatch(app,/M22 204 A138 138/);
});
