import type { BrowserContext, Locator, Page, Request } from "playwright";
import { classifySource } from "@/lib/ai/evaluator";
import { normalizeReferenceSourceUrl } from "@/lib/services/reference-url";
import { domainFromUrl } from "@/lib/utils";
import type { CollectedSource, CollectionInput, CollectionOutput, EngineConnector } from "./types";
import { getPersistentBrowserContext } from "./browser-session";

type SubmissionState = {
  url: string;
  bodyTextLength: number;
  bodyText: string;
  inputText: string;
  messageNodeCount: number;
};

type DoubaoCollectionResult = {
  answerText: string;
  sources: CollectedSource[];
  searchKeywords: string[];
  bodyText: string;
  failureReason?: string;
};

type SubmitPromptOptions = {
  maxAttempts?: number;
  submitWaitMs?: number;
};

const COLLECTION_WAIT_MS = 120000;

// 浏览器连接器依赖真实平台 UI，核心策略是先确认可交互状态，再用平台特化规则提取答案与引用。
export class BrowserConnector implements EngineConnector {
  constructor(public engineType: string) {}

  async collect(input: CollectionInput): Promise<CollectionOutput> {
    let context = null as Awaited<ReturnType<typeof getPersistentBrowserContext>> | null;
    let page: Page | null = null;
    let closeInFinally = !input.keepOpen;
    try {
      context = await getPersistentBrowserContext({
        engineType: input.engineType,
        device: input.device
      });
      page = await createCollectionPage(context, input.engineType);
      const url = buildStartUrl(input);
      await gotoStartUrl(page, url, input.timeoutMs || 45000);
      await page.bringToFront().catch(() => undefined);
      // 登录、区域限制和风控页需要尽早识别；这些场景不应继续输入 Query。
      const preflightFailure = await detectPlatformBlockingState(page, input.engineType);
      if (preflightFailure) {
        const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
        return fail(preflightFailure, text.slice(0, 4000), false);
      }

      if (input.engineType !== "google_aio") {
        const inputLocator = await waitForPromptInput(page, input.engineType, input.timeoutMs || 90000);
        if (!inputLocator) {
          const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
          return fail("login_required_or_prompt_input_not_found", text.slice(0, 4000), false);
        }
        await submitPrompt(page, inputLocator, input.engineType, input.queryText);
      }

      let bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
      let engineSources: CollectedSource[] = [];
      let copiedAnswerText = "";
      let searchKeywords: string[] = [];
      // Google AIO 没有统一复制按钮；其他对话式平台优先通过复制按钮获取干净答案文本。
      if (input.engineType === "google_aio") {
        await waitForAnswerReady(page, input.engineType, input.waitAfterSubmitMs ?? 120000);
        bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
        copiedAnswerText = bodyText;
      } else if (input.engineType === "doubao") {
        const doubaoResult = await collectDoubaoAnswerAndSourcesByRule(page, input);
        bodyText = doubaoResult.bodyText;
        copiedAnswerText = doubaoResult.answerText;
        engineSources = doubaoResult.sources;
        searchKeywords = doubaoResult.searchKeywords;
        if (doubaoResult.failureReason) {
          return fail(doubaoResult.failureReason, bodyText.slice(0, 4000), true, doubaoResult.answerText);
        }
      } else {
        await waitForAnswerReady(page, input.engineType, input.waitAfterSubmitMs ?? 120000);
        bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
        copiedAnswerText = await collectAnswerTextFromCopyButton(page, input.engineType, input.queryText, input.timeoutMs || COLLECTION_WAIT_MS);
        engineSources = await collectEngineSpecificSources(page, input.engineType).catch(() => []);
      }
      if (input.engineType !== "google_aio" && !copiedAnswerText) {
        return fail("answer_copy_button_not_found_or_clipboard_empty", bodyText.slice(0, 4000), true, "");
      }
      // 千问和豆包的引用入口较多，若平台特化提取失败则宁可返回空引用，避免抓取无关页面链接。
      const sourceList = engineSources.length
        ? engineSources
        : input.engineType === "qianwen" || input.engineType === "doubao"
          ? []
          : await collectGenericSources(page);
      if (input.engineType === "google_aio" && !/AI Overview|生成式 AI|概览|AI 概览/i.test(bodyText)) {
        return fail("no_ai_overview", bodyText.slice(0, 4000));
      }
      const sources = sourceList
        .map((link) => ({ ...link, url: normalizeReferenceSourceUrl(link.url) }))
        .filter((link) => domainFromUrl(link.url) !== "unknown")
        .slice(0, 20)
        .map((link) => ({ ...link, sourceType: link.sourceType || classifySource(link.url, link.title) }));
      return {
        status: "succeeded",
        answerText: copiedAnswerText.slice(0, 12000),
        sources,
        rawResponse: bodyText,
        engineMetadata: {
          mode: "browser",
          url: page.url(),
          answerSource: input.engineType === "google_aio" ? "page_body" : "copy_button",
          ...(input.engineType === "doubao" ? { searchKeywords } : {})
        }
      };
    } catch (error) {
      if (error instanceof Error && /Target page, context or browser has been closed/.test(error.message)) {
        return fail("browser_context_closed_during_sampling");
      }
      return fail(error instanceof Error ? error.message : "unknown_error");
    } finally {
      if (context && closeInFinally) {
        await context.close().catch(() => undefined);
      }
    }

    function fail(reason: string, raw = "", shouldClose = true, answerText = raw): CollectionOutput {
      if (!shouldClose) {
        // 登录或风控类失败保留窗口，便于用户在同一持久化会话中手动处理后重试。
        closeInFinally = false;
        if (!input.keepOpen) {
          setTimeout(() => context?.close().catch(() => undefined), 300000);
        }
      }
      return {
        status: "failed",
        answerText,
        sources: [],
        rawResponse: raw,
        failureReason: reason,
        engineMetadata: { mode: "browser", url: page?.url() || "" }
      };
    }
  }
}

let collectionWindowSequence = 0;
let pageCreationLock: Promise<void> = Promise.resolve();

async function createCollectionPage(context: BrowserContext, engineType: string): Promise<Page> {
  return withPageCreationLock(() => createCollectionPageUnlocked(context, engineType));
}

async function withPageCreationLock<T>(task: () => Promise<T>): Promise<T> {
  // Chromium Target.createTarget 对同一持久化上下文并发调用不稳定，页面创建需要串行。
  const previous = pageCreationLock;
  let release: () => void = () => undefined;
  pageCreationLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
  }
}

async function createCollectionPageUnlocked(context: BrowserContext, engineType: string): Promise<Page> {
  const fallback = () => context.newPage();
  const anchorPage = context.pages().find((candidate) => !candidate.isClosed()) || await fallback();
  const pagePromise = context.waitForEvent("page", { timeout: 3500 }).catch(() => null);
  const bounds = nextCollectionWindowBounds(engineType);
  const session = await context.newCDPSession(anchorPage).catch(() => null);
  if (!session) return fallback();
  const created = await session
    .send("Target.createTarget", {
      url: "about:blank",
      newWindow: true,
      width: bounds.width,
      height: bounds.height,
      left: bounds.left,
      top: bounds.top
    })
    .then(() => true)
    .catch(() => false);
  if (!created) return fallback();
  const page = await pagePromise;
  return page || fallback();
}

async function gotoStartUrl(page: Page, url: string, timeoutMs: number) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 2 && /net::ERR_ABORTED|Navigation failed because page was closed|Target page/.test(message)) {
        await page.waitForTimeout(700).catch(() => undefined);
        continue;
      }
      throw error;
    }
  }
}

function nextCollectionWindowBounds(engineType: string) {
  const index = collectionWindowSequence++;
  const baseLeft: Record<string, number> = {
    qianwen: 0,
    doubao: 740,
    chatgpt: 120,
    perplexity: 860,
    google_aio: 240
  };
  return {
    width: 720,
    height: 920,
    left: (baseLeft[engineType] || 120) + (index % 2) * 36,
    top: 40 + Math.floor(index / 2) * 36
  };
}

async function collectDoubaoAnswerAndSourcesByRule(page: Page, input: CollectionInput): Promise<DoubaoCollectionResult> {
  const startedAt = Date.now();
  const refreshMarks = [COLLECTION_WAIT_MS];
  const finalDeadlineMs = COLLECTION_WAIT_MS + 15000;
  let refreshIndex = 0;
  let bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");

  while (Date.now() - startedAt < finalDeadlineMs) {
    // 豆包偶发生成完成但操作区未出现；先轮询复制按钮，超时后刷新并重新提交一次。
    await scrollToLatestAnswerBottom(page);
    bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => bodyText);

    const elapsed = Date.now() - startedAt;
    const nextRefreshAt = refreshMarks[refreshIndex] ?? finalDeadlineMs;
    const probeTimeout = Math.max(1000, Math.min(3000, nextRefreshAt - elapsed, finalDeadlineMs - elapsed));
    const answerText = await collectAnswerTextFromCopyButton(page, input.engineType, input.queryText, probeTimeout);
    bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => bodyText);
    if (answerText) {
      await revealLatestAnswerActions(page);
      const sources = await collectDoubaoSources(page).catch(() => []);
      const searchKeywords = await collectDoubaoSearchKeywords(page).catch(() => []);
      await scrollToLatestAnswerTop(page);
      bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => bodyText);
      return { answerText, sources, searchKeywords, bodyText };
    }

    const elapsedAfterProbe = Date.now() - startedAt;
    if (refreshIndex < refreshMarks.length && elapsedAfterProbe >= refreshMarks[refreshIndex]) {
      const refreshed = await refreshDoubaoAndResubmit(page, input);
      bodyText = refreshed.bodyText || bodyText;
      if (refreshed.answerText) {
        await revealLatestAnswerActions(page);
        const sources = await collectDoubaoSources(page).catch(() => []);
        const searchKeywords = await collectDoubaoSearchKeywords(page).catch(() => []);
        await scrollToLatestAnswerTop(page);
        bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => bodyText);
        return { answerText: refreshed.answerText, sources, searchKeywords, bodyText };
      }
      refreshIndex += 1;
      continue;
    }

    const waitUntil = Math.min(refreshMarks[refreshIndex] ?? finalDeadlineMs, finalDeadlineMs);
    const waitMs = Math.max(250, Math.min(1000, waitUntil - elapsedAfterProbe));
    await page.waitForTimeout(waitMs).catch(() => undefined);
  }

  bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => bodyText);
  return {
    answerText: "未响应",
    sources: [],
    searchKeywords: [],
    bodyText,
    failureReason: "doubao_unresponsive_after_2m"
  };
}

async function collectDoubaoSearchKeywords(page: Page): Promise<string[]> {
  const clicked = await page
    .evaluate(() => {
      const requiredClasses = [
        "overflow-hidden",
        "font-normal",
        "text-ellipsis",
        "whitespace-nowrap",
        "text-dbx-text-secondary"
      ];
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      };
      const hasClasses = (element: Element) => requiredClasses.every((className) => element.classList.contains(className));
      const dispatchActivation = (element: HTMLElement) => {
        element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        const init = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          view: window
        };
        const pointerCtor = typeof window.PointerEvent === "function" ? window.PointerEvent : window.MouseEvent;
        element.dispatchEvent(new pointerCtor("pointerdown", init));
        element.dispatchEvent(new MouseEvent("mousedown", init));
        element.dispatchEvent(new pointerCtor("pointerup", init));
        element.dispatchEvent(new MouseEvent("mouseup", init));
        element.dispatchEvent(new MouseEvent("click", init));
        element.click();
      };
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("div.overflow-hidden.font-normal.text-ellipsis.whitespace-nowrap.text-dbx-text-secondary"))
        .filter((element) => hasClasses(element) && isVisible(element))
        .filter((element) => !element.closest("nav,aside,header,footer"))
        .filter((element) => !/(sidebar|side-bar|history|nav|menu|composer|input|prompt)/i.test(String(element.className || "")))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.textContent || "").trim();
          const clickable =
            (element.closest("button, [role='button'], [onclick], [tabindex], [class*='button'], [class*='btn']") as HTMLElement | null) ||
            element;
          let score = rect.top;
          if (text.length > 0 && text.length <= 120) score += 100;
          if (rect.left > 260) score += 40;
          return { element: clickable, score, top: rect.top };
        })
        .sort((a, b) => b.score - a.score);
      const target = candidates[0];
      if (!target) return { clicked: false, top: 0 };
      dispatchActivation(target.element);
      return { clicked: true, top: target.top };
    })
    .catch(() => ({ clicked: false, top: 0 }));

  if (!clicked.clicked) return [];
  await page.waitForTimeout(800).catch(() => undefined);

  return page
    .evaluate((clickedTop) => {
      const requiredClasses = ["mb-8", "text-sm", "text-dbx-neutral-400"];
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      };
      const hasClasses = (element: Element) => requiredClasses.every((className) => element.classList.contains(className));
      const textOf = (element: HTMLElement) => element.innerText || element.textContent || "";
      const rows = Array.from(document.querySelectorAll<HTMLElement>("div.mb-8.text-sm.text-dbx-neutral-400"))
        .filter((element) => hasClasses(element) && isVisible(element))
        .filter((element) => !element.closest("nav,aside,header,footer"))
        .map((element, index) => {
          const rect = element.getBoundingClientRect();
          const rawText = textOf(element);
          return {
            rawText,
            index,
            distance: Math.abs(rect.top - clickedTop),
            top: rect.top
          };
        })
        .filter((item) => item.rawText.trim().length > 0)
        .sort((a, b) => a.distance - b.distance || a.top - b.top || a.index - b.index)
        .slice(0, 12);
      const seen = new Set<string>();
      const keywords: string[] = [];
      for (const row of rows) {
        const parts = row.rawText
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean);
        for (const part of parts.length > 0 ? parts : [row.rawText.trim()]) {
          if (seen.has(part)) continue;
          seen.add(part);
          keywords.push(part);
        }
      }
      return keywords.slice(0, 30);
    }, clicked.top)
    .catch(() => []);
}

async function refreshDoubaoAndResubmit(page: Page, input: CollectionInput): Promise<{ answerText: string; bodyText: string }> {
  await page.reload({ waitUntil: "domcontentloaded", timeout: Math.min(input.timeoutMs || 45000, 20000) }).catch(async () => {
    await gotoStartUrl(page, buildStartUrl(input), Math.min(input.timeoutMs || 45000, 20000)).catch(() => undefined);
  });
  await page.waitForTimeout(1500).catch(() => undefined);
  await scrollToLatestAnswerBottom(page);
  let bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  const existingAnswer = await collectAnswerTextFromCopyButton(page, input.engineType, input.queryText, 2500);
  bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => bodyText);
  if (existingAnswer) return { answerText: existingAnswer, bodyText };

  const inputLocator = await waitForPromptInput(page, input.engineType, 12000);
  if (!inputLocator) return { answerText: "", bodyText };
  await submitPrompt(page, inputLocator, input.engineType, input.queryText, {
    maxAttempts: 1,
    submitWaitMs: 4500
  }).catch(() => undefined);
  bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => bodyText);
  return { answerText: "", bodyText };
}

async function waitForAnswerReady(page: Page, engineType: string, timeoutMs: number) {
  if (engineType === "google_aio") {
    await page.waitForTimeout(Math.min(timeoutMs, 5000));
    return;
  }

  const deadline = Date.now() + timeoutMs;
  let lastTextLength = 0;
  let stableRounds = 0;
  while (Date.now() < deadline) {
    const state = await page
      .evaluate(() => {
        const bodyText = (document.body.textContent || "").replace(/\s+/g, " ").trim();
        const hasReferenceEntry = /\d+\s*篇来源|参考来源\s*\(\d+\)|搜索\s*\d*\s*个关键词.*参考\s*\d*\s*篇资料|参考\s*\d+\s*篇资料|参考\s*\d+\s*条资料/i.test(bodyText);
        const hasGeneratingHint = /正在生成|生成中|思考中|搜索中|停止生成|Stop generating|Regenerate|重新生成|继续生成|回答中/i.test(bodyText);
        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 20 && rect.height > 16;
        };
        const inputSelectors = [
          "textarea",
          "input[type='text']",
          "input:not([type])",
          "[contenteditable='true']",
          "[contenteditable='plaintext-only']",
          "[role='textbox']"
        ];
        const composerTops = inputSelectors
          .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
          .filter((element) => {
            if (!isVisible(element)) return false;
            const rect = element.getBoundingClientRect();
            return rect.top > window.innerHeight * 0.45 && rect.width > 220;
          })
          .map((element) => element.getBoundingClientRect().top);
        const composerTop = composerTops.length > 0 ? Math.min(...composerTops) : window.innerHeight * 0.92;
        const answerRegionElements = Array.from(document.querySelectorAll<HTMLElement>("main, article, section, div"))
          .filter((element) => {
            if (!isVisible(element)) return false;
            const rect = element.getBoundingClientRect();
            if (rect.left < 260 || rect.width < 280) return false;
            if (rect.top < 70 || rect.top > composerTop - 24) return false;
            if (/(sidebar|side-bar|history|nav|menu|composer|input|prompt)/i.test(String(element.className || ""))) return false;
            if (element.closest("nav,aside,header,footer")) return false;
            return true;
          });
        const centralTexts = answerRegionElements
          .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
          .filter((text) => text.length > 80 && !/^你好，我是/.test(text));
        const answerTextLength = centralTexts.reduce((max, text) => Math.max(max, text.length), 0);
        const hasAnswerCopyAction = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], div, span"))
          .filter((element) => {
            if (!isVisible(element)) return false;
            const rect = element.getBoundingClientRect();
            if (rect.left < 260 || rect.top < 70 || rect.top > composerTop + 80) return false;
            const text = (element.textContent || "").replace(/\s+/g, " ").trim();
            const attrs = ["aria-label", "title", "data-tooltip", "data-testid"]
              .map((attr) => element.getAttribute(attr))
              .filter(Boolean)
              .join(" ");
            return /复制|copy/i.test(`${text} ${attrs}`);
          })
          .length > 0;
        return {
          textLength: bodyText.length,
          answerTextLength,
          hasReferenceEntry,
          hasGeneratingHint,
          hasAnswerCopyAction
        };
      })
      .catch(() => ({ textLength: 0, answerTextLength: 0, hasReferenceEntry: false, hasGeneratingHint: false, hasAnswerCopyAction: false }));

    const delta = Math.abs(state.answerTextLength - lastTextLength);
    if (state.answerTextLength > 80 && state.hasAnswerCopyAction) return;
    if (state.answerTextLength > 160 && delta < 20 && !state.hasGeneratingHint) {
      stableRounds += 1;
      if (stableRounds >= 4) return;
    } else {
      stableRounds = 0;
    }
    lastTextLength = state.answerTextLength;
    await page.waitForTimeout(750);
  }
}

