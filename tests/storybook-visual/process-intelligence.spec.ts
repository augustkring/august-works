import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect,test,type Page } from "@playwright/test";
const require=createRequire(import.meta.url);
const addon=require.resolve("@storybook/addon-a11y/package.json",{paths:[fileURLToPath(new URL("../../ui",import.meta.url))]});
const axeScript=require.resolve("axe-core/axe.min.js",{paths:[dirname(addon)]});
async function accessibility(page:Page) {
  await page.addScriptTag({path:axeScript});
  const violations=await page.evaluate(async()=>{
    const axe=(window as unknown as {axe:{run:(context:HTMLElement,options:object)=>Promise<{violations:unknown[]}>}}).axe;
    const deadline=performance.now()+10000;
    for(;;) try {
      return (await axe.run(document.getElementById("storybook-root")!,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations;
    } catch(error) {
      // Storybook's native addon may be auditing this same DOM. Serialize the
      // manual audit; never swallow a rule violation or another audit error.
      if(!(error instanceof Error) || !error.message.includes("Axe is already running") || performance.now()>=deadline) throw error;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  });expect(violations).toEqual([]);
}
for(const theme of ["light","dark"]) for(const width of [390,1200]) for(const state of ["published","draft","needs-review","inconclusive","conformance"]) {
  test(`process ${state} ${theme} at ${width}px preserves native human review and readiness`,async({page},info)=>{
    await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width,height:1000});
    await page.goto(`/iframe.html?id=business-intelligence-process-intelligence--${state}&viewMode=story&globals=theme:${theme}`);
    await page.getByRole("button",{name:"Inspect process",exact:true}).click();
    const panel=page.getByRole("region",{name:"Inspect process definition"});await expect(panel).toBeVisible();
    await expect(panel.getByRole("button",{name:"Publish selected version"})).toBeDisabled();
    const summary=panel.getByText("Inspect immutable definition",{exact:true});await summary.focus();await page.keyboard.press("Space");
    await expect(panel.locator("pre").first()).toContainText('"governanceObligationRefs"');
    if(state==="published" || state==="inconclusive" || state==="conformance") {
      await page.getByLabel("Retained process run",{exact:true}).selectOption("00000000-0000-4000-8000-000000000005");
      const result=page.getByRole("region",{name:"Observed process result"});await expect(result).toBeVisible();
      await expect(result).toContainText("does not estimate causal effects or score people");
      if(state==="published" || state==="conformance") {
        await expect(result).toContainText("60 s");await expect(result).toContainText("Observed reopening");
        const edges=result.getByText("Directly follows (2)",{exact:true});await edges.focus();await page.keyboard.press("Space");
        await expect(result.getByRole("table")).toContainText("Task updated / blocked");
        if(state==="conformance") {
          const model=result.getByRole("region",{name:"Explicit process conformance"});await expect(model).toContainText("1 with observed deviations");
          await model.getByText("Inspect comparison model",{exact:true}).click();await expect(model).toContainText("Required visits: in_review");
        }
      } else {await expect(result).toContainText("No process statistics are published");await expect(result).toContainText("source coverage");await expect(result.getByRole("heading",{name:"Task perspective"})).toHaveCount(0);}
      const findings=page.getByRole("region",{name:"Process findings",exact:true});await expect(findings).toBeVisible();
      await findings.getByRole("button",{name:"Inspect finding",exact:true}).click();
      const review=findings.getByRole("region",{name:"Inspect process finding",exact:true});
      await expect(review.getByRole("button",{name:"Acknowledge finding"})).toBeDisabled();
      await expect(review.getByRole("button",{name:"Resolve finding"})).toHaveCount(0);
      const facts=review.getByText("Inspect finding facts and limitations",{exact:true});await facts.focus();await page.keyboard.press("Space");
      await expect(review.locator("pre")).toContainText("human_process_interpretation_of_observed_facts");
      await review.getByLabel("Finding review reason",{exact:true}).fill("Human acknowledges the retained process evidence");
      await expect(review.getByRole("button",{name:"Acknowledge finding"})).toBeEnabled();
      await expect(review.getByRole("button",{name:"Suppress with reason"})).toBeEnabled();
      const proposal=findings.getByRole("form",{name:"Record process finding"});await expect(proposal.getByRole("button",{name:"Record finding",exact:true})).toBeDisabled();
      await proposal.getByLabel("Finding human interpretation",{exact:true}).fill("Investigate the qualified process facts with the native owner");
      await expect(proposal.getByRole("button",{name:"Record finding",exact:true})).toBeEnabled();
    }
    if(state==="draft" || state==="needs-review") await expect(panel.getByRole("form",{name:"Run published process"})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await accessibility(page);
    await page.screenshot({path:info.outputPath(`process-${state}-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
  });
}
for(const theme of ["light","dark"]) for(const width of [390,1200]) {
  test(`process proposal ${theme} at ${width}px separates source requirements and publication`,async({page},info)=>{
    await page.route("**/api/**",route=>route.abort());await page.setViewportSize({width,height:1100});
    await page.goto(`/iframe.html?id=business-intelligence-process-intelligence--operator&viewMode=story&globals=theme:${theme}`);
    await page.getByRole("button",{name:"Propose a process",exact:true}).click();const form=page.getByRole("form",{name:"Process definition proposal"});
    await expect(form.getByRole("button",{name:"Save process proposal"})).toBeDisabled();
    await form.getByLabel("Definition name",{exact:true}).fill("Recorded delivery evidence review");await form.getByLabel("Business question",{exact:true}).fill("Which recorded native Task paths reach their first completion?");
    await form.getByLabel("Approved process purpose",{exact:true}).selectOption({label:"Approved advisory process purpose"});
    await expect(form.getByRole("button",{name:"Save process proposal"})).toBeEnabled();
    await form.getByRole("checkbox",{name:"Explicit process conformance",exact:true}).check();
    await expect(form.getByRole("button",{name:"Save process proposal"})).toBeDisabled();
    await form.getByRole("checkbox",{name:"Tasks expected start todo",exact:true}).check();await form.getByRole("checkbox",{name:"Tasks expected terminal done",exact:true}).check();
    await form.getByLabel("Tasks transition from",{exact:true}).selectOption("todo");await form.getByLabel("Tasks transition to",{exact:true}).selectOption("done");await form.getByRole("button",{name:"Add tasks transition",exact:true}).click();
    await expect(form.getByRole("button",{name:"Save process proposal"})).toBeEnabled();
    await form.getByRole("switch",{name:"Require arrival evidence"}).focus();await page.keyboard.press("Space");
    await expect(form).toContainText("no qualified transport-arrival evidence");
    await expect(form).toContainText("Publication requires a separate human review");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await accessibility(page);
    await page.screenshot({path:info.outputPath(`process-proposal-${theme}-${width}.png`),fullPage:true,animations:"disabled"});
  });
}
