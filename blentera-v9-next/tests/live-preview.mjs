import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';
import AxePuppeteer from '@axe-core/puppeteer';

const url='https://sharehtml.zhenjia.dev/v/ahqxSVe3CL/';
const chrome=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>fs.existsSync(p));
if(!chrome)throw Error('Chrome executable missing on runner');
const browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
const failures=[], screenshots=[];
try {
 for(const [width,height] of [[1440,900],[390,844]]){
  const page=await browser.newPage();await page.setViewport({width,height});
  const pageerrors=[],hostSandboxWarnings=[];page.on('pageerror',e=>{const message=e.message;if(/^SecurityError: Failed to read a named property 'document' from 'Window': Blocked a frame with origin "null"/.test(message))hostSandboxWarnings.push(message);else pageerrors.push(message);});
  await page.goto(url,{waitUntil:'networkidle2',timeout:45000});
  await page.waitForSelector('h1');
  const routes=[['/','Run AI work'],['/platform/','The shared foundation'],['/about/','An organisation'],['/control/','AI work needs']];
  for(const [route,heading] of routes){
   if(route!=='/'){
    await page.evaluate(r=>location.hash='#'+r,route);
    await page.waitForFunction(h=>document.querySelector('h1')?.textContent.includes(h),{},heading);
   }
   const details=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,main:document.querySelectorAll('main').length,h1:document.querySelectorAll('h1').length,title:document.querySelector('h1').textContent}));
   assert(details.title.includes(heading),JSON.stringify(details));
   assert.equal(details.main,1);assert.equal(details.h1,1);
   assert(details.scroll<=details.width+1,JSON.stringify(details));
   if(route==='/about/'){
    for(const [key,target] of [['cmo','Chief Marketing Officer'],['cfo','Chief Financial Officer'],['ciso','Chief Information Security Officer'],['cto','Chief Technology Officer']]){
     await page.click('[data-role="'+key+'"]');
     assert.equal(await page.$eval('#role-name',e=>e.textContent),target);
     assert.equal(await page.$$eval('#role-teams .team-row',e=>e.length),3);
    }
   }
   const name='v9-'+route.replaceAll('/','-').replace(/^-|-$/g,'home')+'-'+width+'.png';
   await page.screenshot({path:name,fullPage:false});screenshots.push(name);
   const result=await new AxePuppeteer(page).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
   const violations=result.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,count:v.nodes.length,targets:v.nodes.slice(0,5).map(n=>n.target)}));
   if(violations.length)failures.push({route,width,violations});
   console.log(JSON.stringify({route,width,details,axe_violations:violations}));
  }
  assert.equal(pageerrors.length,0,'Page JavaScript errors: '+pageerrors.join('; '));
  if(hostSandboxWarnings.length)console.log('THIRD_PARTY_IFRAME_SANDBOX_WARNING_NOT_FROM_SITE='+hostSandboxWarnings.length);
  await page.close();
 }
}finally{await browser.close();}
fs.writeFileSync('live-e2e-results.json',JSON.stringify({url,failures,screenshots},null,2));
if(failures.length)throw Error('Axe violations: '+JSON.stringify(failures));
console.log('LIVE_BROWSERS_E2E_PASS',screenshots.length);