type AnswerCopyCandidate = {
  x: number;
  y: number;
  score: number;
  reason: string;
  label: string;
};

async function collectAnswerTextFromCopyButton(page: Page, engineType: string, queryText: string, timeoutMs: number): Promise<string> {
  return withClipboardLock(() => collectAnswerTextFromCopyButtonUnlocked(page, engineType, queryText, timeoutMs));
}

let clipboardLock: Promise<void> = Promise.resolve();

async function withClipboardLock<T>(task: () => Promise<T>): Promise<T> {
  // 系统剪贴板是全局资源；并发复制会造成答案串扰，必须加进程内锁。
  const previous = clipboardLock;
  let release: () => void = () => undefined;
  clipboardLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
  }
}

async function collectAnswerTextFromCopyButtonUnlocked(page: Page, engineType: string, queryText: string, timeoutMs: number): Promise<string> {
  await grantClipboardPermissions(page);
  await page.bringToFront().catch(() => undefined);

  // sentinel 用于区分“复制按钮没有生效”和“剪贴板中原本已有文本”。
  const sentinel = `__geo_answer_clipboard_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
  const sentinelWritten = await writeClipboardText(page, sentinel);
  const beforeText = sentinelWritten ? sentinel : await readClipboardText(page);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await revealLatestAnswerActions(page);
    const candidates = await findAnswerCopyButtonCandidates(page, engineType, queryText);
    for (const candidate of candidates.slice(0, 8)) {
      await page.mouse.click(candidate.x, candidate.y).catch(() => undefined);
      const copied = await waitForCopiedAnswerText(page, beforeText, sentinel, sentinelWritten, queryText, 3000);
      if (copied) return copied;
    }
    await page.waitForTimeout(500);
  }
  return "";
}

async function scrollToLatestAnswerBottom(page: Page) {
  await page
    .evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight);
      const isScrollable = (element: HTMLElement) => element.scrollHeight > element.clientHeight + 80;
      const scrollables = Array.from(document.querySelectorAll<HTMLElement>("main, div, section, article"))
        .filter(isScrollable)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          let score = element.scrollHeight - element.clientHeight;
          if (rect.left > 260) score += 800;
          if (rect.width > 480) score += 300;
          if (rect.top < window.innerHeight * 0.85) score += 120;
          return { element, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      for (const { element } of scrollables) {
        element.scrollTop = element.scrollHeight;
      }
    })
    .catch(() => undefined);
  await page.waitForTimeout(350).catch(() => undefined);
}

async function scrollToLatestAnswerTop(page: Page) {
  await page
    .evaluate(() => {
      window.scrollTo(0, 0);
      const isScrollable = (element: HTMLElement) => element.scrollHeight > element.clientHeight + 80;
      const scrollables = Array.from(document.querySelectorAll<HTMLElement>("main, div, section, article"))
        .filter(isScrollable)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          let score = element.scrollHeight - element.clientHeight;
          if (rect.left > 260) score += 800;
          if (rect.width > 480) score += 300;
          if (rect.top < window.innerHeight * 0.85) score += 120;
          return { element, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      for (const { element } of scrollables) {
        element.scrollTop = 0;
      }
    })
    .catch(() => undefined);
  await page.waitForTimeout(500).catch(() => undefined);
}

async function revealLatestAnswerActions(page: Page) {
  await page
    .evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight);
      const isScrollable = (element: HTMLElement) => element.scrollHeight > element.clientHeight + 80;
      const scrollables = Array.from(document.querySelectorAll<HTMLElement>("div, main, section, article"))
        .filter(isScrollable)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          let score = element.scrollHeight - element.clientHeight;
          if (rect.left > 240) score += 800;
          if (rect.width > 500) score += 300;
          if (rect.height > 300) score += 200;
          if (/(conversation|chat|message|scroll|content|main|body)/i.test(String(element.className || ""))) score += 200;
          return { element, score };
        })
        .sort((a, b) => b.score - a.score);
      for (const item of scrollables.slice(0, 4)) {
        item.element.scrollTop = item.element.scrollHeight;
      }
    })
    .catch(() => undefined);
  const viewport = page.viewportSize() || { width: 1440, height: 1000 };
  await page.mouse.move(Math.round(viewport.width * 0.48), Math.round(viewport.height * 0.72)).catch(() => undefined);
  await page.waitForTimeout(450);
}

async function grantClipboardPermissions(page: Page) {
  const origin = pageOrigin(page);
  if (!origin) return;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin }).catch(() => undefined);
}

function pageOrigin(page: Page) {
  try {
    return new URL(page.url()).origin;
  } catch {
    return "";
  }
}

async function writeClipboardText(page: Page, text: string): Promise<boolean> {
  await grantClipboardPermissions(page);
  return page
    .evaluate(async (value) => {
      if (!navigator.clipboard?.writeText) return false;
      await navigator.clipboard.writeText(value);
      return true;
    }, text)
    .catch(() => false);
}

async function readClipboardText(page: Page): Promise<string> {
  await grantClipboardPermissions(page);
  return page
    .evaluate(async () => {
      if (!navigator.clipboard?.readText) return "";
      return navigator.clipboard.readText();
    })
    .catch(() => "");
}

async function waitForCopiedAnswerText(
  page: Page,
  beforeText: string,
  sentinel: string,
  sentinelWritten: boolean,
  queryText: string,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const copied = normalizeCopiedAnswer(await readClipboardText(page));
    if (isValidCopiedAnswer(copied, beforeText, sentinel, sentinelWritten, queryText)) return copied;
    await page.waitForTimeout(200);
  }
  return "";
}

function normalizeCopiedAnswer(value: string) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function isValidCopiedAnswer(value: string, beforeText: string, sentinel: string, sentinelWritten: boolean, queryText: string) {
  if (!value) return false;
  if (value === sentinel) return false;
  if (/^(已复制|复制成功|copy|copied)$/i.test(value.trim())) return false;
  if (isCopiedQueryText(value, queryText)) return false;
  if (sentinelWritten) return true;
  if (value !== beforeText) return true;
  return value.length >= 20 && /[。！？.!?\n]|^\s*\d+[.、]/.test(value);
}

function isCopiedQueryText(value: string, queryText: string) {
  const normalizedValue = normalizeClipboardComparison(value);
  const normalizedQuery = normalizeClipboardComparison(queryText);
  if (!normalizedQuery) return false;
  if (normalizedValue === normalizedQuery) return true;

  const promptLabelRemoved = normalizedValue.replace(/^(用户|user|提问|问题|question|query|q)[:：-]?/i, "");
  if (promptLabelRemoved === normalizedQuery) return true;

  return normalizedValue.includes(normalizedQuery) && normalizedValue.length <= normalizedQuery.length + 24;
}

function normalizeClipboardComparison(value: string) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[\s"'“”‘’`*_#>「」『』（）()\[\]【】]/g, "")
    .replace(/[，,。.!！?？:：;；-]/g, "")
    .toLowerCase();
}

async function findAnswerCopyButtonCandidates(page: Page, engineType: string, queryText: string): Promise<AnswerCopyCandidate[]> {
  return page
    .evaluate(([engine, query]) => {
      type Candidate = {
        x: number;
        y: number;
        score: number;
        reason: string;
        label: string;
      };
      const engineType = String(engine || "");
      const copyPattern = /复制|拷贝|copy/i;
      const composerPattern = /发消息|发送消息|向千问提问|请输入|任务助手|PPT|AI\s*表格|图像生成|帮我写|超能模式|快速|语音输入/i;
      const minX = engineType === "doubao" ? 340 : 300;
      const viewportHeight = window.innerHeight || 1000;
      const seen = new Set<Element>();
      const candidates: Candidate[] = [];

      const normalize = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
      const compact = (value: unknown) =>
        normalize(value)
          .replace(/[\s"'“”‘’`*_#>「」『』（）()\[\]【】]/g, "")
          .replace(/[，,。.!！?？:：;；-]/g, "")
          .toLowerCase();
      const compactQuery = compact(query);
      // 候选按钮会排除靠近输入框或仅复制用户 Query 的控件，优先选择最新回答区域的复制操作。
      const isQueryContext = (text: string) => {
        if (!compactQuery) return false;
        const compactText = compact(text);
        if (compactText === compactQuery) return true;
        const labelRemoved = compactText.replace(/^(用户|user|提问|问题|question|query|q)/i, "");
        if (labelRemoved === compactQuery) return true;
        return compactText.includes(compactQuery) && compactText.length <= compactQuery.length + 80;
      };
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width >= 6 && rect.height >= 6;
      };
      const labelOf = (element: Element) =>
        normalize(
          [
            element.getAttribute("aria-label"),
            element.getAttribute("title"),
            element.getAttribute("data-testid"),
            element.getAttribute("data-test-id"),
            element.getAttribute("data-click"),
            element.getAttribute("class"),
            element.textContent
          ].join(" ")
        );
      const clickableOf = (element: Element) =>
        (element.closest("button,[role='button'],a,[tabindex],[onclick],[class*='btn'],[class*='button']") as HTMLElement | null) ||
        (element as HTMLElement);
      const composerTop = (() => {
        const inputSelectors = [
          "textarea",
          "input[type='text']",
          "input:not([type])",
          "[contenteditable='true']",
          "[contenteditable='plaintext-only']",
          "[role='textbox']"
        ];
        const inputs = inputSelectors
          .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
          .filter((element) => {
            if (!isVisible(element)) return false;
            const rect = element.getBoundingClientRect();
            return rect.top > viewportHeight * 0.45 && rect.width > 220 && rect.height > 24;
          })
          .map((element) => element.getBoundingClientRect().top);
        return inputs.length > 0 ? Math.min(...inputs) : viewportHeight * 0.92;
      })();

      const addCandidate = (element: Element, reason: string, baseScore: number) => {
        const clickable = clickableOf(element);
        if (!clickable || seen.has(clickable) || !isVisible(clickable)) return;
        const rect = clickable.getBoundingClientRect();
        if (rect.left < minX || rect.top < 80 || rect.top > composerTop - 8) return;
        if (rect.width > 180 || rect.height > 100) return;
        if (clickable.getAttribute("aria-disabled") === "true" || clickable.hasAttribute("disabled")) return;

        const label = labelOf(clickable) || labelOf(element);
        const localText = normalize(
          [
            clickable.parentElement?.textContent,
            clickable.parentElement?.parentElement?.textContent
          ].join(" ")
        );
        if (composerPattern.test(label) || composerPattern.test(localText)) return;
        if (isQueryContext(localText) || isQueryContext(label)) return;

        let score = baseScore + rect.top;
        if (copyPattern.test(label)) score += 1200;
        if (/赞|踩|喜欢|分享|重新|参考|来源|资料|朗读|more|更多/i.test(localText)) score += 180;
        if (clickable.closest("table,[role='table'],[class*='table']")) score -= 400;
        if (rect.width > 70) score -= Math.min(180, rect.width);

        seen.add(clickable);
        candidates.push({
          x: rect.left + Math.min(rect.width * 0.5, 20),
          y: rect.top + rect.height / 2,
          score,
          reason,
          label: label.slice(0, 120)
        });
      };

      Array.from(document.querySelectorAll<HTMLElement>("button,[role='button'],[aria-label],[title],[data-testid],[data-test-id],svg"))
        .filter(isVisible)
        .forEach((element) => {
          const label = `${labelOf(element)} ${labelOf(clickableOf(element))}`;
          if (copyPattern.test(label)) addCandidate(element, "copy-label", 1000);
        });

      const elements = Array.from(document.querySelectorAll<HTMLElement>("button,[role='button'],[tabindex='0'],svg"))
        .map(clickableOf)
        .filter((element, index, array) => element && array.indexOf(element) === index)
        .filter((element) => {
          if (!isVisible(element)) return false;
          const rect = element.getBoundingClientRect();
          if (rect.left < minX || rect.top < 80 || rect.top > composerTop - 8) return false;
          if (rect.width > 96 || rect.height > 72 || rect.width < 8 || rect.height < 8) return false;
          const label = labelOf(element);
          const localText = normalize(`${element.parentElement?.textContent || ""} ${element.parentElement?.parentElement?.textContent || ""}`);
          return !composerPattern.test(label) && !composerPattern.test(localText);
        });

      const groups = new Map<number, HTMLElement[]>();
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        const key = Math.round((rect.top + rect.height / 2) / 16);
        groups.set(key, [...(groups.get(key) || []), element]);
      }

      let chosenGroup: HTMLElement[] = [];
      let chosenScore = -Infinity;
      for (const group of groups.values()) {
        if (group.length < 3 || group.length > 14) continue;
        const sorted = group.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        const centerY = sorted.reduce((sum, element) => {
          const rect = element.getBoundingClientRect();
          return sum + rect.top + rect.height / 2;
        }, 0) / sorted.length;
        const groupText = normalize(
          sorted
            .map((element) => `${element.parentElement?.textContent || ""} ${element.parentElement?.parentElement?.textContent || ""}`)
            .join(" ")
        );
        if (composerPattern.test(groupText)) continue;
        const score = centerY + group.length * 20 + (/参考|来源|资料|赞|踩|分享|重新/i.test(groupText) ? 160 : 0);
        if (score > chosenScore) {
          chosenScore = score;
          chosenGroup = sorted;
        }
      }

      const first = chosenGroup[0];
      if (first) addCandidate(first, "bottom-action-row", 800);

      return candidates.sort((a, b) => b.score - a.score).slice(0, 10);
    }, [engineType, queryText])
    .catch(() => []);
}

async function collectGenericSources(page: Page): Promise<CollectedSource[]> {
  const links = await page
    .locator("a[href^='http']")
    .evaluateAll((anchors) =>
      (anchors as Array<HTMLAnchorElement>)
        .slice(0, 80)
        .map((anchor, index) => ({
          url: anchor.href,
          title: (anchor.textContent || anchor.hostname || "Untitled").trim().slice(0, 160),
          sourceType: "",
          position: index + 1
        }))
    )
    .catch(() => []);
  return links;
}

async function collectVisibleHttpUrls(page: Page): Promise<string[]> {
  return page
    .locator("a[href^='http']")
    .evaluateAll((anchors) =>
      Array.from(anchors)
        .filter((anchor) => {
          const rect = anchor.getBoundingClientRect();
          const style = window.getComputedStyle(anchor);
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
        })
        .map((anchor) => (anchor as HTMLAnchorElement).href)
    )
    .catch(() => []);
}

async function waitForPromptInput(page: Page, engineType: string, timeoutMs: number): Promise<Locator | null> {
  const selectorGroups: Array<string[]> = [
    [
      "[contenteditable='true'][contenteditable='plaintext-only']:visible",
      "[contenteditable='plaintext-only']:visible",
      "div[role='textbox']:visible",
      "div[contenteditable='true']:visible"
    ],
    ["textarea:visible", "input[type='text']:visible", "input:not([type]):visible"],
    [
      "[contenteditable='true'][aria-label]:visible",
      "[contenteditable='true'][placeholder]:visible",
      "[role='textbox'][aria-label]:visible",
      "[contenteditable='true'][tabindex='0']:visible"
    ]
  ];
  const doubaoSelectors = [
    "div[contenteditable='true'][class*='input']:visible",
    "div[contenteditable='plaintext-only'][class*='input']:visible",
    "div[contenteditable='true'][class*='textarea']:visible",
    "div[contenteditable='plaintext-only'][class*='textarea']:visible",
    "div[contenteditable='true'][role='textbox']:visible"
  ];
  const selectors = engineType === "doubao" ? [...selectorGroups.flat(), ...doubaoSelectors] : selectorGroups.flat();
  const viewportWidth = (page.viewportSize()?.width ?? 1366) || 1366;
  const viewportHeight = (page.viewportSize()?.height ?? 1000) || 1000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // 不同平台输入框结构差异很大，按可见面积、位置、role 和提示语综合评分选择最可能的输入框。
    const candidates: Array<{ locator: Locator; score: number }> = [];
    for (const selector of selectors) {
      const rawCount = await page.locator(selector).count().catch(() => 0);
      const maxIndex = Math.min(rawCount, 16);
      for (let index = 0; index < maxIndex; index++) {
        const locator = page.locator(selector).nth(index);
        if (!(await locator.isVisible().catch(() => false))) continue;
        const metadata = await locator
          .evaluate((element) => {
            const box = element.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0) return null;
            return {
              tagName: element.tagName.toLowerCase(),
              role: element.getAttribute("role") || "",
              placeholder: element.getAttribute("placeholder") || "",
              ariaLabel: element.getAttribute("aria-label") || "",
              ariaPlaceholder: element.getAttribute("aria-placeholder") || "",
              title: element.getAttribute("title") || "",
              x: box.left,
              y: box.top,
              width: box.width,
              height: box.height,
              hasValue: "value" in element
            };
          })
          .catch(() => null);
        if (!metadata) continue;
        if (metadata.width * metadata.height < 250) continue;
        if (metadata.width < 80 || metadata.height < 16) continue;
        const hasLikelyPromptHint = /输入|请输入|prompt|message|question|search|ask|query/i.test(
          `${metadata.placeholder}${metadata.ariaLabel}${metadata.ariaPlaceholder}${metadata.title}`
        );
        const bottomBias = metadata.y > viewportHeight * 0.48 ? 900 : -600;
        const leftBias = metadata.x > viewportWidth * 0.6 ? 80 : 0;
        const middleBias = metadata.width < 120 ? -180 : 0;
        const roleBias = metadata.tagName === "textarea" || metadata.role === "textbox" ? 260 : 0;
        const areaBias = Math.log2(Math.max(metadata.width * metadata.height, 1));
        const placeholderPenalty = hasLikelyPromptHint ? 0 : -60;
        const score = metadata.y + bottomBias + leftBias + middleBias + roleBias + areaBias + placeholderPenalty;
        candidates.push({ locator, score });
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0].locator;
    }
    await page.waitForTimeout(700);
  }
  return null;
}

