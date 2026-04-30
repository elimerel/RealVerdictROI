// Type declarations for the Electron IPC bridge exposed by electron-app/preload.js.
// window.electronAPI is only defined when running inside the Electron shell;
// it is undefined in the browser / Vercel deploy.

export interface ElectronBrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ElectronNavUpdate {
  url?: string
  title?: string
  isListing?: boolean
  loading?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
}

export interface ElectronDomPayload {
  url: string
  title: string
  text: string
}

export interface ElectronBrowserState {
  exists: boolean
  url?: string
  title?: string
  isListing?: boolean
}

export interface ElectronAPI {
  createBrowser: (bounds: ElectronBrowserBounds) => Promise<{ reused: boolean }>
  destroyBrowser: () => Promise<void>
  hideBrowser: () => Promise<void>
  showBrowser: (bounds: ElectronBrowserBounds) => Promise<ElectronBrowserState>
  getState: () => Promise<ElectronBrowserState>
  navigate: (url: string) => Promise<void>
  back: () => Promise<void>
  forward: () => Promise<void>
  reload: () => Promise<void>
  updateBounds: (bounds: ElectronBrowserBounds) => Promise<void>
  extractDom: () => Promise<ElectronDomPayload | null>
  analyze: () => Promise<Record<string, unknown>>
  /** Registers a nav-update listener. Returns a cleanup function. */
  onNavUpdate: (cb: (payload: ElectronNavUpdate) => void) => () => void
  /** Auth events */
  signedIn: () => Promise<void>
  signedOut: () => Promise<void>
  /** Opens a popup BrowserWindow for OAuth (Google, etc.) — Electron only */
  openOAuth: (url: string) => Promise<{ ok?: boolean; cancelled?: boolean }>
  // Config / API keys
  getConfig: () => Promise<Record<string, unknown>>
  setOpenAIKey: (key: string) => Promise<{ ok: boolean }>
  hasOpenAIKey: () => Promise<boolean>
  setAnthropicKey: (key: string) => Promise<{ ok: boolean }>
  hasAnthropicKey: () => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
