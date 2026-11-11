"""
Gera as versões ASCII (*.ascii.py) dos scripts Jython desta pasta, trocando cada caractere não
ASCII por \\uXXXX. O Modelio lê o script no charset padrão do Windows; com a versão ASCII os
acentos chegam corretos ao modelo (as strings com acento nos scripts são todas u"...").

Uso:  python preparar_script.py
"""
from pathlib import Path

here = Path(__file__).resolve().parent
for name in ["build_precoclaro_uml.py", "exportar_zip.py", "verificar_projeto.py"]:
    source = (here / name).read_text(encoding="utf-8")
    escaped = "".join(c if ord(c) < 128 else "\\u%04x" % ord(c) for c in source)
    target = here / name.replace(".py", ".ascii.py")
    target.write_text(escaped, encoding="ascii")
    print("gerado:", target.name)
