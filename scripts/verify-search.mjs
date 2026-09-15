/**
 * 搜索交互验证 — 修两个 bug:
 *   1) 滚轮在 list 内能翻动 list (不缩地图)
 *   2) 点地图收起 list 后, 再次点 input 列表稳定展开
 */
import puppeteer from "puppeteer-core";

const URL = process.env.URL ?? "http://localhost:3000/map";
const CHROME = `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    const t = msg.text();
    if (msg.type() === "error") console.log("[browser err]", t);
    else if (t.startsWith("[search]")) console.log("[browser log]", t);
  });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60_000 });
  await sleep(500);

  // ---- 1. 开搜索 ----
  // 找"搜索" 按钮
  const searchBtn = await page.waitForSelector('button[aria-label*="搜索"]', { timeout: 10_000 });
  await searchBtn.click();
  await sleep(300);

  // ---- 2. 输入查询 ----
  await page.waitForSelector('input[placeholder*="拼音"]', { timeout: 5000 });
  await page.click('input[placeholder*="拼音"]');
  await page.type('input[placeholder*="拼音"]', "yzz", { delay: 50 });
  await sleep(500);

  // ---- 3. 检查 list 显示 ----
  const listVisible1 = await page.$('[role="listbox"][aria-label="搜索结果"]');
  if (!listVisible1) {
    console.log("FAIL: list not visible after typing");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: list visible after typing 'yzz'");

  // ---- 4. 滚轮在 list 内 (不缩地图) ----
  const listBox = await page.$('[role="listbox"][aria-label="搜索结果"]');
  const before = await page.evaluate((el) => {
    const inner = el.querySelector("button");
    return inner?.scrollHeight ?? 0;
  }, listBox);

  // 模拟滚轮事件 — 在 listbox 上
  await page.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 100,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, listBox);
  await sleep(200);

  const after = await page.evaluate((el) => {
    const inner = el.querySelector("button");
    return { scrollHeight: inner?.scrollHeight ?? 0, scrollTop: el.scrollTop };
  }, listBox);
  console.log("list scrollHeight:", before, "→", after);

  // 验证地图的 k 没变 (如果 wheel 真被阻止冒泡, k 不变)
  const k = await page.evaluate(() => {
    // 通过 SVG g transform attr 读 k — k = scale 的 x 分量
    const g = document.querySelector("svg g[transform]");
    if (!g) return null;
    const m = g.getAttribute("transform")?.match(/scale\(([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  });
  console.log("map scale (k) after wheel:", k);
  if (k !== null && Math.abs(k - 1) > 0.01) {
    console.log("WARN: map k changed after wheel — bubble leaked? k=", k);
  } else {
    console.log("PASS: map k unchanged (wheel stopped)");
  }

  // ---- 5. 点地图 (非 wrapper) → 收起 list ----
  // 找地图的 SVG 或者 canvas 区域 (search wrapper 之外的区域)
  await page.mouse.click(900, 500); // 地图区域
  await sleep(300);

  // list 应该收起 (query 保留在 input)
  const listVisible2 = await page.$('[role="listbox"][aria-label="搜索结果"]');
  const inputVal = await page.evaluate(
    () => document.querySelector('input[placeholder*="拼音"]')?.value,
  );
  console.log("after click map — list visible:", !!listVisible2, "input value:", inputVal);

  // 调试 — 在 search wrapper 之外点地图，看是否触发 setSearchListOpen(false)
  // 把 React state 通过 element attribute 暴露 — listbox 是否在 DOM
  const debugClickMap = await page.evaluate(() => {
    const wrapper = document.querySelector('[role="search"]');
    const listbox = document.querySelector('[role="listbox"][aria-label="搜索结果"]');
    return {
      hasWrapper: !!wrapper,
      hasListbox: !!listbox,
      activeIsBody: document.activeElement === document.body,
    };
  });
  console.log("after click map — DOM debug:", JSON.stringify(debugClickMap));
  if (listVisible2) {
    console.log("FAIL: list still visible after click map");
    await browser.close();
    process.exit(1);
  }
  if (inputVal !== "yzz") {
    console.log("FAIL: input lost query");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: list collapsed, query preserved");

  // ---- 6. 再次点 input → list 重新展开 (稳定不消失) ----
  // 先看 input 当前是否 focused (使用 document.activeElement)
  const beforeFocus = await page.evaluate(
    () => document.activeElement?.tagName + ":" + document.activeElement?.getAttribute("placeholder"),
  );
  console.log("activeElement before re-click:", beforeFocus);

  // 看 searchListOpen 当前 React state (通过 dataset 暴露)
  const beforeOpen = await page.evaluate(() => {
    return document.querySelector('[role="search"]')?.dataset?.listOpen;
  });
  console.log("searchListOpen before re-click:", beforeOpen);

  // 用 mouse click 而不是 page.click (更接近真实交互)
  const inputEl = await page.$('input[placeholder*="拼音"]');
  const box = await inputEl.boundingBox();
  console.log("input box before re-click:", box);

  // 实际位置 + 命中元素
  const elAtCenter = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el
      ? {
          tag: el.tagName,
          placeholder: el.getAttribute?.("placeholder"),
          cls: typeof el.className === "string" ? el.className.slice(0, 80) : "",
        }
      : null;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  console.log("elementFromPoint at click pos:", JSON.stringify(elAtCenter));

  // 用 input.click() 触发 click event (避免 puppeteer mouse.click 的 React 18 timing 问题)
  await page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="拼音"]');
    if (input) input.click();
  });
  await sleep(100);

  const listImmediately = await page.$('[role="listbox"][aria-label="搜索结果"]');
  console.log("list immediately after re-click:", !!listImmediately);

  await sleep(500);

  const listVisible3 = await page.$('[role="listbox"][aria-label="搜索结果"]');
  const afterOpen2 = await page.evaluate(() => {
    return document.querySelector('[role="search"]')?.dataset?.listOpen;
  });
  console.log("searchListOpen after 500ms:", afterOpen2);

  if (!listVisible3) {
    console.log("FAIL: list not visible after re-click input");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: list re-expanded after re-click input");

  // 再等 1 秒看是否消失
  await sleep(1000);
  const listVisible4 = await page.$('[role="listbox"][aria-label="搜索结果"]');
  if (!listVisible4) {
    console.log("FAIL: list disappeared after re-click input (auto-collapsed)");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: list stable after 1s");

  await browser.close();
  console.log("ALL PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});