async function collectEngineSpecificSources(page: Page, engineType: string): Promise<CollectedSource[]> {
  if (engineType === "qianwen") {
    return collectQianwenSources(page);
  }
  if (engineType === "doubao") {
    return collectDoubaoSources(page);
  }
  return [];
}

async function collectQianwenSources(page: Page): Promise<CollectedSource[]> {
  const before = new Set((await collectVisibleHttpUrls(page)).filter((item) => Boolean(item)));
  // 千问优先读取“搜索内容/深度思考”卡片，再回退到参考来源面板和可见区域抽取。
  const openedBySearchContent = await clickQianwenSearchContentTrigger(page, 12000);
  if (openedBySearchContent) {
    await waitForQianwenDeepThinkSourceCards(page, COLLECTION_WAIT_MS);
    const deepThinkSources = await collectQianwenDeepThinkSourceCards(page);
    if (deepThinkSources.length > 0) return deepThinkSources;
  }

  const hasReferenceTrigger = await hasCurrentAnswerReferenceTrigger(page, "qianwen");
  if (!hasReferenceTrigger && !openedBySearchContent) return [];

  const opened = openedBySearchContent || await clickQianwenReferenceAnchor(page, 90000) || await expandReferenceSection(
    page,
    [/(\d+\s*)?篇来源/, /参考来源/i, /参考资料/i, /资料来源/i, /引用来源/i, /来源\s*\d+/],
    ["参考来源", "篇来源", "来源", "参考资料", "资料来源", "搜索来源", "引用", "引用来源"]
  );
  if (opened) {
    await waitForQianwenDeepThinkSourceCards(page, 3000);
    const deepThinkSources = await collectQianwenDeepThinkSourceCards(page);
    if (deepThinkSources.length > 0) return deepThinkSources;
    await waitForQianwenReferenceCards(page, COLLECTION_WAIT_MS);
    await waitForReferenceLinks(page, before, 1200);
  }

  let qianwenCardSources = await collectQianwenReferenceCardsWithRetry(page, opened ? COLLECTION_WAIT_MS : 5000);
  if (qianwenCardSources.length > 0) return qianwenCardSources;

  const reopened = await clickQianwenReferenceAnchor(page, 15000);
  if (reopened) {
    await waitForQianwenReferenceCards(page, COLLECTION_WAIT_MS);
    qianwenCardSources = await collectQianwenReferenceCardsWithRetry(page, COLLECTION_WAIT_MS);
  }
  if (qianwenCardSources.length > 0) return qianwenCardSources;

  const panelSources = await collectSourcesFromKeywordPanel(
    page,
    "qianwen",
    before,
    ["参考来源", "篇来源", "来源", "参考资料", "资料来源", "引用来源"]
  );
  if (panelSources.length > 0) return panelSources;

  const extracted = await collectReferenceFromOpenRegion(page, "qianwen", before);
  if (extracted.length > 0) return extracted;

  return [];
}

async function collectDoubaoSources(page: Page): Promise<CollectedSource[]> {
  const before = new Set((await collectVisibleHttpUrls(page)).filter((item) => Boolean(item)));
  // 豆包引用可能出现在消息操作、结构化引用、关键词面板或正文文本中，按可信度从高到低尝试。
  const messageActionSources = await collectDoubaoMessageActionReferences(page);
  if (messageActionSources.length > 0) return messageActionSources;

  const structuredSources = await collectDoubaoStructuredReferences(page);
  if (structuredSources.length > 0) return structuredSources;

  const hasReferenceTrigger = await hasCurrentAnswerReferenceTrigger(page, "doubao");
  if (!hasReferenceTrigger) return [];

  const opened = await clickDoubaoReferenceTriggerDirect(page) || await clickDoubaoReferenceAnchor(page, before, 15000) || await expandReferenceSection(
    page,
    [/搜索\s*\d*\s*个关键词.*参考\s*\d*\s*篇资料/, /参考\s*\d+\s*篇资料/, /参考\s*\d+\s*条资料/, /搜索.*参考/],
    ["搜索", "参考", "关键词", "资料"]
  );
  if (opened) {
    await waitForDoubaoReferenceCards(page, before, 8000);
    await waitForReferenceLinks(page, before, 3200);
  }

  const cardSources = await collectDoubaoReferenceCardsWithRetry(page, before, opened ? 8000 : 0);
  if (cardSources.length > 0) return cardSources;

  const panelSources = await collectSourcesFromKeywordPanel(
    page,
    "doubao",
    before,
    ["搜索", "参考", "关键词", "资料"]
  );
  if (panelSources.length > 0) return panelSources;

  const extracted = await collectReferenceFromOpenRegion(page, "doubao", before);
  if (extracted.length > 0) return extracted;
  const textSources = await collectDoubaoSourcesFromVisibleText(page);
  if (textSources.length > 0) return textSources;
  return [];
}

async function collectDoubaoMessageActionReferences(page: Page): Promise<CollectedSource[]> {
  const alreadyOpen = await collectDoubaoMessageActionReferenceRows(page);
  if (alreadyOpen.length > 0) return alreadyOpen;

  const clicked = await clickDoubaoMessageActionReferenceButton(page);
  if (!clicked) return [];

  await waitForDoubaoMessageActionReferenceList(page, 8000);
  return collectDoubaoMessageActionReferenceRows(page);
}

async function clickDoubaoMessageActionReferenceButton(page: Page): Promise<boolean> {
  const clicked = await page
    .evaluate(() => {
      const requiredClasses = ["message-action-button-third", "flex", "w-fit", "min-w-0", "items-center", "gap-12", "self-center"];
      const referencePattern = /搜索|参考|引用|来源|资料/i;
      const nonReferencePattern = /复制|拷贝|copy|点赞|点踩|喜欢|不喜欢|分享|share|重新|regenerate/i;
      const normalizeText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
      const hasClasses = (element: Element, classes: string[]) => classes.every((className) => element.classList.contains(className));
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 4 && rect.height > 4;
      };
      const dispatchActivation = (element: HTMLElement) => {
        element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        const init = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          view: window
        };
        const pointerCtor = typeof window.PointerEvent === "function" ? window.PointerEvent : window.MouseEvent;
        element.dispatchEvent(new pointerCtor("pointerdown", init));
        element.dispatchEvent(new MouseEvent("mousedown", init));
        element.dispatchEvent(new pointerCtor("pointerup", init));
        element.dispatchEvent(new MouseEvent("mouseup", init));
        element.dispatchEvent(new MouseEvent("click", init));
        element.click();
      };

      const candidates = Array.from(document.querySelectorAll<HTMLElement>("div.message-action-button-third, div[class*='message-action-button-third']"))
        .filter((element) => isVisible(element))
        .filter((element) => !element.closest("nav,aside,header,footer"))
        .filter((element) => !/(sidebar|side-bar|history|nav|menu|composer|input|prompt)/i.test(String(element.className || "")))
        .map((element) => {
          const clickable =
            (element.closest("button, [role='button'], [onclick], [tabindex], [class*='button'], [class*='btn']") as HTMLElement | null) ||
            element;
          const rect = clickable.getBoundingClientRect();
          const ownText = normalizeText(element.textContent || "");
          const contextText = normalizeText([
            ownText,
            clickable.textContent,
            clickable.parentElement?.textContent,
            clickable.parentElement?.parentElement?.textContent
          ].join(" "));
          let score = 0;
          if (hasClasses(element, requiredClasses)) score += 1200;
          if (referencePattern.test(contextText)) score += 500;
          if (nonReferencePattern.test(ownText) || nonReferencePattern.test(String(element.getAttribute("aria-label") || ""))) score -= 900;
          if (clickable.getAttribute("aria-disabled") === "true" || clickable.hasAttribute("disabled")) score -= 900;
          if (rect.left > 260) score += 80;
          score += rect.top;
          return { clickable, score };
        })
        .filter((item) => item.score > -400)
        .sort((a, b) => b.score - a.score);

      const target = candidates[0]?.clickable;
      if (!target || !isVisible(target)) return false;
      dispatchActivation(target);
      return true;
    })
    .catch(() => false);

  if (clicked) await page.waitForTimeout(1200).catch(() => undefined);
  return clicked;
}

async function waitForDoubaoMessageActionReferenceList(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await collectDoubaoMessageActionReferenceRows(page);
    if (rows.length > 0) return true;
    await page.waitForTimeout(350).catch(() => undefined);
  }
  return false;
}

async function collectDoubaoMessageActionReferenceRows(page: Page): Promise<CollectedSource[]> {
  type SourceRow = {
    url: string;
    title: string;
    sourceType: string;
    position: number;
    summary?: string;
    keyword?: string;
    siteName?: string;
  };
  type SourceRowCandidate = SourceRow & {
    citationNumber?: number;
    domOrder: number;
  };

  const raw = await page
    .evaluate(() => {
      const normalizeText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
      const normalizeUrl = (value: string) => {
        const trimmed = String(value || "").trim();
        if (!trimmed) return "";
        try {
          const parsed = new URL(trimmed, window.location.href);
          const redirected = parsed.searchParams.get("target") || parsed.searchParams.get("url") || parsed.searchParams.get("u");
          if (redirected && /^https?:\/\//i.test(redirected)) return decodeURIComponent(redirected);
          return parsed.href;
        } catch {
          return trimmed;
        }
      };
      const ignoredHost = (url: string) => {
        try {
          const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
          return /doubao\.com$|byteimg\.com$|bytedance\.com$|wtturl\.cn$/.test(host);
        } catch {
          return false;
        }
      };
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      };
      const linkFromRow = (row: HTMLElement): Element | null => {
        if (row.hasAttribute("href")) return row;
        return row.querySelector("[class*='search'][href], a[href], [href]");
      };
      const textFromRow = (row: HTMLElement, list: HTMLElement, selector: string): string => {
        let current: HTMLElement | null = row;
        while (current) {
          const node = current.querySelector<HTMLElement>(selector);
          if (node?.textContent) return node.textContent;
          if (current === list) break;
          current = current.parentElement;
        }
        return "";
      };
      const citationNumberFromRow = (row: HTMLElement, list: HTMLElement): number | undefined => {
        const citationText = normalizeText(textFromRow(row, list, "span[class*='footer-citation']"));
        const match = citationText.match(/\d+/);
        if (match) {
          const value = Number(match[0]);
          if (Number.isFinite(value) && value > 0) return value;
        }
        return undefined;
      };
      const footerTitleFromRow = (row: HTMLElement, list: HTMLElement): string => {
        return row.querySelector<HTMLElement>("span[class*='footer-title']")?.textContent || textFromRow(row, list, "span[class*='footer-title']");
      };
      const appendRowsFromList = (list: HTMLElement, rows: SourceRowCandidate[], seen: Set<string>) => {
        const candidates = Array.from(list.querySelectorAll<HTMLElement>("div.w-full"))
          .filter((row) => isVisible(row))
          .filter((row) => Boolean(linkFromRow(row)))
          .filter((row) => Boolean(row.querySelector("[class*='search-item-title']") || row.querySelector("[class*='search-item-summary']")));

        for (const row of candidates) {
          const link = linkFromRow(row);
          if (!link) continue;
          const url = normalizeUrl(link.getAttribute("href") || "");
          if (!/^https?:\/\//i.test(url) || ignoredHost(url)) continue;
          const lower = url.toLowerCase();
          if (seen.has(lower)) continue;
          seen.add(lower);

          const titleNode = row.querySelector<HTMLElement>("[class*='search-item-title']");
          const summaryNode = row.querySelector<HTMLElement>("[class*='search-item-summary']");
          const title = titleNode?.textContent || link.textContent || url;
          const summary = summaryNode?.textContent || row.textContent || "";
          const domOrder = rows.length + 1;
          const citationNumber = citationNumberFromRow(row, list);
          const siteName = footerTitleFromRow(row, list);

          rows.push({
            url,
            title,
            summary,
            keyword: "",
            siteName,
            sourceType: "",
            position: citationNumber ?? domOrder,
            citationNumber,
            domOrder
          });
        }
      };

      const lists = Array.from(document.querySelectorAll<HTMLElement>("div[class*='search-item-transition']"))
        .filter((element) => isVisible(element))
        .filter((element) => element.querySelector("div.w-full"));

      const rows: SourceRowCandidate[] = [];
      const seen = new Set<string>();
      for (const list of lists) {
        appendRowsFromList(list, rows, seen);
        if (rows.length >= 30) break;
      }

      return rows
        .sort((a, b) => {
          const aCitation = a.citationNumber ?? Number.MAX_SAFE_INTEGER;
          const bCitation = b.citationNumber ?? Number.MAX_SAFE_INTEGER;
          return aCitation - bCitation || a.domOrder - b.domOrder;
        })
        .slice(0, 30)
        .map(({ citationNumber, domOrder, ...row }, index) => ({
          ...row,
          position: citationNumber ?? row.position ?? index + 1
        }));
    })
    .catch(() => [] as SourceRow[]);

  return raw.filter((item) => Boolean(item.url));
}

async function collectDoubaoStructuredReferences(page: Page): Promise<CollectedSource[]> {
  const alreadyOpen = await collectDoubaoStructuredReferenceRows(page);
  if (alreadyOpen.length > 0) return alreadyOpen;

  const clicked = await clickDoubaoStructuredReferenceTrigger(page);
  if (!clicked) return [];

  await waitForDoubaoStructuredReferenceList(page, 6000);
  return collectDoubaoStructuredReferenceRows(page);
}

async function clickDoubaoStructuredReferenceTrigger(page: Page): Promise<boolean> {
  const clicked = await page
    .evaluate(() => {
      const requiredClasses = ["flex", "flex-col", "gap-2", "w-full"];
      const referencePattern = /搜索\s*\d*\s*个关键词|参考\s*\d+\s*(?:篇|条)资料|引用|来源|资料/i;
      const normalizeText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
      const hasClasses = (element: Element, classes: string[]) => classes.every((className) => element.classList.contains(className));
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 12 && rect.height > 8;
      };
      const dispatchActivation = (element: HTMLElement) => {
        element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        const init = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          view: window
        };
        const pointerCtor = typeof window.PointerEvent === "function" ? window.PointerEvent : window.MouseEvent;
        element.dispatchEvent(new pointerCtor("pointerdown", init));
        element.dispatchEvent(new MouseEvent("mousedown", init));
        element.dispatchEvent(new pointerCtor("pointerup", init));
        element.dispatchEvent(new MouseEvent("mouseup", init));
        element.dispatchEvent(new MouseEvent("click", init));
        element.click();
      };

      const candidates = Array.from(document.querySelectorAll<HTMLElement>("div"))
        .filter((element) => hasClasses(element, requiredClasses) && isVisible(element))
        .filter((element) => !element.closest("nav,aside,header,footer"))
        .filter((element) => !/(sidebar|side-bar|history|nav|menu|composer|input|prompt)/i.test(String(element.className || "")))
        .filter((element) => {
          const text = normalizeText(element.textContent || "");
          return referencePattern.test(text) || element.querySelectorAll("a[href]").length > 0;
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = normalizeText(element.textContent || "");
          const anchorCount = element.querySelectorAll("a[href]").length;
          let score = rect.top;
          if (referencePattern.test(text)) score += 1000;
          if (anchorCount > 0) score += 120;
          if (rect.left > 260) score += 80;
          if (text.length > 220) score -= Math.min(500, text.length);
          return { element, score };
        })
        .sort((a, b) => b.score - a.score);

      const target = candidates[0]?.element;
      if (!target) return false;
      dispatchActivation(target);
      return true;
    })
    .catch(() => false);

  if (clicked) await page.waitForTimeout(900).catch(() => undefined);
  return clicked;
}

async function waitForDoubaoStructuredReferenceList(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page
      .evaluate(() => {
        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 12 && rect.height > 8;
        };
        const isReferenceList = (element: Element) =>
          element.classList.contains("relative") &&
          element.classList.contains("mt-[-8px]") &&
          element.classList.contains("flex") &&
          element.classList.contains("w-full") &&
          element.classList.contains("min-w-0") &&
          element.classList.contains("flex-col");
        return Array.from(document.querySelectorAll<HTMLElement>("div"))
          .filter((element) => isReferenceList(element) && isVisible(element))
          .reduce((sum, element) => sum + element.querySelectorAll("a[href]").length, 0);
      })
      .catch(() => 0);
    if (count > 0) return true;
    await page.waitForTimeout(300).catch(() => undefined);
  }
  return false;
}

