// One-off screenshot helper: node scripts/shot.mjs <url-hash-or-empty> <out.jpg> [tabLabelToClick]
import puppeteer from 'puppeteer-core'
const APP = process.env.APP_URL ?? 'https://weifish0.github.io/ember-almanac/'
const [hash = '', out = 'out/shot.jpg', tab] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars'] })
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
await page.goto(APP + hash, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__emberMap && window.__emberMap.getSource('fire'), { timeout: 60000 })
if (hash) await page.waitForSelector('.report', { timeout: 120000 })
if (tab) await page.evaluate((t) => [...document.querySelectorAll('.seg button')].find((b) => b.textContent.trim() === t)?.click(), tab)
await page.evaluate(() => new Promise((r) => { const m = window.__emberMap; const t = setTimeout(r, 12000); m.once('idle', () => { clearTimeout(t); r() }); m.triggerRepaint() }))
await new Promise((r) => setTimeout(r, 2500))
await page.screenshot({ path: out, type: 'jpeg', quality: 85 })
await browser.close()
