import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'
import { lookupCommissionRate } from './commissionRates.js'
import { loadCategoryTree, resolveCategoryPath } from './categoryTree.js'
import ReleaseUpdater from './submodules/module_update_auto/release_updater.js'
import updateConfig from './submodules/module_update_auto/config.js'

// ESM에서 __dirname 폴리필 (__dirname은 CJS 전용, ESM에서 직접 사용 불가)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow = null
let loginWindow = null

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    frame: false, // 커스텀 타이틀바 사용
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
    },
  })
  mainWindow.loadFile('index.html')
  return mainWindow
}

// ── 자동 업데이트 ──

async function checkForUpdates(mainWindow) {
  try {
    const updater = new ReleaseUpdater('bnam91', 'gomargin', updateConfig.versionFile)
    const current = updater.getCurrentVersion()
    const latest = await updater.getLatestRelease()
    if (!latest || current === latest.tag_name) return

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '업데이트 알림',
      message: `새 버전이 있습니다: ${latest.tag_name}`,
      detail: `현재: ${current ?? '없음'}\n\n업데이트 후 앱을 재시작하세요.`,
      buttons: ['지금 업데이트', '나중에'],
      defaultId: 0,
    })

    if (response === 0) {
      await updater.performUpdate(latest)
      const { response: restartRes } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '업데이트 완료',
        message: `${latest.tag_name} 업데이트가 완료됐습니다.`,
        detail: '지금 앱을 재시작할까요?',
        buttons: ['지금 재시작', '나중에'],
        defaultId: 0,
      })
      if (restartRes === 0) {
        app.relaunch()
        app.exit(0)
      }
    }
  } catch (e) {
    console.error('업데이트 체크 오류:', e.message)
  }
}

// ── 쿠팡 Wing 로그인 윈도우 ──

async function createLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus()
    return
  }
  loginWindow = new BrowserWindow({
    width: 600,
    height: 800,
    title: '쿠팡 로그인',
    parent: mainWindow,
    modal: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      // no preload — 외부 Wing 페이지라 preload 주입 안 함
    },
  })

  // 오버레이 주입 함수 — 매 네비게이션마다 재주입 (wing → xauth 리다이렉트 대응)
  const injectOverlay = async () => {
    if (!loginWindow || loginWindow.isDestroyed()) return
    try {
      await loginWindow.webContents.insertCSS(`
        #gomargin-close-overlay {
          position: fixed; left:0; right:0; bottom:0;
          height: 52px; background: linear-gradient(135deg, #6366f1, #4f46e5);
          display: flex; align-items: center; justify-content: center;
          color: white; font-size: 15px; font-weight: 600; cursor: pointer;
          z-index: 2147483647; user-select: none;
          box-shadow: 0 -4px 12px rgba(0,0,0,0.3);
        }
        #gomargin-close-overlay:hover { background: linear-gradient(135deg, #4f46e5, #4338ca); }
      `)
      await loginWindow.webContents.executeJavaScript(`
        (function(){
          if (document.getElementById('gomargin-close-overlay')) return;
          const div = document.createElement('div');
          div.id = 'gomargin-close-overlay';
          div.textContent = '로그인 완료 후 닫기';
          div.addEventListener('click', () => { window.close(); });
          document.body.appendChild(div);
        })();
      `)
    } catch (e) {
      console.warn('[login-window] overlay injection failed:', e.message)
    }
  }

  // 리스너를 loadURL 전에 등록 — 첫 로드/리다이렉트 이벤트 누락 방지
  loginWindow.webContents.on('did-finish-load', injectOverlay)
  loginWindow.webContents.on('did-navigate', injectOverlay)
  loginWindow.webContents.on('did-navigate-in-page', injectOverlay)

  loginWindow.on('closed', () => { loginWindow = null })

  await loginWindow.loadURL('https://wing.coupang.com/')
}

// ── Wing API 호출 헬퍼 ──

function extractProductIds(url) {
  let productId = null
  let itemId = null
  let vendorItemId = null
  try {
    const m = url.match(/\/products\/(\d+)/)
    productId = m ? m[1] : null
    const urlObj = new URL(url)
    itemId = urlObj.searchParams.get('itemId')
    vendorItemId = urlObj.searchParams.get('vendorItemId')
  } catch (e) {
    // URL 파싱 실패 시 productId만 추출 시도
  }
  return { productId, itemId, vendorItemId }
}