async function collectDoubaoStructuredReferenceRows(page: Page): Promise<CollectedSource[]> {
  type SourceRow = {
    url: string;
    title: string;
    sourceType: string;
    position: number;
    summary?: string;
    keyword?: string;
    siteName?: string;
  };

  const raw = await page
    .evaluate(() => {
      const normalizeText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
      const normalizeUrl = (value: string) => {
        const trimmed = String(value || "").trim();
        if (!trimmed) return "";
        try {
          const parsed = new URL(trimmed, window.location.href);
          const redirected = parsed.searchParams.get("target") || parsed.searchParams.get("url") || parsed.searchParams.get("u");
          if (redirected && /^https?:\/\//i.test(redirected)) return decodeURIComponent(redirected);
          return parsed.href;
        } catch {
          return trimmed;
        }
      };
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      };
      const isReferenceList = (element: Element) =>
        element.classList.contains("relative") &&
        element.classList.contains("mt-[-8px]") &&
        element.classList.contains("flex") &&
        element.classList.contains("w-full") &&
        element.classList.contains("min-w-0") &&
        element.classList.contains("flex-col");
      const isTitleNode = (element: Element) =>
        element.classList.contains("flex-1") &&
        element.classList.contains("truncate") &&
        element.classList.contains("text-dbx-text-highlight");
      const titleForAnchor = (anchor: HTMLAnchorElement) => {
        let node: Element | null = anchor;
        for (let depth = 0; depth < 6 && node; depth += 1) {
          const anchorCount = node.querySelectorAll("a[href]").length;
          const titleNode = isTitleNode(node)
            ? node
            : Array.from(node.querySelectorAll<HTMLElement>("div")).find(isTitleNode) || null;
          if (titleNode && (anchorCount <= 1 || node === anchor)) {
            return normalizeText(titleNode.textContent || "");
          }
          node = node.parentElement;
        }
        return normalizeText(anchor.textContent || anchor.getAttribute("aria-label") || anchor.title || anchor.hostname || "");
      };
      const footerTitleForAnchor = (anchor: HTMLAnchorElement, row: Element): string => {
        let node: Element | null = row || anchor;
        for (let depth = 0; depth < 8 && node; depth += 1) {
          const footerTitle = node.querySelector<HTMLElement>("span[class*='footer-title']");
          if (footerTitle?.textContent) return footerTitle.textContent;
          node = node.parentElement;
        }
        return "";
      };

      const rows: SourceRow[] = [];
      const seen = new Set<string>();
      const lists = Array.from(document.querySelectorAll<HTMLElement>("div"))
        .filter((element) => isReferenceList(element) && isVisible(element))
        .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);

      for (const list of lists) {
        const anchors = Array.from(list.querySelectorAll<HTMLAnchorElement>("a[href]")).filter(isVisible);
        for (const anchor of anchors) {
          const url = normalizeUrl(anchor.getAttribute("href") || anchor.href || "");
          if (!/^https?:\/\//i.test(url)) continue;
          const lower = url.toLowerCase();
          if (seen.has(lower)) continue;
          seen.add(lower);

          const row = anchor.closest("li, [role='listitem'], article, section, div") || anchor;
          const title = titleForAnchor(anchor) || url;
          rows.push({
            url,
            title,
            sourceType: "",
            position: rows.length + 1,
            summary: normalizeText(row.textContent || "").replace(title, "").slice(0, 600),
            keyword: "",
            siteName: footerTitleForAnchor(anchor, row)
          });
        }
        if (rows.length > 0) break;
      }

      return rows.slice(0, 30);
    })
    .catch(() => [] as SourceRow[]);

  return raw.filter((item) => Boolean(item.url)).map((item, index) => ({ ...item, position: index + 1 }));
}

async function clickDoubaoReferenceTriggerDirect(page: Page): Promise<boolean> {
  const clicked = await page
    .evaluate(() => {
      const normalizeText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
      const referencePattern = /(?:搜索\s*\d*\s*个关键词\s*[，,、]?\s*)?参考\s*\d+\s*(?:篇|条)资料|搜索\s*\d+\s*个关键词/i;
      const isDisplayed = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      };
      const dispatchActivation = (element: HTMLElement) => {
        element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        const init = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          view: window
        };
        const pointerCtor = typeof window.PointerEvent === "function" ? window.PointerEvent : window.MouseEvent;
        element.dispatchEvent(new pointerCtor("pointerdown", init));
        element.dispatchEvent(new MouseEvent("mousedown", init));
        element.dispatchEvent(new pointerCtor("pointerup", init));
        element.dispatchEvent(new MouseEvent("mouseup", init));
        element.dispatchEvent(new MouseEvent("click", init));
        element.click();
      };
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], a, div, span, p"))
        .filter((element) => {
          if (!isDisplayed(element)) return false;
          const text = normalizeText(element.textContent || "");
          if (!referencePattern.test(text) || text.length > 180) return false;
          if (element.closest("nav,aside,header,footer")) return false;
          if (/(sidebar|side-bar|history|nav|menu|composer|input|prompt)/i.test(String(element.className || ""))) return false;
          return true;
        })
        .map((element) => {
          const clickable =
            (element.closest(
              "button, [role='button'], a, [onclick], [class*='reference'], [class*='source'], [class*='search'], [class*='link'], [class*='btn'], [class*='button']"
            ) as HTMLElement | null) || element;
          const rect = element.getBoundingClientRect();
          const clickableText = normalizeText(clickable.textContent || "");
          let score = 0;
          if (referencePattern.test(clickableText) && clickableText.length <= 220) score += 400;
          if (/button|btn|link|reference|source|search|answer|operation|tool/.test(String(clickable.className || "").toLowerCase())) score += 80;
          if (clickable.getAttribute("role") === "button" || clickable.tagName.toLowerCase() === "button") score += 60;
          score += Math.max(0, Math.round(rect.left / 20));
          score -= Math.max(0, clickableText.length - 100);
          return { clickable, score };
        })
        .sort((a, b) => b.score - a.score);
      const target = candidates[0]?.clickable;
      if (!target || !isDisplayed(target)) return false;
      dispatchActivation(target);
      return true;
    })
    .catch(() => false);
  if (clicked) {
    await page.waitForTimeout(1500).catch(() => undefined);
  }
  return clicked;
}

async function hasCurrentAnswerReferenceTrigger(page: Page, engineType: "qianwen" | "doubao"): Promise<boolean> {
  return page
    .evaluate((type) => {
      const normalizeText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
      const triggerPattern =
        type === "qianwen"
          ? /(?:^|\s)\d+\s*篇来源(?:\s|$)|参考来源\s*\(\d+\)|参考资料|资料来源|引用来源/i
          : /搜索\s*\d+\s*个关键词\s*[，,、]?\s*参考\s*\d+\s*(?:篇|条)资料|参考\s*\d+\s*(?:篇|条)资料/i;
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      };
      const inputSelectors = [
        "textarea",
        "input[type='text']",
        "input:not([type])",
        "[contenteditable='true']",
        "[contenteditable='plaintext-only']",
        "[role='textbox']"
      ];
      const composerTops = inputSelectors
        .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
        .filter((element) => {
          if (!isVisible(element)) return false;
          const rect = element.getBoundingClientRect();
          return rect.top > window.innerHeight * 0.35 && rect.width > 220;
        })
        .map((element) => element.getBoundingClientRect().top);
      const composerTop = composerTops.length > 0 ? Math.min(...composerTops) : window.innerHeight;
      const elements = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], a, div, span, p, em, sup"))
        .filter((element) => {
          if (!isVisible(element)) return false;
          const rect = element.getBoundingClientRect();
          if (rect.left < 260 || rect.width < 4) return false;
          if (type === "qianwen" && (rect.top < 70 || rect.top > composerTop + 48)) return false;
          if (type === "doubao" && rect.top > composerTop + 48) return false;
          if (element.closest("nav,aside,header,footer")) return false;
          if (/(sidebar|side-bar|history|nav|menu|composer|input|prompt)/i.test(String(element.className || ""))) return false;
          return true;
        });
      return elements.some((element) => {
        const text = normalizeText(element.textContent || "");
        if (!text || text.length > 180) return false;
        return triggerPattern.test(text);
      });
    }, engineType)
    .catch(() => false);
}

async function clickDoubaoReferenceAnchor(page: Page, preUrls: Set<string>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const pattern = /(?:搜索\s*\d*\s*个关键词\s*[，,、]?\s*)?参考\s*\d+\s*(?:篇|条)资料|搜索\s*\d+\s*个关键词/i;
  while (Date.now() < deadline) {
    if (await waitForDoubaoReferenceCards(page, preUrls, 300)) return true;

    const candidates = await page
      .evaluate(() => {
        const normalizeText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
        };
        const referencePattern = /(?:搜索\s*\d*\s*个关键词\s*[，,、]?\s*)?参考\s*\d+\s*(?:篇|条)资料|搜索\s*\d+\s*个关键词/i;
        const elements = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], a, div, span, p"))
          .filter(isVisible)
          .map((element) => {
            const text = normalizeText(element.textContent || "");
            const rect = element.getBoundingClientRect();
            const className = String(element.className || "").toLowerCase();
            const role = element.getAttribute("role") || "";
            const clickable =
              (element.closest(
                "button, [role='button'], a, [onclick], [class*='reference'], [class*='source'], [class*='search'], [class*='link'], [class*='btn'], [class*='button']"
              ) as HTMLElement | null) || element;
            const clickableRect = clickable.getBoundingClientRect();
            const clickableClass = String(clickable.className || "").toLowerCase();
            let score = 0;
            if (referencePattern.test(text)) score += 300;
            if (/参考|资料|搜索|关键词/.test(text)) score += 80;
            if (/button|btn|link|reference|source|search|answer|operation|tool/.test(`${className} ${clickableClass}`)) score += 45;
            if (role === "button" || clickable.getAttribute("role") === "button") score += 30;
            if (text.length <= 80) score += 40;
            if (rect.top > window.innerHeight * 0.35) score += 30;
            score += Math.max(0, Math.round(rect.left / 18));
            return {
              text,
              score,
              x: clickableRect.left + clickableRect.width / 2,
              y: clickableRect.top + clickableRect.height / 2,
              width: clickableRect.width,
              height: clickableRect.height
            };
          })
          .filter((item) => referencePattern.test(item.text) && item.width > 2 && item.height > 2)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);
        return elements;
      })
      .catch(() => [] as Array<{ x: number; y: number; width: number; height: number }>);

    for (const candidate of candidates) {
      await page.mouse.click(candidate.x, candidate.y).catch(() => undefined);
      await page.waitForTimeout(900);
      if (await waitForDoubaoReferenceCards(page, preUrls, 3500)) return true;
    }

    const clickedByScript = await page
      .evaluate(() => {
        const normalizeText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
        };
        const dispatchActivation = (element: HTMLElement) => {
          element.scrollIntoView({ block: "center", inline: "center" });
          const rect = element.getBoundingClientRect();
          const init = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            view: window
          };
          const pointerCtor = typeof window.PointerEvent === "function" ? window.PointerEvent : window.MouseEvent;
          element.dispatchEvent(new pointerCtor("pointerdown", init));
          element.dispatchEvent(new MouseEvent("mousedown", init));
          element.dispatchEvent(new pointerCtor("pointerup", init));
          element.dispatchEvent(new MouseEvent("mouseup", init));
          element.dispatchEvent(new MouseEvent("click", init));
          element.click();
        };
        const referencePattern = /(?:搜索\s*\d*\s*个关键词\s*[，,、]?\s*)?参考\s*\d+\s*(?:篇|条)资料|搜索\s*\d+\s*个关键词/i;
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], a, div, span, p"))
          .filter((element) => isVisible(element) && referencePattern.test(normalizeText(element.textContent || "")))
          .map((element) => {
            const clickable =
              (element.closest(
                "button, [role='button'], a, [onclick], [class*='reference'], [class*='source'], [class*='search'], [class*='link'], [class*='btn'], [class*='button']"
              ) as HTMLElement | null) || element;
            const rect = clickable.getBoundingClientRect();
            const text = normalizeText(element.textContent || "");
            const className = String(clickable.className || "").toLowerCase();
            let score = 0;
            if (/参考\s*\d+\s*(?:篇|条)资料/.test(text)) score += 200;
            if (/button|btn|link|reference|source|search|answer|operation|tool/.test(className)) score += 50;
            if (text.length <= 80) score += 35;
            score += Math.max(0, Math.round(rect.left / 18));
            return { clickable, score };
          })
          .sort((a, b) => b.score - a.score);
        for (const item of candidates.slice(0, 8)) {
          if (!isVisible(item.clickable)) continue;
          dispatchActivation(item.clickable);
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (clickedByScript) {
      await page.waitForTimeout(900);
      if (await waitForDoubaoReferenceCards(page, preUrls, 3500)) return true;
    }

    await page.waitForTimeout(600);
  }
  return false;
}

async function waitForDoubaoReferenceCards(page: Page, preUrls: Set<string>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await countDoubaoReferenceCandidates(page, preUrls);
    if (count >= 2) return true;
    await page.waitForTimeout(450);
  }
  return false;
}

async function countDoubaoReferenceCandidates(page: Page, preUrls: Set<string>): Promise<number> {
  return page
    .evaluate((rawPreUrls) => {
      const normalizeText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
      const normalizeUrl = (value: string) => {
        const trimmed = String(value || "").trim();
        if (!trimmed) return "";
        if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?$/i.test(trimmed)) return `https://${trimmed}`;
        try {
          const parsed = new URL(trimmed, window.location.href);
          const redirected = parsed.searchParams.get("target") || parsed.searchParams.get("url") || parsed.searchParams.get("u");
          if (redirected && /^https?:\/\//i.test(redirected)) return decodeURIComponent(redirected);
          return parsed.href;
        } catch {
          return trimmed;
        }
      };
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      };
      const preSet = new Set(
        (rawPreUrls || []).flatMap((url) => {
          const normalized = normalizeUrl(url);
          return [url.toLowerCase(), normalized.toLowerCase()];
        })
      );
      const ignoreHost = (url: string) => {
        try {
          const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
          return /doubao\.com$|byteimg\.com$|bytedance\.com$|wtturl\.cn$/.test(host);
        } catch {
          return false;
        }
      };
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
        .filter(isVisible)
        .map((anchor) => normalizeUrl(anchor.getAttribute("href") || anchor.href || ""))
        .filter((url) => /^https?:\/\//i.test(url) && !preSet.has(url.toLowerCase()) && !ignoreHost(url));

      const bodyText = normalizeText(document.body.textContent || "");
      const referenceIndex = bodyText.search(/搜索\s*\d+\s*个关键词|参考\s*\d+\s*(?:篇|条)资料/i);
      const referenceText = referenceIndex >= 0 ? bodyText.slice(referenceIndex) : "";
      const domains = Array.from(referenceText.matchAll(/(?:[a-z0-9-]+\.)+[a-z]{2,}/gi))
        .map((match) => `https://${match[0].replace(/[),，。；;]+$/, "").toLowerCase()}`)
        .filter((url) => !preSet.has(url.toLowerCase()) && !ignoreHost(url));
      return new Set([...links, ...domains]).size;
    }, Array.from(preUrls))
    .catch(() => 0);
}

async function collectDoubaoReferenceCardsWithRetry(page: Page, preUrls: Set<string>, timeoutMs: number): Promise<CollectedSource[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sources = await collectDoubaoReferenceCards(page, preUrls);
    if (sources.length > 0) return sources;
    await page.waitForTimeout(500);
  }
  return collectDoubaoReferenceCards(page, preUrls);
}

