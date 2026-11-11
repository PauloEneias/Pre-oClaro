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
    pkg = U.createPackage(u"01 Casos de Uso", ROOT)
    sistema = U.createPackage(u"Sistema PreçoClaro", pkg)
    visitante = U.createActor(u"Visitante", pkg)
    usuario = U.createActor(u"Usuário autenticado", pkg)
    osm = U.createActor(u"OpenStreetMap (Overpass)", pkg)
    redes = U.createActor(u"Sites das redes (Atacadão, Mateus Mais)", pkg)
    agendador = U.createActor(u"Agendador de coleta (a cada 12 h)", pkg)
    gen = U.createGeneralization(usuario, visitante)
    nomes = [u"Pesquisar produtos", u"Comparar preços", u"Consultar histórico de preços", u"Localizar supermercados próximos",
             u"Cadastrar usuário", u"Realizar login", u"Criar lista de compras", u"Adicionar produtos à lista",
             u"Comparar o custo da cesta", u"Conferir preços de prateleira e caixa", u"Salvar conferências",
             u"Coletar preços dos catálogos"]
    uc = dict((n, U.createUseCase(n, sistema)) for n in nomes)
    rel = [gen]
    for n in nomes[:10]:
        rel.append(U.createAssociation(visitante, uc[n], ""))
    rel.append(U.createAssociation(usuario, uc[u"Salvar conferências"], ""))
    rel.append(U.createAssociation(uc[u"Localizar supermercados próximos"], osm, ""))
    rel.append(U.createAssociation(agendador, uc[u"Coletar preços dos catálogos"], ""))
    rel.append(U.createAssociation(uc[u"Coletar preços dos catálogos"], redes, ""))
    rel.append(U.createIncludeUseCaseDependency(uc[u"Comparar o custo da cesta"], uc[u"Comparar preços"]))
    rel.append(U.createExtendUseCaseDependency(uc[u"Salvar conferências"], uc[u"Conferir preços de prateleira e caixa"]))
    rel.append(U.createExtendUseCaseDependency(uc[u"Adicionar produtos à lista"], uc[u"Pesquisar produtos"]))
    rel.append(U.createExtendUseCaseDependency(uc[u"Consultar histórico de preços"], uc[u"Comparar preços"]))
    d = U.createUseCaseDiagram(u"Diagrama de Caso de Uso", pkg, None)
    n1 = note(d, u"Não existe papel de Administrador no PreçoClaro: a manutenção (migrações, coleta manual) "
                 u"é feita por scripts de linha de comando, fora da aplicação.")
    h = DS.getDiagramHandle(d)
    try:
        node(h, sistema, 300, 20, 640, 840)
        node(h, visitante, 70, 230)
        node(h, usuario, 70, 640)
        node(h, osm, 1060, 300)
        node(h, redes, 1060, 690)
        node(h, agendador, 1060, 560)
        coords = [(330, 80), (650, 80), (650, 200), (650, 320), (330, 200), (330, 320), (330, 440), (330, 560),
                  (650, 440), (330, 680), (650, 680), (650, 560)]
        for n, (x, y) in zip(nomes, coords):
            node(h, uc[n], x, y, 250, 70)
        if n1 is not None:
            node(h, n1, 40, 880, 620, 70)
        for r in rel:
            link(h, r)
        h.save()
    finally:
        h.close()
    RESULT["01-diagrama-caso-de-uso.png"] = d

