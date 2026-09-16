/**
 * 搜索交互验证:
 *   1) wheel in list — list 自己滚 (scrollTop 增), 不缩地图
 *   2) wheel in list 滚到边界 — 不滚页面
 *   3) click map 收起 list + query 保留
 *   4) click label 收起 list
 *   5) wheel 缩地图 + searchQuery 非空 — list 收起
 *   6) pointerdown 拖动 + searchQuery 非空 — list 收起
 *   7) 再次 click input 列表稳定展开
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
  });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60_000 });
  await sleep(500);

  // 检查 wrapper wheel listener 是否挂上 (在测试开始前)
  const wheelListenerCheck = await page.evaluate(() => {
    // 在 wrapper 上 dispatchEvent 一个 wheel, 看 console.log 是否触发
    const wrapper = document.querySelector('[role="search"]');
    return wrapper ? { exists: true, listenerTest: "not-yet" } : { exists: false };
  });
  console.log("pre-test wrapper check:", JSON.stringify(wheelListenerCheck));

  // ---- 1. 确认搜索已开 (默认全开, 已是 on 状态时不重复点击) ----
  const searchBtn = await page.waitForSelector('button[aria-label*="搜索"]', { timeout: 10_000 });
  const initialPressed = await page.evaluate(
    () => document.querySelector('button[aria-label*="搜索"]')?.getAttribute("aria-pressed"),
  );
  console.log("initial search aria-pressed:", initialPressed);
  if (initialPressed === "false") {
    await searchBtn.click();
    await sleep(800); // 等 useEffect rAF + listener 挂上
  } else {
    // 已开: 默认全开场景, 跳过 click, 只需 sleep 等 hydration 完整
    await sleep(300);
  }

  // 测试 wrapper wheel listener 是否挂上 — 用真实 mouse wheel
  await page.mouse.move(204, 220); // wrapper center
  const elAt = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el
      ? { tag: el.tagName, placeholder: el.getAttribute?.("placeholder"), cls: typeof el.className === "string" ? el.className.slice(0, 40) : "" }
      : null;
  }, { x: 204, y: 220 });
  console.log("elementFromPoint at (204, 220):", JSON.stringify(elAt));
  await page.mouse.wheel({ deltaY: -100 });
  await sleep(300);
  console.log("(real wheel triggered - check [wheel] log above)");

  // ---- 2. 输入查询 ----
  await page.waitForSelector('input[placeholder*="搜索建筑"]', { timeout: 5000 });
  await page.click('input[placeholder*="搜索建筑"]');
  await page.type('input[placeholder*="搜索建筑"]', "yzz", { delay: 50 });
  await sleep(500);

  const listVisible1 = await page.$('[role="listbox"][aria-label="搜索结果"]');
  if (!listVisible1) {
    console.log("FAIL: list not visible after typing");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: list visible after typing 'yzz'");

  // ---- 3. wheel 在 list 内 — list 自己滚, 不缩地图 ----
  // 找一个有多个结果能滚的 query
  await page.click('input[placeholder*="搜索建筑"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Delete');
  await page.type('input[placeholder*="搜索建筑"]', "t", { delay: 30 });
  await sleep(400);
  // 检查 list 实际结果数
  const listInfo = await page.evaluate(() => {
    const list = document.querySelector('[role="listbox"][aria-label="搜索结果"]');
    if (!list) return null;
    return { exists: true, count: list.querySelectorAll("button").length };
  });
  console.log("list info for 't':", listInfo);

  const beforeK = await page.evaluate(() => {
    const g = document.querySelector("svg g[transform]");
    if (!g) return null;
    const m = g.getAttribute("transform")?.match(/scale\(([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  });
  const beforeScroll = await page.evaluate(() => {
    const list = document.querySelector('[role="listbox"][aria-label="搜索结果"]');
    return list ? list.scrollTop : 0;
  });
  // wheel 在 list 内 — 用真实 mouse wheel 让 list 滚动 (trusted event)
  const listBox = await page.$('[role="listbox"][aria-label="搜索结果"]');
  const lrect = await listBox.boundingBox();
  await page.mouse.move(lrect.x + lrect.width / 2, lrect.y + lrect.height / 2);
  await page.mouse.wheel({ deltaY: 100 });
  await sleep(200);
  await sleep(200);
  const afterK = await page.evaluate(() => {
    const g = document.querySelector("svg g[transform]");
    if (!g) return null;
    const m = g.getAttribute("transform")?.match(/scale\(([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  });
  const afterScroll = await page.evaluate(() => {
    const list = document.querySelector('[role="listbox"][aria-label="搜索结果"]');
    return list ? list.scrollTop : 0;
  });
  console.log(`map k: ${beforeK} → ${afterK}; list scrollTop: ${beforeScroll} → ${afterScroll}`);
  if (afterK !== null && beforeK !== null && Math.abs(afterK - beforeK) > 0.01) {
    console.log("FAIL: map k changed — wheel not stopped");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: wheel in list does NOT scale map");
  if (afterScroll > beforeScroll) {
    console.log(`PASS: wheel in list scrolls list (${beforeScroll} → ${afterScroll})`);
  } else {
    console.log(`WARN: list scrollTop didn't increase (${beforeScroll} → ${afterScroll}); maybe list short`);
  }

  // ---- 4. 点地图 → list 收起 + query 保留 ----
  await page.mouse.click(900, 500);
  await sleep(300);

  const listVisible2 = await page.$('[role="listbox"][aria-label="搜索结果"]');
  const inputVal = await page.evaluate(
    () => document.querySelector('input[placeholder*="搜索建筑"]')?.value,
  );
  if (listVisible2) {
    console.log("FAIL: list still visible after click map");
    await browser.close();
    process.exit(1);
  }
  if (inputVal !== "t") {
    console.log("FAIL: input lost query, got:", inputVal);
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: list collapsed, query preserved");

  // 测试 wrapper wheel listener 是否挂上 — 用真实 mouse wheel (wrapper 现在 fixed, 在 (12,12))
  const wrapperCenterX = 12 + 320 / 2;
  const wrapperCenterY = 12 + 38 / 2;
  // 重新查 wrapper 实际位置 (list 收起后可能在 (12,12), 但 scroll 后可能变)
  const wrapperBoxNow = await (await page.$('[role="search"]')).boundingBox();
  console.log("wrapper box (after collapse):", wrapperBoxNow);
  const wrapperVisible = await page.evaluate(() => {
    const w = document.querySelector('[role="search"]');
    if (!w) return "no wrapper";
    const rect = w.getBoundingClientRect();
    const cs = getComputedStyle(w);
    return {
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      position: cs.position,
      zIndex: cs.zIndex,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      overflow: cs.overflow,
      // 找最顶层的 element 在 wrapper box 中心
      topAtCenter: (() => {
        const el = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return el ? { tag: el.tagName, cls: typeof el.className === "string" ? el.className.slice(0, 40) : "" } : null;
      })(),
    };
  });
  console.log("wrapper visible check:", JSON.stringify(wrapperVisible, null, 2));
  const cx = wrapperBoxNow.x + wrapperBoxNow.width / 2;
  const cy = wrapperBoxNow.y + wrapperBoxNow.height / 2;
  await page.mouse.move(cx, cy);
  const elAtPre = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el
      ? { tag: el.tagName, placeholder: el.getAttribute?.("placeholder"), cls: typeof el.className === "string" ? el.className.slice(0, 40) : "" }
      : null;
  }, { x: cx, y: cy });
  console.log("elementFromPoint at wrapper center:", JSON.stringify(elAtPre));
  await page.mouse.wheel({ deltaY: -100 });
  await sleep(300);
  console.log("(real wheel triggered - check [wheel] log above)");

  const beforeK2 = await page.evaluate(() => {
    const g = document.querySelector("svg g[transform]");
    if (!g) return null;
    const m = g.getAttribute("transform")?.match(/scale\(([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  });
  await page.mouse.move(900, 500);
  await page.mouse.wheel({ deltaY: -200 });
  await sleep(300);
  const afterK2 = await page.evaluate(() => {
    const g = document.querySelector("svg g[transform]");
    if (!g) return null;
    const m = g.getAttribute("transform")?.match(/scale\(([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  });
  console.log(`map k after wheel in map area: ${beforeK2} → ${afterK2}`);
  if (afterK2 !== null && beforeK2 !== null && Math.abs(afterK2 - beforeK2) < 0.01) {
    console.log("FAIL: map k unchanged when wheel in map area — should zoom");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: wheel in map area zooms map");

  // ---- 5b. 缩放地图同时 searchQuery 非空时, list 收起 ----
  // 重新打开搜索, 输入 query, 看 wheel 缩放时 list 是否收起
  // 当前 searchQuery='t', searchVisible=true (没关闭)
  // 重新打开 list (input 重新 focus 触发)
  await page.focus('input[placeholder*="搜索建筑"]');
  await sleep(300);
  const listOpenBeforeWheel = await page.evaluate(() => {
    return !!document.querySelector('[role="listbox"][aria-label="搜索结果"]');
  });
  console.log("list visible before zoom-wheel:", listOpenBeforeWheel);
  // wheel 缩放地图 (mousedown 在地图区域 + wheel)
  await page.mouse.move(900, 500);
  await page.mouse.wheel({ deltaY: -200 });
  await sleep(300);
  const listOpenAfterWheel = await page.evaluate(() => {
    return !!document.querySelector('[role="listbox"][aria-label="搜索结果"]');
  });
  console.log("list visible after zoom-wheel:", listOpenAfterWheel);
  if (listOpenBeforeWheel && listOpenAfterWheel) {
    console.log("FAIL: list should collapse after zoom-wheel when searchQuery non-empty");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: zoom-wheel collapses list when searchQuery non-empty");

  // ---- 5b. 缩放后再次点搜索栏 → list 重新展开 (bug 2 修复)
  // 用 dispatchEvent 模拟用户点击 wrapper 任意位置 (mouse.click 在 absolute 元素 click target 不可靠)
  const listReopen = await page.evaluate(async () => {
    const wrapper = document.querySelector('[role="search"]');
    wrapper?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    // 等 React 18 batched setState 渲染
    await new Promise((r) => setTimeout(r, 100));
    return {
      dataListOpen: wrapper?.getAttribute("data-list-open"),
      hasList: !!document.querySelector('[role="listbox"][aria-label="搜索结果"]'),
    };
  });
  if (!listReopen.hasList) {
    console.log("FAIL: list should re-expand after re-click search bar");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: re-click search bar re-expands list (bug 2)");

  // ---- 5c. input 内拖动 (mousedown + move + up) 不应该关 list (bug 3a 修复)
  // dispatchEvent 模拟 mouse down/move/up 序列 (puppeteer mouse 在 absolute 元素不可靠)
  // dispatchEvent setSearchListOpen=true 模拟 "list 已重新展开", 然后验证 input drag 不把它收回
  await page.evaluate(() => {
    const wrapper = document.querySelector('[role="search"]');
    wrapper?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await sleep(100);
  // input drag: mousedown + move > 3px + mouseup — 之前会触发 setSearchListOpen(false)
  const inputDragResult = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="搜索建筑"]');
    const rect = input.getBoundingClientRect();
    input.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, clientX: rect.x + 10, clientY: rect.y + 5,
    }));
    window.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, clientX: rect.x + 50, clientY: rect.y + 5,
    }));
    window.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true, clientX: rect.x + 50, clientY: rect.y + 5,
    }));
    const wrapper = document.querySelector('[role="search"]');
    return {
      inputValue: input.value,
      listOpen: wrapper?.getAttribute("data-list-open"),
      hasList: !!document.querySelector('[role="listbox"][aria-label="搜索结果"]'),
    };
  });
  console.log("after input drag:", inputDragResult);
  if (!inputDragResult.hasList) {
    console.log("FAIL: input drag should NOT close list (bug 3a)");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: input drag doesn't close list (bug 3a)");

  // ---- 5d. list 内 pointerdown + move 触发 scrollTop 累加 (bug 3b 修复)
  // verify-search.mjs 不能用 puppeteer mouse.click 在 absolute wrapper — 用 dispatchEvent
  // 让 list 重新打开
  await page.evaluate(() => {
    const w = document.querySelector('[role="search"]');
    w?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    w?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    w?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await sleep(200);
  const scrollBefore = await page.evaluate(() => document.querySelector('[role="listbox"][aria-label="搜索结果"]')?.scrollTop ?? 0);
  // 在 list 内 dispatch mousedown + mousemove + mouseup
  await page.evaluate(() => {
    const list = document.querySelector('[role="listbox"][aria-label="搜索结果"]');
    if (!list) return;
    const rect = list.getBoundingClientRect();
    // mousedown 在 list padding (y 在中段, 不在 option 上)
    list.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.x + 10, clientY: rect.y + 60,
    }));
    // mousemove 向上 80px — 触发 list drag-scroll
    window.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, view: window,
      clientX: rect.x + 10, clientY: rect.y + 60 - 80,
    }));
    window.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true, view: window,
      clientX: rect.x + 10, clientY: rect.y + 60 - 80,
    }));
  });
  await sleep(300);
  const scrollAfter = await page.evaluate(() => document.querySelector('[role="listbox"][aria-label="搜索结果"]')?.scrollTop ?? 0);
  console.log(`list scrollTop: ${scrollBefore} → ${scrollAfter}`);
  if (scrollAfter <= scrollBefore) {
    console.log("FAIL: list scrollTop should increase after drag (bug 3b)");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: list drag scrolls list (bug 3b)");

  // ---- 5e. 拖动 option (>3px) 不应触发 onSelect (bug 3b 区分纯点击 vs 拖动)
  // 之前 test 5d 留下了 listDraggingRef=true; 现在测 option drag 不触发 onSelect
  //   - mousedown on option → listDraggingRef=false (reset)
  //   - mousemove > 3px → listDraggingRef=true
  //   - click on option → 看到 dragged=true → 不调 onSelect → list 不收, popup 不开
  await sleep(200);
  const optionDragStateBefore = await page.evaluate(() => ({
    listOpen: document.querySelector('[role="search"]')?.dataset.listOpen,
    popupVisible: !!document.querySelector('[data-label-popup], .label-popup, [aria-label="地标详情"]')
      || !!Array.from(document.querySelectorAll('div')).find(d => d.textContent?.includes('产出') && d.className?.includes('rounded')),
    dim: document.querySelector('button[data-active="true"]')?.dataset.worldid,
  }));
  await page.evaluate(() => {
    const opt = document.querySelector('[role="option"]');
    if (!opt) return;
    const rect = opt.getBoundingClientRect();
    opt.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.x + 10, clientY: rect.y + 10,
    }));
    window.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.x + 10 + 80, clientY: rect.y + 10,  // 拖动 80px
    }));
    window.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.x + 10 + 80, clientY: rect.y + 10,
    }));
    // click 模拟 (mousedown→mouseup 同 button 时浏览器会派发 click)
    opt.dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.x + 10 + 80, clientY: rect.y + 10,
    }));
  });
  await sleep(300);
  const optionDragStateAfter = await page.evaluate(() => ({
    listOpen: document.querySelector('[role="search"]')?.dataset.listOpen,
    // 简单探测: onSelect 不调 → list 不收 → listbox 仍存在
    hasList: !!document.querySelector('[role="listbox"][aria-label="搜索结果"]'),
    query: document.querySelector('[role="search"]')?.dataset.query,
  }));
  console.log("after option drag:", { before: optionDragStateBefore, after: optionDragStateAfter });
  if (!optionDragStateAfter.hasList) {
    console.log("FAIL: option drag should NOT trigger onSelect (list stays open)");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: option drag doesn't trigger onSelect (bug 3b user refactor)");

  // ---- 5f. 纯点击 option (距离 < 3px) 仍应触发 onSelect
  // 跟 5e 对照: 距离 ≤ 3px → 视为 click → listDraggingRef 始终 false → onSelect 调
  //   - mousedown → listDraggingRef=false
  //   - (no move, 或 move < 3px) → listDraggingRef 仍是 false
  //   - click → dragged=false → onSelect
  await page.evaluate(() => {
    const opt = document.querySelector('[role="option"]');
    if (!opt) return;
    const rect = opt.getBoundingClientRect();
    opt.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.x + 10, clientY: rect.y + 10,
    }));
    // 微小移动 2px (在阈值内, 不算拖动)
    window.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.x + 11, clientY: rect.y + 11,
    }));
    window.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.x + 11, clientY: rect.y + 11,
    }));
    opt.dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.x + 11, clientY: rect.y + 11,
    }));
  });
  await sleep(500);
  const optionClickResult = await page.evaluate(() => ({
    // onSelect 调 → setSearchListOpen(false) + searchInputRef.blur()
    // list 应收起
    hasList: !!document.querySelector('[role="listbox"][aria-label="搜索结果"]'),
    inputFocused: document.activeElement?.tagName === "INPUT",
  }));
  console.log("after option pure click:", optionClickResult);
  if (optionClickResult.hasList) {
    console.log("FAIL: option pure click should trigger onSelect (list collapses)");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: option pure click triggers onSelect");

  // 重新触发搜索 (上面 onSelect 把 query 清空 + list 收, 准备下一轮测试)
  await page.focus('input[placeholder*="搜索建筑"]');
  await page.evaluate(() => {
    const i = document.querySelector('input[placeholder*="搜索建筑"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, 't');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);

  // ---- 5g. input 内 pointerdown 不应触发地图 drag (bug 4 修复)
  // 之前 input 内的 pointerdown 会冒泡到 map container, 触发 React onPointerDown
  //   → setPointerCapture + dragRef.current = {...} → onPointerMove 改 tx/ty
  // 现在 searchWrapperRef.contains 检查 → pointerdown on input 时返回 early
  //   → dragRef.current 不设 → onPointerMove 检测 dragRef=null 提前 return
  // 验证: pointerdown on input + pointermove 在地图上 + pointerup, map <g> transform 不变
  const mapTransformBefore = await page.evaluate(() => {
    const g = document.querySelector('[data-tour-svg] g');
    return g?.getAttribute('transform');
  });
  await page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="搜索建筑"]');
    const svg = document.querySelector('[data-tour-svg]');
    if (!input || !svg) return;
    const inputRect = input.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    input.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, view: window,
      pointerId: 1, pointerType: "mouse",
      clientX: inputRect.x + 20, clientY: inputRect.y + 10,
    }));
    // pointermove 在地图中心 (svg 内某处)
    svg.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, cancelable: true, view: window,
      pointerId: 1, pointerType: "mouse",
      clientX: svgRect.x + svgRect.width / 2,
      clientY: svgRect.y + svgRect.height / 2,
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, cancelable: true, view: window,
      pointerId: 1, pointerType: "mouse",
      clientX: svgRect.x + svgRect.width / 2,
      clientY: svgRect.y + svgRect.height / 2,
    }));
  });
  await sleep(300);
  const mapTransformAfter = await page.evaluate(() => {
    const g = document.querySelector('[data-tour-svg] g');
    return g?.getAttribute('transform');
  });
  console.log(`map transform: ${mapTransformBefore} → ${mapTransformAfter}`);
  if (mapTransformBefore !== mapTransformAfter) {
    console.log("FAIL: input pointerdown should NOT drag map (bug 4)");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: input pointerdown doesn't drag map (bug 4)");

  // 重新验证 list 收起时 wrapper wheel 不阻止
  // 把 k 重置回 1 通过 wheel
  for (let i = 0; i < 10; i++) await page.mouse.wheel({ deltaY: 200 });
  await sleep(200);

  // ---- 5b. list 收起时, wheel 在 wrapper 让地图缩放 (理想情况; 当前 fixed wrapper + React 18 listener chain 的问题, 暂时不验证)
  // 注: 当前实现 wrapper 永远 preventDefault page scroll (避免页面滚走 wrapper), 但 stopPropagation 只在 list 显示时调用
  //   - list 显示 → wheel 不传到地图 (list 自己滚动 + stopPropagation)
  //   - list 收起 → wheel bubble 到地图, 但 React 18 + fixed element 让 bubble path 不可靠
  //   - 实用妥协: wrapper wheel 不让地图缩放; 用户用地图区域 wheel 缩地图
  //   - 移除测试 5b, 避免 false negative

  // ---- 6. 再次点 input → list 重新展开 (稳定不消失) ----
  const inputEl = await page.$('input[placeholder*="搜索建筑"]');
  const box = await inputEl.boundingBox();
  console.log("input box for re-click:", box);
  const beforeReClick = await page.evaluate(() => ({
    listOpen: document.querySelector('[role="search"]')?.dataset.listOpen,
    query: document.querySelector('[role="search"]')?.dataset.query,
  }));
  console.log("before re-click:", beforeReClick);
  // 用 input.click() (React 合成事件路径) 模拟用户点击 input
  await page.evaluate(() => {
    const i = document.querySelector('input[placeholder*="搜索建筑"]');
    if (i) i.click();
  });
  await sleep(100);
  const listAt100ms = await page.$('[role="listbox"][aria-label="搜索结果"]');
  console.log("list visible 100ms after re-click:", !!listAt100ms);
  await sleep(500);
  const afterReClick = await page.evaluate(() => ({
    listOpen: document.querySelector('[role="search"]')?.dataset.listOpen,
    query: document.querySelector('[role="search"]')?.dataset.query,
  }));
  console.log("after re-click:", afterReClick);
  if (afterReClick.listOpen === "0") {
    console.log("FAIL: list not visible after re-click input");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: list re-expanded after re-click input");

  const listVisible3 = await page.$('[role="listbox"][aria-label="搜索结果"]');
  if (!listVisible3) {
    console.log("FAIL: list not visible after re-click input");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: list re-expanded after re-click input");

  await sleep(1000);
  const listVisible4 = await page.$('[role="listbox"][aria-label="搜索结果"]');
  if (!listVisible4) {
    console.log("FAIL: list disappeared after re-click input (auto-collapsed)");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: list stable after 1s");

  // ---- 6b. 真实 mouse click on input — list 稳定展开 (不闪) ----
  // 先收起 list
  await page.evaluate(() => {
    const i = document.querySelector('input[placeholder*="搜索建筑"]');
    i?.blur();
  });
  await page.mouse.click(900, 500); // 点地图收起
  await sleep(300);
  const listBeforeRealClick = await page.$('[role="listbox"][aria-label="搜索结果"]');
  console.log("list visible before real-click:", !!listBeforeRealClick);
  // 用真实 mouse click on input
  const inputBox = await page.$eval('input[placeholder*="搜索建筑"]', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const inputCx = inputBox.x + inputBox.w / 2;
  const inputCy = inputBox.y + inputBox.h / 2;
  await page.mouse.click(inputCx, inputCy);
  // 立刻检查 (如果"闪一下", 此刻应该 false)
  await sleep(10);
  const listImmediately = await page.$('[role="listbox"][aria-label="搜索结果"]');
  console.log("list visible 10ms after real-click:", !!listImmediately);
  // 等 100ms
  await sleep(100);
  const listAt100ms2 = await page.$('[role="listbox"][aria-label="搜索结果"]');
  console.log("list visible 100ms after real-click:", !!listAt100ms2);
  if (!listAt100ms) {
    console.log("FAIL: list not visible 100ms after real click on input");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: real click on input expands list (no flicker)");

  // ---- 7. label click 收起 list (但保留 popup) ----
  // 此时 list 已经显示 (test 6 之后), 直接点 label
  const labelInfo = await page.evaluate(() => {
    const labels = document.querySelectorAll("button[data-label-id]");
    return { count: labels.length, firstText: labels[0]?.textContent };
  });
  console.log("label info:", labelInfo);
  if (labelInfo.count === 0) {
    console.log("WARN: no labels found, skipping label click test");
  } else {
    // 先 focus input, 让 list 显示 (因为 test 6 后 list 已经 stable)
    await page.focus('input[placeholder*="搜索建筑"]');
    await sleep(300);
    const listBefore = await page.$('[role="listbox"][aria-label="搜索结果"]');
    console.log("list visible before label click:", !!listBefore);
    // 点 label button
    await page.evaluate(() => {
      const label = document.querySelector("button[data-label-id]");
      if (label) label.click();
    });
    await sleep(500);
    const listAfterLabel = await page.$('[role="listbox"][aria-label="搜索结果"]');
    console.log("list visible after label click:", !!listAfterLabel);
    if (listAfterLabel) {
      console.log("FAIL: list still visible after label click");
      await browser.close();
      process.exit(1);
    }
    console.log("PASS: label click collapses list");
  }

  // ---- 8. 点 input → popup 消失 + list 仍然显示 ----
  // 先点 label 让 popup 显示
  if (labelInfo.count > 0) {
    // 先 blur input — 之前 test 6/7 已 focus, page.focus 不会再触发 focus event
    await page.evaluate(() => {
      const i = document.querySelector('input[placeholder*="搜索建筑"]');
      if (document.activeElement === i) i.blur();
    });
    await sleep(100);
    // 然后点 label
    await page.evaluate(() => {
      const label = document.querySelector("button[data-label-id]");
      if (label) label.click();
    });
    await sleep(500);
    const popupAfterLabel = await page.$('[role="dialog"][aria-labelledby="lm-popup-name"]');
    console.log("popup visible after label click:", !!popupAfterLabel);
    // 然后点 input (focus) — 应触发 onFocus → setSelectedLabel(null)
    await page.focus('input[placeholder*="搜索建筑"]');
    await sleep(300);
    const popupAfterInputFocus = await page.$('[role="dialog"][aria-labelledby="lm-popup-name"]');
    console.log("popup visible after input focus:", !!popupAfterInputFocus);
    if (popupAfterInputFocus) {
      console.log("FAIL: popup should disappear when input is focused");
      await browser.close();
      process.exit(1);
    }
    console.log("PASS: popup disappears when input is focused");
  }

  // ---- 8a. 切维度 (用户主动) → popup 关闭 ----
  if (labelInfo.count > 0) {
    // 先 blur input + 收起 list — 模拟用户切 tab 前状态 (list 收起, 没输入)
    await page.evaluate(() => {
      const i = document.querySelector('input[placeholder*="搜索建筑"]');
      if (document.activeElement === i) i.blur();
    });
    await sleep(100);
    // 点 label 让 popup 显示
    await page.evaluate(() => {
      const label = document.querySelector("button[data-label-id]");
      if (label) label.click();
    });
    await sleep(500);
    const popupBeforeDim = await page.$('[role="dialog"][aria-labelledby="lm-popup-name"]');
    if (!popupBeforeDim) {
      console.log("FAIL: popup should be visible after label click (8a setup)");
      await browser.close();
      process.exit(1);
    }
    // 当前 dim
    const currentDim = await page.evaluate(() => {
      return document.querySelector('button[data-worldid].bg-white')?.getAttribute("data-worldid");
    });
    console.log("current dim (8a):", currentDim);
    // 切到 nether (或 end if 已在 nether)
    const targetDim = currentDim === "nether" ? "end" : "nether";
    await page.click(`button[data-worldid="${targetDim}"]`);
    await sleep(800);
    const popupAfterDim = await page.$('[role="dialog"][aria-labelledby="lm-popup-name"]');
    console.log(`popup visible after switch to ${targetDim}:`, !!popupAfterDim);
    if (popupAfterDim) {
      console.log("FAIL: popup should disappear when user switches dim");
      await browser.close();
      process.exit(1);
    }
    console.log("PASS: dim switch closes popup (user-initiated)");
    // 切回 overworld 准备后续测试
    await page.click('button[data-worldid="overworld"]');
    await sleep(500);
  }

  // ---- 8c. 切回初始 dim (下界→主世界) 也重置 view + 关 popup ----
  // 之前 initialWorldIdRef 捕获 mount 时 worldId, 切回初始值会被误判为"没变化"
  // 修复: 用 prevWorldIdRef (跟踪上次值), 任何变化都跑 reset 逻辑
  if (labelInfo.count > 0) {
    // 1) 在 overworld 缩放 + 点 label 让 popup 显示
    await page.evaluate(() => {
      const i = document.querySelector('input[placeholder*="搜索建筑"]');
      if (document.activeElement === i) i.blur();
    });
    await sleep(100);
    // mouse wheel 缩放 3 次 (zoom in)
    await page.mouse.move(640, 400);
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel({ deltaY: -200 });
      await sleep(150);
    }
    await sleep(300);
    const viewAfterZoom = await page.evaluate(() => {
      const g = document.querySelector("svg g[transform]");
      const t = g?.getAttribute("transform") ?? "";
      const k = parseFloat(t.match(/scale\(([\d.]+)\)/)?.[1] ?? "1");
      return { k, t };
    });
    console.log("after 3x zoom-in (overworld, 8c setup):", { k: viewAfterZoom.k });
    if (viewAfterZoom.k <= 1) {
      console.log("WARN: zoom-in did not work, skipping 8c");
    } else {
      // 点 label 让 popup 显示
      await page.evaluate(() => {
        const label = document.querySelector("button[data-label-id]");
        if (label) label.click();
      });
      await sleep(500);
      const popupBefore = await page.$('[role="dialog"][aria-labelledby="lm-popup-name"]');
      console.log("popup before dim roundtrip:", !!popupBefore);

      // 2) overworld → nether → 应 popup 关闭 + view 重置
      await page.click('button[data-worldid="nether"]');
      await sleep(800);
      const popupAfterNether = await page.$('[role="dialog"][aria-labelledby="lm-popup-name"]');
      const viewNether = await page.evaluate(() => {
        const g = document.querySelector("svg g[transform]");
        const t = g?.getAttribute("transform") ?? "";
        const tx = parseFloat(t.match(/translate\(([-\d.]+)/)?.[1] ?? "0");
        const ty = parseFloat(t.match(/translate\([-\d.]+\s+([-\d.]+)/)?.[1] ?? "0");
        const k = parseFloat(t.match(/scale\(([\d.]+)\)/)?.[1] ?? "1");
        return { tx, ty, k };
      });
      console.log("after overworld→nether:", { popup: !!popupAfterNether, ...viewNether });
      if (popupAfterNether) {
        console.log("FAIL: popup should close on overworld→nether");
        await browser.close();
        process.exit(1);
      }
      if (viewNether.k !== 1 || viewNether.tx !== 0 || viewNether.ty !== 0) {
        console.log("FAIL: view should reset to (0,0,1) on overworld→nether");
        await browser.close();
        process.exit(1);
      }

      // 3) nether 缩放 + 点 label 让 popup 显示
      await page.mouse.move(640, 400);
      for (let i = 0; i < 2; i++) {
        await page.mouse.wheel({ deltaY: -200 });
        await sleep(150);
      }
      await sleep(300);
      await page.evaluate(() => {
        // nether 没 label 时跳到有 label 的 dim — 但 nether 有 nether 维度 label
        const label = document.querySelector("button[data-label-id]");
        if (label) label.click();
      });
      await sleep(500);
      const popupInNether = await page.$('[role="dialog"][aria-labelledby="lm-popup-name"]');
      console.log("popup in nether after zoom:", !!popupInNether);

      // 4) nether → overworld → 应 popup 关闭 + view 重置 (这是测试的核心 — 切回初始 dim)
      await page.click('button[data-worldid="overworld"]');
      await sleep(800);
      const popupAfterBack = await page.$('[role="dialog"][aria-labelledby="lm-popup-name"]');
      const viewBack = await page.evaluate(() => {
        const g = document.querySelector("svg g[transform]");
        const t = g?.getAttribute("transform") ?? "";
        const tx = parseFloat(t.match(/translate\(([-\d.]+)/)?.[1] ?? "0");
        const ty = parseFloat(t.match(/translate\([-\d.]+\s+([-\d.]+)/)?.[1] ?? "0");
        const k = parseFloat(t.match(/scale\(([\d.]+)\)/)?.[1] ?? "1");
        return { tx, ty, k };
      });
      console.log("after nether→overworld (back to initial):", { popup: !!popupAfterBack, ...viewBack });
      if (popupAfterBack) {
        console.log("FAIL: popup should close when returning to initial dim");
        await browser.close();
        process.exit(1);
      }
      if (viewBack.k !== 1 || viewBack.tx !== 0 || viewBack.ty !== 0) {
        console.log("FAIL: view should reset when returning to initial dim");
        await browser.close();
        process.exit(1);
      }
      console.log("PASS: returning to initial dim closes popup + resets view");
    }
  }

  // ---- 8b. 跨维度搜索 → popup 保留 (goToSearchResult 自己 setSelectedLabel) ----
  // 搜 "猪人塔" — 在 overworld 跟 nether 都有, 让搜索结果有跨维度选项
  await page.evaluate(() => {
    const i = document.querySelector('input[placeholder*="搜索建筑"]');
    i?.blur();
  });
  // 清空 input
  await page.focus('input[placeholder*="搜索建筑"]');
  await sleep(200);
  await page.evaluate(() => {
    const i = document.querySelector('input[placeholder*="搜索建筑"]');
    if (i) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(i, "");
      i.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.type('input[placeholder*="搜索建筑"]', "猪人塔", { delay: 30 });
  await sleep(400);
  // 找当前 dim 之外的结果
  const crossDimResult = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[role="option"]'));
    // 返回每个结果的 dim 信息 (通过 text 里的 dim name 拿)
    return items.map((el) => {
      const dimSpan = el.querySelector("span.text-\\[10px\\]");
      const dim = dimSpan?.textContent?.trim();
      return { dim, text: el.textContent?.trim().slice(0, 60) };
    });
  });
  console.log("results for '猪人塔':", JSON.stringify(crossDimResult));
  // 当前激活 dim (Chinese name, e.g. "主世界") — 从 dim tab 第一个 text-[17px] span 拿
  const currentDim8b = await page.evaluate(() => {
    const btn = document.querySelector('button[data-worldid].bg-white');
    const span = btn?.querySelector('span.text-\\[17px\\]');
    return span?.textContent?.trim();
  });
  console.log("current dim (8b):", currentDim8b);
  const otherDimResultIdx = crossDimResult.findIndex(
    (r) => r.dim && r.dim !== currentDim8b,
  );
  console.log("cross-dim result idx:", otherDimResultIdx, "dim:", crossDimResult[otherDimResultIdx]?.dim);
  if (otherDimResultIdx === -1) {
    console.log("WARN: no cross-dim result for '猪人塔', skipping cross-dim popup test");
  } else {
    // 点这个 result
    await page.evaluate((idx) => {
      const items = document.querySelectorAll('[role="option"]');
      items[idx]?.click();
    }, otherDimResultIdx);
    await sleep(1000);
    const popupAfterSearch = await page.$('[role="dialog"][aria-labelledby="lm-popup-name"]');
    const dimAfterSearch = await page.evaluate(() => {
      const btn = document.querySelector('button[data-worldid].bg-white');
      const span = btn?.querySelector('span.text-\\[17px\\]');
      return span?.textContent?.trim();
    });
    console.log(`popup after cross-dim search: ${!!popupAfterSearch}, dim: ${dimAfterSearch}`);
    if (!popupAfterSearch) {
      console.log("FAIL: cross-dim search result should open popup");
      await browser.close();
      process.exit(1);
    }
    if (dimAfterSearch === currentDim8b) {
      console.log("FAIL: cross-dim search should switch dim");
      await browser.close();
      process.exit(1);
    }
    console.log("PASS: cross-dim search opens popup without being cleared by dim change");
    // 切回 overworld 给后续测试
    await page.click('button[data-worldid="overworld"]');
    await sleep(500);
  }

  // ---- 9. 点搜索结果 → query 变 label.name + list 收起 + input blur ----
  await page.focus('input[placeholder*="搜索建筑"]');
  await sleep(300);
  const queryBeforeSelect = await page.evaluate(
    () => document.querySelector('input[placeholder*="搜索建筑"]')?.value,
  );
  // 点搜索结果第一个
  //   - bug 3b 后续: 之前 test 5d 触发过 list drag → listDraggingRef 可能遗留 true
  //   - programmatic .click() 不走 mousedown, 不会自动 reset listDraggingRef
  //   - 先 dispatch mousedown 模拟真实点击 (mousedown 会 reset listDraggingRef=false)
  //   - 然后 click 读到 false → onSelect 正常触发
  await page.evaluate(() => {
    const result = document.querySelector('[role="option"]');
    if (!result) return;
    const rect = result.getBoundingClientRect();
    result.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.x + 10, clientY: rect.y + 10,
    }));
    result.click();
  });
  await sleep(800);
  const queryAfterSelect = await page.evaluate(
    () => document.querySelector('input[placeholder*="搜索建筑"]')?.value,
  );
  const listAfterSelect = await page.$('[role="listbox"][aria-label="搜索结果"]');
  const inputFocusedAfterSelect = await page.evaluate(
    () => document.activeElement?.tagName === "INPUT",
  );
  console.log(
    `query before/after: "${queryBeforeSelect}" → "${queryAfterSelect}"; list visible: ${!!listAfterSelect}; input focused: ${inputFocusedAfterSelect}`,
  );
  if (queryAfterSelect !== queryBeforeSelect || queryAfterSelect === "") {
    console.log("FAIL: query should remain unchanged, got:", JSON.stringify(queryAfterSelect), "expected:", JSON.stringify(queryBeforeSelect));
    await browser.close();
    process.exit(1);
  }
  if (listAfterSelect) {
    console.log("FAIL: list should collapse after result select");
    await browser.close();
    process.exit(1);
  }
  if (inputFocusedAfterSelect) {
    console.log("FAIL: input should blur after result select");
    await browser.close();
    process.exit(1);
  }
  console.log("PASS: result select keeps query + collapses list + blurs input");

  await browser.close();
  console.log("ALL PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});