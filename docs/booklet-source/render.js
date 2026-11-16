const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + __dirname + '/booklet.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: __dirname + '/../School-Management-System-Booklet.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close();
})();
