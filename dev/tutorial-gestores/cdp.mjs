/* Driver mínimo do Chrome (DevTools Protocol) para capturar as telas do tutorial. */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
export const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export async function abrirChrome({ porta = 9333, largura = 1366, altura = 800, escala = 2 } = {}) {
  const perfil = join(tmpdir(), `tut-chrome-${Date.now()}`);
  mkdirSync(perfil, { recursive: true });
  const proc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`,
    `--window-size=${largura},${altura}`, "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--force-color-profile=srgb", "--lang=pt-BR", "about:blank"
  ], { stdio: "ignore" });
  let alvo;
  for (let i = 0; i < 50 && !alvo; i++) {
    await espera(200);
    try { alvo = (await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
  }
  if (!alvo) throw new Error("Chrome não abriu");
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((ok, erro) => { ws.onopen = ok; ws.onerror = erro; });
  let n = 0;
  const pendentes = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pendentes.has(d.id)) { const { ok, erro } = pendentes.get(d.id); pendentes.delete(d.id); d.error ? erro(new Error(JSON.stringify(d.error))) : ok(d.result); }
  };
  const cdp = (method, params = {}) => new Promise((ok, erro) => { const id = ++n; pendentes.set(id, { ok, erro }); ws.send(JSON.stringify({ id, method, params })); });
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: largura, height: altura, deviceScaleFactor: escala, mobile: false });

  const b = {
    cdp,
    async fechar() { try { await cdp("Browser.close"); } catch {} proc.kill(); await espera(500); try { rmSync(perfil, { recursive: true, force: true }); } catch {} },
    async ir(url) { await cdp("Page.navigate", { url }); await espera(1500); },
    async js(expr) {
      const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error("JS: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async esperar(expr, ms = 8000) {
      const fim = Date.now() + ms;
      while (Date.now() < fim) { if (await b.js(`!!(${expr})`)) return true; await espera(150); }
      throw new Error("Tempo esgotado esperando: " + expr);
    },
    async centro(sel) {
      const achar = `document.querySelector(${JSON.stringify(sel)})`;
      const fora = await b.js(`(() => { const el = ${achar}; if (!el) return false; const r = el.getBoundingClientRect(); const ok = r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; if (!ok) el.scrollIntoView({ block: "center", inline: "nearest" }); return !ok; })()`);
      if (fora) await espera(400);
      const r = await b.js(`(() => { const el = ${achar}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 }; })()`);
      if (!r) throw new Error("Elemento não encontrado: " + JSON.stringify(sel));
      return r;
    },
    async clicar(sel, { duplo = false } = {}) {
      const { x, y } = await b.centro(sel);
      await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      for (let c = 1; c <= (duplo ? 2 : 1); c++) {
        await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: c });
        await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: c });
      }
      await espera(350);
    },
    async passar(sel) { const { x, y } = await b.centro(sel); await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await espera(250); },
    async digitar(texto) { await cdp("Input.insertText", { text: texto }); await espera(200); },
    async tecla(key, { ctrl = false, shift = false } = {}) {
      const codigos = { Enter: 13, Tab: 9, Escape: 27, F2: 113, ArrowDown: 40, ArrowUp: 38, Backspace: 8, k: 75, K: 75, a: 65 };
      const mod = (ctrl ? 2 : 0) | (shift ? 8 : 0);
      const vk = codigos[key] || 0;
      const base = { key, code: key.length === 1 ? "Key" + key.toUpperCase() : key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mod };
      await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
      if (key === "Enter" && !ctrl) await cdp("Input.dispatchKeyEvent", { type: "char", ...base, text: "\r" });
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      await espera(250);
    },
    async focar(sel) { await b.js(`document.querySelector(${JSON.stringify(sel)}).focus()`); await espera(200); },
    /* Captura: tela inteira ou recorte de um elemento (com folga) */
    async foto(arquivo, { sel = null, folga = 10, ret = null } = {}) {
      let clip;
      if (sel || ret) {
        const r = ret || await b.js(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getClientRects().length); if (!els.length) return null; const rs = els.map((e) => e.getBoundingClientRect()); return { x: Math.min(...rs.map((r) => r.left)), y: Math.min(...rs.map((r) => r.top)), x2: Math.max(...rs.map((r) => r.right)), y2: Math.max(...rs.map((r) => r.bottom)) }; })()`);
        if (!r) throw new Error("Nada para recortar: " + sel);
        const x = Math.max(0, r.x - folga), y = Math.max(0, r.y - folga);
        clip = { x, y, width: Math.min(r.x2 + folga, await b.js("innerWidth")) - x, height: Math.min(r.y2 + folga, await b.js("innerHeight")) - y, scale: 1 };
      }
      const { data } = await cdp("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
      writeFileSync(arquivo, Buffer.from(data, "base64"));
      console.log("foto:", arquivo);
    }
  };
  return b;
}
