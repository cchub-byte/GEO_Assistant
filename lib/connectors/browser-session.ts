import path from "node:path";
import { chromium } from "playwright";
import type { BrowserContext } from "playwright";
import { env } from "@/lib/config";

const contextStoreKey = "__geoBrowserContexts";
const contextPromiseStoreKey = "__geoBrowserContextPromises";

type BrowserContextStore = Map<string, BrowserContext>;
type BrowserContextPromiseStore = Map<string, Promise<BrowserContext>>;

declare global {
  // eslint-disable-next-line no-var
  var __geoBrowserContexts: BrowserContextStore | undefined;
  // eslint-disable-next-line no-var
  var __geoBrowserContextPromises: BrowserContextPromiseStore | undefined;
}

export async function getPersistentBrowserContext(input: {
  engineType: string;
  device?: string;
  viewport?: { width: number; height: number };
}) {
  const contextStore = getContextStore();
  const existing = contextStore.get(input.engineType);
  if (existing && isContextAlive(existing)) return existing;
  if (existing) contextStore.delete(input.engineType);

  const promiseStore = getContextPromiseStore();
  const pending = promiseStore.get(input.engineType);
  if (pending) return pending;

  const profilePath = browserProfilePath(input.engineType);
  const launchPromise = (async () => {
    const context = await chromium.launchPersistentContext(profilePath, {
      args: [`--window-position=${windowPositionFor(input.engineType)}`],
      headless: false,
      viewport: input.viewport || (input.device === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
    });
    context.on("close", () => {
      const current = contextStore.get(input.engineType);
      if (current === context) contextStore.delete(input.engineType);
    });
    contextStore.set(input.engineType, context);
    return context;
  })();
  promiseStore.set(input.engineType, launchPromise);
  try {
    return await launchPromise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `persistent_browser_profile_unavailable:${input.engineType}`,
        `profile=${profilePath}`,
        "同一 profile 已被现有浏览器窗口占用，或上一次采样窗口仍由旧进程持有。",
        "请先点击“停止采样”关闭旧采样窗口，或关闭对应平台窗口后重试。",
        message
      ].join("\n")
    );
  } finally {
    promiseStore.delete(input.engineType);
  }
}

export async function closePersistentBrowserContexts() {
  const contextStore = getContextStore();
  getContextPromiseStore().clear();
  await Promise.all([...contextStore.values()].map((context) => context.close().catch(() => undefined)));
  contextStore.clear();
}

export async function closePersistentBrowserContext(engineType: string) {
  getContextPromiseStore().delete(engineType);
  const contextStore = getContextStore();
  const context = contextStore.get(engineType);
  if (!context) return;
  contextStore.delete(engineType);
  await context.close().catch(() => undefined);
}

export function browserProfilePath(engineType: string) {
  return path.resolve(process.cwd(), env.browserProfileDir, engineType);
}

function getContextStore() {
  globalThis[contextStoreKey] ??= new Map<string, BrowserContext>();
  return globalThis[contextStoreKey];
}

function getContextPromiseStore() {
  globalThis[contextPromiseStoreKey] ??= new Map<string, Promise<BrowserContext>>();
  return globalThis[contextPromiseStoreKey];
}

function isContextAlive(context: BrowserContext) {
  try {
    context.pages();
    return true;
  } catch {
    return false;
  }
}

function windowPositionFor(engineType: string) {
  const positions: Record<string, string> = {
    qianwen: "0,0",
    doubao: "780,0",
    chatgpt: "80,80",
    perplexity: "860,80",
    google_aio: "160,160"
  };
  return positions[engineType] || "120,120";
}
