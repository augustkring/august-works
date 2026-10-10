import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import AxePuppeteer from '@axe-core/puppeteer';

const origin='http://127.0.0.1:8765';
const chrome=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>fs.existsSync(p));
if(!chrome)throw Error('Chrome not installed');
const browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
const failures=[],images=[];
try{
  for(const [width,height] of [[1440,900],[390,844]]){
    const page=await browser.newPage();await page.setViewport({width,height});
    const uncaught=[];page.on('pageerror',e=>uncaught.push(e.message));
    for(const [route,expected] of [['/','Run AI work'],['/platform/','The shared foundation'],['/about/','An organisation'],['/control/','AI work needs']]){
      const response=await page.goto(origin+route,{waitUntil:'networkidle0',timeout:45000});
      assert.equal(response.status(),200);
      const title=await page.$eval('h1',x=>x.textContent);
      assert(title.includes(expected),title);
      assert.equal(await page.$$eval('main',x=>x.length),1);
      assert.equal(await page.$$eval('h1',x=>x.length),1);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
      assert(overflow<=1,JSON.stringify({width,route,overflow}));
      const colors=await page.evaluate(()=>({html:getComputedStyle(document.documentElement).fontFamily,background:getComputedStyle(document.body).backgroundColor}));
      if(route==='/about/'){
        for(const [role,name] of [['cmo','Chief Marketing Officer'],['cfo','Chief Financial Officer'],['ciso','Chief Information Security Officer']]){
          await page.click('[data-role="'+role+'"]');
          assert.equal(await page.$eval('#role-name',e=>e.textContent),name);
          assert.equal(await page.$$eval('#role-teams .team-row',e=>e.length),3);
        }
      }
      if(width===390){
        await page.click('[data-menu-toggle]');
        assert.equal(await page.$eval('#mobile-navigation',x=>x.hidden),false);
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval('#mobile-navigation',x=>x.hidden),true);
      }
      const imageName='next-'+route.replaceAll('/','-').replace(/^-|-$/g,'home')+'-'+width+'.png';
      await page.screenshot({path:imageName,fullPage:false});images.push(imageName);
      const axe=await new AxePuppeteer(page).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      const violations=axe.violations.map(v=>({id:v.id,impact:v.impact,count:v.nodes.length,targets:v.nodes.map(n=>n.target)}));
      if(violations.length)failures.push({route,width,violations});
      console.log(JSON.stringify({route,width,overflow,colors,axe:violations}));
    }
    assert.equal(uncaught.length,0,'Next exported app JS exceptions: '+uncaught.join('; '));
    await page.close();
  }
}finally{await browser.close()}
fs.writeFileSync('exported-next-e2e.json',JSON.stringify({origin,images,failures},null,2));
if(failures.length)throw Error('Accessibility QA failures '+JSON.stringify(failures));
console.log('NEXT_STATIC_EXPORT_BROWSER_PASS',images.length);