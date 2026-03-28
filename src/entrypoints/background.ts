export default defineBackground(() => {
  // Relay messages between devtools panel and content script
  browser.runtime.onConnect.addListener((port) => {
    // Port name format: "devtools:<tabId>"
    if (!port.name.startsWith('devtools:')) return

    const tabId = Number(port.name.split(':')[1])
    if (!tabId) return

    // Forward messages from devtools to the inspected tab's content script
    port.onMessage.addListener((message) => {
      browser.tabs.sendMessage(tabId, message)
    })

    // Forward messages from the inspected tab's content script back to devtools
    const listener = (
      message: unknown,
      sender: Browser.runtime.MessageSender,
    ) => {
      if (sender.tab?.id === tabId) {
        port.postMessage(message)
      }
    }
    browser.runtime.onMessage.addListener(listener)

    port.onDisconnect.addListener(() => {
      browser.runtime.onMessage.removeListener(listener)
    })
  })
})
