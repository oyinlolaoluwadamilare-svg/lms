import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';

const login = async (page, email) => {
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', 'wfg2026');
  await page.click('button[type=submit]');
  await page.waitForURL((url) => !url.pathname.includes('login'), { timeout: 15000 });
};

const run = async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // Full cycle on Resourcing Q1, currently 'submitted' in the seed:
  // EMT returns it -> operator resubmits -> EMT signs off.
  const emt = await (await browser.newContext()).newPage();
  await login(emt, 'emt@wfg.demo');
  await emt.goto(`${BASE}/review`);
  await emt.getByRole('link', { name: 'Workforce Resourcing' }).first().click();
  await emt.waitForURL('**/review/**');
  await emt.getByLabel('Comment').fill('Quantify the pipeline rebuild before we sign off.');
  await emt.getByRole('button', { name: 'Return to unit' }).click();
  await emt.waitForURL('**/review', { timeout: 15000 });
  console.log('EMT return OK');

  const op = await (await browser.newContext()).newPage();
  await login(op, 'resourcing@wfg.demo');
  await op.goto(`${BASE}/report?period=q1`);
  await op.getByText('Returned by the EMT: Quantify the pipeline rebuild').waitFor();
  console.log('operator sees returned comment OK');
  const note = op.getByLabel('Reporting note');
  await note.fill(
    'Q1 restated: core pipeline was 25% below plan; the bulk placement added N18m one-off. Rebuild plan now quantified at N32m of weighted pipeline by Q3.',
  );
  await op.getByRole('button', { name: 'Submit for review' }).click();
  await op.getByText('Submitted for EMT review.').waitFor({ timeout: 15000 });
  console.log('operator resubmit OK');

  await emt.goto(`${BASE}/review`);
  await emt.getByRole('link', { name: 'Workforce Resourcing' }).first().click();
  await emt.waitForURL('**/review/**');
  await emt.getByText('Q1 restated').waitFor();
  await emt.getByLabel('Rating').selectOption('3');
  await emt.getByLabel('Comment').fill('Signed off on the restated basis. Watch time to fill.');
  await emt.getByRole('button', { name: 'Sign off' }).click();
  await emt.waitForURL('**/review', { timeout: 15000 });
  console.log('EMT sign off OK');

  // Operator should now see the approved state.
  await op.goto(`${BASE}/report?period=q1`);
  await op.getByText(/Signed off with a rating of 3 of 5/).waitFor();
  console.log('operator sees signed-off state OK');

  await browser.close();
  console.log('E2E REVIEW FLOW PASSED');
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
