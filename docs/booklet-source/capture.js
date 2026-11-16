// Captures app screens for the sales booklet at print resolution (deviceScaleFactor 2).
const { chromium } = require('playwright');
const base = 'http://localhost:3000';
const OUT = __dirname + '/img/';
const ids = { mr: 'cmwi5li6h006413opa0fzie09', att: 'cmwi4dxn3000z11ahsv57gluh', wd: 'cmwj1dc6v002aeby9ymgo2tyh', cv: 'cmwj2qr9v001acleopjw8arut', alb: 'cmwj2r4r2002gcleoy7jz2xq8' };

async function session(b, user, pw, mobile) {
  const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Asia/Karachi' } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, timezoneId: 'Asia/Karachi' });
  // Show the app at 10:30 in the morning, school time.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
  await ctx.clock.setFixedTime(new Date(today + 'T10:30:00+05:00'));
  const p = await ctx.newPage();
  await p.goto(base + '/login');
  await p.fill('input[autocomplete=username]', user);
  await p.fill('input[autocomplete=current-password]', pw);
  await p.click('button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'));
  return p;
}
async function shot(p, path, name, { wait = 2200, full = false, before } = {}) {
  await p.goto(base + path);
  await p.waitForTimeout(wait);
  await p.evaluate(() => {
    document.querySelectorAll('div').forEach((d) => {
      if (/^Free trial ends/.test(d.textContent?.trim() ?? '') && d.children.length === 0) d.remove();
    });
  });
  if (before) await before(p);
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + name + '.png', fullPage: full });
  console.log('ok', name);
}

(async () => {
  const b = await chromium.launch();
  const pr = await session(b, 'ayesha', 'Principal123');
  await shot(pr, '/school', 'dashboard');
  await shot(pr, '/school/fees', 'fees');
  await shot(pr, '/rankings', 'rankings', { before: async (p) => { await p.fill('input[type=month]', '2026-11'); await p.locator('input[type=month]').blur(); await p.waitForTimeout(1500); } });
  await shot(pr, '/admissions', 'admissions');
  await shot(pr, '/circulars?id=' , 'circulars');
  await shot(pr, '/syllabus', 'syllabus', { before: async (p) => { await p.click('[role=tab]:has-text("Coverage report")'); await p.waitForTimeout(1200); } });
  await shot(pr, '/honors', 'honors');
  await shot(pr, '/gallery', 'gallery');
  await shot(pr, '/reports', 'reports');
  await shot(pr, `/withdrawals/${ids.wd}/certificate`, 'certificate');
  await shot(pr, '/school/attendance', 'attendance-school');
  await shot(pr, '/school/exams', 'exams');

  const t = await session(b, 'city-grammar-school.e001', 'Teacher123');
  await shot(t, '/home', 'teacher');
  await shot(t, '/home/attendance', 'attendance-mark', { before: async (p) => { await p.click('button:has-text("Class 5 – A")'); await p.waitForTimeout(1500); } });
  await shot(t, '/chat', 'chat');
  await shot(t, '/homework', 'homework-teacher');

  const pm = await session(b, 'city-grammar-school.p0001', 'Parent1234', true);
  await shot(pm, '/home', 'm-parent-home');
  await shot(pm, '/home/homework?date=2026-11-17', 'm-parent-homework');
  await shot(pm, `/monthly-reports/${ids.mr}`, 'm-monthly-report');
  await shot(pm, `/conversations?c=${ids.cv}`, 'm-conversation');
  await shot(pm, '/home/fees', 'm-fees');
  await shot(pm, '/home/results', 'm-results');
  await shot(pm, '/notifications', 'm-notifications');

  const sm = await session(b, 'city-grammar-school.20260001', 'Student123', true);
  await shot(sm, `/home/online-exams/result/${ids.att}`, 'm-online-result');
  await shot(sm, '/chat', 'm-chat');
  await b.close();
})();
