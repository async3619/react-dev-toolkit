export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    // Listen for results from the MAIN world scanner script
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (
        data?.type === "REACT_TREE_RESULT" ||
        data?.type === "REACT_NOT_FOUND" ||
        data?.type === "INSPECT_SELECT"
      ) {
        browser.runtime.sendMessage(data);
      }
    });

    // Listen for commands from devtools (via background)
    browser.runtime.onMessage.addListener((message) => {
      if (
        message?.type === "START_WATCHING" ||
        message?.type === "STOP_WATCHING" ||
        message?.type === "SCAN_REACT_TREE" ||
        message?.type === "HIGHLIGHT_NODE" ||
        message?.type === "HIDE_HIGHLIGHT"
      ) {
        window.postMessage(message, "*");
      }
    });
  },
});
