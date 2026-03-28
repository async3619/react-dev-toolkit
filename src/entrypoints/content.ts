export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    console.log("React Dev Toolkit content script loaded");

    // Listen for messages from the background service worker
    browser.runtime.onMessage.addListener((message) => {
      // Handle messages from devtools panel (via background)
      console.log("[React Dev Toolkit] Received message:", message);
    });
  },
});
