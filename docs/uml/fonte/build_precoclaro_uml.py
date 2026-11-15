"""
Gera o projeto NATIVO do Modelio "PrecoClaro_UML" com os oito diagramas do PreçoClaro.
(O Modelio 5.4 recusa hífen em nome de projeto — "Illegal project name 'PrecoClaro-UML'" —,
por isso o projeto se chama PrecoClaro_UML; o arquivo entregue continua PrecoClaro-Modelio.zip.)

Executado pelo próprio Modelio 5.4 em modo batch (Jython), com a API oficial de modelagem:
  python preparar_script.py            (gera a versão ASCII: o Modelio lê o script no charset do Windows)
  modelio.exe -workspace <pasta> -create PrecoClaro_UML -batch build_precoclaro_uml.ascii.py

Os elementos são criados com as fábricas do IUmlModel dentro de transações; os diagramas
recebem os elementos com IDiagramHandle.unmask() e as imagens são exportadas com
IDiagramHandle.saveInFile(). O resultado é um projeto Modelio comum: tudo é editável na
interface gráfica depois de importado.

Variável de ambiente PC_UML_OUT: pasta onde gravar as imagens PNG e o log.
"""
from org.modelio.api.modelio import Modelio
from org.modelio.metamodel.uml.statik import AggregationKind
from org.modelio.metamodel.uml.behavior.interactionModel import MessageSort, InteractionOperator
from java.lang import Throwable, System
import traceback, os

OUT = System.getenv("PC_UML_OUT") or os.getcwd()
if not os.path.isdir(OUT):
    os.makedirs(OUT)
LOG = open(os.path.join(OUT, "build.log"), "w")
def log(*a):
    LOG.write(u" ".join(unicode(x) for x in a).encode("utf-8") + "\n"); LOG.flush()

M = Modelio.getInstance()
S = M.getModelingSession()
U = S.getModel()
DS = M.getDiagramService()
T = U.getUmlTypes()
PROJ = [r for r in U.getModelRoots() if r.getMClass().getName() == "Project"][0]
ROOT = PROJ.getModel()[0]
RESULT = {}

def project_service():
    """IProjectService do Modelio (o mesmo serviço usado pelos menus Salvar e Exportar projeto)."""
    from org.osgi.framework import FrameworkUtil
    bundles = dict((b.getSymbolicName(), b) for b in FrameworkUtil.getBundle(M.getClass()).getBundleContext().getBundles())
    e4 = bundles["org.eclipse.e4.ui.workbench"]
    ctx = e4.loadClass("org.eclipse.e4.ui.internal.workbench.E4Workbench").getMethod("getServiceContext").invoke(None)
    app = ctx.get(e4.loadClass("org.eclipse.e4.ui.workbench.IWorkbench")).getApplication().getContext()
    ps = app.get(bundles["org.modelio.platform.project"].loadClass("org.modelio.platform.project.services.IProjectService"))
    monitor = bundles["org.eclipse.equinox.common"].loadClass("org.eclipse.core.runtime.NullProgressMonitor").newInstance()
    return ps, monitor

def show_features(nodes):
    """Mostra atributos e operações (com assinatura) nos retângulos de classe."""
    for n in nodes:
        for key in ["CLASS_ATT_GROUPVISIBLE", "CLASS_OP_GROUPVISIBLE", "CLASS_OP_SHOWSIGNATURE", "ENUMERATION_ATT_GROUPVISIBLE"]:
            try:
                n.setProperty(key, "true")
            except Throwable:
                pass

def transaction(name, fn):
    """Executa fn numa transação; em erro do ModelShield registra as regras violadas e desfaz."""
    t = S.createTransaction(name)
    ok = False
    try:
        fn()
        t.commit()
        ok = True
        log("OK", name)
    except Throwable as e:
        log("ERRO", name, e)
        try:
            for en in e.getClosure().getEntries():
                log("   regra", en.getRuleId(), en.getElement())
        except Throwable:
            pass
    except Exception as e:
        log("ERRO-PY", name, e, traceback.format_exc())
    if not ok:
        try:
            t.rollback()
        except Throwable:
            pass
    return ok

def node(h, element, x, y, w=None, hgt=None):
    """Mostra o elemento no diagrama na posição (x, y); ajusta o tamanho quando informado."""
    g = h.unmask(element, x, y)
    nodes = [n for n in (g or []) if hasattr(n, "setSize")]
    for n in nodes:
        try:
            if w and hgt:
                n.setSize(w, hgt)
            else:
                n.fitToContent()
        except Throwable:
            pass
    return nodes

def link(h, element):
    try:
        return h.unmask(element, 0, 0)
    except Throwable as e:
        log("   link não exibido", element, e)

def place(h, element, x, y, w=None, hgt=None):
    """Reposiciona um gráfico já existente (lifelines criadas automaticamente)."""
    for g in h.getDiagramGraphics(element):
        try:
            g.setLocation(x, y)
            if w and hgt:
                g.setSize(w, hgt)
        except Throwable as e:
            log("   place", element, e)

# ---------------------------------------------------------------------------------------------
# Geometria: cada nó é colocado numa posição/tamanho conhecidos (GEOM) e cada seta recebe um
# caminho explícito (route), em ângulo reto, para não atravessar caixas nem textos.
# ---------------------------------------------------------------------------------------------
GEOM = {}

def box(h, element, x, y, w, hgt):
    """Mostra o elemento com posição e tamanho fixos e guarda a geometria para as setas."""
    for g in node(h, element, x, y, w, hgt):
        try:
            g.setLocation(x, y)
            g.setSize(w, hgt)
        except Throwable:
            pass
    GEOM[element] = (x, y, w, hgt)

def top(e, f=0.5):
    x, y, w, hh = GEOM[e]; return (x + int(w * f), y)
def bottom(e, f=0.5):
    x, y, w, hh = GEOM[e]; return (x + int(w * f), y + hh)
def left(e, f=0.5):
    x, y, w, hh = GEOM[e]; return (x, y + int(hh * f))
def right(e, f=0.5):
    x, y, w, hh = GEOM[e]; return (x + w, y + int(hh * f))
def cx(e):
    x, y, w, hh = GEOM[e]; return x + w // 2
def cy(e):
    x, y, w, hh = GEOM[e]; return y + hh // 2

def route(h, rel, src, pts):
    """Mostra o vínculo `rel` e impõe o caminho `pts` (lista de (x, y), começando no lado de `src`)."""
    from java.util import ArrayList
    link(h, rel)
    for g in h.getDiagramGraphics(rel):
        if not hasattr(g, "getPath"):
            continue
        try:
            seq = list(pts)
            try:
                if g.getFrom() is not None and g.getFrom().getElement() != src:
                    seq.reverse()
            except Throwable:
                pass
            path = g.getPath()
            p0 = path.getPoints().get(0)
            jl = ArrayList()
            for (x, y) in seq:
                p = p0.getCopy(); p.setLocation(x, y); jl.add(p)
            path.setPoints(jl)
            g.setPath(path)
        except Throwable as e:
            log("   rota", rel, e)

