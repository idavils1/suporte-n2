"""Servidor local de testes da Central (só neste computador; a pasta dev/ não vai para o Firebase).

Igual a "python -m http.server", mas manda Cache-Control: no-store para o navegador
sempre pegar a versão nova dos módulos JS depois de cada edição.
Uso (na raiz do projeto):  py dev/servidor-sem-cache.py 5500
"""
import functools
import http.server
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class SemCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
    manipulador = functools.partial(SemCache, directory=RAIZ)
    with http.server.ThreadingHTTPServer(("127.0.0.1", porta), manipulador) as servidor:
        print(f"Central em http://localhost:{porta}/  (sem cache)")
        servidor.serve_forever()