async function collectDoubaoReferenceCards(page: Page, preUrls: Set<string>): Promise<CollectedSource[]> {
  type SourceRow = {
    url: string;
    title: string;
    sourceType: string;
    position: number;
    summary?: string;
    keyword?: string;
    siteName?: string;
  };

  const raw = await page
    .evaluate((rawPreUrls) => {
      const normalizeText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
      const normalizeUrl = (value: string) => {
        const trimmed = String(value || "").trim();
        if (!trimmed) return "";
        if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?$/i.test(trimmed)) return `https://${trimmed}`;
        try {
          const parsed = new URL(trimmed, window.location.href);
          const redirected = parsed.searchParams.get("target") || parsed.searchParams.get("url") || parsed.searchParams.get("u");
          if (redirected && /^https?:\/\//i.test(redirected)) return decodeURIComponent(redirected);
          return parsed.href;
        } catch {
          return trimmed;
        }
      };
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      };
      const preSet = new Set(
        (rawPreUrls || []).flatMap((url) => {
          const normalized = normalizeUrl(url);
          return [url.toLowerCase(), normalized.toLowerCase()];
        })
      );
      const ignoredHost = (url: string) => {
        try {
          const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
          return /doubao\.com$|byteimg\.com$|bytedance\.com$|wtturl\.cn$/.test(host);
        } catch {
          return false;
        }
      };
      const cleanSourceTitle = (text: string) => {
        return String(text || "");
      };
      const footerTitleFromNode = (element: Element | null): string => {
        let node: Element | null = element;
        for (let depth = 0; depth < 8 && node; depth += 1) {
          const footerTitle = node.querySelector<HTMLElement>("span[class*='footer-title']");
          if (footerTitle?.textContent) return footerTitle.textContent;
          node = node.parentElement;
        }
        return "";
      };
      const rows: SourceRow[] = [];
      const seen = new Set<string>();
      const bodyText = normalizeText(document.body.textContent || "");
      const keywordText = (() => {
        const referencePattern = /搜索\s*\d+\s*个关键词\s*[，,、]?\s*参考\s*\d+\s*(?:篇|条)资料/i;
        const triggerElements = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], a, div, span, p"))
          .filter((element) => isVisible(element))
          .filter((element) => {
            const text = normalizeText(element.textContent || "");
            return referencePattern.test(text) && text.length <= 180 && !element.closest("nav,aside,header,footer");
          })
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        for (const trigger of triggerElements) {
          let node: Element | null = trigger;
          const parts: string[] = [];
          for (let depth = 0; depth < 4 && node; depth += 1) {
            let sibling = node.nextElementSibling;
            for (let index = 0; index < 5 && sibling; index += 1) {
              const text = normalizeText(sibling.textContent || "");
              if (/^\d{1,2}\s*[.、]/.test(text) || sibling.querySelector("a[href]")) break;
              if (text && !referencePattern.test(text) && text.length >= 4 && text.length <= 320) parts.push(text);
              sibling = sibling.nextElementSibling;
            }
            node = node.parentElement;
          }
          const joined = normalizeText(parts.join(" "));
          const quoted = Array.from(joined.matchAll(/[“"]([^”"]{2,80})[”"]/g))
            .map((match) => match[1])
            .filter(Boolean);
          if (quoted.length > 0) return quoted.slice(0, 8).join("、").slice(0, 260);
        }
        return "";
      })();
      const addRow = (input: { url: string; title: string; summary?: string; keyword?: string; siteName?: string }) => {
        const url = normalizeUrl(input.url);
        if (!/^https?:\/\//i.test(url)) return;
        const lower = url.toLowerCase();
        if (preSet.has(lower) || seen.has(lower) || ignoredHost(url)) return;
        seen.add(lower);
        rows.push({
          url,
          title: cleanSourceTitle(input.title || "") || url,
          summary: input.summary || "",
          keyword: input.keyword || keywordText,
          siteName: input.siteName || "",
          sourceType: "",
          position: rows.length + 1
        });
      };
      const titleBeforeDomain = (text: string, domainIndex: number) => {
        const before = normalizeText(text.slice(Math.max(0, domainIndex - 220), domainIndex));
        const titleMatch = before.match(/(?:^|\s)(?:\d{1,2}\s+)?([^。；;]{6,180})$/);
        return cleanSourceTitle(titleMatch?.[1] || before);
      };
      const summaryAfterDomain = (text: string, domainIndex: number, domainLength: number, nextIndex: number) => {
        const after = text.slice(domainIndex + domainLength, Math.min(nextIndex, domainIndex + domainLength + 900));
        return after;
      };

      const visibleAnchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).filter(isVisible);
      for (const anchor of visibleAnchors) {
        const sourceNode =
          anchor.closest("li, article, section, [role='listitem'], [class*='source'], [class*='reference'], [class*='result'], [class*='card']") ||
          anchor.parentElement ||
          anchor;
        const rawNodeText = sourceNode.textContent || "";
        const nodeText = normalizeText(rawNodeText);
        if (/历史对话|新对话|下载电脑版|内容由豆包|消息|请输入|发消息/i.test(nodeText)) continue;
        addRow({
          url: anchor.getAttribute("href") || anchor.href,
          title: anchor.textContent || anchor.getAttribute("aria-label") || anchor.hostname,
          summary: rawNodeText,
          siteName: footerTitleFromNode(sourceNode)
        });
      }

      const candidates = Array.from(document.querySelectorAll<HTMLElement>("div, section, article, li"))
        .filter(isVisible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = normalizeText(element.textContent || "");
          const domainCount = (text.match(/(?:[a-z0-9-]+\.)+[a-z]{2,}/gi) || []).length;
          const linkCount = element.querySelectorAll("a[href^='http']").length;
          let score = 0;
          if (/搜索\s*\d+\s*个关键词|参考\s*\d+\s*(?:篇|条)资料|关键词|资料|来源/i.test(text)) score += 240;
          score += domainCount * 18 + linkCount * 10;
          if (rect.left > window.innerWidth * 0.45) score += 80;
          if (text.length > 40 && text.length < 1400) score += 30;
          if (text.length > 3000) score -= 120;
          return { text, score };
        })
        .filter(({ text, score }) => {
          if (score <= 0) return false;
          if (text.length < 20) return false;
          if (!/(?:[a-z0-9-]+\.)+[a-z]{2,}/i.test(text)) return false;
          if (/历史对话|新对话|下载电脑版|内容由豆包|消息|请输入|发消息/i.test(text)) return false;
          return true;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);

      for (const { text } of candidates) {
        const domainMatches = Array.from(text.matchAll(/(?:[a-z0-9-]+\.)+[a-z]{2,}/gi))
          .map((match) => ({ value: match[0].replace(/[),，。；;]+$/, ""), index: match.index || 0 }));
        for (let index = 0; index < domainMatches.length; index += 1) {
          const item = domainMatches[index];
          const rawDomain = item.value.toLowerCase();
          const url = `https://${rawDomain}`;
          const nextIndex = domainMatches[index + 1]?.index ?? text.length;
          addRow({
            url,
            title: titleBeforeDomain(text, item.index) || rawDomain,
            summary: summaryAfterDomain(text, item.index, item.value.length, nextIndex)
          });
          if (rows.length >= 30) break;
        }
        if (rows.length >= 30) break;
      }

      return rows.slice(0, 30);
    }, Array.from(preUrls))
    .catch(() => [] as SourceRow[]);

  return raw.filter((item) => Boolean(item.url)).map((item, index) => ({ ...item, position: index + 1 }));
}

async function collectDoubaoSourcesFromVisibleText(page: Page): Promise<CollectedSource[]> {
  type SourceRow = {
    url: string;
    title: string;
    sourceType: string;
    position: number;
    summary?: string;
    keyword?: string;
    siteName?: string;
  };
  const raw = await page
    .evaluate(() => {
      const normalizeText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      };
      const domainFromText = (value: string) => {
        const match = normalizeText(value).match(/(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i);
        return match ? match[0].replace(/[),，。；;]+$/, "") : "";
      };
      const footerTitleFromNode = (element: Element | null): string => {
        let node: Element | null = element;
        for (let depth = 0; depth < 8 && node; depth += 1) {
          const footerTitle = node.querySelector<HTMLElement>("span[class*='footer-title']");
          if (footerTitle?.textContent) return footerTitle.textContent;
          node = node.parentElement;
        }
        return "";
      };
      const rows: SourceRow[] = [];
      const seen = new Set<string>();
      const addRow = (input: { url: string; title: string; summary?: string; keyword?: string; siteName?: string }) => {
        if (!input.url) return;
        const lower = input.url.toLowerCase();
        if (seen.has(lower)) return;
        seen.add(lower);
        rows.push({
          url: input.url,
          title: input.title || input.url,
          summary: input.summary || "",
          keyword: input.keyword || "",
          siteName: input.siteName || "",
          sourceType: "",
          position: rows.length + 1
        });
      };

      const candidates = Array.from(document.querySelectorAll<HTMLElement>("div, section, article, li"))
        .filter(isVisible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = normalizeText(element.textContent || "");
          return { element, rect, text };
        })
        .filter(({ rect, text }) => {
          if (text.length < 28) return false;
          if (!/(?:[a-z0-9-]+\.)+[a-z]{2,}/i.test(text)) return false;
          if (/历史对话|新对话|下载电脑版|内容由豆包|消息|请输入|发消息/i.test(text)) return false;
          return rect.left > 280 || /参考|资料|来源|关键词/i.test(text);
        })
        .sort((a, b) => {
          const aScore = (/参考|资料|来源|关键词/i.test(a.text) ? 1000 : 0) + a.rect.top + Math.min(a.text.length, 600);
          const bScore = (/参考|资料|来源|关键词/i.test(b.text) ? 1000 : 0) + b.rect.top + Math.min(b.text.length, 600);
          return bScore - aScore;
        });

      for (const { element, text } of candidates.slice(0, 80)) {
        const anchors = Array.from(element.querySelectorAll<HTMLAnchorElement>("a[href^='http']"))
          .filter(isVisible)
          .map((anchor) => ({
            url: anchor.href,
            title: normalizeText(anchor.textContent || anchor.getAttribute("aria-label") || anchor.hostname),
            summary: normalizeText(anchor.closest("li,div,article,section")?.textContent || ""),
            sourceNode: anchor.closest("li,div,article,section") || anchor
          }));
        for (const anchor of anchors) {
          addRow({
            url: anchor.url,
            title: anchor.title || anchor.url,
            summary: anchor.summary.slice(0, 600),
            siteName: footerTitleFromNode(anchor.sourceNode)
          });
        }

        const domain = domainFromText(text);
        if (!domain) continue;
        const url = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
        const title = normalizeText(text.split(domain)[0].replace(/^\d+\s*/, "")).slice(0, 180);
        const summary = normalizeText(text.slice(text.indexOf(domain) + domain.length)).slice(0, 600);
        addRow({ url, title: title || domain, summary, siteName: footerTitleFromNode(element) });
      }
      return rows.slice(0, 30);
    })
    .catch(() => []) as SourceRow[];

  return raw.filter((item) => Boolean(item.url)).map((item, index) => ({ ...item, position: index + 1 }));
}

type CollectedSourceLike = {
  url: string;
  title: string;
  sourceType: string;
  position: number;
  summary?: string;
  keyword?: string;
  siteName?: string;
};

async function collectSourcesFromKeywordPanel(
  page: Page,
  engineType: "qianwen" | "doubao",
  preUrls: Set<string>,
  keywordHints: string[]
): Promise<CollectedSource[]> {
  const raw = await page
    .locator("a[href^='http']")
    .evaluateAll((anchors, args) => {
      const [engineType, preloaded, hints] = args as [string, string[], string[]];
      const preUrlSet = new Set((preloaded || []).map((value) => value.toLowerCase()));
      const normalizedHints = (hints || []).map((value) => String(value || "").trim().toLowerCase());
      const visibleAnchors = Array.from(anchors).filter((anchor) => {
        const rect = anchor.getBoundingClientRect();
        const style = window.getComputedStyle(anchor);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      });

      const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();
      const hasHint = (text: string) => {
        const lowered = text.toLowerCase();
        return normalizedHints.some((hint) => lowered.includes(hint));
      };

      const candidatePanels = new Map<HTMLElement, number>();
      const scoreByPanel = (element: HTMLElement, text: string, linkCount: number) => {
        const className = (element.className || "").toLowerCase();
        const tag = element.tagName.toLowerCase();
        if (/nav|header|footer|breadcrumb|toolbar|menu/.test(className)) return -Infinity;
        if (/html|body/.test(tag)) return -Infinity;
        const role = element.getAttribute("role") || "";
        let score = linkCount * 5;
        if (hasHint(text)) score += 40;
        if (/dialog|popup|drawer|modal|panel/.test(className)) score += 30;
        if (/^search|^source|reference/.test(role)) score += 20;
        if (engineType === "doubao" && /搜索\d*个关键词|参考\d*篇资料|搜索|关键词|参考|资料/.test(text)) score += 25;
        if (engineType === "qianwen" && /参考来源|来源/.test(text)) score += 25;
        return score;
      };

      for (const anchor of visibleAnchors) {
        const anchorElement = anchor as HTMLAnchorElement;
        const url = anchorElement.href || "";
        if (!url || preUrlSet.has(url.toLowerCase())) continue;
        if (!/^https?:\/\//i.test(url)) continue;

        let node: HTMLElement | null = anchorElement;
        for (let depth = 0; depth < 6 && node; depth += 1) {
          const text = normalizeText(node.textContent || "");
          if (!text) {
            node = node.parentElement;
            continue;
          }
          const linkCount = node.querySelectorAll("a[href^='http']").length;
          if (linkCount >= 1) {
            const score = scoreByPanel(node, text, linkCount);
            if (score > (candidatePanels.get(node) || -Infinity)) {
              candidatePanels.set(node, score);
            }
          }
          node = node.parentElement;
        }
      }

      let chosenPanel: HTMLElement | null = null;
      let chosenScore = -Infinity;
      for (const [node, score] of candidatePanels.entries()) {
        if (score > chosenScore) {
          chosenPanel = node;
          chosenScore = score;
        }
      }
      if (!chosenPanel || !Number.isFinite(chosenScore)) return [];

        const panelAnchors = Array.from(chosenPanel.querySelectorAll("a[href^='http']")).filter((anchor) => {
        const rect = anchor.getBoundingClientRect();
        const style = window.getComputedStyle(anchor);
        const href = (anchor as HTMLAnchorElement).href || "";
        return /^https?:\/\//i.test(href) && style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2 && !preUrlSet.has(href.toLowerCase());
      });

      const rows: CollectedSourceLike[] = [];
      const seen = new Set<string>();
      const pickKeyword = (text: string) => {
        const cleaned = normalizeText(text || "");
        if (!cleaned) return "";
        const keywordPrefix = cleaned.match(/关键词[:：]?\s*([^，。；;,.\n]{1,60})/i);
        if (keywordPrefix?.[1]) return keywordPrefix[1].trim().slice(0, 60);
        if (cleaned.length > 2 && cleaned.length < 50) return cleaned.slice(0, 60);
        return "";
      };
      const footerTitleFromNode = (element: Element | null): string => {
        let node: Element | null = element;
        for (let depth = 0; depth < 8 && node; depth += 1) {
          const footerTitle = node.querySelector<HTMLElement>("span[class*='footer-title']");
          if (footerTitle?.textContent) return footerTitle.textContent;
          node = node.parentElement;
        }
        return "";
      };

      for (const anchor of panelAnchors) {
        const url = (anchor as HTMLAnchorElement).href || "";
        const lower = url.toLowerCase();
        if (!url || seen.has(lower)) continue;
        seen.add(lower);
        const text = normalizeText(anchor.textContent || anchor.getAttribute("aria-label") || "");
        const title = text || normalizeText((anchor as HTMLAnchorElement).hostname || "Untitled");

        let sourceNode: Element | null =
          anchor.closest("li, .source-item, [class*='source'], tr, .reference-item, [role='listitem'], article, section") || anchor.parentElement;
        if (!sourceNode) sourceNode = anchor;

        const summaryNodes = sourceNode.querySelectorAll("p, .summary, .desc, .description, .content, .snippet");
        const summaryCandidates = Array.from(summaryNodes)
          .map((node) => normalizeText(node.textContent || ""))
          .map((item) => item.replace(title, "").trim())
          .filter((item) => item && !item.includes(url) && !new RegExp(title, "i").test(item))
          .filter((item) => item.length > 4);
        const flattenedSummary =
          sourceNode.textContent ? normalizeText(sourceNode.textContent).replace(title, "").replace(url, "").trim() : "";
        const summaryText = summaryCandidates.length > 0 ? summaryCandidates[0] : flattenedSummary.slice(0, 240);

        let keyword = "";
        if (engineType === "doubao") {
          const keywordCandidates = sourceNode.querySelectorAll("strong, b, h1, h2, h3, h4, .keyword, [class*='keyword']");
          keyword =
            Array.from(keywordCandidates)
              .map((node) => normalizeText(node.textContent || ""))
              .filter((item) => item && item.length > 0 && item.length <= 60)
              .find((item) => item.length >= 2 && !item.toLowerCase().includes("http")) || "";
          if (!keyword) keyword = pickKeyword(sourceNode.textContent || "");
        }

        rows.push({
          url,
          title: title || url,
          sourceType: "",
          position: rows.length + 1,
          summary: summaryText || "",
          keyword,
          siteName: engineType === "doubao" ? footerTitleFromNode(sourceNode) : ""
        });
      }

      return rows.slice(0, engineType === "doubao" ? 30 : 20);
    }, [engineType, [...preUrls], keywordHints])
    .catch(() => []);

  return raw.filter((item) => Boolean(item.url)).map((item, index) => ({ ...item, position: index + 1 }));
}

async function clickQianwenSearchContentTrigger(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await waitForQianwenDeepThinkSourceCards(page, 250)) return true;
    const clicked = await page
      .evaluate(() => {
        const normalizeText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
        };
        const dispatchActivation = (element: HTMLElement) => {
          element.scrollIntoView({ block: "center", inline: "center" });
          const rect = element.getBoundingClientRect();
          const init = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            view: window
          };
          const pointerCtor = typeof window.PointerEvent === "function" ? window.PointerEvent : window.MouseEvent;
          element.dispatchEvent(new pointerCtor("pointerdown", init));
          element.dispatchEvent(new MouseEvent("mousedown", init));
          element.dispatchEvent(new pointerCtor("pointerup", init));
          element.dispatchEvent(new MouseEvent("mouseup", init));
          element.dispatchEvent(new MouseEvent("click", init));
          element.click();
        };
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("div[class*='search-content']"))
          .filter((element) => isVisible(element))
          .filter((element) => !element.closest("nav,aside,header,footer"))
          .filter((element) => !/(sidebar|side-bar|history|nav|menu|composer|input|prompt)/i.test(String(element.className || "")))
          .map((element) => {
            const clickable =
              (element.closest("button, [role='button'], [onclick], [tabindex], [class*='search-content']") as HTMLElement | null) ||
              element;
            const rect = clickable.getBoundingClientRect();
            const text = normalizeText(element.textContent || "");
            let score = rect.top;
            if (/来源|参考|搜索|资料|\d+\s*篇/i.test(text)) score += 600;
            if (String(element.className || "").includes("search-content")) score += 240;
            if (rect.left > 240) score += 80;
            if (text.length > 0 && text.length <= 220) score += 60;
            if (text.length > 800) score -= 500;
            return { element: clickable, score };
          })
          .sort((a, b) => b.score - a.score);
        const target = candidates[0]?.element;
        if (!target || !isVisible(target)) return false;
        dispatchActivation(target);
        return true;
      })
      .catch(() => false);
    if (clicked) {
      await page.waitForTimeout(800).catch(() => undefined);
      if (await waitForQianwenDeepThinkSourceCards(page, 5000)) return true;
      if (await qianwenReferencePanelIsOpen(page)) return true;
    }
    await page.waitForTimeout(450).catch(() => undefined);
  }
  return false;
}

