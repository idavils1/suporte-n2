/* Aplica o tema antes de a página aparecer (fica fora do HTML por causa da Content-Security-Policy) */
(function () {
  try {
    var tema = localStorage.getItem("banco-tickets-tema");
    if (tema !== "claro" && tema !== "escuro") {
      tema = window.matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
    }
    document.documentElement.setAttribute("data-tema", tema);
    /* Aparência livre: as variáveis já calculadas (aparencia.js) entram antes da primeira pintura.
       Só nomes --[a-z0-9-] e valores sem chaves/ponto e vírgula, aplicados com setProperty. */
    var h = decodeURIComponent(location.hash.slice(1));
    var planilha = h === "banco-tickets" || h === "sig-informacoes" ? h : localStorage.getItem("banco-tickets-planilha-ativa") || "banco-tickets";
    var c = JSON.parse(localStorage.getItem("banco-tickets-aparencia-aplicada:" + planilha) || "null");
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
