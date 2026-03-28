// This content script runs at document_start in MAIN world to ensure
// __REACT_DEVTOOLS_GLOBAL_HOOK__ properly stores renderer internals
// when React calls hook.inject(). Without this, the dispatcher ref is lost.

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    const win = window as unknown as Record<string, unknown>;

    interface DevHook {
      renderers?: Map<number, unknown>;
      inject?: (renderer: unknown) => number;
      supportsFiber?: boolean;
      onScheduleFiberRoot?: () => void;
      onCommitFiberRoot?: () => void;
      onCommitFiberUnmount?: () => void;
    }

    const existing = win.__REACT_DEVTOOLS_GLOBAL_HOOK__ as DevHook | undefined;

    if (existing) {
      if (!existing.renderers) existing.renderers = new Map();
      const renderers = existing.renderers;
      const origInject = existing.inject;
      let nextID = renderers.size;
      existing.inject = (renderer: unknown) => {
        const id = origInject?.call(existing, renderer) ?? ++nextID;
        renderers.set(id, renderer as never);
        return id;
      };
      return;
    }

    // Create hook from scratch if none exists
    let nextID = 0;
    const renderers = new Map<number, unknown>();
    win.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers,
      supportsFiber: true,
      inject(renderer: unknown) {
        const id = ++nextID;
        renderers.set(id, renderer);
        return id;
      },
      onScheduleFiberRoot() {},
      onCommitFiberRoot() {},
      onCommitFiberUnmount() {},
    };
  },
});
