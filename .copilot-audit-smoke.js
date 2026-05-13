const { chromium } = require('playwright');

(async () => {
  const bad = [];
  const consoleErrors = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3
  });

  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) bad.push({ status, url: response.url() });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('http://127.0.0.1:4173/?audit=local-actions-v2', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await page.waitForTimeout(5000);

  const report = await page.evaluate(() => {
    const safeText = (el) => {
      const raw = el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '';
      return raw.replace(/\s+/g, ' ').trim();
    };
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const anchors = [...document.querySelectorAll('a')].filter(visible).map((anchor) => ({
      text: safeText(anchor).slice(0, 70),
      id: anchor.id,
      hrefAttr: anchor.getAttribute('href'),
      href: anchor.href
    }));
    const deadAnchors = anchors.filter((anchor) => !anchor.hrefAttr || anchor.hrefAttr === '#' || /^javascript:/i.test(anchor.hrefAttr));
    const scripts = [...document.scripts].map((script) => script.getAttribute('src')).filter(Boolean);
    const ticker = document.querySelector('.ix-live-ticker');
    const treasury = document.querySelector('#fhRevDashboard .fh-card[style*="grid-column"] div:nth-child(2)');
    const duckRefs = [...document.images].filter((image) => (image.currentSrc || image.src).includes('duckduckgo')).length;
    return {
      viewport: { vw: innerWidth, vh: innerHeight },
      scripts: {
        app: scripts.some((src) => src.includes('app.js?v=139')),
        ads: scripts.some((src) => src.includes('faucet-hub-ads.js?v=100')),
        quick: scripts.some((src) => src.includes('shop-quickview.js?v=3')),
        inter: scripts.some((src) => src.includes('interchange-live.js?v=2')),
        card: scripts.some((src) => src.includes('ost-card.js?v=7')),
        trenches: scripts.some((src) => src.includes('launchpad-trenches.js?v=4'))
      },
      deadAnchors: deadAnchors.slice(0, 30),
      sampleTicker: Boolean(ticker),
      sampleTickerLabel: ticker ? getComputedStyle(ticker, '::before').content : '',
      adTreasuryText: treasury ? treasury.textContent : '',
      duckRefs
    };
  });

  report.badResponses = bad.slice(0, 30);
  report.consoleErrors = consoleErrors.slice(0, 20);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