async function waitForQianwenDeepThinkSourceCards(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page
      .evaluate(() => {
        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
        };
        const lists = Array.from(document.querySelectorAll<HTMLElement>("div[class*='bg-primary'][class*='deep-think-source']"))
          .filter(isVisible);
        const cardsInLists = lists.reduce((sum, list) => sum + list.querySelectorAll("[id^='deep-think-source-card-']").length, 0);
        const visibleCards = Array.from(document.querySelectorAll<HTMLElement>("[id^='deep-think-source-card-']")).filter(isVisible).length;
        return Math.max(cardsInLists, visibleCards);
      })
      .catch(() => 0);
    if (count > 0) return true;
    await page.waitForTimeout(300).catch(() => undefined);
  }
  return false;
}

async function collectQianwenDeepThinkSourceCards(page: Page): Promise<CollectedSource[]> {
  type SourceRow = {
    url: string;
    title: string;
    sourceType: string;
    position: number;
    summary?: string;
    keyword?: string;
    siteName?: string;
  };

  const raw = await page
    .evaluate(() => {
      const normalizeText = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
      const normalizeUrl = (value: string) => {
        const trimmed = String(value || "").trim();
        if (!trimmed) return "";
        try {
          return new URL(trimmed, window.location.href).href;
        } catch {
          return trimmed;
        }
      };
      const isLikelyImageUrl = (value: string) => /\.(?:png|jpe?g|webp|gif|svg|ico|bmp|avif|heic|heif|tiff?)(?:$|[?#])/i.test(value);
      const isSearchImageProxyUrl = (value: string) => {
        try {
          const parsed = new URL(value);
          return parsed.hostname.replace(/^www\./, "").toLowerCase() === "s2.zimgs.cn" && parsed.pathname === "/ims";
        } catch {
          return false;
        }
      };
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      };
      const readJsonAttribute = (element: Element, attrName: string) => {
        const value = element.getAttribute(attrName);
        if (!value) return null;
        try {
          return JSON.parse(value) as { ref_url?: unknown };
        } catch {
          return null;
        }
      };
      const readRefUrl = (element: Element) => {
        const payloads = [
          readJsonAttribute(element, "data-exposure-extra"),
          readJsonAttribute(element, "data-click-extra"),
          readJsonAttribute(element, "data-log-params")
        ];
        for (const payload of payloads) {
          const rawUrl = payload?.ref_url;
          if (typeof rawUrl === "string" && /^https?:\/\//i.test(rawUrl)) return rawUrl;
        }
        const attrText = Array.from(element.attributes || []).map((attr) => attr.value).join(" ");
        const match = attrText.match(/https?:\/\/[^"'\s<>]+/i);
        return match ? match[0] : "";
      };
      const readRefUrlDeep = (element: Element) => {
        const own = readRefUrl(element);
        if (own) return own;
        const descendants = Array.from(element.querySelectorAll("*"));
        for (const descendant of descendants) {
          const url = readRefUrl(descendant);
          if (url) return url;
        }
        return "";
      };
      const parseIndex = (value: string, fallback: number) => {
        const match = normalizeText(value).match(/\d+/);
        if (!match) return fallback;
        const parsed = Number(match[0]);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
      };
      const listContainers = Array.from(document.querySelectorAll<HTMLElement>("div[class*='bg-primary'][class*='deep-think-source']"))
        .filter(isVisible);
      const cards = (listContainers.length > 0
        ? listContainers.flatMap((list) => Array.from(list.querySelectorAll<HTMLElement>("[id^='deep-think-source-card-']")))
        : Array.from(document.querySelectorAll<HTMLElement>("[id^='deep-think-source-card-']")))
        .filter(isVisible);
      const rows: SourceRow[] = [];
      const seen = new Set<string>();
      for (const card of cards) {
        const headerNode = card.querySelector<HTMLElement>("div[class*='header']");
        const titleNode = headerNode?.querySelector<HTMLElement>("span[class*='title']") || card.querySelector<HTMLElement>("span[class*='title']");
        const indexNode = headerNode?.querySelector<HTMLElement>("span[class*='index']") || card.querySelector<HTMLElement>("span[class*='index']");
        const sourceNode = card.querySelector<HTMLElement>("div[class*='source']");
        const imageNode = sourceNode?.querySelector<HTMLImageElement>("img[src]") || card.querySelector<HTMLImageElement>("img[src]");
        const siteNameNode = sourceNode?.querySelector<HTMLElement>("div[class*='name']") || card.querySelector<HTMLElement>("div[class*='name']");
        const contentNode = card.querySelector<HTMLElement>("div[class*='content']");

        const explicitRefUrl = normalizeUrl(readRefUrlDeep(card));
        const imgUrl = normalizeUrl(imageNode?.getAttribute("src") || "");
        const url = /^https?:\/\//i.test(explicitRefUrl) ? explicitRefUrl : imgUrl;
        if (!/^https?:\/\//i.test(url)) continue;
        if (!explicitRefUrl && (isLikelyImageUrl(url) || isSearchImageProxyUrl(url))) continue;
        const lower = url.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);

        const title = titleNode?.textContent || headerNode?.textContent || url;
        rows.push({
          url,
          title,
          sourceType: "",
          position: parseIndex(indexNode?.textContent || "", rows.length + 1),
          summary: contentNode?.textContent || "",
          keyword: "",
          siteName: siteNameNode?.textContent || ""
        });
      }
      return rows
        .sort((left, right) => left.position - right.position)
        .slice(0, 30);
    })
    .catch(() => [] as SourceRow[]);

  return raw.filter((item) => Boolean(item.url)).map((item, index) => ({ ...item, position: item.position || index + 1 }));
}

async function clickQianwenReferenceAnchor(page: Page, timeoutMs = 90000): Promise<boolean> {
  const clickedBySourceCount = await clickQianwenSourceCountTrigger(page, timeoutMs);
  if (clickedBySourceCount) return true;

  const selectors = [
    "[class*='reference-wrap']:visible",
    "[class*='link-title']:visible",
    "[class*='search-content']:visible"
  ];
  for (const selector of selectors) {
    const count = await page.locator(selector).count().catch(() => 0);
    for (let index = Math.min(count - 1, 20); index >= 0; index -= 1) {
      const locator = page.locator(selector).nth(index);
      const text = await locator.textContent().catch(() => "");
      if (!/(\d+\s*)?篇来源|参考来源|参考资料|资料来源|引用来源/i.test(text || "")) continue;
      if (!(await locator.isVisible().catch(() => false))) continue;
      await locator.scrollIntoViewIfNeeded().catch(() => undefined);
      const clicked = await locator.click({ timeout: 2500 }).then(() => true).catch(() => false);
      if (clicked) {
        await page.waitForTimeout(400);
        return true;
      }
    }
  }
  return false;
}

async function clickQianwenSourceCountTrigger(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let lastLoggedTextMatches = -1;
  while (Date.now() < deadline) {
    if (await waitForQianwenReferenceCards(page, 300)) return true;
    if (await qianwenReferencePanelIsOpen(page)) {
      await waitForQianwenReferenceCards(page, 5000);
      return true;
    }

    const textMatches = await page.getByText(/^\d+\s*篇来源$/).count().catch(() => 0);
    if (process.env.DEBUG_QIANWEN_SOURCES === "1" && textMatches !== lastLoggedTextMatches) {
      lastLoggedTextMatches = textMatches;
      console.log("qianwen_sources_locator", { elapsedMs: Date.now() - startedAt, textMatches, url: page.url() });
    }
    for (let index = Math.min(textMatches - 1, 8); index >= 0; index -= 1) {
      const locator = page.getByText(/^\d+\s*篇来源$/).nth(index);
      if (!(await locator.isVisible().catch(() => false))) continue;
      await locator.scrollIntoViewIfNeeded().catch(() => undefined);
      const clicked = await locator.click({ force: true, timeout: 2500 }).then(() => true).catch(() => false);
      if (process.env.DEBUG_QIANWEN_SOURCES === "1") {
        console.log("qianwen_sources_click", { elapsedMs: Date.now() - startedAt, index, clicked });
      }
      if (clicked) {
        await page.waitForTimeout(800);
        const hasCards = await waitForQianwenReferenceCards(page, 7000);
        const panelOpen = await qianwenReferencePanelIsOpen(page);
        if (process.env.DEBUG_QIANWEN_SOURCES === "1") {
          console.log("qianwen_sources_after_click", { elapsedMs: Date.now() - startedAt, hasCards, panelOpen });
        }
        if (hasCards) return true;
        if (panelOpen) return true;
      }
    }

    const clickedByScript = await page
      .evaluate(() => {
        const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();
        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
        };
        const dispatchActivation = (element: HTMLElement) => {
          element.scrollIntoView({ block: "center", inline: "center" });
          const rect = element.getBoundingClientRect();
          const init = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            view: window
          };
          const pointerCtor = typeof window.PointerEvent === "function" ? window.PointerEvent : window.MouseEvent;
          element.dispatchEvent(new pointerCtor("pointerdown", init));
          element.dispatchEvent(new MouseEvent("mousedown", init));
          element.dispatchEvent(new pointerCtor("pointerup", init));
          element.dispatchEvent(new MouseEvent("mouseup", init));
          element.dispatchEvent(new MouseEvent("click", init));
          element.click();
        };
        const panelIsOpen = () => /参考来源\s*\(\d+\)/.test(document.body.textContent || "");
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("div, span, button, [role='button'], a"))
          .map((element) => ({ element, text: normalizeText(element.textContent || "") }))
          .filter(({ element, text }) => isVisible(element) && /^\d+\s*篇来源$/.test(text));

        const scored = candidates
          .map(({ element, text }) => {
            const clickable =
              (element.closest(
                "[class*='reference-wrap'], [class*='link-title'], [class*='search-content'], button, [role='button'], a, [onclick]"
              ) as HTMLElement | null) || element;
            const rect = clickable.getBoundingClientRect();
            const className = String(clickable.className || "").toLowerCase();
            let score = 0;
            if (/reference-wrap|link-title|search-content/.test(className)) score += 200;
            if (clickable !== element) score += 40;
            score += Math.max(0, 120 - Math.round(rect.width));
            score += Math.max(0, Math.round(rect.left / 20));
            return { element, clickable, text, score };
          })
          .sort((a, b) => b.score - a.score);

        for (const chosen of scored.slice(0, 8)) {
          const targets = [
            chosen.element,
            chosen.element.closest("[class*='search-content']") as HTMLElement | null,
            chosen.element.closest("[class*='link-title']") as HTMLElement | null,
            chosen.element.closest("[class*='reference-wrap']") as HTMLElement | null,
            chosen.clickable
          ].filter((item): item is HTMLElement => {
            if (!item) return false;
            return isVisible(item);
          });
          const uniqueTargets = Array.from(new Set(targets));
          for (const target of uniqueTargets) {
            dispatchActivation(target);
            if (panelIsOpen()) return true;
          }
        }
        return scored.length > 0;
      })
      .catch(() => false);

    if (clickedByScript) {
      await page.waitForTimeout(700);
      if (await waitForQianwenReferenceCards(page, 4000)) return true;
      if (await qianwenReferencePanelIsOpen(page)) return true;
    }
    await page.waitForTimeout(450);
  }
  if (process.env.DEBUG_QIANWEN_SOURCES === "1") {
    console.log("qianwen_sources_timeout", { elapsedMs: Date.now() - startedAt, url: page.url() });
  }
  return false;
}

async function qianwenReferencePanelIsOpen(page: Page): Promise<boolean> {
  return page
    .evaluate(() => /参考来源\s*\(\d+\)/.test(document.body.textContent || ""))
    .catch(() => false);
}

async function waitForQianwenReferenceCards(page: Page, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page
      .evaluate(() => {
        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
        };
        const hasRefUrl = (element: Element) => {
          const attrText = [
            ...Array.from(element.attributes).map((attr) => attr.value),
            ...Array.from(element.querySelectorAll("*")).flatMap((child) =>
              Array.from(child.attributes).map((attr) => attr.value)
            )
          ].join(" ");
          return /ref_url|https?:\/\//i.test(attrText);
        };
        const bodyText = (document.body.textContent || "").replace(/\s+/g, " ").trim();
        const referencePanelText = bodyText.slice(Math.max(0, bodyText.search(/参考来源\s*\(\d+\)/)));
        if (/参考来源\s*\(\d+\)/.test(referencePanelText) && /(?:[a-z0-9-]+\.)+[a-z]{2,}/i.test(referencePanelText)) {
          return 1;
        }
        const selector = [
          "[id^='deep-think-source-card-']",
          "[class*='source-item']",
          "[data-click-extra*='ref_url']",
          "[data-log-params*='ref_url']",
          "[data-exposure-extra*='ref_url']"
        ].join(",");
        return Array.from(document.querySelectorAll(selector))
          .filter((card) => isVisible(card) && hasRefUrl(card))
          .length;
      })
      .catch(() => 0);
    if (count > 0) return true;
    await page.waitForTimeout(350);
  }
  return false;
}

async function collectQianwenReferenceCardsWithRetry(page: Page, timeoutMs: number): Promise<CollectedSource[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sources = await collectQianwenReferenceCards(page);
    if (sources.length > 0) return sources;
    await page.waitForTimeout(450);
  }
  return collectQianwenReferenceCards(page);
}

async function collectQianwenReferenceCards(page: Page): Promise<CollectedSource[]> {
  type SourceRow = {
    url: string;
    title: string;
    sourceType: string;
    position: number;
    summary?: string;
    keyword?: string;
    siteName?: string;
  };
  const raw = await page
    .evaluate(String.raw`(() => {
      function normalizeText(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
      }
      function readJsonAttribute(element, attrName) {
        var value = element.getAttribute(attrName);
        if (!value) return null;
        try {
          return JSON.parse(value);
        } catch (error) {
          return null;
        }
      }
      function readRefUrl(element) {
        var payloads = [
          readJsonAttribute(element, "data-exposure-extra"),
          readJsonAttribute(element, "data-click-extra"),
          readJsonAttribute(element, "data-log-params")
        ];
        for (var i = 0; i < payloads.length; i += 1) {
          var payload = payloads[i];
          var rawUrl = payload && payload.ref_url;
          if (typeof rawUrl === "string" && /^https?:\/\//i.test(rawUrl)) return rawUrl;
        }
        var attrs = Array.prototype.slice.call(element.attributes || []);
        var allAttrs = attrs.map(function(attr) { return attr.value; }).join(" ");
        var match = allAttrs.match(/https?:\/\/[^"'\s<>]+/i);
        return match ? match[0] : "";
      }
      function readRefUrlDeep(element) {
        var direct = readRefUrl(element);
        if (direct) return direct;
        var descendants = Array.prototype.slice.call(element.querySelectorAll("*"));
        for (var i = 0; i < descendants.length; i += 1) {
          var url = readRefUrl(descendants[i]);
          if (url) return url;
        }
        return "";
      }
      function domainFromText(value) {
        var match = normalizeText(value).match(/(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i);
        return match ? match[0].replace(/[),，。；;]+$/, "") : "";
      }
      function isVisible(element) {
        var rect = element.getBoundingClientRect();
        var style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      }
      var sourceCardSelector = [
        "[id^='deep-think-source-card-']",
        "[class*='source-item']",
        "[data-click-extra*='ref_url']",
        "[data-log-params*='ref_url']",
        "[data-exposure-extra*='ref_url']"
      ].join(",");
      var urlCandidateCards = Array.prototype.slice.call(document.querySelectorAll(sourceCardSelector));
      var panelCandidates = Array.prototype.slice.call(document.querySelectorAll("div, article, section, li"));
      var rightPanelTextCards = panelCandidates.filter(function(element) {
        var rect = element.getBoundingClientRect();
        var text = normalizeText(element.textContent || "");
        if (rect.left < window.innerWidth * 0.48) return false;
        if (text.length < 40) return false;
        return /(?:[a-z0-9-]+\.)+[a-z]{2,}|IT之家|中关村|天极|哔哩|应用宝|魅族|搜狐|咸宁/i.test(text);
      });
      var cardSeen = new Set();
      var cards = [];
      urlCandidateCards.concat(rightPanelTextCards).forEach(function(card) {
        if (cardSeen.has(card)) return;
        cardSeen.add(card);
        var text = normalizeText(card.textContent || "");
        if (readRefUrlDeep(card) || (isVisible(card) && text.length > 40 && /\d/.test(text) && domainFromText(text))) {
          cards.push(card);
        }
      });

      var rows = [];
      var seen = new Set();
      function addRow(row) {
        if (!row.url || seen.has(row.url.toLowerCase())) return;
        seen.add(row.url.toLowerCase());
        rows.push({
          url: row.url,
          title: row.title,
          sourceType: "",
          position: rows.length + 1,
          summary: row.summary || "",
          keyword: row.keyword || "",
          siteName: row.siteName || ""
        });
      }
      for (var cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
        var card = cards[cardIndex];
        var refUrl = readRefUrlDeep(card);
        var sourceNode = card.querySelector("[class*='source-'], [class*='name-']");
        var siteNameNode = card.querySelector("[class*='source-'] [class*='name-'], [class*='name-']");
        var sourceText = normalizeText(sourceNode ? sourceNode.textContent : "");
        var siteNameText = normalizeText(siteNameNode ? siteNameNode.textContent : "");
        var cardText = normalizeText(card.textContent || "");
        var domain = domainFromText(sourceText) || domainFromText(cardText);
        var url = refUrl || (domain ? "https://" + domain : "");
        if (!url) continue;
        var titleNode = card.querySelector("[class*='title-']") || card.querySelector("[class*='header-']");
        var titleText = normalizeText(titleNode ? titleNode.textContent : "").replace(/^\d+\s*/, "");
        var fallbackTitle = cardText.replace(/^\d+\s*/, "").split(domain)[0].replace(/\s+/g, " ").trim().slice(0, 180);
        var contentNode = card.querySelector("[class*='content-']");
        var summaryText = normalizeText(contentNode ? contentNode.textContent : "") ||
          cardText.replace(titleText || fallbackTitle, "").replace(domain, "").trim();
        addRow({
          url: url,
          title: titleText || fallbackTitle || sourceText || url,
          summary: summaryText.slice(0, 600),
          keyword: "",
          siteName: siteNameText
        });
      }

      var bodyText = normalizeText(document.body.textContent || "");
      var panelMatch = bodyText.match(/参考来源\s*\(\d+\)([\s\S]*)/);
      var panelText = panelMatch ? panelMatch[1] : "";
      var domainRegex = /(?:[a-z0-9-]+\.)+[a-z]{2,}/gi;
      var domainMatches = [];
      var match;
      while ((match = domainRegex.exec(panelText)) !== null) {
        domainMatches.push({ value: match[0], index: match.index });
      }
      for (var index = 0; index < domainMatches.length && rows.length < 30; index += 1) {
        var item = domainMatches[index];
        var rawDomain = item.value.replace(/[),，。；;]+$/, "").toLowerCase();
        if (!rawDomain || /^s2\.zimgs\.cn$/i.test(rawDomain)) continue;
        var fallbackUrl = "https://" + rawDomain;
        if (seen.has(fallbackUrl.toLowerCase())) continue;
        var before = panelText.slice(Math.max(0, item.index - 220), item.index);
        var titleMatch = before.match(/(?:^|\s)(\d{1,2})\s+([\s\S]+)$/);
        var title = normalizeText(((titleMatch && titleMatch[2]) || before).replace(/[|｜]?\s*$/, "")).slice(0, 180);
        var nextIndex = domainMatches[index + 1] ? domainMatches[index + 1].index : panelText.length;
        var after = panelText.slice(item.index + item.value.length, Math.min(nextIndex, item.index + item.value.length + 900));
        var summary = after;
        addRow({
          url: fallbackUrl,
          title: title || rawDomain,
          summary: summary.slice(0, 600),
          keyword: ""
        });
      }
      return rows.slice(0, 30);
    })()`)
    .catch((error) => {
      if (process.env.DEBUG_QIANWEN_SOURCES === "1") {
        console.log("qianwen_collect_error", error instanceof Error ? error.message : String(error));
      }
      return [];
    }) as SourceRow[];

  if (process.env.DEBUG_QIANWEN_SOURCES === "1") {
    console.log("qianwen_collect_raw", { count: raw.length, first: raw[0] });
  }
  return raw.filter((item) => Boolean(item.url)).map((item, index) => ({ ...item, position: index + 1 }));
}

