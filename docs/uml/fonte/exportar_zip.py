"""
Exporta o projeto PrecoClaro_UML em ZIP com o mecanismo do próprio Modelio
(IProjectService.exportProject — o mesmo do menu "Exportar projeto"). Como o Modelio não exporta
o projeto que está aberto, este script roda com OUTRO projeto aberto no mesmo workspace:

  modelio.exe -workspace <pasta> -create Exportador -batch exportar_zip.py
Variáveis: PC_UML_WS (workspace), PC_UML_ZIP (arquivo de saída), PC_UML_OUT (pasta do log).
"""
from org.modelio.api.modelio import Modelio
from org.osgi.framework import FrameworkUtil
from java.lang import System, Throwable
from java.nio.file import Paths
import os, traceback

out = open(os.path.join(System.getenv("PC_UML_OUT"), "export.log"), "w")
def log(*a):
    out.write(" ".join(unicode(x).encode("ascii", "replace") for x in a) + "\n"); out.flush()
try:
    M = Modelio.getInstance()
    bundles = dict((b.getSymbolicName(), b) for b in FrameworkUtil.getBundle(M.getClass()).getBundleContext().getBundles())
    e4 = bundles["org.eclipse.e4.ui.workbench"]
    ctx = e4.loadClass("org.eclipse.e4.ui.internal.workbench.E4Workbench").getMethod("getServiceContext").invoke(None)
    app = ctx.get(e4.loadClass("org.eclipse.e4.ui.workbench.IWorkbench")).getApplication().getContext()
    ps = app.get(bundles["org.modelio.platform.project"].loadClass("org.modelio.platform.project.services.IProjectService"))
    factory = bundles["org.modelio.core.project"].loadClass("org.modelio.gproject.project.GProjectDescriptorFactory")
    reader = [m for m in factory.getMethods() if m.getName() == "readProjectDirectory"][0]
    project_dir = Paths.get(System.getenv("PC_UML_WS"), ["PrecoClaro_UML"])
    descriptor = reader.invoke(None, [project_dir]) if reader.getParameterCount() == 1 else None
    log("descritor", descriptor)
    progress = bundles["org.modelio.core.utils"].loadClass("org.modelio.vbasic.progress.NullProgress").newInstance()
    target = Paths.get(System.getenv("PC_UML_ZIP"), [])
    ps.exportProject(descriptor, target, progress)
    log("exportado", target, os.path.getsize(str(target)))
except Throwable as e:
    log("ERRO", e)
except Exception as e:
    log("ERRO-PY", e, traceback.format_exc())
out.close()