// Wing API 호출 — 로그인 윈도우가 있으면 그쪽, 없으면 임시 숨김 윈도우.
// 숨김 윈도우는 호출 후 자동 정리.
async function callWingAPI(jsExpression) {
  if (loginWindow && !loginWindow.isDestroyed()) {
    return loginWindow.webContents.executeJavaScript(jsExpression)
  }
  const hidden = new BrowserWindow({
    width: 400, height: 300, show: false,
    webPreferences: { contextIsolation: true },
  })
  try {
    await hidden.loadURL('https://wing.coupang.com/')
    return await hidden.webContents.executeJavaScript(jsExpression)
  } finally {
    if (!hidden.isDestroyed()) hidden.close()
  }
}

// ── IPC 핸들러 ──

ipcMain.handle('open-coupang-login', async () => {
  await createLoginWindow()
  return { ok: true }
})

ipcMain.handle('fetch-product-info', async (_, url) => {
  try {
    const { productId, itemId } = extractProductIds(url)
    if (!productId && !itemId) {
      return { error: 'URL에서 productId를 추출할 수 없습니다.' }
    }
    const searchId = itemId || productId

    // pre-matching/search 호출 (Wing 도메인 내에서 fetch → 쿠키 자동 전송)
    const result = await callWingAPI(`
      (async () => {
        const tokenMatch = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
        if (!tokenMatch) return { error: 'NO_TOKEN' };
        const token = decodeURIComponent(tokenMatch[1]);
        try {
          const resp = await fetch('/tenants/seller-web/pre-matching/search', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-xsrf-token': token },
            body: JSON.stringify({
              keyword: '${searchId}',
              excludedProductIds: [],
              searchPage: 0,
              searchOrder: 'DEFAULT',
              sortType: 'DEFAULT'
            })
          });
          if (!resp.ok) return { error: 'HTTP_' + resp.status };
          const data = await resp.json();
          return { items: data.result || [] };
        } catch(e) { return { error: e.message }; }
      })()
    `)

    if (result.error) {
      if (result.error === 'NO_TOKEN') {
        return { error: '쿠팡 로그인이 필요합니다. "쿠팡 로그인" 버튼을 먼저 눌러주세요.' }
      }
      return { error: 'Wing API 오류: ' + result.error }
    }

    // 매칭
    let matched = null
    if (itemId) matched = result.items.find(i => String(i.itemId) === itemId)
    if (!matched && productId) matched = result.items.find(i => String(i.productId) === productId)
    if (!matched && result.items.length === 1) matched = result.items[0]

    if (!matched) {
      return { error: '해당 상품을 찾을 수 없습니다. Wing 판매자 관리 상품이 아닐 수 있습니다.' }
    }

    // 카테고리 트리 lazy-load (같은 세션 내 1회만)
    await loadCategoryTree(callWingAPI)
    const categoryPath = resolveCategoryPath(matched.categoryId)

    // 수수료율: 카테고리 경로 매칭 → 실패 시 상품명 폴백 → 그래도 없으면 10.8%
    const commissionRate =
      lookupCommissionRate(categoryPath || '') ||
      lookupCommissionRate(matched.productName || '') ||
      10.8

    // 28일 매출 추정 (판매수 × 판매가)
    const salesLast28d = matched.salesLast28d || 0
    const salePrice = matched.salePrice || 0
    const revenueLast28d = salesLast28d * salePrice

    return {
      productName: matched.productName || '',
      categoryPath: categoryPath || (matched.categoryId ? 'categoryId: ' + matched.categoryId : ''),
      categoryId: matched.categoryId,
      salePrice,
      commissionRate,
      productId: matched.productId,
      itemId: matched.itemId,
      vendorItemId: matched.vendorItemId,
      // 추가 지표
      pvLast28Day: matched.pvLast28Day || 0,
      salesLast28d,
      revenueLast28d,
      ratingCount: matched.ratingCount || 0,
      brandName: matched.brandName || '',
    }
  } catch (e) {
    return { error: e.message }
  }
})

// ── 윈도우 제어 ──

ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
})

ipcMain.handle('window-close', () => {
  mainWindow?.close()
})

// 외부 링크를 기본 브라우저로 열기 — https만 허용 (악성 프로토콜 차단)
ipcMain.handle('open-external', (_, url) => {
  try {
    const u = new URL(String(url))
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'invalid_protocol' }
    shell.openExternal(u.toString())
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('window-zoom', (_, factor) => {
  if (!mainWindow) return
  const f = Number(factor)
  if (!Number.isFinite(f) || f <= 0) return
  mainWindow.webContents.setZoomFactor(f)
})

// ── 앱 초기화 ──

app.whenReady().then(() => {
  const win = createMainWindow()
  checkForUpdates(win)

  // darwin: 독 클릭 시 창 복원
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
