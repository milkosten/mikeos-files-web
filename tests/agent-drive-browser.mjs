// Run against npm run dev. Supply PLAYWRIGHT_MODULE if Playwright is installed elsewhere.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
let shared;
for(const width of [320,390,1440]) {
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.route('**/auth/me',r=>r.fulfill({json:{authenticated:true,user:{email:'mikaelwestoo@osmike.com'}}}));
 await page.route('**/drive-api/**',async r=>{
 const u=new URL(r.request().url());let data={};
 if(u.pathname.endsWith('/agent-permissions')) {if(r.request().method()==='POST'){shared=r.request().postDataJSON();data={id:'grant',...shared};}else data={permissions:[]};}
 else if(u.pathname.endsWith('/permissions')) {if(r.request().method()==='POST')shared=r.request().postDataJSON();data={owner:{user_id:'mike',display_name:'Mike'},grants:[],link:{enabled:false}};}
 else if(u.pathname.endsWith('/agents'))data={agents:[{agent_id:'email-mikaelwestoo',name:'Email agent'}]};
 else if(u.pathname.endsWith('/views'))data={views:[{id:'saved',name:'Bergsjön',tags:['home:bergsjon'],metadata:{}}]};
 else if(u.pathname.endsWith('/folders'))data={folders:[{id:'agents',name:'Agents',parent_id:null},{id:'agent',name:'email-mikaelwestoo',parent_id:'agents'}]};
 else if(u.pathname.endsWith('/files'))data={files:[{id:'file',name:'Property document.pdf',mime:'application/pdf',size:100,folder_id:'agent',tags:['home:bergsjon','source:email'],created_by_agent:'email-mikaelwestoo',my_role:'owner'},{id:'other',name:'Other.pdf',mime:'application/pdf',tags:['other'],my_role:'owner'}]};
 await r.fulfill({json:data});});
 await page.goto('http://127.0.0.1:5173');
 await page.locator('.filerow .name').filter({hasText:'Other.pdf'}).waitFor();
 if(width<760)await page.getByRole('button',{name:'Folders & views'}).click();
 await page.getByRole('button',{name:'Bergsjön',exact:true}).click();
 await page.getByText('Created by email-mikaelwestoo',{exact:true}).waitFor();
 await page.getByRole('button',{name:'home:bergsjon',exact:true}).first().click();
 if(await page.locator('.filerow .name').filter({hasText:'Other.pdf'}).count())throw Error('Tag filter failed');
 await page.locator('.filerow:not(.head)').first().hover();
 await page.locator('button[title="Share"]').first().click();
 await page.getByLabel('Recipient type').selectOption('agent');
 await page.getByLabel('Agent recipient').fill('email-mikaelwestoo');
 await page.getByRole('dialog').getByRole('button',{name:'Share',exact:true}).click();
 await page.waitForTimeout(100);
 if(shared?.principal_type!=='agent'||shared.principal_id!=='email-mikaelwestoo')throw Error('Share payload');
 await page.keyboard.press('Escape');
 if(await page.getByRole('dialog').count())throw Error('Escape failed');
 if(await page.evaluate(()=>document.activeElement?.getAttribute('data-focus-key'))!=='share-file')throw Error('Focus return failed');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 if(overflow)throw Error('Overflow '+width);
 await page.screenshot({path:`/tmp/files-ui-${width}.png`,fullPage:true});
 console.log(JSON.stringify({width,tagFilter:true,agentShare:true,escape:true,horizontalOverflow:false}));
 await page.close();
}
await browser.close();