async function clickReferenceTrigger(page: Page, patterns: RegExp[]): Promise<boolean> {
  const triggerScorers = [
    page.getByRole("button"),
    page.locator("[role='button']"),
    page.locator("button"),
    page.locator("a[href='#'], a[href*='javascript'], a, [class*='btn'], [class*='button']")
  ];

  for (const pattern of patterns) {
    for (let round = 0; round < 2; round++) {
      for (const scorer of triggerScorers) {
        const candidates = await scorer.count().catch(() => 0);
        const cursor = Math.max(candidates - 1, 0);
        for (let index = cursor; index >= 0; index--) {
          const locator = scorer.nth(index);
          const text = await locator.textContent().catch(() => "");
          if (!text || !pattern.test(text)) continue;
          if (!(await locator.isVisible().catch(() => false))) continue;
          await locator.scrollIntoViewIfNeeded().catch(() => undefined);
          const clicked = await locator.click({ timeout: 2500 }).then(() => true).catch(() => false);
          if (clicked) {
            await page.waitForTimeout(450);
            return true;
          }
        }
      }
      const visibleTextLocator = page.getByText(pattern);
      const matchCount = await visibleTextLocator.count().catch(() => 0);
      for (let i = Math.min(matchCount - 1, 20); i >= 0; i--) {
        const candidate = visibleTextLocator.nth(i);
        if (!(await candidate.isVisible().catch(() => false))) continue;
        const clicked = await candidate.click({ timeout: 1500 }).then(() => true).catch(() => false);
        if (clicked) {
          await page.waitForTimeout(450);
          return true;
        }
      }
      await page.waitForTimeout(500);
    }
  }
  return false;
}

async function expandReferenceSection(page: Page, patterns: RegExp[], keywords: string[]): Promise<boolean> {
  const patternTextList = patterns.map((pattern) => pattern.source);
  const expandedByScript = await clickHintElementsByText(page, keywords, patternTextList);
  if (expandedByScript) return true;

  const direct = await clickReferenceTrigger(page, patterns);
  if (direct) return true;

  const expandedByPanelFallback = await clickReferenceButtonArea(page, keywords, patternTextList);
  if (expandedByPanelFallback) return true;

  return false;
}

async function clickReferenceButtonArea(page: Page, keywords: string[], patternTextList: string[]): Promise<boolean> {
  const normalizedKeywords = keywords.map((keyword) => keyword.trim()).filter(Boolean);
  if (normalizedKeywords.length === 0 && patternTextList.length === 0) return false;
  const clicked = await page
    .locator("[role='button'], button, a, [role='link'], div, span, summary, li")
    .evaluateAll((elements, args) => {
      const [keywords, patterns, patternList] = args as [string[], string[], string[]];
      const normalizedKeywords = (keywords || []).map((item) => String(item || "").toLowerCase().trim()).filter((item) => item);
      const normalizedPatterns = [
        ...(patternList || []),
        ...(patterns || [])
      ].map((item) => {
        try {
          return new RegExp(item, "i");
        } catch {
          return new RegExp(String(item).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        }
      });

      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      };

      const hasTextHint = (text: string) => {
        const normalizedText = String(text || "").toLowerCase();
        return normalizedKeywords.some((keyword) => normalizedText.includes(keyword));
      };

      const hasPatternHit = (text: string) => normalizedPatterns.some((pattern) => pattern.test(text));

      const candidates = Array.from(elements).filter((element) => {
        if (!isVisible(element)) return false;
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        const attrs = [
          "aria-label",
          "title",
          "alt",
          "role",
          "id",
          "data-tooltip",
          "data-text",
          "aria-describedby",
          "aria-labelledby",
          "data-testid"
        ]
          .map((attr) => element.getAttribute(attr))
          .filter(Boolean)
          .map(String)
          .join(" ");
        const classes = String((element as HTMLElement).className || "");
        const attributeText = `${attrs} ${classes}`.toLowerCase();
        if (!text && !attributeText) return false;
        if (text.length > 180 && !/篇来源|参考来源|参考资料|资料来源|引用来源/i.test(text)) return false;
        if (!hasTextHint(text) && !hasPatternHit(text) && !hasTextHint(attributeText) && !hasPatternHit(attributeText)) return false;
        return true;
      });

      let best: Element | null = null;
      let bestScore = -1;
      for (const element of candidates) {
        const text = (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        const attrs = `${element.getAttribute?.("role") || ""} ${element.getAttribute?.("aria-label") || ""} ${element.getAttribute?.("title") || ""} ${(element as HTMLElement).getAttribute?.("aria-describedby") || ""} ${(element as HTMLElement).className || ""}`.toLowerCase();
        const className = (element.className || "").toString().toLowerCase();
        let score = 0;
        if (hasTextHint(text)) score += 60;
        const hintSourceText = `${text} ${attrs}`.toLowerCase();
        if (/\d+\s*篇来源|参考来源|参考资料|资料来源|引用来源/i.test(hintSourceText)) score += 180;
        if (/(参考|来源|资料|关键词|search|expand|更多)/i.test(hintSourceText)) score += 35;
        if (text.length > 80) score -= 40;
        if (/(button|btn|btns|icon|icon-button|dropdown|toggle|trigger|link|summary|details)/i.test(className)) score += 16;
        if (/(search|source|source|reference|citation|ref|drawer|panel|popover|expand|collapse)/i.test(attrs)) score += 14;
        if (element.tagName.toLowerCase() === "summary") score += 35;
        if (element.getAttribute?.("role") === "button") score += 12;
        if (element.tagName.toLowerCase() === "button") score += 16;
        if (element.getAttribute?.("aria-expanded") !== null) score += 20;
        if (score > bestScore) {
          bestScore = score;
          best = element;
        }
      }

      if (!best) return false;

      const clickable =
        (best as HTMLElement).tagName.toLowerCase() === "button" ? (best as HTMLElement)
          : (best.closest(
              "button, [role='button'], summary, [aria-expanded], [onclick], a, [class*='reference-wrap'], [class*='link-title'], [class*='search-content']"
            ) as HTMLElement | null) || (best as HTMLElement);
      if (!clickable || !isVisible(clickable)) return false;
      try {
        (clickable as HTMLElement).click();
        return true;
      } catch {
        return false;
      }
    }, [normalizedKeywords, patternTextList])
    .catch(() => false);
  return clicked;
}

async function clickHintElementsByText(page: Page, keywords: string[], patterns: string[]): Promise<boolean> {
  if (!keywords.length && !patterns.length) return false;
  return page.evaluate((args) => {
    const [keywords, patternTextList] = args as [string[], string[]];
    const escapeRegExp = (value: string) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const normalizedKeywords = (keywords || []).map((keyword) => String(keyword || "").trim().toLowerCase()).filter(Boolean);
    const normalizedPatterns = (patternTextList || []).map((value) => {
      const raw = String(value || "");
      try {
        return new RegExp(raw, "i");
      } catch {
        return new RegExp(escapeRegExp(raw), "i");
      }
    });

    const hasHint = (text: string) => {
      const normalized = text.toLowerCase();
      if (normalizedKeywords.some((keyword) => normalized.includes(keyword))) return true;
      return normalizedPatterns.some((pattern) => pattern.test(normalized));
    };

    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
    };

    const selectors = [
      "button",
      "[role='button']",
      "[role='link']",
      "a",
      "summary",
      "[class*='btn']",
      "[class*='button']",
      "[class*='link']",
      "div",
      "span",
      "p",
      "em",
      "sup"
    ].join(",");
    const extractAttrText = (element: Element) => {
      return [
        "aria-label",
        "title",
        "alt",
        "role",
        "id",
        "data-tooltip",
        "data-text",
        "aria-describedby",
        "aria-labelledby",
        "data-testid"
      ]
        .map((attr) => element.getAttribute(attr))
        .filter(Boolean)
        .map((value) => String(value))
        .join(" ")
        .toLowerCase();
    };
    const elements = Array.from(document.querySelectorAll(selectors))
      .filter((element) => {
        if (!isVisible(element)) return false;
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        const attributeText = extractAttrText(element);
        if (!text && !attributeText) return false;
        if (text.length > 180 && !/篇来源|参考来源|参考资料|资料来源|引用来源/i.test(text)) return false;
        return hasHint(text) || hasHint(attributeText);
      });

    const best = elements
      .map((element) => {
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        const cls = (element.className || "").toString().toLowerCase();
        const attrs = extractAttrText(element);
        const role = element.getAttribute("role") || "";
        const tag = element.tagName.toLowerCase();
        let score = 0;
        const hintSourceText = `${text} ${attrs}`.toLowerCase();
        if (/\d+\s*篇来源|参考来源|参考资料|资料来源|引用来源/i.test(hintSourceText)) score += 220;
        if (/(参考|来源|资料|关键词|expand|reference|citation|source|搜索|来源|参考来源|参考资料|搜索来源|参考)/i.test(hintSourceText)) score += 90;
        if (text.length > 80) score -= 40;
        if (normalizedKeywords.length === 0 && tag === "summary") score += 30;
        if (tag === "summary") score += 60;
        if (element.getAttribute("aria-expanded") !== null) score += 30;
        if (tag === "button" || role === "button" || /btn|button|tab|click|trigger/.test(cls)) score += 28;
        const rect = element.getBoundingClientRect();
        score += Math.max(0, 80 - Math.round(text.length / 2));
        score += Math.max(0, Math.round(rect.left / 12));
        return { element, score, text };
      })
      .sort((a, b) => b.score - a.score)
      .shift()?.element;

    if (!best) return false;
    try {
      const clickable =
        best.closest(
          "button, [role='button'], summary, [aria-expanded], [onclick], a, [class*='reference-wrap'], [class*='link-title'], [class*='search-content']"
        ) ||
        best;
      (clickable as HTMLElement).click();
      return true;
    } catch {
      return false;
    }
  }, [keywords, patterns]).catch(() => false);
}

function escapeRegExp(value: string) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForReferenceLinks(page: Page, before: Set<string>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const now = new Set((await collectVisibleHttpUrls(page)).filter((item) => Boolean(item)).map((value) => value.toLowerCase()));
    if (now.size > before.size) return true;
    const hasCandidate = await collectSourcesFromOpenRegionQuick(page, before).catch(() => []);
    if (hasCandidate.length > 0) return true;
    await page.waitForTimeout(450);
  }
  return false;
}

