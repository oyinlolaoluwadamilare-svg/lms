import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const run = async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext()).newPage();
  const fail = (msg) => {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  };

  // 1. Login as operator
  await page.goto(`${BASE}/login`);
  await page.fill('#email', 'consulting@wfg.demo');
  await page.fill('#password', 'wfg2026');
  await page.click('button[type=submit]');
  await page.waitForURL('**/report**', { timeout: 15000 });
  console.log('login -> /report OK');

  // 2. Enter a July actual for Advisory revenue and save (month pinned so
  // the test is deterministic regardless of what is already reported)
  await page.goto(`${BASE}/report?m=7`);
  const input = page.getByLabel('Advisory revenue actual for Jul');
  await input.fill('21.5');
  // Live attainment should appear before saving (21.5 / 19.8 = 108.59 -> 109%)
  const row = page.locator('tr', { has: input });
  await row.getByText('109%').waitFor({ timeout: 5000 });
  console.log('live attainment OK');
  await page.getByRole('button', { name: /Save Jul actuals/ }).click();
  await page.getByText(/Saved at/).waitFor({ timeout: 15000 });
  console.log('save actuals OK');

  // 3. Reload and confirm persistence
  await page.reload();
  const val = await page.getByLabel('Advisory revenue actual for Jul').inputValue();
  if (val !== '21.5') fail(`expected persisted 21.5, got ${val}`);
  else console.log('persistence OK');

  // 4. Submit Q3 (fresh period, no existing submission)
  await page.goto(`${BASE}/report?period=q3`);
  await page.getByLabel('Reporting note').fill('July opened ahead of plan on advisory revenue.');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.getByText('Submitted for EMT review.').waitFor({ timeout: 15000 });
  console.log('submit period OK');

  // 5. Confirm locked state after submit
  await page.reload();
  await page.getByText('With the EMT for review').waitFor({ timeout: 10000 });
  console.log('locked state OK');

  // 6. Clean up: revert the test actual so the demo dataset stays Jan-Jun
  await page.goto(`${BASE}/report?m=7`);
  await page.getByLabel('Advisory revenue actual for Jul').fill('');
  await page.getByRole('button', { name: /Save Jul actuals/ }).click();
  await page.getByText(/Saved at/).waitFor({ timeout: 15000 });
  console.log('cleanup actual OK');

  await browser.close();
  console.log(process.exitCode ? 'E2E FAILED' : 'E2E OPERATOR FLOW PASSED');
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
