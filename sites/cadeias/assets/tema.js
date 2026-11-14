/* Aplica o tema antes de a página aparecer (fica fora do HTML por causa da Content-Security-Policy) */
(function () {
  try {
    var tema = localStorage.getItem("cadeias-tema");
    if (tema !== "claro" && tema !== "escuro") {
      tema = window.matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
    }
    document.documentElement.setAttribute("data-tema", tema);
    /* Ambiente do endereço (#v6 ou #v12): cor de destaque e aparência já calculadas antes da primeira pintura */
    var amb = /^#v12/i.test(location.hash) ? "v12" : /^#v6/i.test(location.hash) ? "v6" : localStorage.getItem("cadeias-ultimo-ambiente");
    if (amb !== "v6" && amb !== "v12") amb = "";
    if (amb) document.documentElement.setAttribute("data-ambiente", amb);
    /* Aparência livre: as variáveis já calculadas (aparencia.js) entram antes da primeira pintura.
       Só nomes --[a-z0-9-] e valores sem chaves/ponto e vírgula, aplicados com setProperty. */
    var c = amb ? JSON.parse(localStorage.getItem("cadeias-aparencia-aplicada:" + amb) || "null") : null;
    if (c && c.v === 1 && Object.prototype.toString.call(c[tema]) === "[object Array]") {
      var raiz = document.documentElement, nome = /^--[a-z0-9-]{1,40}$/, valor = /^[^{};<>\\]{0,20000}$/;
      for (var i = 0; i < c[tema].length; i++) {
        var par = c[tema][i];
        if (par && nome.test(par[0]) && typeof par[1] === "string" && valor.test(par[1])) raiz.style.setProperty(par[0], par[1]);
      }
      var a = c.attrs || {}, aceitos = ["data-ap", "data-ap-fundo", "data-ap-area", "data-ap-vidro", "data-ap-vidro-blur"];
      for (var k = 0; k < aceitos.length; k++) if (typeof a[aceitos[k]] === "string" && /^[a-z0-9-]{1,20}$/.test(a[aceitos[k]])) raiz.setAttribute(aceitos[k], a[aceitos[k]]);
    }
  } catch (e) {}
})();
