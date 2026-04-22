// preload는 반드시 CJS (CommonJS) 방식이어야 함
// "type": "module" 환경에서도 .cjs 확장자를 사용하면 CJS로 로드됨
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  openCoupangLogin: ()       => ipcRenderer.invoke('open-coupang-login'),
  fetchProductInfo: (url)    => ipcRenderer.invoke('fetch-product-info', url),
  calculateFee:     (dims)   => ipcRenderer.invoke('calculate-fee', dims),
  windowMinimize:   ()       => ipcRenderer.invoke('window-minimize'),
  windowMaximize:   ()       => ipcRenderer.invoke('window-maximize'),
  windowClose:      ()       => ipcRenderer.invoke('window-close'),
  windowZoom:       (factor) => ipcRenderer.invoke('window-zoom', factor),
  openExternal:     (url)    => ipcRenderer.invoke('open-external', url),
  getAppVersion:    ()       => ipcRenderer.invoke('get-app-version'),
})