async function collectSourcesFromOpenRegionQuick(page: Page, preUrls: Set<string>): Promise<CollectedSource[]> {
  const raw = await page
    .locator("a[href^='http']")
    .evaluateAll((anchors, args) => {
      const [rawPreUrls] = args as [string[]];
      const preSet = new Set((rawPreUrls || []).map((value) => value.toLowerCase()));
      const visible = Array.from(anchors).filter((anchor) => {
        const rect = anchor.getBoundingClientRect();
        const style = window.getComputedStyle(anchor);
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
      });
      const links = visible
        .map((anchor) => (anchor as HTMLAnchorElement).href)
        .filter((url) => /^https?:\/\//i.test(url || ""))
        .filter((url) => Boolean(url) && !preSet.has(url.toLowerCase()));
      return links.slice(0, 1);
    }, [Array.from(preUrls)])
    .catch(() => []);
  return raw.map((url, index) => ({
    url,
    title: (() => {
      if (!url) return "Untitled";
      try {
        return new URL(url).hostname || "Untitled";
      } catch {
        return "Untitled";
      }
    })(),
    sourceType: "",
    position: index + 1
  }));
}

async function collectReferenceFromOpenRegion(
  page: Page,
  engineType: "qianwen" | "doubao",
  preUrls: Set<string> = new Set()
): Promise<CollectedSource[]> {
  const raw = await page
    .locator("a[href^='http']")
    .evaluateAll((anchors, args) => {
      const [engineType, preloaded] = args as [string, string[]];
      const preUrlSet = new Set(preloaded.map((value) => value.toLowerCase()));
      const visibleAnchors = Array.from(anchors).filter((anchor) => {
        const rect = anchor.getBoundingClientRect();
        const style = window.getComputedStyle(anchor);
        const isVisible = style.visibility !== "hidden" && style.display !== "none" && rect.width > 2 && rect.height > 2;
        return isVisible;
      });

      const seen = new Set<string>();
      const rows: Array<{
        url: string;
        title: string;
        sourceType: string;
        position: number;
        summary?: string;
        keyword?: string;
      }> = [];

      const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();
      const pickKeyword = (text: string) => {
        const cleaned = normalizeText(text || "");
        if (!cleaned) return "";
        const keywordPrefix = cleaned.match(/关键词[:：]?\s*([^，。；;,.\n]{1,60})/i);
        if (keywordPrefix?.[1]) return keywordPrefix[1].trim().slice(0, 60);
        if (cleaned.length > 2 && cleaned.length < 50) return cleaned.slice(0, 60);
        return "";
      };

      for (const anchor of visibleAnchors) {
        const anchorElement = anchor as HTMLAnchorElement;
        const url = anchorElement.href || "";
        if (!url || seen.has(url)) continue;
        if (!/^https?:\/\//i.test(url)) continue;
        if (preUrlSet.has(url.toLowerCase())) continue;
        seen.add(url);
        const text = normalizeText(anchor.textContent || anchor.getAttribute("aria-label") || "");
        const title = text || normalizeText(anchorElement.hostname || "Untitled");

        let sourceNode: Element | null = anchor.closest("li, .source-item, [class*='source'], tr, .reference-item, [role='listitem'], article, section") || anchor.parentElement;
        if (sourceNode == null) sourceNode = anchor;

        const summaryNodes = sourceNode.querySelectorAll("p, .summary, .desc, .description, .content, .snippet");
        const summaryCandidates = Array.from(summaryNodes)
          .map((node) => normalizeText(node.textContent || ""))
          .map((item) => item.replace(title, "").trim())
          .filter((item) => item && !item.includes(url) && !new RegExp(title, "i").test(item))
          .filter((item) => item.length > 4);
        const flattenedSummary =
          sourceNode.textContent ? normalizeText(sourceNode.textContent).replace(title, "").replace(url, "").trim() : "";
        const summaryText = summaryCandidates.length > 0 ? summaryCandidates[0] : flattenedSummary.slice(0, 240);

        let keyword = "";
        if (engineType === "qianwen") {
          keyword = "";
        } else {
          const keywordCandidates = sourceNode.querySelectorAll("strong, b, h1, h2, h3, h4, .keyword, [class*='keyword']");
          keyword = Array.from(keywordCandidates)
            .map((node) => normalizeText(node.textContent || ""))
            .filter((item) => item && item.length > 0 && item.length <= 60)
            .find((item) => item.length >= 2 && !item.toLowerCase().includes("http")) || "";
          if (!keyword) keyword = pickKeyword(sourceNode.textContent || "");
          if (!keyword) {
            const fallbackKeyword = flattenedSummary.split(/\s*[-|]|\s{2,}/g).find((entry) => entry && entry.length >= 2 && entry.length <= 60);
            if (fallbackKeyword) keyword = fallbackKeyword;
          }
        }

        rows.push({
          url,
          title: title || url,
          sourceType: "",
          position: rows.length + 1,
          summary: summaryText || "",
          keyword
        });
      }

      return rows.slice(0, engineType === "doubao" ? 30 : 20);
    }, [engineType, [...preUrls]])
    .catch(() => []);

  return raw.filter((item) => Boolean(item.url)).map((item, index) => ({ ...item, position: index + 1 }));
}

async function collectFallbackSourceFromAnchors(page: Page, limit = 40): Promise<CollectedSource[]> {
  const anchors = await collectGenericSources(page);
  return anchors
    .filter((source, index) => {
      if (!source.url) return false;
      if (!/^https?:\/\//.test(source.url)) return false;
      if (index >= limit) return false;
      return true;
    })
    .map((source, index) => ({ ...source, position: index + 1 }));
}

async function submitPrompt(page: Page, inputLocator: Locator, engineType: string, queryText: string, options: SubmitPromptOptions = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const submitWaitMs = options.submitWaitMs ?? 9000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 提交成功没有统一 DOM 信号，因此同时监听输入框变化和疑似对话提交网络请求。
    await preparePromptInput(page, inputLocator, queryText, engineType);
    const baseline = await collectSubmissionState(page, inputLocator);
    await page.keyboard.press("Enter").catch(() => undefined);
    const sent = await Promise.race([
      waitForSubmissionStateChange(page, inputLocator, baseline, queryText, submitWaitMs),
      waitForLikelySubmitNetworkWithQuery(page, engineType, queryText, submitWaitMs)
    ]).catch(() => false);
    if (sent) return;

    const buttonBaseline = await collectSubmissionState(page, inputLocator);
    const clickedSend = await clickSendButton(page, inputLocator, engineType === "doubao" ? "priority" : "fallback");
    if (clickedSend) {
      const sentByButton = await Promise.race([
        waitForSubmissionStateChange(page, inputLocator, buttonBaseline, queryText, submitWaitMs),
        waitForLikelySubmitNetworkWithQuery(page, engineType, queryText, submitWaitMs)
      ]).catch(() => false);
      if (sentByButton) return;
    }

    const submitBlockReason = await detectPlatformBlockingState(page, engineType);
    if (submitBlockReason) {
      throw new Error(submitBlockReason);
    }
    if (attempt < maxAttempts) {
      await page.waitForTimeout(500);
    }
  }

  const finalState = await collectSubmissionState(page, inputLocator);
  if (normalizeText(finalState.inputText).includes(normalizeText(queryText))) {
    throw new Error("prompt_not_submitted_after_typing_input_not_cleared");
  }
  throw new Error("prompt_not_submitted_after_typing_enter_retries");
}

async function preparePromptInput(page: Page, inputLocator: Locator, queryText: string, engineType: string) {
  await inputLocator.scrollIntoViewIfNeeded().catch(() => undefined);
  await inputLocator.click({ timeout: 10000 }).catch(() => undefined);
  await inputLocator.focus().catch(() => undefined);
  await clearEditableText(page, inputLocator);

  if (engineType === "qianwen") {
    const hasPasted = await setEditableTextByPaste(inputLocator, queryText);
    if (hasPasted) {
      const normalizedQuery = normalizeText(queryText);
      const waitForText = Date.now() + 3000;
      while (Date.now() < waitForText) {
        const value = await getEditableText(inputLocator).catch(() => "");
        if (normalizeText(value).includes(normalizedQuery)) return;
        await page.waitForTimeout(150);
      }
    }
  }

  const hasFilled = await setEditableText(inputLocator, queryText);
  if (!hasFilled) {
    await page.keyboard.type(queryText, { delay: 12 });
  }
  await inputLocator.evaluate((element) => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }).catch(() => undefined);
  const normalizedQuery = normalizeText(queryText);
  const waitForText = Date.now() + 3000;
  while (Date.now() < waitForText) {
    const value = await getEditableText(inputLocator).catch(() => "");
    if (normalizeText(value).includes(normalizedQuery)) return;
    await page.waitForTimeout(150);
  }
}

async function clearEditableText(page: Page, inputLocator: Locator) {
  await inputLocator.evaluate((element) => {
    const anyElement = element as Element & { textContent: string | null };
    if ((element as HTMLInputElement | HTMLTextAreaElement).value !== undefined) {
      (element as HTMLInputElement | HTMLTextAreaElement).value = "";
    } else {
      anyElement.textContent = "";
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
  await page.keyboard.press("Backspace").catch(() => undefined);
}

async function setEditableTextByPaste(inputLocator: Locator, value: string): Promise<boolean> {
  const isInputLike = await inputLocator
    .evaluate((element) => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
    .catch(() => false);

  if (isInputLike) {
    const inserted = await inputLocator.evaluate((element, text) => {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      const normalizedText = String(text).replace(/\r\n/g, "\n");
      input.focus();
      const caretStart = input.selectionStart ?? input.value.length;
      const caretEnd = input.selectionEnd ?? input.value.length;
      input.setSelectionRange(caretStart, caretEnd);
      if (typeof input.setRangeText === "function") {
        input.setRangeText(normalizedText, caretStart, caretEnd, "end");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return normalizeLike((input.value || ""), normalizedText);
      }
      return false;
    }, value);
    if (inserted) return inserted;
  }

  return inputLocator
    .evaluate((element, text) => {
      const editable = element as HTMLElement;
      if (!editable) return false;
      const normalizedText = String(text).replace(/\r\n/g, "\n");
      try {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData("text/plain", normalizedText);
        const pasteEvent = new ClipboardEvent("paste", {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true
        });
        editable.dispatchEvent(pasteEvent);
        editable.focus();
        const success = editable.ownerDocument.execCommand("insertText", false, normalizedText);
        if (typeof success === "boolean" && success) {
          editable.dispatchEvent(new Event("input", { bubbles: true }));
          editable.dispatchEvent(new Event("change", { bubbles: true }));
          const text = (editable.textContent || "").replace(/\r\n/g, "\n");
          return normalizeLike(text, normalizedText);
        }
      } catch {
        // ignore
      }
      return false;
    }, value)
    .catch(() => false);
}

function normalizeLike(current: string, expected: string) {
  return current.replace(/\s+/g, "") === String(expected).replace(/\s+/g, "");
}

async function setEditableText(inputLocator: Locator, value: string): Promise<boolean> {
  const isInputLike = await inputLocator
    .evaluate((element) => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
    .catch(() => false);
  if (isInputLike) {
    await inputLocator.fill(value).catch(() => undefined);
  } else {
    await inputLocator
      .evaluate((element, text) => {
        const editable = element as HTMLElement;
        editable.focus();
        editable.textContent = text;
        editable.dispatchEvent(new Event("input", { bubbles: true }));
        editable.dispatchEvent(new Event("change", { bubbles: true }));
      }, value)
      .catch(() => undefined);
  }
  await inputLocator.evaluate(
    (element, text) => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        if ((element.value || "").replace(/\s+/g, "") !== (text as string).replace(/\s+/g, "")) {
          element.value = text as string;
          element.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      const editable = element as HTMLElement;
      const current = (editable.textContent || "").replace(/\s+/g, "");
      if (current !== (text as string).replace(/\s+/g, "")) {
        editable.textContent = text as string;
        editable.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    value
  );
  return getEditableText(inputLocator)
    .then((current) => normalizeText(current) === normalizeText(value))
    .catch(() => false);
}

async function clickSendButton(page: Page, inputLocator: Locator, mode: "priority" | "fallback" = "fallback") {
  const baseSelectors = [
    page.getByRole("button", { name: /^(发送|Send|Submit|提交)$/i }).last(),
    page.locator("button[aria-label*='发送']").last(),
    page.locator("button[aria-label*='提交']").last(),
    page.locator("button[aria-label*='Send']").last(),
    page.locator("button[aria-label*='send']").last(),
    page.locator("button[title*='发送']").last(),
    page.locator("button[title*='提交']").last(),
    page.locator("button[title*='Send']").last(),
    page.locator("[role='button'][aria-label*='发送']").last(),
    page.locator("[role='button'][aria-label*='Submit']").last(),
    page.locator("[role='button'][aria-label*='send']").last(),
    page.locator("button[type='submit']").last(),
    page.locator("button[data-testid*='send']").last(),
    page.locator("[role='button'][data-testid*='send']").last(),
    page.locator("svg[aria-label*='发送'], svg[title*='发送']").last()
  ];
  const doubaoSelectors = [
    page.getByRole("button", { name: /发送/i }).last(),
    page.locator("button[aria-label*='发送消息']").last(),
    page.locator("button[aria-label*='发送消息（']").last(),
    page.locator("[role='button'][aria-label*='发送消息']").last(),
    page.locator("[data-testid*='send-button']").last(),
    page.locator("[class*='send'][role='button']").last(),
    page.locator("[class*='sendBtn']").last()
  ];
  const candidates = mode === "priority" ? [...baseSelectors, ...doubaoSelectors] : [...doubaoSelectors, ...baseSelectors];
  for (const button of candidates) {
    if ((await button.count().catch(() => 0)) > 0 && (await button.isVisible().catch(() => false)) && (await button.isEnabled().catch(() => false))) {
      await button.click({ timeout: 5000 }).catch(() => undefined);
      return true;
    }
  }
  const clickedNearest = await clickNearestPromptButton(page, inputLocator);
  return clickedNearest;
}

async function clickNearestPromptButton(page: Page, inputLocator: Locator) {
  const hasFocusedInput = await inputLocator.evaluate((element) => {
    const active = document.activeElement;
    return Boolean(active && (active === element || element.contains(active)));
  });

  return page
    .evaluate((isFocusedInput) => {
      const isVisible = (element: Element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const inputSelectors = ["textarea", "[contenteditable='true']", "div[role='textbox']", "input[type='text']", "input:not([type])"];
      const inputs = inputSelectors
        .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
        .filter(isVisible);
      const activeElement = document.activeElement as Element | null;
      const preferredInput =
        inputs.find((item) => item === activeElement || item.contains(activeElement)) ||
        inputs.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
      if (!preferredInput) return false;

      const inputRect = preferredInput.getBoundingClientRect();
      const buttons = Array.from(document.querySelectorAll<HTMLElement>("button,[role='button']"))
        .filter(isVisible)
        .filter((button) => !button.hasAttribute("disabled") && button.getAttribute("aria-disabled") !== "true")
        .filter((button) => {
          const label = `${button.textContent || ""} ${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`.trim();
          return !isFocusedInput || Boolean(label);
        })
        .map((button) => {
          const rect = button.getBoundingClientRect();
          const label = `${button.textContent || ""} ${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`;
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const inComposerBand = centerY >= inputRect.top - 80 && centerY <= inputRect.bottom + 140;
          const textScore = /发送|提交|send|submit/i.test(label) ? -1200 : 0;
          const distance = Math.hypot(centerX - inputRect.right, centerY - inputRect.bottom);
          return { button, score: (inComposerBand ? 0 : 2200) + textScore + distance };
        })
        .sort((a, b) => a.score - b.score);

      const target = buttons[0]?.button;
      if (!target) return false;
      target.click();
      return true;
    }, hasFocusedInput)
    .catch(() => false);
}

async function collectSubmissionState(page: Page, inputLocator: Locator): Promise<SubmissionState> {
  const [url, bodyText, inputText, messageNodeCount] = await Promise.all([
    page.url(),
    page.locator("body").innerText({ timeout: 8000 }).catch(() => ""),
    getEditableText(inputLocator).catch(() => ""),
    page
      .evaluate(() => {
        const selectors = ["[data-message-role]", "[role='listitem']", ".message", ".msg", ".chat-message", ".conversation-item", ".bubble", ".message-content"];
        return selectors.reduce((acc, selector) => acc + document.querySelectorAll(selector).length, 0);
      })
      .catch(() => 0)
  ]);
  return {
    url,
    bodyText,
    bodyTextLength: bodyText.length,
    inputText,
    messageNodeCount: typeof messageNodeCount === "number" ? messageNodeCount : 0
  };
}

async function getEditableText(inputLocator: Locator): Promise<string> {
  return inputLocator
    .evaluate((element) => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
      return element.textContent || "";
    })
    .catch(() => "");
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, "");
}

function normalizeForSearch(value: string) {
  return normalizeText(value).toLowerCase();
}

async function detectPlatformBlockingState(page: Page, engineType: string): Promise<string | null> {
  const normalizedUrl = page.url().toLowerCase();
  const text = normalizeForSearch(await page.locator("body").innerText({ timeout: 4000 }).catch(() => ""));
  if (engineType === "doubao") {
    if (
      normalizedUrl.includes("doubao-region-ban") ||
      /\/security\//i.test(normalizedUrl) ||
      /受区域限制/.test(text) ||
      /请先登录再使用豆包/.test(text)
    ) {
      return "doubao_region_access_blocked_or_requires_login";
    }
    return null;
  }
  if (engineType === "qianwen") {
    if (
      /passport\.qianwen\.com/.test(normalizedUrl) ||
      /qianwen\.com\/.*login/i.test(normalizedUrl) ||
      /登录可同步历史对话/.test(text) ||
      /请先登录/.test(text)
    ) {
      return "qianwen_requires_login";
    }
    return null;
  }
  return null;
}

async function waitForSubmissionStateChange(
  page: Page,
  inputLocator: Locator,
  baseline: SubmissionState,
  queryText: string,
  timeoutMs: number
) {
  const normalizedQuery = normalizeText(queryText);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await collectSubmissionState(page, inputLocator).catch(() => baseline);
    const currentNormalizedInput = normalizeText(current.inputText);
    const baselineNormalizedInput = normalizeText(baseline.inputText);
    const currentNormalizedBody = normalizeText(current.bodyText);
    if (current.url !== baseline.url) return true;
    if (current.messageNodeCount > baseline.messageNodeCount) return true;
    if (baselineNormalizedInput.includes(normalizedQuery) && !currentNormalizedInput.includes(normalizedQuery) && currentNormalizedBody.includes(normalizedQuery)) {
      return true;
    }
    await page.waitForTimeout(300);
  }
  return false;
}

async function waitForLikelySubmitNetwork(page: Page, engineType: string, timeoutMs: number) {
  return waitForLikelySubmitNetworkWithQuery(page, engineType, "", timeoutMs).then(() => true).catch(() => false);
}

async function waitForLikelySubmitNetworkWithQuery(page: Page, engineType: string, queryText: string, timeoutMs: number) {
  const rawUrl = page.url();
  let host = "";
  try {
    host = new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  const normalizedQuery = normalizeForSearch(queryText);
  // 网络层确认用于覆盖 UI 未及时变化的情况；若提供 queryText，则请求体必须包含该 Query。
  return page.waitForRequest(
    (request) => {
      if (!isLikelySubmitRequest(request, host, engineType)) return false;
      if (!normalizedQuery) return true;
      const postData = request.postData();
      if (postData) {
        if (normalizeForSearch(postData).includes(normalizedQuery)) return true;
      }
      const payload = safeRequestPayload(request);
      if (payload) {
        if (typeof payload === "string") {
          if (normalizeForSearch(payload).includes(normalizedQuery)) return true;
        } else if (recursivelyFindTextInRequestPayload(payload, normalizedQuery)) {
          return true;
        }
      }
      return false;
    },
    { timeout: timeoutMs }
  );
}

function safeRequestPayload(request: Request) {
  try {
    const jsonPayload = request.postDataJSON();
    if (jsonPayload && typeof jsonPayload === "object") {
      return jsonPayload;
    }
    if (typeof jsonPayload === "string") {
      return jsonPayload;
    }
  } catch {
    // Ignore incompatible request payload formats
  }
  return null;
}

function recursivelyFindTextInRequestPayload(payload: unknown, normalizedQuery: string): boolean {
  if (!payload) return false;
  if (typeof payload === "string") return normalizeForSearch(payload).includes(normalizedQuery);
  if (Array.isArray(payload)) {
    return payload.some((item) => recursivelyFindTextInRequestPayload(item, normalizedQuery));
  }
  if (typeof payload === "object") {
    for (const value of Object.values(payload as Record<string, unknown>)) {
      if (recursivelyFindTextInRequestPayload(value, normalizedQuery)) return true;
    }
  }
  return false;
}

function isLikelySubmitRequest(request: Request, host: string, engineType: string) {
  if (request.isNavigationRequest()) return false;
  const method = request.method().toUpperCase();
  if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") return false;
  const url = request.url().toLowerCase();
  if (!url.startsWith("http")) return false;
  if (/analytics|beacon|pixel|sentry|clarity|log/.test(url)) return false;
  const resourceType = request.resourceType();
  if (resourceType === "script" || resourceType === "stylesheet" || resourceType === "image" || resourceType === "font" || resourceType === "media") return false;

  if (url.includes("chrome-extension")) return false;
  if (host && !url.includes(host) && url.includes(".js") === false && url.includes(".css") === false) {
    if (engineType !== "doubao" && engineType !== "chatgpt" && engineType !== "qianwen" && engineType !== "perplexity") {
      return false;
    }
  }
  return /api|chat|stream|completion|message|conversation|search|prompt|answer|sse/.test(url);
}

function buildStartUrl(input: CollectionInput) {
  if (input.engineType === "google_aio") {
    const query = encodeURIComponent(input.queryText);
    return `${input.baseUrl}?q=${query}&hl=${input.language.startsWith("zh") ? "zh-CN" : "en"}`;
  }
  return input.baseUrl;
}
