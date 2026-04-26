import Browserbase from "@browserbasehq/sdk"
import { chromium } from "playwright-core"

export type BrowseResult = {
  url: string
  finalUrl: string
  title: string
  /** Visible page text — capped at 30k chars to fit in a prompt */
  text: string
  /** Base64-encoded PNG screenshot of the viewport */
  screenshot: string
}

export async function visitPage(url: string): Promise<BrowseResult> {
  const apiKey = process.env.BROWSERBASE_API_KEY
  const projectId = process.env.BROWSERBASE_PROJECT_ID
  if (!apiKey || !projectId) {
    throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set.")
  }

  const bb = new Browserbase({ apiKey })
  const session = await bb.sessions.create({ projectId })

  const wsEndpoint = `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${session.id}`
  const browser = await chromium.connectOverCDP(wsEndpoint)

  const context = browser.contexts()[0] ?? await browser.newContext()
  const page = context.pages()[0] ?? await context.newPage()

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 })
    // Give JS-heavy SPAs time to render listing data
    await page.waitForTimeout(3000)

    const [title, text, screenshotBuf, finalUrl] = await Promise.all([
      page.title(),
      page.evaluate(() => {
        // Strip nav/footer noise; grab the main content text
        const remove = document.querySelectorAll(
          "nav, footer, header, script, style, [aria-hidden='true']"
        )
        remove.forEach((el) => el.remove())
        return (document.body?.innerText ?? "").slice(0, 30000)
      }),
      page.screenshot({ type: "png", fullPage: false }),
      page.url(),
    ])

    return {
      url,
      finalUrl,
      title,
      text,
      screenshot: screenshotBuf.toString("base64"),
    }
  } finally {
    await browser.close()
  }
}