# =============================================================================================
# 2. DIAGRAMA DE PACOTES (MVC)
# =============================================================================================
def pacotes():
    pkg = U.createPackage(u"02 Pacotes MVC", ROOT)
    P = {}
    defs = [
        ("pages", u"src/pages — View (telas React)"),
        ("components", u"src/components — View (componentes)"),
        ("context", u"src/context — estado global (Auth, Basket, Location)"),
        ("api", u"src/api.ts — cliente HTTP"),
        ("controllers", u"backend/src/controllers — Controller (Fastify)"),
        ("http", u"backend/src/http — sessão, CSRF, erros"),
        ("services", u"backend/src/services — regras de negócio"),
        ("rules", u"backend/src/*.ts — regras puras (searchRelevance, catalogComparison, csv, location)"),
        ("repositories", u"backend/src/repositories — Model (SQL)"),
        ("integrations", u"backend/src/integrations + osm.ts — fontes externas e coletores"),
        ("mysql", u"MySQL — backend/sql (tabelas, views, procedures)"),
    ]
    for key, name in defs:
        P[key] = U.createPackage(name, pkg)
    deps = [("pages", "components"), ("pages", "context"), ("pages", "api"), ("components", "context"), ("components", "api"),
            ("context", "api"), ("api", "controllers"), ("controllers", "http"), ("controllers", "services"), ("http", "services"),
            ("services", "repositories"), ("services", "rules"), ("services", "integrations"), ("repositories", "mysql"),
            ("integrations", "rules"), ("integrations", "mysql")]
    rel = []
    for a, b in deps:
        dep = U.createUsage(P[a], P[b])
        if (a, b) == ("api", "controllers"):
            dep.setName(u"HTTP/JSON")
        rel.append(dep)
    d = U.createClassDiagram(u"Diagrama de Pacotes (MVC)", pkg, None)
    n1 = note(d, u"MVC adaptado: a View é o React (navegador); o Controller é a camada de rotas Fastify; "
                 u"o Model são os repositories + MySQL. Os services ficam entre Controller e Model com as regras "
                 u"de negócio. As setas «use» seguem um único sentido (sem dependência circular).")
    h = DS.getDiagramHandle(d)
    try:
        pos = {"pages": (40, 40), "components": (420, 40), "context": (800, 40),
               "api": (420, 230), "controllers": (420, 400), "http": (800, 400),
               "services": (420, 570), "rules": (800, 570), "integrations": (40, 740),
               "repositories": (420, 740), "mysql": (420, 910)}
        for k, (x, y) in pos.items():
            node(h, P[k], x, y, 330, 110)
        if n1 is not None:
            node(h, n1, 40, 400, 330, 250)
        for r in rel:
            link(h, r)
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

    rel = [
        assoc(user, slist, u"listas", "0", "30", u"dono", "1", "1", composition=True),
        assoc(slist, item, u"itens", "0", "80", u"lista", "1", "1", composition=True),
        assoc(user, check, u"conferências", "0", "*", u"autor", "0", "1"),
        assoc(check, citem, u"itens", "1", "60", u"conferência", "1", "1", composition=True),
        assoc(product, offer, u"ofertas", "0", "*", u"produto", "1", "1"),
        assoc(store, offer, u"ofertas", "0", "*", u"loja", "1", "1"),
    ]
    for src, dst in [(item, product), (citem, product), (obs, product)]:
        dep = U.createDependency(src, dst, "ModelerModule", "trace") if False else U.createUsage(src, dst)
        dep.setName(u"por GTIN")
        rel.append(dep)
    note_text = (u"Correspondência TypeScript ↔ MySQL: User=usuarios, Product=produtos, Store=estabelecimentos, "
                   u"Offer=ofertas, ShoppingList=listas, ShoppingListItem=lista_itens, PriceCheck=conferencias, "
                   u"PriceCheckItem=conferencia_itens, PriceObservation=observacoes_preco. No código os modelos são "
                   u"types TypeScript; as operações listadas são as funções dos services que manipulam cada entidade "
                   u"(authService, listService, checkMath/checkService). Itens de lista e observações referenciam o "
                   u"produto pelo GTIN (sem chave estrangeira).")
    CLS.update(dict(User=user, ShoppingList=slist, ShoppingListItem=item, Product=product, rel_list=rel[0], rel_item=rel[1]))
    d = U.createClassDiagram(u"Diagrama de Classes", pkg, None)
    n1 = note(d, note_text)
    h = DS.getDiagramHandle(d)
    try:
        layout = [(user, 40, 40), (slist, 480, 40), (item, 940, 40), (check, 40, 470), (citem, 480, 520),
                  (product, 1420, 300), (offer, 1420, 640), (store, 940, 640), (obs, 1420, 980), (st, 940, 1060), (cs, 480, 860)]
        for e, x, y in layout:
            rows = len(e.getOwnedAttribute()) + len(e.getOwnedOperation()) if hasattr(e, "getOwnedOperation") else 0
            if e.getMClass().getName() == "Enumeration":
                rows = len(e.getValue())
            show_features(node(h, e, x, y, 340, 44 + 18 * rows + 12))
        if n1 is not None:
            node(h, n1, 40, 1060, 780, 170)
        for r in rel:
            link(h, r)
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
    usuario = inst(u"usuario", CLS["User"], {"id": "1", "name": u"\"Usuário de exemplo\"", "email": u"\"exemplo@example.com\""})
    lista = inst(u"comprasDoMes", CLS["ShoppingList"], {"id": "10", "name": u"\"Compras do mês\""})
    itens = [
        inst(u"arroz", CLS["ShoppingListItem"], {"gtin": u"\"(ilustrativo)\"", "name": u"\"Arroz branco tipo 1 5kg\"", "quantity": "2", "purchased": "false"}),
        inst(u"feijao", CLS["ShoppingListItem"], {"gtin": u"\"(ilustrativo)\"", "name": u"\"Feijão carioca 1kg\"", "quantity": "3", "purchased": "false"}),
        inst(u"leite", CLS["ShoppingListItem"], {"gtin": u"\"(ilustrativo)\"", "name": u"\"Leite UHT integral 1L\"", "quantity": "6", "purchased": "true"}),
    ]
    links = [U.createLink(usuario, lista, u"listas")]
    for it in itens:
        links.append(U.createLink(lista, it, u"itens"))
    # Cada ligação é instância da associação correspondente do diagrama de classes.
    for lk in links:
        try:
            ends = list(lk.getLinkEnd()) if hasattr(lk, "getLinkEnd") else []
        except Throwable:
            ends = []
    d = U.createObjectDiagram(u"Diagrama de Objetos", pkg, None)
    n1 = note(d, u"DADOS ILUSTRATIVOS: nomes, quantidades e identificadores são exemplos para explicar a estrutura; "
                 u"não representam um usuário real. A lista pertence ao usuário (composição) e contém três itens.")
    h = DS.getDiagramHandle(d)
    try:
        node(h, usuario, 40, 60, 340, 110)
        node(h, lista, 460, 60, 300, 90)
        for i, it in enumerate(itens):
            node(h, it, 40 + 400 * i, 330, 360, 130)
        if n1 is not None:
            node(h, n1, 840, 40, 400, 130)
        for lk in links:
            link(h, lk)
        h.save()
    finally:
        h.close()
    RESULT["04-diagrama-objetos.png"] = d