def label_at(h, rel, x, y):
    """Move o rótulo principal (extensão) de um vínculo para (x, y)."""
    for g in h.getDiagramGraphics(rel):
        try:
            from org.modelio.api.modelio.diagram import IDiagramLink
            roles = list(IDiagramLink.ExtensionRole.values())
            found = [(r, g.getFirstExtension(r)) for r in roles if hasattr(g, "getFirstExtension")]
            found = [(r, e) for r, e in found if e is not None]
            if found:
                found[0][1].setLocation(x, y)
            else:
                log("   rotulo ausente", rel)
        except Throwable as e:
            log("   rotulo", rel, e)
        except Exception as e:
            log("   rotulo-py", rel, e)

def auto(a, b, mode="v"):
    """Caminhos típicos entre dois nós já colocados:
       v  = de baixo de a para cima de b (mesma coluna)      h  = da lateral de a para a lateral de b (mesma linha)
       hv = sai pela lateral de a e desce até o topo de b    vh = desce de a e entra pela lateral de b"""
    if mode == "v":
        return [bottom(a), (cx(a), top(b)[1])] if cx(a) == cx(b) else [bottom(a), (cx(a), (bottom(a)[1] + top(b)[1]) // 2), (cx(b), (bottom(a)[1] + top(b)[1]) // 2), top(b)]
    if mode == "up":
        return [top(a), (cx(a), bottom(b)[1])]
    if mode == "h":
        if cx(b) > cx(a):
            return [right(a), (left(b)[0], cy(a))]
        return [left(a), (right(b)[0], cy(a))]
    if mode == "hv":
        side = right(a) if cx(b) > cx(a) else left(a)
        return [side, (cx(b), cy(a)), top(b)]
    if mode == "vh":
        side = left(b) if cx(b) > cx(a) else right(b)
        return [bottom(a), (cx(a), cy(b)), side]
    raise ValueError(mode)

def export(diagram, filename):
    h = DS.getDiagramHandle(diagram)
    try:
        h.saveInFile("PNG", os.path.join(OUT, filename), 24)
        log("PNG", filename)
    except Throwable as e:
        log("ERRO PNG", filename, e)
    finally:
        h.close()

def note(owner, text):
    """Nota de descrição. O dono é o próprio diagrama, para não arrastar um pacote junto no desenho."""
    try:
        return U.createNote("ModelerModule", "description", owner, text)
    except Throwable as e:
        log("   nota não criada", e)
        return None

def attr(cls, name, typ, mult_min=None, mult_max=None):
    a = U.createAttribute(name, typ, cls)
    if mult_min is not None:
        a.setMultiplicityMin(mult_min)
    if mult_max is not None:
        a.setMultiplicityMax(mult_max)
    return a

def op(cls, name, params=(), ret=None):
    o = U.createOperation(name, cls)
    for pname, ptype in params:
        p = U.createParameter()
        p.setName(pname)
        p.setType(ptype)
        p.setComposed(o)
    if ret is not None:
        U.createReturnParameter("", ret, o)
    return o

def assoc(a, b, role_b, min_b, max_b, role_a, min_a, max_a, composition=False, navigable_a=False):
    """Associação a—b. A ponta com origem em `a` descreve b (papel, multiplicidade, composição)."""
    asc = U.createAssociation(a, b, role_b)
    for e in asc.getEnd():
        if e.getSource() is not None:
            e.setMultiplicityMin(min_b); e.setMultiplicityMax(max_b)
            if composition:
                e.setAggregation(AggregationKind.KINDISCOMPOSITION)
        else:
            e.setName(role_a); e.setMultiplicityMin(min_a); e.setMultiplicityMax(max_a)
            if navigable_a:
                e.setNavigable(True)
    return asc

STR, INT, BOOL, DATE, DEC = T.getSTRING(), T.getINTEGER(), T.getBOOLEAN(), T.getDATE(), T.getDOUBLE()

# =============================================================================================
# 1. DIAGRAMA DE CASO DE USO
# =============================================================================================
def caso_de_uso():
    """Atores conferidos no código: o visitante pesquisa, compara, monta listas (no navegador) e confere
    preços sem conta; só o usuário autenticado guarda listas na conta, consulta conferências salvas e
    gerencia a conta (rotas com requireUser). «include» aponta da base para o caso sempre executado;
    «extend» aponta do caso opcional para a base que ele estende."""
    pkg = U.createPackage(u"01 Casos de Uso", ROOT)
    sistema = U.createPackage(u"Sistema PreçoClaro", pkg)
    visitante = U.createActor(u"Visitante", pkg)
    usuario = U.createActor(u"Usuário autenticado", pkg)
    osm = U.createActor(u"OpenStreetMap (Overpass)", pkg)
    redes = U.createActor(u"Sites das redes (Atacadão, Mateus Mais)", pkg)
    agendador = U.createActor(u"Agendador de coleta (a cada 12 h)", pkg)
    nomes_visitante = [u"Pesquisar produtos", u"Comparar o custo da cesta", u"Localizar supermercados próximos",
                       u"Conferir preços de prateleira e caixa", u"Montar lista de compras", u"Cadastrar-se", u"Realizar login"]
    nomes_usuario = [u"Guardar listas na conta", u"Consultar conferências salvas", u"Gerenciar conta e senha"]
    outros = [u"Adicionar produto à lista", u"Comparar preços entre redes", u"Consultar histórico de preços",
              u"Coletar preços dos catálogos"]
    uc = dict((n, U.createUseCase(n, sistema)) for n in nomes_visitante + nomes_usuario + outros)
    d = U.createUseCaseDiagram(u"Diagrama de Caso de Uso", pkg, None)
    n1 = note(d, u"Visitante: usa tudo sem conta (as listas ficam no navegador). Usuário autenticado: herda os casos do "
                 u"visitante e ganha os que exigem sessão. «include»: a base sempre executa o incluído. «extend»: o caso "
                 u"opcional estende a base. Não há administrador: manutenção e coleta manual são scripts de linha de comando.")
    h = DS.getDiagramHandle(d)
    try:
        W, H, A, B, C = 260, 64, 330, 640, 950
        row = lambda i: 60 + 88 * i
        box(h, sistema, 290, 20, 950, 940)
        for i, n in enumerate(nomes_visitante + nomes_usuario):
            box(h, uc[n], A, row(i), W, H)
        box(h, uc[u"Adicionar produto à lista"], B, row(0), W, H)
        box(h, uc[u"Comparar preços entre redes"], B, row(1), W, H)
        box(h, uc[u"Consultar histórico de preços"], C, row(1), W, H)
        box(h, uc[u"Coletar preços dos catálogos"], C, row(5), W, H)
        box(h, visitante, 110, row(3) - 20, 60, 90)
        box(h, usuario, 110, row(8) - 20, 60, 90)
        box(h, osm, 1300, row(2) - 20, 60, 90)
        box(h, agendador, 1300, row(4) - 20, 60, 90)
        box(h, redes, 1300, row(6) - 20, 60, 90)
        if n1 is not None:
            box(h, n1, 290, 980, 950, 80)
        # Generalização: Usuário autenticado —▷ Visitante.
        gen = U.createGeneralization(usuario, visitante)
        route(h, gen, usuario, [top(usuario), bottom(visitante)])
        for n in nomes_visitante:
            route(h, U.createAssociation(visitante, uc[n], ""), visitante, [right(visitante, 0.35), left(uc[n])])
        for n in nomes_usuario:
            route(h, U.createAssociation(usuario, uc[n], ""), usuario, [right(usuario, 0.35), left(uc[n])])
        route(h, U.createAssociation(uc[u"Localizar supermercados próximos"], osm, ""), uc[u"Localizar supermercados próximos"],
              [right(uc[u"Localizar supermercados próximos"]), left(osm, 0.35)])
        route(h, U.createAssociation(agendador, uc[u"Coletar preços dos catálogos"], ""), agendador,
              [left(agendador, 0.35), (C + W // 2, left(agendador, 0.35)[1]), top(uc[u"Coletar preços dos catálogos"])])
        route(h, U.createAssociation(uc[u"Coletar preços dos catálogos"], redes, ""), uc[u"Coletar preços dos catálogos"],
              [bottom(uc[u"Coletar preços dos catálogos"]), (C + W // 2, left(redes, 0.35)[1]), left(redes, 0.35)])
        pesq, cesta, comp = uc[u"Pesquisar produtos"], uc[u"Comparar o custo da cesta"], uc[u"Comparar preços entre redes"]
        route(h, U.createIncludeUseCaseDependency(pesq, comp), pesq, [right(pesq, 0.75), (B + 40, right(pesq, 0.75)[1]), top(comp, 0.16)])
        route(h, U.createIncludeUseCaseDependency(cesta, comp), cesta, [right(cesta), left(comp)])
        add = uc[u"Adicionar produto à lista"]
        route(h, U.createExtendUseCaseDependency(add, pesq), add, [left(add, 0.35), right(pesq, 0.35)])
        hist = uc[u"Consultar histórico de preços"]
        route(h, U.createExtendUseCaseDependency(hist, comp), hist, [left(hist), right(comp)])
        guardar, montar = uc[u"Guardar listas na conta"], uc[u"Montar lista de compras"]
        route(h, U.createExtendUseCaseDependency(guardar, montar), guardar,
              [right(guardar), (A + W + 40, cy(guardar)), (A + W + 40, cy(montar)), right(montar)])
        h.save()
    finally:
        h.close()
    RESULT["01-diagrama-caso-de-uso.png"] = d

# =============================================================================================
# 2. DIAGRAMA DE PACOTES (MVC)
# =============================================================================================
def pacotes():
    """Três camadas MVC como pacotes que CONTÊM os pacotes de código; banco e serviços externos fora.
    Layout em grade compacta para que as setas «use» sejam curtas e não se cruzem; a nota fica à direita."""
    pkg = U.createPackage(u"02 Pacotes MVC", ROOT)
    L = {
        "view": U.createPackage(u"View — frontend React (src/)", pkg),
        "ctrl": U.createPackage(u"Controller — backend Fastify (backend/src)", pkg),
        "model": U.createPackage(u"Model — regras de negócio e dados (backend/src)", pkg),
    }
    P = {}
    defs = [
        ("pages", "view", u"pages"),
        ("components", "view", u"components"),
        ("context", "view", u"context"),
        ("api", "view", u"api.ts"),
        ("http", "ctrl", u"http"),
        ("controllers", "ctrl", u"controllers"),
        ("rules", "model", u"regras puras"),
        ("services", "model", u"services"),
        ("integrations", "model", u"integrations"),
        ("repositories", "model", u"repositories"),
    ]
    for key, layer, name in defs:
        P[key] = U.createPackage(name, L[layer])
    P["mysql"] = U.createPackage(u"MySQL (backend/sql)", pkg)
    P["ext"] = U.createPackage(u"Externo (OSM, sites das redes)", pkg)
    deps = [("pages", "components"), ("components", "context"), ("pages", "api"), ("components", "api"),
            ("context", "api"), ("api", "controllers"), ("controllers", "http"), ("controllers", "services"),
            ("services", "rules"), ("services", "integrations"), ("services", "repositories"),
            ("repositories", "mysql"), ("integrations", "ext"), ("integrations", "mysql")]
    rel = []
    for a, b in deps:
        dep = U.createUsage(P[a], P[b])
        if (a, b) == ("api", "controllers"):
            dep.setName(u"HTTP/JSON")
        rel.append(dep)
    d = U.createClassDiagram(u"Diagrama de Pacotes (MVC)", pkg, None)
    n1 = note(d, u"MVC adaptado (não clássico): a View é o React no navegador e só fala com o servidor por api.ts (HTTP/JSON); "
                 u"o Controller são as rotas Fastify; o Model reúne services, regras puras, repositories e coletores. "
                 u"As setas «use» só descem de camada (sem ciclo).")
    h = DS.getDiagramHandle(d)
    try:
        c1, c2, c3, W, H = 60, 300, 540, 190, 56
        box(h, L["view"], 30, 20, 740, 220)
        box(h, L["ctrl"], 30, 300, 740, 110)
        box(h, L["model"], 30, 470, 740, 220)
        pos = {"pages": (c1, 60), "components": (c2, 60), "context": (c3, 60), "api": (c2, 165),
               "http": (c1, 340), "controllers": (c2, 340),
               "rules": (c1, 510), "services": (c2, 510), "integrations": (c3, 510), "repositories": (c2, 615),
               "mysql": (c2, 760), "ext": (c3, 760)}
        for k, (x, y) in pos.items():
            box(h, P[k], x, y, W, H)
        if n1 is not None:
            box(h, n1, 800, 20, 300, 170)
        E = P
        routes = {
            ("pages", "components"): auto(E["pages"], E["components"], "h"),
            ("components", "context"): auto(E["components"], E["context"], "h"),
            ("pages", "api"): auto(E["pages"], E["api"], "vh"),
            ("components", "api"): [bottom(E["components"], 0.3), top(E["api"], 0.3)],
            ("context", "api"): auto(E["context"], E["api"], "vh"),
            ("api", "controllers"): [bottom(E["api"], 0.3), top(E["controllers"], 0.3)],
            ("controllers", "http"): auto(E["controllers"], E["http"], "h"),
            ("controllers", "services"): [bottom(E["controllers"], 0.3), top(E["services"], 0.3)],
            ("services", "rules"): auto(E["services"], E["rules"], "h"),
            ("services", "integrations"): auto(E["services"], E["integrations"], "h"),
            ("services", "repositories"): [bottom(E["services"], 0.3), top(E["repositories"], 0.3)],
            ("repositories", "mysql"): [bottom(E["repositories"], 0.15), top(E["mysql"], 0.15)],
            ("integrations", "ext"): [bottom(E["integrations"], 0.5), top(E["ext"], 0.5)],
            ("integrations", "mysql"): [bottom(E["integrations"], 0.2), (bottom(E["integrations"], 0.2)[0], 725),
                                        (top(E["mysql"], 0.4)[0], 725), top(E["mysql"], 0.4)],
        }
        for (a, b), r in zip(deps, rel):
            pts = routes[(a, b)]
            route(h, r, P[a], pts)
            # Rótulo «use» ao lado do trecho vertical mais longo, longe das abas dos pacotes.
            segs = [(pts[i], pts[i + 1]) for i in range(len(pts) - 1) if pts[i][0] == pts[i + 1][0]]
            if segs:
                (x0, y0), (x1, y1) = max(segs, key=lambda sg: abs(sg[1][1] - sg[0][1]))
                label_at(h, r, x0 + 6, (y0 + y1) // 2 - 8)
        h.save()
    finally:
        h.close()
    RESULT["02-diagrama-pacotes-mvc.png"] = d

# =============================================================================================
# 3. DIAGRAMA DE CLASSES
# =============================================================================================
CLS = {}
def classes():
    pkg = U.createPackage(u"03 Dominio", ROOT)
    st = U.createEnumeration(u"SourceType", pkg)
    for lit in ["DEMO", "ONLINE", "LOJA", "USUARIO"]:
        U.createEnumerationLiteral(lit, st)
    cs = U.createEnumeration(u"CheckStatus", pkg)
    for lit in ["CAIXA_MAIOR", "CAIXA_MENOR", "IGUAL"]:
        U.createEnumerationLiteral(lit, cs)

    user = U.createClass(u"User", pkg)
    for n, t in [("id", INT), ("name", STR), ("email", STR), ("passwordHash", STR), ("createdAt", DATE)]:
        attr(user, n, t)
    op(user, "register", [("name", STR), ("email", STR), ("password", STR)], user)
    op(user, "login", [("email", STR), ("password", STR)], user)
    op(user, "changePassword", [("currentPassword", STR), ("newPassword", STR)])

    product = U.createClass(u"Product", pkg)
    attr(product, "id", INT); attr(product, "gtin", STR, "0", "1"); attr(product, "name", STR)
    attr(product, "brand", STR); attr(product, "size", STR); attr(product, "image", STR, "0", "1")

    store = U.createClass(u"Store", pkg)
    for n, t in [("id", INT), ("name", STR), ("neighborhood", STR), ("city", STR), ("state", STR),
                 ("latitude", DEC), ("longitude", DEC), ("isDemo", BOOL), ("active", BOOL)]:
        attr(store, n, t)
    attr(store, "osmId", STR, "0", "1"); attr(store, "externalCode", STR, "0", "1")

    offer = U.createClass(u"Offer", pkg)
    attr(offer, "id", INT); attr(offer, "price", DEC); attr(offer, "sourceType", st)
    attr(offer, "sourceUrl", STR, "0", "1"); attr(offer, "minimumQuantity", INT)
    attr(offer, "observedAt", DATE); attr(offer, "available", BOOL)

    slist = U.createClass(u"ShoppingList", pkg)
    for n, t in [("id", INT), ("name", STR), ("createdAt", DATE), ("updatedAt", DATE)]:
        attr(slist, n, t)
    op(slist, "addItems", [("items", STR), ("mode", STR)])
    op(slist, "rename", [("name", STR)])
    op(slist, "compareBasket", [], STR)

    item = U.createClass(u"ShoppingListItem", pkg)
    for n, t in [("gtin", STR), ("name", STR), ("brand", STR), ("size", STR), ("quantity", INT), ("purchased", BOOL), ("addedAt", DATE)]:
        attr(item, n, t)
    op(item, "updateItem", [("quantity", INT), ("purchased", BOOL)])

    check = U.createClass(u"PriceCheck", pkg)
    for n, t in [("id", INT), ("submissionKey", STR), ("network", STR), ("unit", STR), ("purchaseDate", DATE),
                 ("items", INT), ("divergentItems", INT), ("shelfTotal", DEC), ("checkoutTotal", DEC), ("createdAt", DATE)]:
        attr(check, n, t)
    attr(check, "channelCode", STR, "0", "1")
    op(check, "computeCheck", [], cs)
    op(check, "register", [], INT)

    citem = U.createClass(u"PriceCheckItem", pkg)
    attr(citem, "gtin", STR, "0", "1")
    for n, t in [("productName", STR), ("shelfPrice", DEC), ("checkoutPrice", DEC), ("quantity", INT)]:
        attr(citem, n, t)
    op(citem, "status", [], cs)

    obs = U.createClass(u"PriceObservation", pkg)
    for n, t in [("id", INT), ("gtin", STR), ("productName", STR), ("network", STR), ("channelCode", STR),
                 ("price", DEC), ("minimumQuantity", INT), ("source", STR), ("sourceUrl", STR),
                 ("collectedAt", DATE), ("confirmedAt", DATE)]:
        attr(obs, n, t)
    attr(obs, "listPrice", DEC, "0", "1")

    # Composições (o todo controla a vida da parte; no banco, ON DELETE CASCADE) e associações.
    # Itens de lista, itens de conferência e observações apontam para Product pelo GTIN, sem chave
    # estrangeira: por isso a ponta do produto é 0..1 (o GTIN pode não existir no catálogo).
    r_list = assoc(user, slist, u"listas", "0", "30", u"dono", "1", "1", composition=True)
    r_item = assoc(slist, item, u"itens", "0", "80", u"lista", "1", "1", composition=True)
    r_check = assoc(user, check, u"conferências", "0", "*", u"autor", "0", "1")
    r_citem = assoc(check, citem, u"itens", "1", "60", u"conferência", "1", "1", composition=True)
    r_offer_p = assoc(product, offer, u"ofertas", "0", "*", u"produto", "1", "1")
    r_offer_s = assoc(store, offer, u"ofertas", "0", "*", u"loja", "1", "1")
    r_item_p = assoc(item, product, u"produto (gtin)", "0", "1", u"", "0", "*")
    r_citem_p = assoc(citem, product, u"produto (gtin)", "0", "1", u"", "0", "*")
    r_obs_p = assoc(obs, product, u"produto (gtin)", "0", "1", u"", "0", "*")
    note_text = (u"Tabelas: User=usuarios, Product=produtos, Store=estabelecimentos, Offer=ofertas, ShoppingList=listas, "
                 u"ShoppingListItem=lista_itens, PriceCheck=conferencias, PriceCheckItem=conferencia_itens, "
                 u"PriceObservation=observacoes_preco. Losango cheio = composição (ON DELETE CASCADE). "
                 u"As associações \"produto (gtin)\" são feitas pelo código de barras, sem chave estrangeira. "
                 u"As operações são as funções dos services que manipulam cada entidade.")
    CLS.update(dict(User=user, ShoppingList=slist, ShoppingListItem=item, Product=product, rel_list=r_list, rel_item=r_item))
    d = U.createClassDiagram(u"Diagrama de Classes", pkg, None)
    n1 = note(d, note_text)
    h = DS.getDiagramHandle(d)
    try:
        def height(e):
            if e.getMClass().getName() == "Enumeration":
                return 44 + 18 * len(e.getValue()) + 12
            return 44 + 18 * (len(e.getOwnedAttribute()) + len(e.getOwnedOperation())) + 12
        C1, C2, C3, C4, W = 40, 520, 1000, 1480, 340
        R1, R2, R3 = 40, 330, 680
        layout = [(user, C1, R1), (slist, C2, R1), (item, C3, R1),
                  (check, C1, R2), (citem, C2, R2), (product, C3, R2), (obs, C4, R2),
                  (cs, C1, R3), (store, C2, R3), (offer, C3, R3), (st, C4, R3)]
        for e, x, y in layout:
            box(h, e, x, y, W, height(e))
            show_features(h.getDiagramGraphics(e))
        if n1 is not None:
            box(h, n1, C1, 990, 1780, 70)
        Y1 = R1 + 60
        route(h, r_list, user, [right(user, 0.3), (C2, top(user)[1] + int(0.3 * GEOM[user][3]))])
        route(h, r_item, slist, [right(slist, 0.3), (C3, top(slist)[1] + int(0.3 * GEOM[slist][3]))])
        route(h, r_check, user, [bottom(user), (cx(user), R2)])
        route(h, r_citem, check, [right(check, 0.3), (C2, R2 + int(0.3 * GEOM[check][3]))])
        route(h, r_item_p, item, [bottom(item), (cx(item), R2)])
        route(h, r_citem_p, citem, [right(citem, 0.4), (C3, R2 + int(0.4 * GEOM[citem][3]))])
        route(h, r_obs_p, obs, [left(obs, 0.4), (C3 + W, R2 + int(0.4 * GEOM[obs][3]))])
        route(h, r_offer_p, product, [bottom(product), (cx(product), R3)])
        route(h, r_offer_s, store, [right(store, 0.3), (C3, R3 + int(0.3 * GEOM[store][3]))])
        h.save()
    finally:
        h.close()
    RESULT["03-diagrama-classes.png"] = d

# =============================================================================================
# 4. DIAGRAMA DE OBJETOS
# =============================================================================================
def objetos():
    pkg = U.createPackage(u"04 Objetos (exemplo ilustrativo)", ROOT)
    def inst(name, base, values):
        i = U.createInstance(name, pkg)
        i.setBase(base)
        for a in base.getOwnedAttribute():
            if a.getName() in values:
                sl = U.createAttributeLink()
                sl.setAttributed(i); sl.setBase(a); sl.setValue(values[a.getName()])
        return i
    usuario = inst(u"usuario1", CLS["User"], {"id": "1", "name": u"\"Usuário de exemplo\"", "email": u"\"exemplo@example.com\""})
    lista = inst(u"lista10", CLS["ShoppingList"], {"id": "10", "name": u"\"Compras do mês\""})
    itens = [
        inst(u"item1", CLS["ShoppingListItem"], {"gtin": u"\"(ilustrativo)\"", "name": u"\"Arroz branco tipo 1 5kg\"", "quantity": "2", "purchased": "false"}),
        inst(u"item2", CLS["ShoppingListItem"], {"gtin": u"\"(ilustrativo)\"", "name": u"\"Feijão carioca 1kg\"", "quantity": "3", "purchased": "false"}),
        inst(u"item3", CLS["ShoppingListItem"], {"gtin": u"\"(ilustrativo)\"", "name": u"\"Leite UHT integral 1L\"", "quantity": "6", "purchased": "true"}),
    ]
    # Cada ligação é uma instância da associação correspondente do diagrama de classes (papel no nome).
    l_lista = U.createLink(usuario, lista, u"listas")
    l_itens = [U.createLink(lista, it, u"itens") for it in itens]
    d = U.createObjectDiagram(u"Diagrama de Objetos", pkg, None)
    n1 = note(d, u"DADOS ILUSTRATIVOS (não é um usuário real). Notação objeto : Classe. usuario1 é dono de lista10 "
                 u"(ligação \"listas\", instância da composição User–ShoppingList); lista10 contém item1, item2 e item3 "
                 u"(ligações \"itens\").")
    h = DS.getDiagramHandle(d)
    try:
        W, H = 340, 110
        box(h, usuario, 40, 40, W, 100)
        box(h, lista, 460, 40, W, 90)
        for i, it in enumerate(itens):
            box(h, it, 40 + 420 * i, 260, W, H)
        if n1 is not None:
            box(h, n1, 40, 400, 1220, 75)
        route(h, l_lista, usuario, [right(usuario, 0.45), (460, top(usuario)[1] + 45)])
        bus = 200
        route(h, l_itens[1], lista, [bottom(lista), (cx(lista), 260)])
        for it, f in ((itens[0], 0.25), (itens[2], 0.75)):
            route(h, l_itens[itens.index(it)], lista, [bottom(lista, f), (bottom(lista, f)[0], bus), (cx(it), bus), top(it)])
        h.save()
    finally:
        h.close()
    RESULT["04-diagrama-objetos.png"] = d

# =============================================================================================
# 5. DIAGRAMA DE SEQUÊNCIA
# =============================================================================================
SEQ = []   # (diagrama, interação, lifelines, x de cada lifeline, fragmentos a posicionar)

def interacao(pkg, nome, participantes):
    it = U.createInteraction(); it.setName(nome); it.setOwner(pkg)
    L = [U.createLifeline(n, it) for n in participantes]
    def occ(l, line, enclosing=None):
        o = U.createExecutionOccurenceSpecification()
        if enclosing is None:
            o.setEnclosingInteraction(it)
        else:
            o.setEnclosingOperand(enclosing)
        o.setLineNumber(line); o.getCovered().add(l)
        return o
    def call(a, b, label, line, dur, sort=MessageSort.SYNCCALL, reply=u"", enclosing=None):
        """Mensagem a→b na linha `line`; ativação de b por `dur` linhas; retorno (tracejado) se reply não for None."""
        so = occ(L[a], line, enclosing); ro = occ(L[b], line, enclosing)
        m = U.createMessage(label, sort); m.setName(label); m.setSendEvent(so); m.setReceiveEvent(ro)
        ex = U.createExecutionSpecification()
        if enclosing is None:
            ex.setEnclosingInteraction(it)
        else:
            ex.setEnclosingOperand(enclosing)
        ex.setLineNumber(line); ex.getCovered().add(L[b])
        fo = occ(L[b], line + dur, enclosing); ex.setStart(ro); ex.setFinish(fo)
        if reply is not None:
            back = occ(L[a], line + dur, enclosing)
            r = U.createMessage(reply, MessageSort.RETURNMESSAGE); r.setName(reply); r.setSendEvent(fo); r.setReceiveEvent(back)
        return m
    return it, L, call

def sequencia():
    """Dois diagramas menores no lugar de um com oito participantes:
       1) requisição e resposta: do clique do usuário até a tela (front ↔ API);
       2) processamento da busca: o que o catalogService faz no servidor (ranking e consultas ao MySQL)."""
    pkg = U.createPackage(u"05 Sequencia", ROOT)
    # ---- 1. Requisição e resposta --------------------------------------------------------------
    it1, L1, call1 = interacao(pkg, u"Pesquisar produtos: requisição e resposta",
                               [u"usuário", u"CatalogPage (React)", u"api.ts", u"catalogController", u"catalogService"])
    call1(0, 1, u"1: pesquisar(\"ovos 30 unidades\")", 100, 680, reply=None)
    call1(1, 2, u"2: getCatalogItems(q, filtros)", 160, 330, sort=MessageSort.ASYNCCALL, reply=u"7: CatalogItemsResponse")
    call1(2, 3, u"3: GET /api/catalog/items?q=…", 220, 210, sort=MessageSort.ASYNCCALL, reply=u"6: 200 JSON {items, total, search}")
    call1(3, 4, u"4: listItems(filtros)", 280, 90, reply=u"5: página + resumo da busca")
    frags = []
    try:
        cf = U.createCombinedFragment(InteractionOperator.ALTOP)
        cf.setEnclosingInteraction(it1); cf.setLineNumber(530)
        op1 = U.createInteractionOperand(u"[search.strongTotal > 0]"); op1.setOwnerFragment(cf); op1.setLineNumber(540)
        op2 = U.createInteractionOperand(u"[search.strongTotal = 0]"); op2.setOwnerFragment(cf); op2.setLineNumber(610)
        for l in (L1[0], L1[1]):
            cf.getCovered().add(l); op1.getCovered().add(l); op2.getCovered().add(l)
        for o, e in ((cf, 690), (op1, 610), (op2, 690)):
            if hasattr(o, "setEndLineNumber"):
                o.setEndLineNumber(e)
        call1(1, 0, u"8: mostrar cartões na ordem escolhida", 620, 20, sort=MessageSort.ASYNCCALL, reply=None, enclosing=op1)
        call1(1, 0, u"8: mostrar \"Não encontramos…\" + relacionados", 735, 20, sort=MessageSort.ASYNCCALL, reply=None, enclosing=op2)
        frags.append((cf, (20, 530, 620, 260)))
        frags.append((op1, (20, 560, 620, 95)))
        frags.append((op2, (20, 655, 620, 135)))
    except Throwable as e:
        log("   alt não criado", e)
    d1 = U.createSequenceDiagram(); d1.setName(u"Diagrama de Sequência 1 — requisição e resposta"); d1.setOrigin(it1)
    n1 = note(d1, u"A etapa 4 (listItems) é detalhada no Diagrama de Sequência 2. O fragmento alt mostra as duas "
                  u"apresentações possíveis do resultado.")
    SEQ.append((d1, it1, L1, [40, 300, 560, 820, 1080], frags, n1, (700, 600, 520, 80)))
    RESULT["05-diagrama-sequencia-1-requisicao.png"] = d1
    # ---- 2. Processamento da busca -------------------------------------------------------------
    it2, L2, call2 = interacao(pkg, u"Pesquisar produtos: processamento no servidor",
                               [u"catalogService", u"searchRanking", u"catalogRepository", u"MySQL"])
    call2(0, 1, u"1: rankSearch(q, categoria, ordem, página)", 100, 270, reply=u"GTINs da página + resumo")
    call2(1, 2, u"2: searchCandidates(grupos, rede)", 160, 110, reply=u"candidatos")
    call2(2, 3, u"3: SELECT … GROUP BY gtin", 200, 40, reply=u"linhas")
    call2(1, 1, u"4: scoreBest() · ordenar · paginar", 300, 40, reply=None)
    call2(0, 2, u"5: rowsForGtins(gtins), imagesForGtins(gtins)", 430, 110, reply=u"ofertas e fotos")
    call2(2, 3, u"6: SELECT … WHERE gtin IN (…)", 470, 40, reply=u"linhas")
    call2(0, 0, u"7: compareCatalogItem() · centavos", 590, 40, reply=None)
    d2 = U.createSequenceDiagram(); d2.setName(u"Diagrama de Sequência 2 — processamento da busca"); d2.setOrigin(it2)
    n2 = note(d2, u"Relevância antes da paginação: o ranking ordena todos os candidatos e só então corta a página. "
                  u"Depois o serviço busca ofertas e fotos apenas dos GTINs da página e calcula os preços em centavos.")
    SEQ.append((d2, it2, L2, [40, 360, 680, 1000], [], n2, (40, 680, 1140, 70)))
    RESULT["05-diagrama-sequencia-2-processamento.png"] = d2

def sequencia_layout():
    for d, it, L, xs, frags, n, nb in SEQ:
        h = DS.getDiagramHandle(d)
        try:
            for l, x in zip(L, xs):
                place(h, l, x, 20)
            for f, (x, y, w, hh) in frags:
                place(h, f, x, y, w, hh)
            todos = list(it.getFragment())
            for f in list(todos):
                for o in (f.getOperand() if hasattr(f, "getOperand") else []):
                    todos.extend(o.getFragment())
            for f in todos:
                m = getattr(f, "getSentMessage", lambda: None)()
                if m is not None and not h.getDiagramGraphics(m):
                    link(h, m)
            if n is not None:
                node(h, n, nb[0], nb[1], nb[2], nb[3])
            h.save()
        finally:
            h.close()

# =============================================================================================
# 6. DIAGRAMA DE COMUNICAÇÃO
# =============================================================================================
def comunicacao():
    pkg = U.createPackage(u"06 Comunicacao", ROOT)
    part = U.createPackage(u"Participantes", pkg)
    it = U.createCommunicationInteraction(); it.setName(u"Adicionar produto à lista"); it.setOwner(pkg)
    defs = [("user", u"usuário", None), ("modal", u"modal", u"AddToListModal"), ("ctx", u"listas", u"BasketContext"),
            ("api", u"cliente", u"api.ts"), ("ctl", u"rotas", u"listController"), ("ses", u"sessão", u"session.ts"),
            ("svc", u"serviço", u"listService"), ("repo", u"repositório", u"listRepository"), ("db", u"banco", u"MySQL")]
    N = {}
    for key, name, typ in defs:
        cn = U.createCommunicationNode(); cn.setName(name); cn.setOwner(it)
        if typ:
            c = U.createClass(typ, part)
            inst = U.createInstance(name, part); inst.setBase(c)
            cn.setRepresented(inst)
        N[key] = cn
    chans = {}
    def chan(a, b):
        ch = U.createCommunicationChannel(); ch.setStart(N[a]); ch.setEnd(N[b]); chans[(a, b)] = ch; return ch
    for a, b in [("user", "modal"), ("modal", "ctx"), ("ctx", "api"), ("api", "ctl"), ("ctl", "ses"), ("ctl", "svc"),
                 ("svc", "repo"), ("repo", "db")]:
        chan(a, b)
    # Numeração = ordem real das chamadas em listController/listService (10 só depois de 6–9).
    msgs = [(("user", "modal"), u"1: confirmar(quantidade, lista)"),
            (("modal", "ctx"), u"2: addToList(listId, item)"),
            (("ctx", "api"), u"3: addListItems(id, [item], 'add')"),
            (("api", "ctl"), u"4: POST /api/lists/:id/items"),
            (("ctl", "ses"), u"5: csrfGuard() · requireUser()"),
            (("ctl", "svc"), u"6: addItems(userId, listId, itens)"),
            (("svc", "repo"), u"7: ownsList(userId, listId)"),
            (("svc", "repo"), u"8: addItems(listId, itens, 80)"),
            (("repo", "db"), u"9: INSERT … ON DUPLICATE KEY"),
            (("ctl", "svc"), u"10: detail(userId, listId)")]
    MSG = []
    for i, (key, text) in enumerate(msgs):
        m = U.createCommunicationMessage(); m.setName(text.split(": ", 1)[1]); m.setSequence(str(i + 1)); m.setChannel(chans[key])
        m.setSortOfMessage(MessageSort.SYNCCALL)
        MSG.append((key, m))
    d = U.createCommunicationDiagram(u"Diagrama de Comunicação", it, None)
    n1 = note(d, u"Mensagens numeradas na ordem de execução (1 a 10). Linha de cima: navegador. Linha de baixo: "
                 u"servidor. A mensagem 4 é a única que cruza a rede (HTTP).")
    h = DS.getDiagramHandle(d)
    try:
        # Duas linhas: navegador em cima, servidor embaixo. Todos os canais são horizontais e só o 4
        # desce de linha por um trecho horizontal longo; assim nenhuma linha atravessa o texto.
        W, H, STEP, X0 = 180, 50, 480, 40
        col = lambda i: X0 + STEP * i
        r1, r2 = 60, 240
        pos = {"user": (col(0), r1), "modal": (col(1), r1), "ctx": (col(2), r1), "api": (col(3), r1),
               "ses": (col(0), r2), "ctl": (col(1), r2), "svc": (col(2), r2), "repo": (col(3), r2), "db": (col(4), r2)}
        for k, (x, yy) in pos.items():
            box(h, N[k], x, yy, W, H)
        if n1 is not None:
            box(h, n1, col(4) - 60, 20, 300, 130)
        S1 = (r1 + H + r2) // 2
        special = {("api", "ctl"): [bottom(N["api"]), (cx(N["api"]), S1), (cx(N["ctl"]), S1), top(N["ctl"])]}
        for (a, b), ch in chans.items():
            pts = special.get((a, b)) or auto(N[a], N[b], "h")
            route(h, ch, N[a], pts)
        h.save()
    finally:
        h.close()
    RESULT["06-diagrama-comunicacao.png"] = d

# =============================================================================================
# 7. DIAGRAMA DE MÁQUINA DE ESTADOS
# =============================================================================================
def estados():
    pkg = U.createPackage(u"07 Estados da coleta", ROOT)
    sm = U.createStateMachine(); sm.setName(u"Execução da coleta (coleta_execucoes)"); sm.setOwner(pkg)
    reg = sm.getTop()
    if reg is None:
        reg = U.createRegion(); sm.setTop(reg)
    def state(name):
        s = U.createState(); s.setName(name); s.setParent(reg); return s
    # Verificações internas viram pseudoestados de escolha (losangos): não são estados e nada gravam.
    ini = U.createInitialPseudoState(); ini.setParent(reg)
    trava = U.createChoicePseudoState(); trava.setName(u"trava"); trava.setParent(reg)
    intervalo = U.createChoicePseudoState(); intervalo.setName(u"intervalo"); intervalo.setParent(reg)
    ignorada = state(u"IGNORADA (só em memória)")
    andamento = state(u"EM_ANDAMENTO")
    resultado = U.createChoicePseudoState(); resultado.setName(u"resultado"); resultado.setParent(reg)
    sucesso = state(u"SUCESSO")
    parcial = state(u"PARCIAL")
    falha = state(u"FALHA")
    fim1 = U.createFinalState(); fim1.setParent(reg)
    fim2 = U.createFinalState(); fim2.setParent(reg)
    # Subestados de EM_ANDAMENTO (etapas do coletor; não gravados).
    sub = U.createRegion(); sub.setParent(andamento)
    sini = U.createInitialPseudoState(); sini.setParent(sub)
    s1 = U.createState(); s1.setName(u"Coletando páginas"); s1.setParent(sub)
    s2 = U.createState(); s2.setName(u"Validando ofertas"); s2.setParent(sub)
    s3 = U.createState(); s3.setName(u"Gravando observações"); s3.setParent(sub)
    T = {}
    def t(key, src, dst, ev=u"", guard=u"", eff=u""):
        x = U.createTransition(); x.setSource(src); x.setTarget(dst)
        if ev: x.setReceivedEvents(ev)
        if guard: x.setGuard(guard)
        if eff: x.setEffect(eff)
        T[key] = (x, src); return x
    t("ini", ini, trava, ev=u"runMarketCollection()")
    t("ocupada", trava, fim1, guard=u"GET_LOCK ocupado")
    t("livre", trava, intervalo, guard=u"trava obtida")
    t("recente", intervalo, ignorada, guard=u"SUCESSO recente e sem force")
    t("abre", intervalo, andamento, guard=u"intervalo cumprido", eff=u"openRun()")
    t("ign_fim", ignorada, fim1)
    t("sini", sini, s1); t("s12", s1, s2); t("s23", s2, s3)
    t("fecha", andamento, resultado, ev=u"coleta terminou", eff=u"closeRun()")
    t("ok", resultado, sucesso, guard=u"stats.complete")
    t("parcial", resultado, parcial, guard=u"não completa")
    t("falha", andamento, falha, ev=u"erro ou queda")
    t("f1", sucesso, fim2); t("f2", parcial, fim2); t("f3", falha, fim2)
    note_text = (u"Gravados em coleta_execucoes.status: EM_ANDAMENTO, SUCESSO, PARCIAL e FALHA. Não gravados: as "
                 u"verificações (losangos trava e intervalo), IGNORADA e as etapas internas de EM_ANDAMENTO. "
                 u"Com GET_LOCK ocupado a chamada termina sem registro. Uma linha que ficou EM_ANDAMENTO após queda "
                 u"do processo vira FALHA no próximo openRun(). Código: backend/src/integrations/marketSync.ts.")
    d = U.createStateMachineDiagram(u"Diagrama de Máquina de Estados", sm, None)
    n1 = note(d, note_text)
    h = DS.getDiagramHandle(d)
    try:
        Y = 220   # eixo horizontal principal
        box(h, ini, 40, Y - 12, 24, 24)
        box(h, trava, 250, Y - 15, 30, 30)
        box(h, intervalo, 540, Y - 15, 30, 30)
        box(h, ignorada, 470, 380, 170, 56)
        box(h, fim1, 540, 500, 30, 30)
        box(h, andamento, 820, 40, 320, 400)
        box(h, sini, 970, 85, 20, 20)
        box(h, s1, 860, 130, 240, 56)
        box(h, s2, 860, 240, 240, 56)
        box(h, s3, 860, 350, 240, 56)
        box(h, resultado, 1370, Y - 15, 30, 30)
        box(h, sucesso, 1530, 80, 170, 56)
        box(h, parcial, 1530, Y - 28, 170, 56)
        box(h, falha, 1530, 380, 170, 56)
        box(h, fim2, 1790, Y - 15, 30, 30)
        if n1 is not None:
            box(h, n1, 40, 580, 1780, 70)
        R = {
            "ini": [right(ini), left(trava)],
            "ocupada": [bottom(trava), (cx(trava), cy(fim1)), left(fim1)],
            "livre": [right(trava), left(intervalo)],
            "recente": [bottom(intervalo), top(ignorada, (cx(intervalo) - 470) / 170.0)],
            "abre": [right(intervalo), (820, Y)],
            "ign_fim": [bottom(ignorada, (cx(fim1) - 470) / 170.0), top(fim1)],
            "sini": [bottom(sini), (cx(sini), 130)],
            "s12": [bottom(s1), top(s2)], "s23": [bottom(s2), top(s3)],
            "fecha": [(1140, Y), left(resultado)],
            "ok": [top(resultado), (cx(resultado), cy(sucesso)), left(sucesso)],
            "parcial": [right(resultado), left(parcial)],
            "falha": [(1140, cy(falha)), left(falha)],
            "f1": [right(sucesso), (1750, cy(sucesso)), (1750, Y), left(fim2)],
            "f2": [right(parcial), left(fim2)],
            "f3": [right(falha), (1750, cy(falha)), (1750, Y), left(fim2)],
        }
        # Rótulos (evento [guarda] / efeito) fora das linhas e longe uns dos outros.
        LBL = {"ini": (75, Y - 28), "livre": (300, Y - 28), "ocupada": (cx(trava) + 10, Y + 90),
               "abre": (600, Y - 28), "recente": (cx(intervalo) + 10, Y + 70),
               "fecha": (1165, Y - 28), "ok": (cx(resultado) + 12, 135), "parcial": (1410, Y - 28),
               "falha": (1260, cy(falha) - 28)}
        for key, (x, src) in T.items():
            route(h, x, src, R[key])
            if key in LBL:
                label_at(h, x, LBL[key][0], LBL[key][1])
            for g in h.getDiagramGraphics(x):
                for k in ["TRANSITION_SHOWLABEL", "TRANSITION_GUARDVISIBLE"]:
                    try:
                        g.setProperty(k, "true")
                    except Throwable:
                        pass
        h.save()
    finally:
        h.close()
    RESULT["07-diagrama-maquina-de-estados.png"] = d

# =============================================================================================
# 8. DIAGRAMA DE ATIVIDADES
# =============================================================================================
def atividades():
    pkg = U.createPackage(u"08 Atividades", ROOT)
    ac = U.createActivity(); ac.setName(u"Comparar lista de compras"); ac.setOwner(pkg)
    def part(name):
        p = U.createActivityPartition(); p.setName(name); p.setInActivity(ac); return p
    pu = part(u"Usuário — React")
    pa = part(u"API — services")
    pd = part(u"MySQL")
    pr = part(u"Regras — catalogComparison.ts")
    def action(name, p):
        a = U.createOpaqueAction(); a.setName(name); a.setOwnerPartition(p); return a
    def decision(p, name=u""):
        d = U.createDecisionMergeNode(); d.setName(name); d.setOwnerPartition(p); return d
    ini = U.createInitialNode(); ini.setOwnerPartition(pu)
    a1 = action(u"Selecionar produtos e quantidades", pu)
    d1 = decision(pu, u"tem conta?")
    a3 = action(u"Enviar cesta", pu)
    a4 = action(u"Abrir lista", pu)
    m1 = decision(pa)
    a5 = action(u"Validar cesta (1–80 itens, GTIN, quantidade)", pa)
    d2 = decision(pa, u"válida?")
    a14 = action(u"Mostrar erro de validação", pu)
    a6 = action(u"Pedir ofertas dos GTINs (rowsForGtins)", pa)
    a6b = action(u"SELECT ofertas vigentes WHERE gtin IN (…)", pd)
    a7 = action(u"Escolher faixa de preço vigente por unidade", pr)
    a8 = action(u"Somar total por unidade (centavos)", pr)
    d3 = decision(pr, u"unidade completa?")
    a10 = action(u"Marcar unidade incompleta", pr)
    m2 = decision(pr)
    a11 = action(u"Montar compra dividida e a opção mais econômica", pr)
    a13 = action(u"Apresentar totais, faltantes e economia", pu)
    fim = U.createActivityFinalNode(); fim.setOwnerPartition(pu)
    flows = []
    def f(a, b, g=u"", pts=None):
        c = U.createControlFlow(); c.setSource(a); c.setTarget(b)
        if g: c.setGuard(g)
        flows.append((c, a, b, pts))
    d = U.createActivityDiagram(u"Diagrama de Atividades", ac)
    n1 = note(d, u"Raias: Usuário (React), API (services do Fastify), MySQL (consulta SQL) e Regras (funções puras). "
                 u"A API só pede as ofertas; quem executa a consulta é o MySQL. As regras recebem as linhas e calculam "
                 u"totais em centavos, faltantes e a compra dividida.")
    h = DS.getDiagramHandle(d)
    try:
        LW, W, AH = 300, 250, 56
        lanes = [(pu, 20), (pa, 330), (pd, 640), (pr, 950)]
        for p, x in lanes:
            box(h, p, x, 20, LW, 980)
        col = lambda lane_x: lane_x + 40          # x da ação centralizada na raia
        dcol = lambda lane_x: lane_x + 150        # x do losango (30 px), alinhado ao centro das ações
        row = lambda i: 60 + 70 * i
        box(h, ini, 173, row(0), 24, 24)
        box(h, a1, col(20), row(1) - 10, W, AH)
        box(h, d1, dcol(20), row(2), 30, 30)
        box(h, a3, 50, row(3), 125, AH)
        box(h, a4, 185, row(3), 125, AH)
        box(h, m1, dcol(330), row(4), 30, 30)
        box(h, a5, col(330), row(5) - 10, W, AH)
        box(h, d2, dcol(330), row(6), 30, 30)
        box(h, a14, col(20), row(7), W, AH)
        box(h, a6, col(330), row(7), W, AH + 10)
        box(h, a6b, col(640), row(7), W, AH + 10)
        box(h, a7, col(950), row(7), W, AH + 10)
        box(h, a8, col(950), row(8) + 10, W, AH)
        box(h, d3, dcol(950), row(9) + 10, 30, 30)
        box(h, a10, col(950) + 20, row(10), W - 40, AH - 6)
        box(h, m2, dcol(950), row(11), 30, 30)
        box(h, a11, col(950), row(12) - 10, W, AH + 10)
        box(h, a13, col(20), row(12) - 10, W, AH + 10)
        box(h, fim, 170, row(11) - 20, 30, 30)
        if n1 is not None:
            box(h, n1, 20, 1020, 1230, 75)
        f(ini, a1); f(a1, d1)
        f(d1, a3, u"não", [left(d1), (cx(a3), cy(d1)), top(a3)])
        f(d1, a4, u"sim", [right(d1), (cx(a4), cy(d1)), top(a4)])
        f(a3, m1, u"", [bottom(a3), (cx(a3), cy(m1)), left(m1)])
        f(a4, m1, u"", [right(a4), (cx(m1), cy(a4)), top(m1)])
        f(m1, a5); f(a5, d2)
        f(d2, a14, u"inválida", [left(d2), (cx(a14), cy(d2)), top(a14)])
        f(d2, a6, u"válida", None)
        f(a6, a6b, u"", auto(a6, a6b, "h")); f(a6b, a7, u"", auto(a6b, a7, "h"))
        f(a7, a8); f(a8, d3)
        f(d3, a11, u"sim", [right(d3), (cx(a11) + 110, cy(d3)), (cx(a11) + 110, top(a11)[1])])
        f(d3, a10, u"não"); f(a10, m2); f(m2, a11)
        f(a11, a13, u"", [left(a11), right(a13)])
        f(a13, fim, u"", [top(a13), bottom(fim)])
        f(a14, fim, u"", [left(a14, 0.5), (40, cy(a14)), (40, cy(fim)), left(fim)])
        for c, a, b, pts in flows:
            route(h, c, a, pts or auto(a, b, "v"))
        h.save()
    finally:
        h.close()
    RESULT["08-diagrama-atividades.png"] = d

for name, fn in [("caso de uso", caso_de_uso), ("pacotes", pacotes), ("classes", classes), ("objetos", objetos),
                 ("sequencia", sequencia), ("sequencia-layout", sequencia_layout), ("comunicacao", comunicacao),
                 ("estados", estados), ("atividades", atividades)]:
    if name == "sequencia-layout" and not SEQ:
        continue
    if name == "objetos" and "User" not in CLS:
        continue
    transaction(name, fn)

try:
    ps, monitor = project_service()
    ps.saveProject(monitor)
    log("projeto salvo")
except Throwable as e:
    log("ERRO ao salvar", e)
except Exception as e:
    log("ERRO-PY ao salvar", e, traceback.format_exc())

for filename, diagram in sorted(RESULT.items()):
    if filename.endswith(".png"):
        export(diagram, filename)
log("diagramas:", ", ".join(sorted(k for k in RESULT if k.endswith(".png"))))
LOG.close()
