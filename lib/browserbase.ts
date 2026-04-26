import Browserbase from "@browserbasehq/sdk"
import { chromium } from "playwright-core"

// Viewport used for all sessions — matches a standard laptop screen
const VIEWPORT = { width: 1280, height: 800 }

export type BrowseResult = {
  url: string
  finalUrl: string
  title: string
  /** Visible page text — capped at 30k chars to fit in a prompt */
  text: string
  /** Base64-encoded PNG screenshot of the viewport */
  screenshot: string
}

export type SessionState = {
  screenshot: string
  url: string
  title: string
  /** Whether the current page looks like a property listing */
  isListingPage: boolean
}

function getBBClient() {
  const apiKey = process.env.BROWSERBASE_API_KEY
  const projectId = process.env.BROWSERBASE_PROJECT_ID
  if (!apiKey || !projectId) {
    throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set.")
  }
  return { bb: new Browserbase({ apiKey }), apiKey, projectId }
}

function wsEndpointFor(apiKey: string, sessionId: string) {
  return `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${sessionId}`
}

const LISTING_PAGE_RE = /\/homedetails\/|\/homes\/|for[_-]sale|for-rent|property-detail|realestateandhomes-detail/i

// ---------------------------------------------------------------------------
// One-shot visit (used by /api/browse for quick analyze flow)
// ---------------------------------------------------------------------------

export async function visitPage(url: string): Promise<BrowseResult> {
  const { bb, apiKey, projectId } = getBBClient()
  const session = await bb.sessions.create({
    projectId,
    browserSettings: { viewport: VIEWPORT },
  })
  const browser = await chromium.connectOverCDP(wsEndpointFor(apiKey, session.id))
  const context = browser.contexts()[0] ?? await browser.newContext()
  const page = context.pages()[0] ?? await context.newPage()

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 })
    await page.waitForTimeout(3000)

    const [title, text, screenshotBuf, finalUrl] = await Promise.all([
      page.title(),
      page.evaluate(() => {
        document.querySelectorAll("nav, footer, header, script, style, [aria-hidden='true']")
          .forEach((el) => el.remove())
        return (document.body?.innerText ?? "").slice(0, 30000)
      }),
      page.screenshot({ type: "png", fullPage: false }),
      page.url(),
    ])

    return { url, finalUrl, title, text, screenshot: screenshotBuf.toString("base64") }
  } finally {
    await browser.close()
  }
}

// ---------------------------------------------------------------------------
// Session-based browsing (used by /research)
// ---------------------------------------------------------------------------

export async function createBrowseSession(initialUrl?: string): Promise<string> {
  const { bb, projectId } = getBBClient()
  const session = await bb.sessions.create({
    projectId,
    browserSettings: { viewport: VIEWPORT },
  })
  if (initialUrl) {
    // Navigate without holding the connection — fire and forget startup
    const { apiKey } = getBBClient()
    const browser = await chromium.connectOverCDP(wsEndpointFor(apiKey, session.id))
    const context = browser.contexts()[0] ?? await browser.newContext()
    const page = context.pages()[0] ?? await context.newPage()
    try {
      await page.goto(initialUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
      await page.waitForTimeout(1500)
    } finally {
      await browser.close()
    }
  }
  return session.id
}

export async function endBrowseSession(sessionId: string): Promise<void> {
  const { bb } = getBBClient()
  try {
    await bb.sessions.update(sessionId, { status: "REQUEST_RELEASE" })
  } catch {
    // Best-effort — session may have already expired
  }
}

export type BrowseAction =
  | { type: "navigate"; url: string }
  | { type: "click"; x: number; y: number }
  | { type: "scroll"; direction: "up" | "down" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }

export async function actInSession(
  sessionId: string,
  action: BrowseAction,
): Promise<SessionState & { pageText: string }> {
  const { apiKey } = getBBClient()
  const browser = await chromium.connectOverCDP(wsEndpointFor(apiKey, sessionId))
  const context = browser.contexts()[0] ?? await browser.newContext()
  const page = context.pages()[0] ?? await context.newPage()

  try {
    switch (action.type) {
      case "navigate":
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 20000 })
        await page.waitForTimeout(2000)
        break
      case "click":
        await page.mouse.click(action.x, action.y)
        await page.waitForTimeout(1500)
        break
      case "scroll":
        await page.mouse.wheel(0, action.direction === "down" ? 600 : -600)
        await page.waitForTimeout(300)
        break
      case "back":
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 })
        await page.waitForTimeout(1500)
        break
      case "forward":
        await page.goForward({ waitUntil: "domcontentloaded", timeout: 15000 })
        await page.waitForTimeout(1500)
        break
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 })
        await page.waitForTimeout(1500)
        break
    }

    const [title, screenshotBuf, finalUrl, pageText] = await Promise.all([
      page.title(),
      page.screenshot({ type: "jpeg", quality: 80, fullPage: false }),
      page.url(),
      page.evaluate(() => (document.body?.innerText ?? "").slice(0, 30000)),
    ])

    return {
      screenshot: screenshotBuf.toString("base64"),
      url: finalUrl,
      title,
      pageText,
      isListingPage: LISTING_PAGE_RE.test(finalUrl),
    }
  } finally {
    await browser.close()
  }
}