# =============================================================================================
# 5. DIAGRAMA DE SEQUÊNCIA
# =============================================================================================
def sequencia():
    pkg = U.createPackage(u"05 Sequencia", ROOT)
    it = U.createInteraction(); it.setName(u"Pesquisar e comparar preços"); it.setOwner(pkg)
    names = [u"usuário", u"CatalogPage (React)", u"api.ts", u"catalogController", u"catalogService",
             u"searchRanking", u"catalogRepository", u"MySQL"]
    L = [U.createLifeline(n, it) for n in names]
    def occ(l, line, enclosing=None):
        o = U.createExecutionOccurenceSpecification()
        if enclosing is None:
            o.setEnclosingInteraction(it)
        else:
            o.setEnclosingOperand(enclosing)
        o.setLineNumber(line); o.getCovered().add(l)
        return o
    def call(a, b, label, line, dur, sort=MessageSort.SYNCCALL, reply=u"", enclosing=None):
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
    y = 120
    call(0, 1, u"1: pesquisar(\"ovos 30 unidades\")", y, 700, reply=u"18: cartões / mensagem de ausência")
    call(1, 2, u"2: getCatalogItems(q, qtd, página, rede, ordem)", y + 30, 640, sort=MessageSort.ASYNCCALL, reply=u"17: Promise<CatalogItemsResponse>")
    call(2, 3, u"3: GET /api/catalog/items?q=…", y + 60, 580, sort=MessageSort.ASYNCCALL, reply=u"16: 200 JSON {items, total, search}")
    call(3, 4, u"4: listItems({q, network, compare, quantity, sort, page})", y + 90, 520, reply=u"15: página + resumo da pesquisa")
    call(4, 5, u"5: rankSearch(q, categoria, ordem, página)", y + 120, 250, reply=u"10: GTINs da página")
    call(5, 6, u"6: searchCandidates(sqlGroups, rede, qtd)", y + 150, 90, reply=u"8: candidatos")
    call(6, 7, u"7: SELECT … GROUP BY gtin (LIKE sem acento)", y + 165, 50, reply=u"linhas")
    # Nota, ordenação e paginação dentro do serviço de ranking (mensagem para si mesmo).
    call(5, 5, u"9: scoreBest() · ordenar no nível · paginar", y + 260, 60, reply=None)
    call(4, 6, u"11: rowsForGtins(gtins) / imagesForGtins(gtins)", y + 390, 90, reply=u"13: ofertas e fotos")
    call(6, 7, u"12: SELECT … WHERE gtin IN (…)", y + 405, 50, reply=u"linhas")
    call(4, 4, u"14: compareCatalogItem() · centavos · preço antigo", y + 500, 50, reply=None)
    # Alternativa: com ou sem produtos que são o item pesquisado.
    try:
        cf = U.createCombinedFragment(InteractionOperator.ALTOP)
        cf.setEnclosingInteraction(it); cf.setLineNumber(y + 670)
        for l in (L[0], L[1]):
            cf.getCovered().add(l)
        op1 = U.createInteractionOperand(u"[strongTotal > 0] mostrar cartões e ordem escolhida")
        op1.setOwnerFragment(cf); op1.setLineNumber(y + 690)
        op2 = U.createInteractionOperand(u"[strongTotal = 0] SearchNotice: \"Não encontramos…\" + relacionados")
        op2.setOwnerFragment(cf); op2.setLineNumber(y + 790)
        for o in (op1, op2):
            for l in (L[0], L[1]):
                o.getCovered().add(l)
        cf.setEndLineNumber(y + 830) if hasattr(cf, "setEndLineNumber") else None
        op1.setEndLineNumber(y + 760) if hasattr(op1, "setEndLineNumber") else None
        op2.setEndLineNumber(y + 830) if hasattr(op2, "setEndLineNumber") else None
    except Throwable as e:
        log("   alt não criado", e)
    d = U.createSequenceDiagram(); d.setName(u"Diagrama de Sequência"); d.setOrigin(it)
    RESULT["05-diagrama-sequencia.png"] = d
    RESULT["_seq_lifelines"] = L
    RESULT["_seq_interaction"] = it

