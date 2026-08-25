// Headless screenshot driver for QA verification — zero dependencies.
//
// WHY THIS EXISTS: the interactive Browser pane in this environment has
// repeatedly failed to composite frames ("the Browser pane is not
// displayed"), so no pixel screenshot could ever be captured through it.
// Edge (Chromium) is installed on this machine and its DevTools Protocol
// gives full navigate/evaluate/screenshot control, and Node 22 ships a
// global WebSocket — so this needs no Playwright/Puppeteer install.
//
// Usage:
//   node scripts/qa-shot.mjs <steps.json>
// where steps.json is { "out": "C:\\abs\\dir", "width":1280, "height":900,
//   "steps": [ {"nav": "https://..."}, {"wait": 1500},
//              {"eval": "document.querySelector('x').click()"},
//              {"shot": "name"} ] }
//
// Screenshots MUST be written to an absolute Windows path — Edge's
// headless writer is denied access to some temp dirs.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9333;

const cfg = JSON.parse(readFileSync(process.argv[2], "utf-8"));
const width = cfg.width || 1280;
const height = cfg.height || 900;
mkdirSync(cfg.out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  `--window-size=${width},${height}`,
  "--user-data-dir=C:\\Users\\khudy\\AppData\\Local\\Temp\\qa-edge-profile",
  "about:blank",
], { stdio: "ignore" });

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const tabs = await res.json();
      const page = tabs.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("Could not reach Edge DevTools endpoint");
}

const wsUrl = await getWsUrl();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");

// The app uses window.alert() for save confirmations (an existing
// codebase convention). In headless that blocks the page forever, so
// auto-accept every dialog and record what it said.
const dialogs = [];
const pageErrors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Page.javascriptDialogOpening") {
    dialogs.push(m.params.message);
    send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
  }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    pageErrors.push(d.exception?.description || d.text);
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    pageErrors.push(m.params.args.map(a => a.value ?? a.description).join(" "));
  }
});
await send("Emulation.setDeviceMetricsOverride", {
  width, height, deviceScaleFactor: 1, mobile: width < 768,
});

const log = [];
for (const step of cfg.steps) {
  if (step.nav) {
    await send("Page.navigate", { url: step.nav });
    await sleep(step.settle ?? 2500);
    log.push(`nav ${step.nav}`);
  }
  if (step.wait) { await sleep(step.wait); log.push(`wait ${step.wait}`); }
  if (step.eval) {
    const r = await send("Runtime.evaluate", {
      expression: step.eval, awaitPromise: true, returnByValue: true,
    });
    const val = r.result?.value;
    log.push(`eval -> ${typeof val === "string" ? val.slice(0, 200) : JSON.stringify(val)?.slice(0, 200)}`);
  }
  if (step.shot) {
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!step.full });
    const path = `${cfg.out}/${step.shot}.png`;
    writeFileSync(path, Buffer.from(data, "base64"));
    log.push(`SHOT ${path}`);
  }
}

if (dialogs.length) log.push(`DIALOGS: ${JSON.stringify(dialogs)}`);
if (pageErrors.length) log.push(`PAGE ERRORS (${pageErrors.length}):\n  ` + pageErrors.slice(0, 6).join("\n  "));
console.log(log.join("\n"));
ws.close();
edge.kill();
process.exit(0);
