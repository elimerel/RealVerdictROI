// Open the side panel whenever the toolbar icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id })
})

// Tell the side panel which tab it's attached to when it connects
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "realverdict-panel") return
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id) port.postMessage({ type: "TAB_ID", tabId: tab.id })
  })
})

// Forward tab navigation events to the panel so it can auto-detect listing pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return
  chrome.runtime.sendMessage({
    type: "TAB_NAVIGATED",
    tabId,
    url: tab.url ?? "",
    title: tab.title ?? "",
  }).catch(() => {}) // panel may not be open — ignore
})
