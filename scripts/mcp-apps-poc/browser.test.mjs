import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { startPoc } from "./server.mjs";
const axePath = createRequire(new URL("../../packages/paperclip-runner/package.json", import.meta.url)).resolve("axe-core/axe.min.js");
let poc, browser;
before(async () => {
  poc = await startPoc();
  browser = await chromium.launch({ ...(process.env.PAPERCLIP_PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PAPERCLIP_PLAYWRIGHT_EXECUTABLE } : {}), headless: true, args: ["--no-sandbox", "--no-proxy-server"] });
});
after(async () => { await browser?.close(); await poc?.close(); });
async function panel(page) {
  await page.goto(poc.hostOrigin); await page.getByRole("button", {name:"Open isolated panel"}).click();
  await page.getByRole("status").filter({hasText:"Isolated panel ready"}).waitFor();
  const app = page.frameLocator('iframe[title="Experimental third-party panel"]').frameLocator('iframe[title="Read-only synthetic app"]');
  await app.getByText("Synthetic read-only fixture; no business result", {exact:true}).waitFor(); return app;
}
test("real browser enforces separate-origin DOM/cookie/CSP/tool/navigation boundaries and recoverable close", async () => {
  const context = await browser.newContext({ viewport: {width:390,height:844} }); const page = await context.newPage();
  try {
    await context.addCookies([{name:"aw_poc_private",value:"HOST_COOKIE_CANARY",url:poc.hostOrigin}]);
    const app = await panel(page);
    for (const [button, result] of [["Inspect app cookie boundary","No host cookies"],["Try host DOM access","Host DOM blocked"],["Try undeclared connection","Undeclared connection blocked"],["Request a cross-server tool","Tool request refused; no effect"],["Try host navigation","Host navigation blocked"]]) {
      await app.getByRole("button",{name:button}).click(); await app.getByText(result,{exact:true}).waitFor();
    }
    assert.equal(page.url(),`${poc.hostOrigin}/`); assert.equal(poc.audit.forbiddenRequests,0); assert.equal(poc.audit.nonGetRequests,0);
    const activeView = page.frames().find(frame=>frame.url()==="about:srcdoc");
    await activeView.evaluate(()=>parent.postMessage({jsonrpc:"2.0",id:"unknown",method:"PRIVATE_RPC_CANARY"},"*"));
    await page.waitForFunction(()=>window.pocAudit.some(item=>item.method==="unsupported"));
    const audit = await page.evaluate(()=>window.pocAudit);
    assert.ok(audit.some(item=>item.code==="operation_refused" && item.method==="tools/call"));
    assert.ok(!JSON.stringify(audit).includes("CANARY"));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const axe = await readFile(axePath, "utf8"); await page.evaluate(axe);
    assert.deepEqual((await page.evaluate(async()=>window.axe.run(document.querySelector("main"), {runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}}))).violations,[]);
    const inner = page.frames().find(frame=>frame.url()==="about:srcdoc"); await inner.evaluate(axe);
    assert.deepEqual((await inner.evaluate(async()=>window.axe.run(document, {runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}}))).violations,[]);
    if (process.env.PAPERCLIP_MCP_POC_SCREENSHOT) {
      await inner.locator("body").screenshot({path:`${process.env.PAPERCLIP_MCP_POC_SCREENSHOT}.app.png`});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.screenshot({path:process.env.PAPERCLIP_MCP_POC_SCREENSHOT,fullPage:true});
    }
    await page.getByRole("button",{name:"Close panel"}).click(); assert.equal(await page.locator("iframe").count(),0);
    assert.equal(await page.getByRole("button",{name:"Open isolated panel"}).evaluate(button=>button===document.activeElement),true);
  } finally { await context.close(); }
});
test("wrong-window messages and hash-substituted resources cannot initialize an app", async () => {
  const context = await browser.newContext(); const page = await context.newPage();
  try {
    await page.goto(poc.hostOrigin);
    await page.evaluate(()=>window.postMessage({jsonrpc:"2.0",method:"ui/notifications/sandbox-proxy-ready"},location.origin));
    assert.equal(await page.locator("iframe").count(),0);
    await page.route(`${poc.hostOrigin}/resource`,async route=>{
      const response=await route.fetch(); const resource=await response.json(); resource.text=resource.text.replace("Read-only synthetic panel","SUBSTITUTED HTML");
      await route.fulfill({response,json:resource});
    });
    await page.getByRole("button",{name:"Open isolated panel"}).click();
    await page.getByRole("status").filter({hasText:"Panel unavailable"}).waitFor();
    assert.equal(await page.locator("iframe").count(),0);
  } finally { await context.close(); }
});
test("message-budget exhaustion removes the iframe and permits a clean independent reopen", async () => {
  const context=await browser.newContext();const page=await context.newPage();
  try {
    const app=await panel(page); await app.getByRole("button",{name:"Exceed bridge message budget"}).click();
    await page.getByRole("status").filter({hasText:"Panel unavailable"}).waitFor(); assert.equal(await page.locator("iframe").count(),0);
    await page.getByRole("button",{name:"Open isolated panel"}).click();
    await page.getByRole("status").filter({hasText:"Isolated panel ready"}).waitFor();
    assert.ok((await page.evaluate(()=>window.pocAudit)).some(item=>item.code==="budget_exhausted"));
  } finally { await context.close(); }
});

test("a closed pending resource read cannot attach a frame after a newer open", async()=>{
  const context=await browser.newContext();const page=await context.newPage();
  let release, arrived;const delayed=new Promise(resolve=>release=resolve), started=new Promise(resolve=>arrived=resolve);let calls=0;
  try {
    await page.goto(poc.hostOrigin);
    await page.route(`${poc.hostOrigin}/resource`,async route=>{
      if(++calls===1){arrived();await delayed;}await route.continue();
    });
    await page.getByRole("button",{name:"Open isolated panel"}).click();await started;
    await page.getByRole("button",{name:"Close panel"}).click();
    await page.getByRole("button",{name:"Open isolated panel"}).click();
    await page.getByRole("status").filter({hasText:"Isolated panel ready"}).waitFor();
    release();await page.waitForLoadState("networkidle");assert.equal(await page.locator("iframe").count(),1);
  }finally{release();await context.close();}
});
