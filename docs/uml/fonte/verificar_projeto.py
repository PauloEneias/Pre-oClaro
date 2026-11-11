"""
Verifica o projeto PrecoClaro_UML depois de importado num workspace novo:
  - lista os diagramas e conta os elementos gráficos de cada um;
  - prova que o modelo é editável (renomeia um elemento numa transação e desfaz);
  - exporta as imagens PNG finais (PC_UML_OUT).
  modelio.exe -workspace <workspace novo> -open PrecoClaro_UML -batch verificar_projeto.py
"""
from org.modelio.api.modelio import Modelio
from java.lang import System, Throwable
import os, traceback

OUT = System.getenv("PC_UML_OUT")
out = open(os.path.join(OUT, "verificacao.log"), "w")
def log(*a):
    out.write(u" ".join(unicode(x) for x in a).encode("utf-8") + "\n"); out.flush()
NAMES = {
    u"Diagrama de Caso de Uso": "01-diagrama-caso-de-uso.png",
    u"Diagrama de Pacotes (MVC)": "02-diagrama-pacotes-mvc.png",
    u"Diagrama de Classes": "03-diagrama-classes.png",
    u"Diagrama de Objetos": "04-diagrama-objetos.png",
    u"Diagrama de Sequência": "05-diagrama-sequencia.png",
    u"Diagrama de Comunicação": "06-diagrama-comunicacao.png",
    u"Diagrama de Máquina de Estados": "07-diagrama-maquina-de-estados.png",
    u"Diagrama de Atividades": "08-diagrama-atividades.png",
}
try:
    M = Modelio.getInstance(); S = M.getModelingSession(); U = S.getModel(); DS = M.getDiagramService()
    found = []
    for cls in ["UseCaseDiagram", "ClassDiagram", "ObjectDiagram", "SequenceDiagram", "CommunicationDiagram",
                "StateMachineDiagram", "ActivityDiagram"]:
        mc = M.getMetamodelService().getMetamodel().getMClass(cls)
        for d in S.findByClass(mc):
            found.append(d)
    log("diagramas encontrados:", len(found))
    for d in found:
        h = DS.getDiagramHandle(d)
        try:
            nodes = h.getDiagramNode().getNodes()
            log(u"- %s [%s]: %d elementos graficos" % (d.getName(), d.getMClass().getName(), nodes.size()))
            fname = NAMES.get(d.getName())
            if fname:
                h.saveInFile("PNG", os.path.join(OUT, fname), 24)
        finally:
            h.close()
    log("esperados:", len(NAMES), "faltando:", [n for n in NAMES if n not in [d.getName() for d in found]])
    # Edição: renomeia o primeiro diagrama e desfaz (rollback) — o modelo aceita alterações.
    t = S.createTransaction("teste de edicao")
    try:
        old = found[0].getName()
        found[0].setName(old + " (editado)")
        log("edicao aceita:", found[0].getName())
    finally:
        t.rollback()
    log("apos desfazer:", found[0].getName())
except Throwable as e:
    log("ERRO", e)
except Exception as e:
    log("ERRO-PY", e, traceback.format_exc())
out.close()
