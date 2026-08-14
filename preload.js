"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dshDesktop", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  retry: () => ipcRenderer.send("dsh:retry"),
  serverInfo: () => ipcRenderer.invoke("dsh:server-info"),
  openExternal: (url) => ipcRenderer.invoke("dsh:open-external", url),
});
