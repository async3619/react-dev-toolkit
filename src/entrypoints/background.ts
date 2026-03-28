export default defineBackground(() => {
  console.log("React Dev Toolkit background service worker loaded");

  // Relay messages between devtools panel and content script
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === "devtools") {
      port.onMessage.addListener((message) => {
        // Forward messages from devtools to the active tab's content script
        browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
          if (tab?.id) {
            browser.tabs.sendMessage(tab.id, message);
          }
        });
      });

      // Forward messages from content script back to devtools
      const listener = (
        message: unknown,
        _sender: browser.Runtime.MessageSender,
      ) => {
        port.postMessage(message);
      };
      browser.runtime.onMessage.addListener(listener);

      port.onDisconnect.addListener(() => {
        browser.runtime.onMessage.removeListener(listener);
      });
    }
  });
});
