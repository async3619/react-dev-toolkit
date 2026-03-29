import { SourceMapConsumer, type RawSourceMap } from "source-map-js";

import type { ScriptEntry, SourceCacheEntry, SourceLocation } from "./types";

const scriptEntries = new Map<string, ScriptEntry>();
export const fnSourceCache = new Map<unknown, SourceCacheEntry>();
let sourceMapsLoaded = false;

export async function loadSourceMaps(): Promise<void> {
  if (sourceMapsLoaded) return;
  sourceMapsLoaded = true;

  const scripts = document.querySelectorAll<HTMLScriptElement>("script[src]");

  await Promise.allSettled(
    Array.from(scripts).map(async (script) => {
      const url = script.src;
      if (!url || scriptEntries.has(url)) return;

      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const content = await res.text();

        const match = content.match(
          /\/\/[#@]\s*sourceMappingURL=(.+?)[\s]*$/m,
        );
        let consumer: SourceMapConsumer | null = null;

        if (match) {
          try {
            let rawMap: RawSourceMap;
            if (match[1].startsWith("data:")) {
              const base64 = match[1].split(",")[1];
              rawMap = JSON.parse(atob(base64));
            } else {
              const smUrl = new URL(match[1], url).href;
              const smRes = await fetch(smUrl);
              rawMap = await smRes.json();
            }
            consumer = new SourceMapConsumer(rawMap);
          } catch {
            // source map fetch/parse failed
          }
        }

        scriptEntries.set(url, { content, consumer });
      } catch {
        // script fetch failed (CORS, etc.)
      }
    }),
  );
}

export function resolveSourceFromMap(fn: unknown): SourceCacheEntry {
  const cached = fnSourceCache.get(fn);
  if (cached) return cached;

  const empty: SourceCacheEntry = { classification: undefined };

  if (typeof fn !== "function") {
    fnSourceCache.set(fn, empty);
    return empty;
  }

  const fnStr = fn.toString();
  if (fnStr.length < 10) {
    fnSourceCache.set(fn, empty);
    return empty;
  }

  for (const [, entry] of scriptEntries) {
    if (!entry.consumer) continue;

    const idx = entry.content.indexOf(fnStr);
    if (idx === -1) continue;

    const before = entry.content.substring(0, idx);
    const lines = before.split("\n");
    const line = lines.length;
    const column = lines[lines.length - 1].length;

    const pos = entry.consumer.originalPositionFor({ line, column });
    if (pos.source) {
      const result: SourceCacheEntry = {
        classification: pos.source.includes("node_modules")
          ? "third-party"
          : "first-party",
        location: {
          fileName: pos.source,
          lineNumber: pos.line ?? 1,
          columnNumber: pos.column ?? undefined,
        },
      };
      fnSourceCache.set(fn, result);
      return result;
    }
  }

  fnSourceCache.set(fn, empty);
  return empty;
}

/**
 * Resolve a bundled file location to original source via source maps.
 * Searches each loaded script's source map for a source file matching the given path,
 * then uses generatedPositionFor + originalPositionFor to map the location.
 */
export function resolveSourceMapLocation(
  fileName: string,
  lineNumber: number,
  columnNumber?: number,
): { fileName: string; lineNumber: number; columnNumber?: number } | null {
  // Extract short path from webpack-internal or similar URLs
  const shortPath = fileName
    .replace(/^webpack-internal:\/\/\//, "")
    .replace(/^webpack:\/\/[^/]*\//, "")
    .replace(/^\.\//, "")
    .replace(/\?.*$/, "");

  for (const [, entry] of scriptEntries) {
    if (!entry.consumer) continue;
    const sources = (entry.consumer as unknown as { sources: string[] }).sources;
    if (!sources) continue;

    // Find a source that matches our file path
    const matchedSource = sources.find((s: string) => {
      const cleaned = s.replace(/^\.\//, "").replace(/^webpack:\/\/[^/]*\//, "");
      return cleaned === shortPath || cleaned.endsWith(shortPath) || shortPath.endsWith(cleaned);
    });

    if (!matchedSource) continue;

    // Use originalPositionFor with the matched source
    // For webpack eval-source-map, the line numbers in stack traces are already
    // relative to the module, so we can try direct lookup
    const pos = entry.consumer.originalPositionFor({
      line: lineNumber,
      column: columnNumber ?? 0,
    });

    if (pos.source && pos.line != null) {
      return {
        fileName: pos.source,
        lineNumber: pos.line,
        columnNumber: pos.column ?? undefined,
      };
    }
  }

  return null;
}
