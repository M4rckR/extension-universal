// Sin default_popup en el manifest, chrome.action.onClicked dispara en cada
// click del icono — acá se crea o enfoca la ventana independiente que antes
// abría el botón ⧉ dentro del popup clásico (ese popup ya no existe: la
// única entrada a la extensión es este listener).
//
// El puntero guardado en storage.local es
// { windowId, tabId, sourceTabId }: windowId/tabId son la ventana y la pestaña
// DEL INSPECTOR (popup.html), sourceTabId es la pestaña que inspecciona. Antes
// solo se guardaba la del inspector, así que no había forma de saber a qué
// pestaña estaba atada la ventana.
function inspectorUrl(sourceTabId) {
  return `${chrome.runtime.getURL("popup.html")}?tabId=${sourceTabId}`;
}

function createInspectorWindow(tab) {
  chrome.windows.create({ url: inspectorUrl(tab.id), type: "popup", width: 520, height: 720 }, (win) => {
    const tabId = win?.tabs?.[0]?.id;
    if (tabId) chrome.storage.local.set({ inspectorWindow: { windowId: win.id, tabId, sourceTabId: tab.id } });
  });
}

chrome.action.onClicked.addListener((tab) => {
  chrome.storage.local.get("inspectorWindow", (data) => {
    const w = data.inspectorWindow;
    if (!w) {
      createInspectorWindow(tab);
      return;
    }
    chrome.windows.get(w.windowId, () => {
      if (chrome.runtime.lastError) {
        createInspectorWindow(tab);
        return;
      }
      // Click desde otra pestaña: la ventana existente pasa a inspeccionar
      // esa pestaña (antes solo se enfocaba y seguía atada a la anterior,
      // aunque esa ya estuviera cerrada).
      if (w.sourceTabId !== tab.id && w.tabId) {
        chrome.tabs.update(w.tabId, { url: inspectorUrl(tab.id) });
        chrome.storage.local.set({ inspectorWindow: { ...w, sourceTabId: tab.id } });
      }
      chrome.windows.update(w.windowId, { focused: true });
    });
  });
});

// Limpia el puntero cuando se cierra la ventana del inspector (por la pestaña
// o por la ventana entera) — la propia ventana no puede hacer esta limpieza
// de forma confiable en su propio cierre, así que la hace el service worker.
// Si lo que se cierra es la pestaña INSPECCIONADA, el puntero se conserva:
// la ventana muestra "pestaña cerrada" y el próximo click en el ícono la
// reapunta a la pestaña desde la que se hizo click.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get("inspectorWindow", (data) => {
    if (data.inspectorWindow?.tabId === tabId) {
      chrome.storage.local.remove("inspectorWindow");
    }
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.local.get("inspectorWindow", (data) => {
    if (data.inspectorWindow?.windowId === windowId) {
      chrome.storage.local.remove("inspectorWindow");
    }
  });
});
