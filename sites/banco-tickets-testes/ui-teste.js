/* Ajudantes de teste da interface (carregar no console: await import("/teste/ui-teste.js"))
   __t.clicar(el, {shift}) reproduz pointerdown → mousedown → foco → pointerup → mouseup → click;
   __t.tecla(key, {shift, ctrl, alt}) dispara keydown no elemento com foco; __t.onde() diz onde está a seleção/edição;
   __t.semear(n, prefixo) cria n equipamentos com índices (administradora logada). */
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
window.__t = {
  espera,
  cel(id, col) { return document.querySelector(`.linha[data-id="${id}"] .celula[data-col="${col}"]`); },
  ids() { return [...document.querySelectorAll("#planilha .linha[data-id]")].sort((a, b) => a.offsetTop - b.offsetTop).map((l) => l.dataset.id); },
  clicar(el, o = {}) {
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(20, r.width / 2), y = r.top + r.height / 2;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, shiftKey: !!o.shift };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerType: "mouse", isPrimary: true, buttons: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1, detail: 1 }));
    if (!o.shift) { const f = el.closest("[tabindex], input, select, textarea, button"); if (f) f.focus(); }
    el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse", isPrimary: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mouseup", { ...base, detail: 1 }));
    el.dispatchEvent(new MouseEvent("click", { ...base, detail: 1 }));
  },
  arrastar(de, ate) {
    const p = (el) => { const r = el.getBoundingClientRect(); return { clientX: r.left + 10, clientY: r.top + r.height / 2 }; };
    const base = { bubbles: true, cancelable: true, composed: true, button: 0, pointerType: "mouse", isPrimary: true };
    de.dispatchEvent(new PointerEvent("pointerdown", { ...base, ...p(de), buttons: 1 }));
    window.dispatchEvent(new PointerEvent("pointermove", { ...base, ...p(ate), buttons: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { ...base, ...p(ate) }));
    ate.dispatchEvent(new MouseEvent("click", { ...base, ...p(ate), detail: 1 }));
  },
  tecla(key, o = {}) {
    const el = document.activeElement;
    const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, shiftKey: !!o.shift, ctrlKey: !!o.ctrl, altKey: !!o.alt });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  },
  digitar(txt) { const el = document.activeElement; el.value = txt; el.dispatchEvent(new Event("input", { bubbles: true })); },
  colar(el, texto) {
    const dt = new DataTransfer();
    dt.setData("text/plain", texto);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  },
  onde() {
    const ed = document.querySelector(".editor-celula");
    if (!ed) {
      const a = document.activeElement;
      return "sel:" + (a.classList.contains("celula") ? a.closest(".linha").dataset.id + "/" + a.dataset.col : a.tagName + (a.dataset && a.dataset.nova ? "[" + a.dataset.nova + "]" : "") + (a.className ? "." + a.className : ""));
    }
    const l = ed.closest(".linha");
    const c = [...l.querySelectorAll(".celula[data-col]")].find((x) => x.offsetLeft === parseFloat(ed.style.left));
    return "edit:" + l.dataset.id + "/" + (c && c.dataset.col) + "=" + document.activeElement.value;
  },
  async semear(n = 5000, prefixo = "inventario") {
    const st = ["em-uso", "disponivel", "em-manutencao"], ar = ["sac", "suporte-operacional", "suporte-n2"];
    const quem = { criadoPor: "lays.almeida@valid.com", criadoPorNome: "Lays", criadoPorEmail: "lays.almeida@valid.com", atualizadoPor: "lays.almeida@valid.com", atualizadoPorNome: "Lays", atualizadoPorEmail: "lays.almeida@valid.com" };
    let ops = [];
    for (let i = 1; i <= n; i++) {
      const id = "s" + String(i).padStart(5, "0"), h = "PC-" + String(i).padStart(5, "0"), d = "D" + (100000 + i);
      ops.push({ op: "set", caminho: `${prefixo}/${id}`, dados: { campos: { hostname: h, dna: d, usuario: "Usuário " + i, area: ar[i % 3], status: st[i % 3], observacao: i % 4 ? "" : "Obs " + i }, numero: h, dna: d, ...quem, criadoEm: "__AGORA__", atualizadoEm: "__AGORA__", exclusao: null } });
      ops.push({ op: "set", caminho: `${prefixo}-hostnames/${h}`, dados: { equipamento: id } });
      ops.push({ op: "set", caminho: `${prefixo}-dnas/${d}`, dados: { equipamento: id } });
      if (ops.length >= 3000) { await __NUVEM_TESTE__.lote(ops); ops = []; }
    }
    if (ops.length) await __NUVEM_TESTE__.lote(ops);
    return n;
  }
};
export default window.__t;
