// Run against npm run dev; uses API fixtures, never modifies a real account.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({args:['--no-sandbox']});
try {
 for (const width of [320,390,1440]) {
  const context = await browser.newContext({viewport:{width,height:900},colorScheme:'light'});
  const page = await context.newPage(); let user='appearance-test';
  await page.route('**/auth/me',r=>r.fulfill({json:{authenticated:true,user:{sub:user,email:user+'@example.test'}}}));
  await page.route('**/drive-api/**',r=>r.fulfill({json:{files:[],folders:[],views:[]}}));
  await page.goto('http://127.0.0.1:5173/settings');
  const select=page.getByRole('radio',{name:'System',exact:true});
  const choose = mode => page.getByRole('radio',{name:mode,exact:true}).check();
  async function check(mode) {await page.waitForFunction(mode=>document.documentElement.dataset.theme===mode,mode);}
  await select.waitFor(); if(!(await select.isChecked()))throw Error('Default'); await check('light');
  await page.emulateMedia({colorScheme:'dark'}); await check('dark');
  await choose('Light'); await check('light'); await page.reload(); await select.waitFor(); await check('light');
  await page.emulateMedia({colorScheme:'light'}); await choose('Dark'); await check('dark');
  await page.reload(); await select.waitFor(); await check('dark');
  await page.getByRole('radio',{name:'Dark',exact:true}).focus(); await page.keyboard.press('Tab'); if(await page.evaluate(()=>document.activeElement.textContent)!=='Done')throw Error('Keyboard navigation');
  await page.getByRole('link',{name:'Done',exact:true}).click(); await page.getByLabel('Account',{exact:true}).click();
  await page.getByRole('link',{name:'Settings',exact:true}).click(); await select.waitFor(); await check('dark');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow '+width);
  user='another-user'; await page.reload(); await select.waitFor(); await check('light'); if(!(await select.isChecked()))throw Error('User isolation');
  console.log(JSON.stringify({width,systemLive:true,explicitOverride:true,reload:true,userIsolation:true,keyboard:true,overflow:false}));
  await context.close();
 }
} finally { await browser.close(); }