def sequencia_layout():
    d = RESULT["05-diagrama-sequencia.png"]
    h = DS.getDiagramHandle(d)
    try:
        for i, l in enumerate(RESULT["_seq_lifelines"]):
            place(h, l, 40 + i * 230, 20)
        it = RESULT["_seq_interaction"]
        for f in it.getFragment():
            if f.getMClass().getName() == "CombinedFragment":
                log("   alt linha", f.getLineNumber())
                place(h, f, 20, 790, 560, 230)
        for f in it.getFragment():
            m = getattr(f, "getSentMessage", lambda: None)()
            if m is not None and not h.getDiagramGraphics(m):
                link(h, m)
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
    msgs = [(("user", "modal"), u"confirmar(quantidade, lista)"),
            (("modal", "ctx"), u"addToList(listId, item, 'add')"),
            (("ctx", "api"), u"addListItems(id, [item], 'add')"),
            (("api", "ctl"), u"POST /api/lists/:id/items {items, mode}"),
            (("ctl", "ses"), u"csrfGuard(request) · requireUser(request)"),
            (("ctl", "svc"), u"addItems(userId, listId, itens, 'add')"),
            (("svc", "repo"), u"ownsList(userId, listId)"),
            (("svc", "repo"), u"addItems(listId, itens, 'add', 80)"),
            (("repo", "db"), u"BEGIN · SELECT … FOR UPDATE · INSERT … ON DUPLICATE KEY UPDATE · COMMIT"),
            (("ctl", "svc"), u"detail(userId, listId) → ListDetail")]
    for i, (key, text) in enumerate(msgs):
        m = U.createCommunicationMessage(); m.setName(text); m.setSequence(str(i + 1)); m.setChannel(chans[key])
        m.setSortOfMessage(MessageSort.SYNCCALL)
    d = U.createCommunicationDiagram(u"Diagrama de Comunicação", it, None)
    n1 = note(d, u"Mensagens numeradas na ordem de execução (1 a 10). O canal rotas–sessão mostra a colaboração com "
                 u"a proteção CSRF e a sessão HttpOnly; o canal repositório–banco é uma transação.")
    h = DS.getDiagramHandle(d)
    try:
        pos = {"user": (40, 60), "modal": (380, 60), "ctx": (760, 60), "api": (760, 330), "ctl": (380, 330),
               "ses": (40, 330), "svc": (380, 600), "repo": (760, 600), "db": (760, 860)}
        for k, (x, yy) in pos.items():
            node(h, N[k], x, yy)
        if n1 is not None:
            node(h, n1, 40, 820, 520, 110)
        for ch in chans.values():
            link(h, ch)
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
    ini = U.createInitialPseudoState(); ini.setParent(reg)
    verif = state(u"Verificando trava e intervalo (conceitual)")
    ignorada = state(u"IGNORADA (só em memória, não gravada)")
    andamento = state(u"EM_ANDAMENTO")
    escolha = U.createChoicePseudoState(); escolha.setParent(reg)
    sucesso = state(u"SUCESSO")
    parcial = state(u"PARCIAL")
    falha = state(u"FALHA")
    fim = U.createFinalState(); fim.setParent(reg)
    # Subestados conceituais de EM_ANDAMENTO (não são gravados no MySQL).
    sub = U.createRegion(); sub.setParent(andamento)
    sini = U.createInitialPseudoState(); sini.setParent(sub)
    s1 = U.createState(); s1.setName(u"Coletando páginas/unidades"); s1.setParent(sub)
    s2 = U.createState(); s2.setName(u"Validando ofertas (GTIN, preço, peso)"); s2.setParent(sub)
    s3 = U.createState(); s3.setName(u"Gravando observações e catálogo"); s3.setParent(sub)
    tr = []
    def t(src, dst, ev=u"", guard=u"", eff=u""):
        x = U.createTransition(); x.setSource(src); x.setTarget(dst)
        if ev: x.setReceivedEvents(ev)
        if guard: x.setGuard(guard)
        if eff: x.setEffect(eff)
        tr.append(x); return x
    t(ini, verif, ev=u"runMarketCollection()")
    t(verif, ignorada, guard=u"GET_LOCK ocupado ou última coleta SUCESSO dentro do intervalo")
    t(verif, andamento, guard=u"trava obtida", eff=u"openRun(): FALHA nas antigas EM_ANDAMENTO; INSERT")
    t(sini, s1); t(s1, s2); t(s2, s3)
    t(andamento, escolha, ev=u"coleta terminou", eff=u"closeRun()")
    t(escolha, sucesso, guard=u"leitura completa (stats.complete)")
    t(escolha, parcial, guard=u"leitura incompleta, dados válidos gravados")
    t(andamento, falha, ev=u"exceção ou queda do processo", eff=u"status FALHA")
    t(ignorada, fim); t(sucesso, fim); t(parcial, fim); t(falha, fim)
    note_text = (u"Estados PERSISTIDOS em coleta_execucoes.status: EM_ANDAMENTO, SUCESSO, PARCIAL, FALHA. "
                   u"Estados CONCEITUAIS (não gravados): 'Verificando trava e intervalo', IGNORADA e os subestados "
                   u"de EM_ANDAMENTO. Se o processo cair durante a coleta, a linha que ficou EM_ANDAMENTO é "
                   u"fechada como FALHA no próximo openRun(). Código: backend/src/integrations/marketSync.ts.")
    d = U.createStateMachineDiagram(u"Diagrama de Máquina de Estados", sm, None)
    n1 = note(d, note_text)
    h = DS.getDiagramHandle(d)
    try:
        node(h, ini, 60, 80)
        node(h, verif, 160, 50, 260, 70)
        node(h, ignorada, 160, 560, 260, 70)
        node(h, andamento, 560, 30, 380, 420)
        node(h, sini, 590, 90)
        node(h, s1, 640, 80, 260, 60)
        node(h, s2, 640, 200, 260, 60)
        node(h, s3, 640, 320, 260, 60)
        node(h, escolha, 1100, 200)
        node(h, sucesso, 1340, 40, 170, 60)
        node(h, parcial, 1340, 330, 170, 60)
        node(h, falha, 1340, 560, 170, 60)
        node(h, fim, 1660, 700)
        if n1 is not None:
            node(h, n1, 60, 720, 760, 130)
        for x in tr:
            for g in (link(h, x) or []):
                for key in ["TRANSITION_SHOWLABEL", "TRANSITION_GUARDVISIBLE"]:
                    try:
                        g.setProperty(key, "true")
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
    pu = part(u"Usuário — React (ListsPage, BasketContext)")
    pa = part(u"API — listService / catalogService")
    pr = part(u"Regras — catalogComparison.ts")
    pd = part(u"MySQL")
    def action(name, p):
        a = U.createOpaqueAction(); a.setName(name); a.setOwnerPartition(p); return a
    def decision(p, name=u""):
        d = U.createDecisionMergeNode(); d.setName(name); d.setOwnerPartition(p); return d
    ini = U.createInitialNode(); ini.setOwnerPartition(pu)
    a1 = action(u"Selecionar produtos", pu)
    a2 = action(u"Definir quantidades (1 a 999)", pu)
    d1 = decision(pu, u"tem conta?")
    a3 = action(u"Enviar cesta: POST /api/catalog/basket/compare", pu)
    a4 = action(u"Abrir lista: GET /api/lists/:id", pu)
    m1 = decision(pa)
    a5 = action(u"Validar cesta (validateBasket: 1–80 itens, GTIN, quantidade)", pa)
    d2 = decision(pa, u"válida?")
    a6 = action(u"Consultar ofertas dos supermercados (rowsForGtins)", pd)
    a7 = action(u"Selecionar faixa vigente por unidade (currentQuotes)", pr)
    a8 = action(u"Identificar produtos sem preço", pr)
    d3 = decision(pr, u"unidade tem todos os itens?")
    a9 = action(u"Calcular total da unidade em centavos", pr)
    a10 = action(u"Marcar unidade como incompleta (sem total)", pr)
    m2 = decision(pr)
    a11 = action(u"Montar compra dividida (menor preço de cada item)", pr)
    d4 = decision(pr, u"2 ou mais cestas completas?")
    a12 = action(u"Identificar a opção mais econômica e a economia", pr)
    m3 = decision(pr)
    a13 = action(u"Apresentar resultados (totais, faltantes, compra dividida)", pu)
    a14 = action(u"Mostrar erro de validação", pu)
    fim = U.createActivityFinalNode(); fim.setOwnerPartition(pu)
    flows = []
    def f(a, b, g=u""):
        c = U.createControlFlow(); c.setSource(a); c.setTarget(b)
        if g: c.setGuard(g)
        flows.append(c)
    f(ini, a1); f(a1, a2); f(a2, d1)
    f(d1, a3, u"visitante"); f(d1, a4, u"logado")
    f(a3, m1); f(a4, m1); f(m1, a5); f(a5, d2)
    f(d2, a14, u"inválida"); f(a14, fim)
    f(d2, a6, u"válida"); f(a6, a7); f(a7, a8); f(a8, d3)
    f(d3, a9, u"sim"); f(d3, a10, u"não"); f(a9, m2); f(a10, m2); f(m2, a11); f(a11, d4)
    f(d4, a12, u"sim"); f(d4, m3, u"não"); f(a12, m3); f(m3, a13); f(a13, fim)
    d = U.createActivityDiagram(u"Diagrama de Atividades", ac)
    h = DS.getDiagramHandle(d)
    try:
        lanes = [(pu, 20), (pa, 400), (pd, 780), (pr, 1160)]
        for p, x in lanes:
            node(h, p, x, 20, 370, 1700)
        W = 300
        layout = [(ini, 180, 70, None), (a1, 50, 130, W), (a2, 50, 230, W), (d1, 180, 330, None),
                  (a3, 40, 420, 160), (a4, 210, 420, 160), (m1, 580, 520, None), (a5, 430, 600, W), (d2, 580, 710, None),
                  (a14, 50, 800, W), (a6, 810, 800, W), (a7, 1190, 800, W), (a8, 1190, 900, W), (d3, 1320, 1000, None),
                  (a9, 1170, 1080, 160), (a10, 1340, 1080, 170), (m2, 1320, 1180, None), (a11, 1190, 1240, W),
                  (d4, 1320, 1340, None), (a12, 1190, 1420, W), (m3, 1320, 1540, None), (a13, 50, 1530, W), (fim, 180, 1640, None)]
        for e, x, yy, w in layout:
            if w:
                node(h, e, x, yy, w, 60)
            else:
                node(h, e, x, yy)
        for c in flows:
            link(h, c)
        h.save()
    finally:
        h.close()
    RESULT["08-diagrama-atividades.png"] = d

for name, fn in [("caso de uso", caso_de_uso), ("pacotes", pacotes), ("classes", classes), ("objetos", objetos),
                 ("sequencia", sequencia), ("sequencia-layout", sequencia_layout), ("comunicacao", comunicacao),
                 ("estados", estados), ("atividades", atividades)]:
    if name == "sequencia-layout" and "05-diagrama-sequencia.png" not in RESULT:
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
