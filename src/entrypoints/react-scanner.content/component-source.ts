import type { Fiber } from "bippy";
import type { ComponentSourceInfo, SourceLocation } from "./types";
import { resolveSourceFromMap } from "./source-map";

const sourceLocationCache = new WeakMap<object, SourceLocation | null>();

/**
 * Resolve the source location where a component function is defined.
 * Uses the same technique as React DevTools: invoke the function to capture
 * a stack trace, then compare with a control stack to isolate the component's frame.
 */
export function resolveComponentSourceByInvocation(fn: unknown): SourceLocation | null {
  if (typeof fn !== "function") return null;

  // Use WeakMap cache keyed by function reference
  if (sourceLocationCache.has(fn as object)) {
    return sourceLocationCache.get(fn as object) ?? null;
  }

  let result: SourceLocation | null = null;

  // Disable React hooks dispatcher to prevent side effects
  const internals = (window as unknown as Record<string, unknown>).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED as
    | { ReactCurrentDispatcher?: { current: unknown } }
    | undefined;
  const prevDispatcher = internals?.ReactCurrentDispatcher?.current;

  // Also check React 19+ internals name
  const internals19 = (window as unknown as Record<string, unknown>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as
    | { H?: unknown }
    | undefined;
  const prevH = internals19?.H;

  try {
    // Null out dispatchers to prevent hook side effects
    if (internals?.ReactCurrentDispatcher) {
      internals.ReactCurrentDispatcher.current = null;
    }
    if (internals19 && "H" in internals19) {
      internals19.H = null;
    }

    let sampleStack: string | undefined;
    let controlStack: string | undefined;

    // Capture sample stack by invoking the component
    try {
      const isClass = fn.prototype && fn.prototype.isReactComponent;
      if (isClass) {
        Reflect.construct(fn as new (...args: unknown[]) => unknown, [], class Fake {});
      } else {
        (fn as () => unknown)();
      }
    } catch (e: unknown) {
      if (e instanceof Error) sampleStack = e.stack;
    }

    // If the function didn't throw, we need a different approach
    if (!sampleStack) {
      // Try wrapping with a throw
      try {
        const wrapper = () => {
          try {
            const isClass = fn.prototype && fn.prototype.isReactComponent;
            if (isClass) {
              Reflect.construct(fn as new (...args: unknown[]) => unknown, [], class Fake {});
            } else {
              (fn as () => unknown)();
            }
          } finally {
            throw new Error("__source_probe__");
          }
        };
        wrapper();
      } catch (e: unknown) {
        if (e instanceof Error) sampleStack = e.stack;
      }
    }

    // Capture control stack at the same call depth
    try {
      throw new Error("__control__");
    } catch (e: unknown) {
      if (e instanceof Error) controlStack = e.stack;
    }

    if (sampleStack && controlStack) {
      const sampleLines = sampleStack.split("\n");
      const controlLines = controlStack.split("\n");

      // Extract our own script URL from the control stack to filter it out
      // The control stack only contains our scanner frames, so any URL in it is ours
      const ownUrls: string[] = [];
      for (const line of controlLines) {
        const m = line.match(/\((.+):\d+:\d+\)/) || line.match(/at\s+(.+):\d+:\d+\s*$/);
        if (m) {
          const url = m[1];
          if (!ownUrls.includes(url)) ownUrls.push(url);
        }
      }

      // Compare from the bottom up to find where stacks diverge
      let s = sampleLines.length - 1;
      let c = controlLines.length - 1;
      while (s >= 1 && c >= 0 && sampleLines[s] === controlLines[c]) {
        s--;
        c--;
      }

      // Walk up from the divergence point, looking for a user-code frame
      for (let i = s; i >= 0; i--) {
        const line = sampleLines[i];
        // Skip our own scanner frames, React internals, and node_modules
        if (
          ownUrls.some(url => line.includes(url)) ||
          line.includes("node_modules") ||
          line.includes("react-dom") ||
          line.includes("react-jsx-runtime") ||
          line.includes("react.development") ||
          line.includes("__source_probe__") ||
          line.includes("__control__")
        ) continue;

        // Chrome: "at Name (url:line:col)" or "at url:line:col"
        const match = line.match(/\((.+):(\d+):(\d+)\)/) || line.match(/at\s+(.+):(\d+):(\d+)\s*$/);
        if (match) {
          result = {
            fileName: match[1],
            lineNumber: parseInt(match[2], 10),
            columnNumber: parseInt(match[3], 10),
          };
          break;
        }
      }
    }
  } catch {
    // Never crash the scanner
  } finally {
    // Restore dispatchers
    if (internals?.ReactCurrentDispatcher && prevDispatcher !== undefined) {
      internals.ReactCurrentDispatcher.current = prevDispatcher;
    }
    if (internals19 && prevH !== undefined) {
      internals19.H = prevH;
    }
  }

  sourceLocationCache.set(fn as object, result);
  return result;
}

function classifyFileName(fileName: string): "first-party" | "third-party" {
  return fileName.includes("node_modules") ? "third-party" : "first-party";
}

export function getComponentSource(fiber: Fiber): ComponentSourceInfo {
  try {
    // Strategy 1: _debugSource (React 17-18 dev builds)
    const debugSource = fiber._debugSource;
    if (debugSource?.fileName) {
      return {
        classification: classifyFileName(debugSource.fileName),
        location: {
          fileName: debugSource.fileName,
          lineNumber: debugSource.lineNumber,
          columnNumber: debugSource.columnNumber,
        },
      };
    }

    // Strategy 2: Invoke component function to capture stack trace (React DevTools technique)
    // Works across all React versions and build modes
    const fn = typeof fiber.type === "function"
      ? fiber.type
      : typeof fiber.type === "object" && fiber.type !== null
        ? (fiber.type as { render?: unknown; type?: unknown }).render
          || (fiber.type as { render?: unknown; type?: unknown }).type
        : null;

    if (typeof fn === "function") {
      const loc = resolveComponentSourceByInvocation(fn);
      if (loc) {
        return {
          classification: classifyFileName(loc.fileName),
          location: loc,
        };
      }
    }

    // Strategy 3: resolve via source maps (production builds)
    if (typeof fiber.type === "function") {
      return resolveSourceFromMap(fiber.type);
    }
    if (typeof fn === "function") {
      return resolveSourceFromMap(fn);
    }
  } catch {
    // Catch-all: never let source resolution crash the tree walk
  }

  return { classification: undefined };
}
