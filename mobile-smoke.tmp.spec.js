const { test, expect } = require('playwright/test');

const LIVE_URL = process.env.SMOKE_URL || 'https://nachogtavl-collab.github.io/ost-token/';

const ACTION_SELECTORS = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="tab"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function compactRect(rect) {
  if (!rect) return null;
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  locale: 'en-US'
});

test('mobile layout smoke', async ({ page }) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(9000);
  page.setDefaultNavigationTimeout(12000);
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.addInitScript(() => {
    try {
      localStorage.setItem('ost_prefs', JSON.stringify({ lang: 'en', currency: 'USD', welcomeVersion: 'readable-gate-v1' }));
      localStorage.setItem('ost.welcome.version', 'readable-gate-v1');
      localStorage.setItem('ost.tour.completed', '1');
      localStorage.setItem('ost.compartments.guideSeen.v1', '1');
      sessionStorage.setItem('ost.welcome.seen.session', '1');
    } catch (_) {}
  });

  await page.goto(`${LIVE_URL}?nopopup=1&mobile-smoke=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    if (window.OST_NUKE_OVERLAYS) window.OST_NUKE_OVERLAYS();
    const welcome = document.getElementById('welcomeOverlay');
    if (welcome) {
      welcome.classList.add('hidden');
      welcome.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('ost-welcome-open');
  });

  const baseline = await page.evaluate(({ ACTION_SELECTORS }) => {
    const ignoredOverflowSelectors = [
      'pre', 'code', 'table', 'iframe', 'canvas',
      '.commerce-filter-row', '.game-tabs', '.launch-ticker', '.ost-quick-nav',
      '.stock-market-lanes', '.wallet-tabs', '.wallet-segment', '.msx-tabs', '.ost-mesh-tabs'
    ];
    const isIgnoredOverflow = (el) => ignoredOverflowSelectors.some((selector) => el.matches(selector) || el.closest(selector));
    const labelFor = (el) => {
      const text = String(el.getAttribute('aria-label') || el.textContent || el.value || el.placeholder || el.id || el.className || el.tagName || '').replace(/\s+/g, ' ').trim();
      return text.slice(0, 90);
    };
    const rectOf = (el) => {
      const rect = el.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) !== 0;
    };
    const clickables = Array.from(document.querySelectorAll(ACTION_SELECTORS)).filter((el) => visible(el));
    const tiny = clickables
      .map((el) => ({ label: labelFor(el), tag: el.tagName.toLowerCase(), rect: rectOf(el), disabled: !!el.disabled }))
      .filter((item) => !item.disabled && (item.rect.width < 34 || item.rect.height < 34))
      .slice(0, 18);
    const overflows = Array.from(document.body.querySelectorAll('*')).filter((el) => visible(el) && !isIgnoredOverflow(el)).map((el) => ({
      label: labelFor(el),
      tag: el.tagName.toLowerCase(),
      className: String(el.className || '').slice(0, 80),
      rect: rectOf(el)
    })).filter((item) => item.rect.left < -2 || item.rect.right > window.innerWidth + 2).slice(0, 24);
    const fixed = Array.from(document.body.querySelectorAll('*')).filter((el) => visible(el) && ['fixed', 'sticky'].includes(getComputedStyle(el).position)).map((el) => ({
      label: labelFor(el),
      tag: el.tagName.toLowerCase(),
      className: String(el.className || '').slice(0, 80),
      rect: rectOf(el),
      zIndex: getComputedStyle(el).zIndex
    })).slice(0, 18);
    const buttons = Array.from(document.querySelectorAll('button')).filter((el) => visible(el)).length;
    const links = Array.from(document.querySelectorAll('a[href]')).filter((el) => visible(el)).length;
    return {
      title: document.title,
      url: location.href,
      viewport: { innerWidth, innerHeight, visualWidth: Math.round(window.visualViewport?.width || 0), visualHeight: Math.round(window.visualViewport?.height || 0) },
      media: { max390: matchMedia('(max-width: 390px)').matches, max600: matchMedia('(max-width: 600px)').matches, coarse: matchMedia('(pointer: coarse)').matches },
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      overflowX: document.documentElement.scrollWidth - innerWidth,
      buttons,
      links,
      tiny,
      overflows,
      fixed
    };
  }, { ACTION_SELECTORS });

  console.log('BASELINE', JSON.stringify(baseline, null, 2));
  expect(baseline.viewport.innerWidth).toBe(390);
  expect(baseline.overflowX).toBeLessThanOrEqual(2);

  const interactions = [];
  async function record(name, fn) {
    try {
      const value = await fn();
      interactions.push({ name, ok: true, value });
      console.log('INTERACTION_OK', name, String(JSON.stringify(value) || '').slice(0, 220));
    } catch (error) {
      interactions.push({ name, ok: false, error: error.message });
      console.log('INTERACTION_FAIL', name, error.message);
    }
  }

  await record('home CTAs visible', async () => {
    await expect(page.getByRole('link', { name: /Get OST Now/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Create Wallet/i })).toBeVisible();
    return true;
  });

  await record('quick nav wallet', async () => {
    await page.getByRole('button', { name: /^Wallet/i }).last().click();
    await expect(page.locator('#wallet')).toBeInViewport({ timeout: 8000 });
    return await page.evaluate(() => location.hash || document.elementFromPoint(20, 20)?.textContent?.slice(0, 40));
  });

  await record('commerce add cart', async () => {
    await page.locator('#commerce').scrollIntoViewIfNeeded();
    await page.locator('#storeProducts .btn-add').first().click();
    await expect(page.locator('#cartBadge')).toHaveText(/^[1-9]/);
    return await page.locator('#storeCart').textContent().then((text) => text.slice(0, 120));
  });

  await record('wallet tabs', async () => {
    await page.locator('#wallet').scrollIntoViewIfNeeded();
    await page.getByRole('tab', { name: /Market/i }).click();
    await page.getByRole('tab', { name: /Convert/i }).click();
    return await page.locator('#wallet [role="tabpanel"]').first().textContent({ timeout: 8000 }).then((text) => text.slice(0, 120));
  });

  await record('stock search and side', async () => {
    await page.locator('#stock-market').scrollIntoViewIfNeeded();
    await page.getByRole('searchbox', { name: /Search stock symbols/i }).fill('MSFT');
    await page.getByRole('button', { name: /^Sell$/i }).click();
    return await page.locator('#stock-market').textContent({ timeout: 8000 }).then((text) => text.includes('MSFT') && text.includes('Sell'));
  });

  await record('fair game switch', async () => {
    await page.getByRole('button', { name: /Crash Rocket curve/i }).first().click();
    await expect(page.getByRole('heading', { name: /Crash/i }).first()).toBeVisible({ timeout: 8000 });
    return true;
  });

  await record('Mesh opens and stacks', async () => {
    await page.evaluate(() => window.OST_MESH?.open?.());
    await page.waitForSelector('#ost-mesh-pavilion.is-open .ost-mesh-session', { timeout: 12000 });
    await page.waitForTimeout(800);
    return await page.evaluate(() => {
      const root = document.querySelector('#ost-mesh-pavilion');
      const session = document.querySelector('.ost-mesh-session');
      const grid = session ? getComputedStyle(session).gridTemplateColumns : null;
      const chromeHidden = ['.ost-dock', '#ghost-input-ring', '.ost-tradepop__launcher', '#ostCardFloatingBtn'].map((selector) => {
        const el = document.querySelector(selector);
        if (!el) return [selector, true, 'missing'];
        const cs = getComputedStyle(el);
        return [selector, cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0', `${cs.display}/${cs.visibility}/${cs.opacity}`];
      });
      return {
        grid,
        rootOverflow: root ? root.scrollWidth - root.clientWidth : null,
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
        chromeHidden,
        socialTabs: Array.from(document.querySelectorAll('.msx-tabs button')).map((button) => button.textContent.trim()).slice(0, 8)
      };
    });
  });

  await record('Mesh contacts profile accessible', async () => {
    await page.getByRole('button', { name: /Contacts/i }).click();
    await page.waitForTimeout(600);
    const text = await page.locator('#ost-mesh-pavilion').textContent();
    await page.getByRole('button', { name: /Profile/i }).click();
    await page.waitForTimeout(600);
    return { contactsVisible: /Contacts|Invite|peer|contact/i.test(text), profileVisible: /Profile|Bio|avatar|picture|QR/i.test(await page.locator('#ost-mesh-pavilion').textContent()) };
  });

  await record('OST Card modal', async () => {
    await page.evaluate(() => window.OST_MESH?.close?.()).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('#ostCardFloatingBtn').click();
    await page.waitForTimeout(800);
    return await page.evaluate(() => /OST Card|Apple Wallet|Google Wallet|tap-to-pay/i.test(document.body.textContent || ''));
  });

  await record('Ghost launcher', async () => {
    const ghost = page.getByRole('button', { name: /Open Ghost AI assistant/i });
    await ghost.click({ timeout: 8000 });
    await page.waitForTimeout(700);
    const closeBox = await page.locator('#ghost-close').boundingBox();
    await page.locator('#ghost-close').click();
    await expect(page.locator('#ghost-summoning-circle')).not.toHaveClass(/is-open/);
    return { opened: await page.evaluate(() => /Ghost AI|Ask OST|assistant/i.test(document.body.textContent || '')), closeBox };
  });

  await record('Launchpad tabs', async () => {
    await page.locator('#launchpad').scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: /Trending/i }).first().click();
    await page.getByRole('button', { name: /Leaderboard/i }).first().click();
    return await page.locator('#launchpad').textContent({ timeout: 8000 }).then((text) => /Coins|Leaderboard|TVL/i.test(text));
  });

  await record('Survival controls', async () => {
    await page.locator('#survival').scrollIntoViewIfNeeded();
    await page.locator('#survival').getByRole('button', { name: /^100$/ }).click();
    await page.locator('#survival .sv-fmt[data-fmt="paper"]').click();
    return await page.locator('#survival').textContent({ timeout: 8000 }).then((text) => /100|Paper QR|Bearer/i.test(text));
  });

  await record('Quantum buttons', async () => {
    await page.locator('#quantum-realm').scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: /Entangle Wallets/i }).click();
    await page.getByRole('button', { name: /Collapse State/i }).click();
    return await page.locator('#quantum-realm').textContent({ timeout: 8000 }).then((text) => /Entangled|Coherence|Quantum/i.test(text));
  });

  const finalAudit = await page.evaluate(({ ACTION_SELECTORS }) => {
    const labelFor = (el) => String(el.getAttribute('aria-label') || el.textContent || el.value || el.placeholder || el.id || el.className || el.tagName || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    const rectOf = (el) => {
      const rect = el.getBoundingClientRect();
      return { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) !== 0;
    };
    const clickables = Array.from(document.querySelectorAll(ACTION_SELECTORS)).filter((el) => visible(el));
    const tiny = clickables.map((el) => ({ label: labelFor(el), tag: el.tagName.toLowerCase(), rect: rectOf(el), disabled: !!el.disabled })).filter((item) => !item.disabled && (item.rect.width < 34 || item.rect.height < 34)).slice(0, 40);
    return {
      overflowX: document.documentElement.scrollWidth - innerWidth,
      meshOpen: !!document.querySelector('#ost-mesh-pavilion.is-open'),
      tiny,
      consoleErrors: []
    };
  }, { ACTION_SELECTORS });

  console.log('INTERACTIONS', JSON.stringify(interactions, null, 2));
  console.log('FINAL_AUDIT', JSON.stringify(finalAudit, null, 2));
  console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors.slice(0, 30), null, 2));

  const failed = interactions.filter((item) => !item.ok);
  expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  expect(finalAudit.overflowX).toBeLessThanOrEqual(2);
});
