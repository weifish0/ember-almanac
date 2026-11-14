// Captures real product footage from the deployed app with headless Chrome, for the demo video.
//   node scripts/capture.mjs [globe|product]
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const APP = process.env.APP_URL ?? 'https://weifish0.github.io/ember-almanac/'
const OUT = new URL('../public/cap/', import.meta.url).pathname
const what = process.argv[2] ?? 'all'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--window-size=1920,1080'],
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const idle = (page, max = 9000) =>
  page.evaluate(
    (max) =>
      new Promise((r) => {
        const m = window.__emberMap
        const t = setTimeout(r, max)
        m.once('idle', () => { clearTimeout(t); r() })
        m.triggerRepaint()
      }),
    max,
  )
const month = (page, i) => page.evaluate((i) => document.querySelectorAll('.months button')[i + 1].click(), i)

if (what === 'globe' || what === 'all') {
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 120000 })
  await page.waitForFunction(() => window.__emberMap && window.__emberMap.getSource('fire'), { timeout: 60000 })
  await page.addStyleTag({
    content: `.app{grid-template-columns:1fr 0 !important}.panel{display:none !important}
      .plate-top,.plate-bottom,.maplibregl-control-container{opacity:0 !important;pointer-events:none}`,
  })
  await sleep(500)
  await page.evaluate(() => window.__emberMap.resize())
  const N = 180
  let last = -1
  for (let f = 0; f < N; f++) {
    const m = Math.min(11, Math.floor((f / N) * 12))
    if (m !== last) { await month(page, m); last = m; await sleep(250) }
    await page.evaluate((f, N) => {
      window.__emberMap.jumpTo({ center: [8 + (f / N) * 100, 6], zoom: 2.62, padding: { left: 640, right: 0, top: 0, bottom: 0 } })
    }, f, N)
    await idle(page, f < 3 ? 15000 : 6000)
    await page.screenshot({ path: `${OUT}globe/${String(f).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 93 })
    if (f % 20 === 0) console.log('globe frame', f)
  }
  await page.close()
}

if (what === 'product' || what === 'all') {
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 })
  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 120000 })
  await page.waitForFunction(() => window.__emberMap && window.__emberMap.getSource('fire'), { timeout: 60000 })
  await idle(page, 20000)
  await sleep(1500)
  await page.screenshot({ path: `${OUT}home.jpg`, type: 'jpeg', quality: 92 })

  // the map as it looks just before the user draws a box around northern Thailand
  await month(page, 2)
  await page.evaluate(() => window.__emberMap.fitBounds([[97.5, 17.5], [101.5, 20.5]], { padding: 90, maxZoom: 6.2, duration: 0 }))
  await idle(page, 20000)
  await sleep(1200)
  const box = await page.evaluate(() => {
    const m = window.__emberMap
    const a = m.project([97.5, 20.5])
    const b = m.project([101.5, 17.5])
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y, plateWidth: document.querySelector('.plate').clientWidth }
  })
  fs.writeFileSync(`${OUT}box.json`, JSON.stringify(box))
  await page.screenshot({ path: `${OUT}before.jpg`, type: 'jpeg', quality: 92 })

  // the almanac for that area
  await page.evaluate(() => { location.hash = '#place=chiang-mai' })
  await page.waitForSelector('.report', { timeout: 120000 })
  await idle(page, 20000)
  await sleep(2500)
  await page.screenshot({ path: `${OUT}after.jpg`, type: 'jpeg', quality: 92 })

  // the whole report as one tall strip, for scrolling through in the video
  await page.addStyleTag({ content: `.app{height:auto !important}.panel{overflow:visible !important}.plate{height:1080px}*{animation:none !important}` })
  await sleep(800)
  const r = await page.evaluate(() => { const b = document.querySelector('.panel').getBoundingClientRect(); return { x: b.x, y: 0, width: b.width, height: document.querySelector('.panel').scrollHeight } })
  await page.screenshot({ path: `${OUT}panel.png`, clip: r, captureBeyondViewport: true })
  fs.writeFileSync(`${OUT}panel.json`, JSON.stringify(r))
  console.log('product shots done', box, r)
  await page.close()
}
await browser.close()
