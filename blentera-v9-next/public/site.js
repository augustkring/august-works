(function(){
  const button=document.querySelector('[data-menu-toggle]');
  const nav=document.getElementById('mobile-navigation');
  function close(){if(!button||!nav)return;nav.hidden=true;button.setAttribute('aria-expanded','false');}
  if(button&&nav){button.addEventListener('click',()=>{const expanded=button.getAttribute('aria-expanded')==='true';nav.hidden=expanded;button.setAttribute('aria-expanded',String(!expanded));});
   nav.addEventListener('click',event=>{if(event.target.closest('a'))close();});
   document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!nav.hidden){close();button.focus();}});
  }
  const roles={
   cto:{name:'Chief Technology Officer',label:'Technology',mission:'Coordinates the technical work needed to build, connect and maintain systems.',teams:[['Engineering','Build and integrate the right software.'],['Quality & Testing','Verify the release against defined requirements.'],['Platform & Security','Keep access, reliability and runtime boundaries clear.']],handoff:'Receives an integration brief from the Chief of Staff; returns a tested implementation plan for human approval.'},
   coo:{name:'Chief Operating Officer',label:'Operations',mission:'Turns goals into reliable processes across teams and connected systems.',teams:[['Process Design','Map the steps and review the exceptions.'],['Business Operations','Coordinate systems, owners and handoffs.'],['Delivery & QA','Track outcomes and escalate blocked work.']],handoff:'Receives approved work, delegates steps and returns operational exceptions to a human owner.'},
   cmo:{name:'Chief Marketing Officer',label:'Growth',mission:'Connects market research, content and distribution to one measurable goal.',teams:[['Research & Positioning','Understand an audience and its buying situation.'],['Content','Prepare clear campaigns for human review.'],['Distribution','Test channels and report what worked.']],handoff:'Coordinates marketing specialists for a market launch and shares evidence with Finance before a decision.'},
   cfo:{name:'Chief Financial Officer',label:'Finance',mission:'Makes commercial assumptions, costs and financial trade-offs explicit.',teams:[['Forecasting','Model scenarios and underlying assumptions.'],['Reporting','Prepare an auditable financial view.'],['Controls','Flag budget limits and spending thresholds.']],handoff:'Returns assumptions and downside scenarios to the human economic decision maker.'},
   cpo:{name:'Chief Product Officer',label:'Product',mission:'Connects customer needs to testable product priorities and results.',teams:[['Discovery','Capture the problem and evidence.'],['Specification','Define scope and acceptance criteria.'],['Evaluation','Compare outcomes against the original need.']],handoff:'Receives customer evidence and routes technical work to the CTO while keeping the product owner informed.'},
   cro:{name:'Chief Revenue Officer',label:'Sales',mission:'Turns qualified opportunities into well-prepared, accountable commercial work.',teams:[['Pipeline','Qualify leads and update deal context.'],['Outreach','Prepare personalised messages for approval.'],['Account Planning','Coordinate follow-ups and handoffs.']],handoff:'Aligns Sales with Growth and Customer Success; the human owner approves commercial commitments.'},
   ciso:{name:'Chief Information Security Officer',label:'Security',mission:'Keeps authority, access and review requirements visible across AI activity.',teams:[['Access & Policy','Define roles and permission scopes.'],['Risk & Review','Evaluate sensitive actions and exceptions.'],['Audit & Response','Retain evidence and investigate issues.']],handoff:'Reviews high-impact operations; approval remains a separate human-controlled decision.'},
   cco:{name:'Chief Customer Officer',label:'Customer success',mission:'Connects onboarding, support and lasting customer outcomes.',teams:[['Onboarding','Help new people and agents start with company context.'],['Support','Triage questions and escalate exceptions.'],['Retention','Surface recurring value and unresolved needs.']],handoff:'Shares recurring support patterns with Product so reviewed improvements can become a standard.'}
  };
  const explorer=document.getElementById('org-explorer');
  if(explorer){
   const buttons=[...explorer.querySelectorAll('[data-role]')];
   const title=document.getElementById('role-name');const mission=document.getElementById('role-mission');const teams=document.getElementById('role-teams');const handoff=document.getElementById('role-handoff');const chosen=document.getElementById('role-category');
   function update(id){const entry=roles[id];if(!entry)return;buttons.forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.role===id)));title.textContent=entry.name;mission.textContent=entry.mission;chosen.textContent=entry.label;teams.replaceChildren(...entry.teams.map(([name,detail])=>{const row=document.createElement('div');row.className='team-row';const strong=document.createElement('strong');strong.textContent=name;const p=document.createElement('p');p.textContent=detail;row.append(strong,p);return row;}));handoff.textContent=entry.handoff;}
   buttons.forEach(btn=>btn.addEventListener('click',()=>update(btn.dataset.role)));
   const known=(new URLSearchParams(location.search)).get('role');update(known && roles[known]?known:'cto');
  }
})();
