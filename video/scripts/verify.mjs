// Smoke test of the deployed app: loads presets, checks for errors, saves screenshots.
import puppeteer from 'puppeteer-core'
const APP = process.env.APP_URL ?? 'https://weifish0.github.io/ember-almanac/'
const places = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--hide-scrollbars'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 200)))
page.on('requestfailed', (r) => r.failure()?.errorText !== 'net::ERR_ABORTED' && errors.push('failed: ' + r.failure()?.errorText + ' ' + r.url().slice(0, 90)))
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
for (const place of places) {
  const t0 = Date.now()
  await page.goto(APP + '#place=' + place, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.report', { timeout: 120000 })
  const ms = Date.now() - t0
  await new Promise((r) => setTimeout(r, 2500))
  const info = await page.evaluate(() => ({
    title: document.querySelector('.report h1')?.textContent,
    lede: document.querySelector('.report .lede')?.textContent,
    facts: [...document.querySelectorAll('.facts > div')].map((d) => d.textContent),
    episodes: [...document.querySelectorAll('.episodes li')].slice(0, 4).map((d) => d.textContent),
  }))
  console.log(place, ms + 'ms', JSON.stringify(info, null, 1))
  await page.screenshot({ path: `out/verify_${place}.jpg`, type: 'jpeg', quality: 80 })
}
console.log('errors:', errors.length, [...new Set(errors)].slice(0, 8))
await browser.close()
