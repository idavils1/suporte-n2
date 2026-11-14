"""Carimba o rodapé (título e "página X de Y") em todas as páginas do PDF, menos na capa."""
import sys
import pymupdf

caminho = sys.argv[1]
doc = pymupdf.open(caminho)
total = doc.page_count
cor = (0.48, 0.45, 0.52)
for i, pagina in enumerate(doc):
    if i == 0:
        continue
    largura, altura = pagina.rect.width, pagina.rect.height
    margem = 15 * 72 / 25.4
    y = altura - 8 * 72 / 25.4
    pagina.draw_line((margem, y - 9), (largura - margem, y - 9), color=(0.89, 0.85, 0.95), width=0.6)
    pagina.insert_text((margem, y), "Inventário de Equipamentos · Guia dos Gestores", fontsize=7.5, fontname="helv", color=cor)
    texto = f"{i + 1} de {total}"
    pagina.insert_text((largura - margem - pymupdf.get_text_length(texto, fontname="helv", fontsize=7.5), y), texto, fontsize=7.5, fontname="helv", color=cor)
doc.saveIncr()
