/**
 * Extract a short path (e.g. "src/components/Foo.tsx") from a full URL
 * for matching against loaded resources.
 */
function extractPathFromUrl(fileName: string): string {
  let p = fileName.replace(/[?#].*$/, "");
  // Strip scheme + host: webpack://pkg-name/./src/... → ./src/...
  p = p.replace(/^[\w-]+:\/\/[^/]*\//, "");
  // Strip leading ./
  p = p.replace(/^\.\//, "");
  return p;
}

/**
 * Open a source file in the browser's DevTools Sources panel.
 * Uses getResources() to find the exact URL (including query hash)
 * that matches the file path.
 */
/**
 * Open a source file in the browser's DevTools Sources panel.
 * Uses inspect() via inspectedWindow.eval, which has access to the
 * DevTools Console API. inspect(fn) navigates to the function's
 * source-mapped original location.
 */
export function openInSource(nodeId: number): void {
  browser.devtools.inspectedWindow.eval(
    `{
      const fnMap = window.__REACT_DEV_TOOLKIT_FN_REFS__;
      if (fnMap) {
        const fn = fnMap.get(${nodeId});
        if (fn) inspect(fn);
      }
    }`,
  );
}

/**
 * Evaluate synchronous JS in the inspected page and return the result.
 */
function evalInPage<T>(code: string): Promise<T | null> {
  return new Promise((resolve) => {
    browser.devtools.inspectedWindow.eval(code, (result, error) => {
      resolve(error ? null : (result as T));
    });
  });
}

// Cached project root resolved from source maps (null = not yet resolved, "" = resolution failed)
let cachedProjectRoot: string | null = null;

/**
 * Try to resolve the absolute project root from source maps via synchronous XHR.
 * Caches the result so it only runs once per session.
 */
function resolveProjectRoot(): Promise<string> {
  if (cachedProjectRoot !== null) return Promise.resolve(cachedProjectRoot);

  return evalInPage<string>(`
    (function(){
      try {
        var scripts = document.querySelectorAll("script[src]");
        for (var i = 0; i < scripts.length; i++) {
          try {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", scripts[i].src, false);
            xhr.send();
            var text = xhr.responseText || "";
            var m = text.match(/\\/\\/[#@]\\s*sourceMappingURL=(.+)/);
            if (!m) continue;
            var mapData = null;
            if (m[1].startsWith("data:")) {
              var b64 = m[1].split(",")[1];
              mapData = JSON.parse(atob(b64));
            } else {
              var mapXhr = new XMLHttpRequest();
              mapXhr.open("GET", new URL(m[1], scripts[i].src).href, false);
              mapXhr.send();
              if (mapXhr.status === 200) mapData = JSON.parse(mapXhr.responseText);
            }
            if (!mapData) continue;
            if (mapData.sourceRoot && mapData.sourceRoot.startsWith("/")) {
              return mapData.sourceRoot.replace(/\\/$/,"");
            }
            var sources = mapData.sources || [];
            for (var j = 0; j < sources.length; j++) {
              if (typeof sources[j]==="string" && sources[j].startsWith("/")) {
                var idx = sources[j].indexOf("/src/");
                if (idx >= 0) return sources[j].substring(0, idx);
              }
            }
          } catch(e){}
        }
      } catch(e){}
      return "";
    })()
  `).then((root) => {
    cachedProjectRoot = root ?? "";
    return cachedProjectRoot;
  });
}

/**
 * Open a source file in the user's local editor.
 * 1. Tries common dev-server endpoints via synchronous XHR
 * 2. Resolves absolute path from source maps, opens via vscode:// protocol
 * 3. Falls back to copying file:line to clipboard
 */
export function openInEditor(fileName: string, lineNumber: number, columnNumber?: number): void {
  const col = columnNumber ?? 1;
  const relPath = extractPathFromUrl(fileName);

  const endpoints = [
    `/__open-in-editor?file=${encodeURIComponent(relPath)}&line=${lineNumber}&column=${col}`,
    `/__open-stack-frame-in-editor?fileName=${encodeURIComponent(relPath)}&lineNumber=${lineNumber}&colNumber=${col}`,
    `/__nextjs_launch-editor?file=${encodeURIComponent(relPath)}:${lineNumber}:${col}`,
    `/launch-editor?file=${encodeURIComponent(relPath)}&line=${lineNumber}&column=${col}`,
  ];

  // Build synchronous XHR check — returns true on first successful endpoint
  const xhrChecks = endpoints
    .map(
      (ep) =>
        `(function(){try{var x=new XMLHttpRequest();x.open("GET","${ep}",false);x.send();if(x.status>=200&&x.status<400)return true}catch(e){}return false})()`,
    )
    .join("||");

  evalInPage<boolean>(xhrChecks).then(async (ok) => {
    if (ok) return;

    // Try vscode:// with absolute path from source maps
    const root = await resolveProjectRoot();
    if (root) {
      window.open(`vscode://file/${root}/${relPath}:${lineNumber}:${col}`);
      return;
    }

    // Final fallback: copy to clipboard
    const text = `${relPath}:${lineNumber}`;
    await navigator.clipboard.writeText(text);
  });
}
