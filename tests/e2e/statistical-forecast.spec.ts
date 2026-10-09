import {expect,test} from "@playwright/test";
import {createRequire} from "node:module";
import {analyticalPurpose,metricDefinition} from "../../server/src/__tests__/helpers/business-metric-fixture.ts";
import {json} from "./agent-chat.shared";
const axePath=createRequire(import.meta.url).resolve("axe-core/axe.min.js");
test.setTimeout(120000);
// Actual shipped local-trusted UI/API and pinned numerical worker. No collected
// historical data, actual Human/pilot trial or customer forecast skill claimed.
test("a native operator proposes an exact statistical version without publication or canonical changes",async({page,request},info)=>{
 const original=await json(await request.get("/api/instance/settings/experimental"));
 try {
  await json(await request.patch("/api/instance/settings/experimental",{data:{analytical_lineage_v8:true,business_metrics_v8:true,business_forecasting_v8:true,forecast_provider_statsforecast_v8:true,ai_use_cases_v7:true,governance_evidence_v7:true}}));
  const company=await json(await request.post("/api/companies",{data:{name:"Native statistical forecast software fixture"}}));
  const task=await json(await request.post(`/api/companies/${company.id}/issues`,{data:{title:"Independent native Task",status:"todo"}}));
  const purpose=analyticalPurpose();purpose.analyticalPurpose!.capabilities=["metrics","forecast"];
  const policy=await json(await request.post(`/api/companies/${company.id}/governance-obligations`,{data:purpose}));
  const definition=metricDefinition(policy.id);definition.valueType="count";definition.unit="objects";definition.calculation={kind:"native_count",population:{entity:"issue",statuses:["done"],projectId:null}};
  const metric=await json(await request.post(`/api/companies/${company.id}/business-metrics`,{data:{key:"native_task_volume",definition}}));
  await json(await request.post(`/api/companies/${company.id}/business-metrics/${metric.metric.id}/publish`,{data:{expectedRevision:1,versionId:metric.version.id}}));
  const endpoint=`/api/companies/${company.id}/business-forecasts`;
  const profile=await json(await request.get(`${endpoint}/provider-profile`));expect(profile.models).toEqual(["auto_ets","auto_arima"]);
  await page.setViewportSize({width:390,height:844});await page.goto(`/${company.issuePrefix}/business-forecasts`);await page.getByRole("button",{name:"Define a forecast",exact:true}).click();
  const form=page.getByRole("form",{name:"Forecast definition proposal",exact:true});
  for(const [label,value] of [["Forecast key","statistical_capacity"],["Forecast name","Statistical capacity review"],["Business question","Which workload should a separate human capacity review consider?"],["Decision use","Support the separate Human planning decision"],["Known failure modes (one per line)","Model interval empirical company coverage remains unestablished"]]) await form.getByRole("textbox",{name:label,exact:true}).fill(value);
  await form.getByRole("combobox",{name:"Published native metric",exact:true}).selectOption(metric.metric.id);await form.getByRole("combobox",{name:"Approved forecast purpose",exact:true}).selectOption(policy.id);await form.getByRole("combobox",{name:"Native candidate model",exact:true}).selectOption("auto_ets");await form.getByRole("spinbutton",{name:"Declared seasonal periods",exact:true}).fill("1");
  await expect(form).toContainText("empirical coverage on company history is not established");await expect(form.getByRole("button",{name:"Save forecast proposal",exact:true})).toBeEnabled();
  await page.addScriptTag({path:axePath});
  for(const theme of ["light","dark"] as const) for(const width of [390,1200]) {
   await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme:theme});await expect.poll(()=>page.evaluate(()=>document.documentElement.style.colorScheme)).toBe(theme);
   await page.evaluate(async()=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));await Promise.all(document.getAnimations().filter(animation=>Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))).map(animation=>animation.finished.catch(()=>undefined)));});
   const violations=await page.evaluate(async()=>{const w=window as unknown as {axe:{run:(context:string,options:unknown)=>Promise<{violations:unknown[]}>}};return(await w.axe.run('form[aria-label="Forecast definition proposal"]',{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa","wcag22aa"]}})).violations;});expect(violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(`native-statistical-definition-${theme}-${width}.png`),fullPage:true});
  }
  const saved=page.waitForResponse(response=>response.url().includes(endpoint)&&response.request().method()==="POST");await form.getByRole("button",{name:"Save forecast proposal",exact:true}).click();const proposal=await json(await saved);
  expect(proposal.spec).toMatchObject({status:"draft",publishedVersionId:null});expect(proposal.version.definition).toMatchObject({provider:"statsforecast",providerProfile:profile.profile,candidate:{kind:"auto_ets",seasonLength:1},metricVersionId:metric.version.id,baselines:[{kind:"naive"}]});
  expect((await json(await request.get(`${endpoint}/${proposal.spec.id}/backtests`))).items).toEqual([]);expect((await json(await request.get(`${endpoint}/${proposal.spec.id}/runs`))).items).toEqual([]);
  expect(await json(await request.get(`/api/issues/${task.id}`))).toMatchObject({status:"todo",plannedStartAt:null,plannedEndAt:null});
 } finally {await json(await request.patch("/api/instance/settings/experimental",{data:original}));}
});
