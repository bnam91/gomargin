# gomargin — 쿠팡 마진 계산기

Electron 데스크톱 앱. 쿠팡 상품 URL을 입력하면 Wing API로 상품 정보를 조회해 마진을 계산한다.

## 실행

```bash
npm start    # electron . --remote-debugging-port=9343 --remote-allow-origins=*
```

CDP 포트 **9343**. 이미 떠있을 때 재시작하려면 `lsof -ti :9343 | xargs kill` 먼저.

## 아키텍처

```
┌─ main.js (ESM)          ── Electron main, IPC 핸들러, Wing API 호출
├─ preload.cjs (CJS)      ── contextBridge로 window.api 노출
├─ index.html             ── UI (커스텀 타이틀바, frame:false)
├─ style.css              ── CSS 변수 테마 시스템
├─ categoryTree.js        ── Wing 카테고리 트리 fetch + 세션 캐시
└─ commissionRates.js     ── 카테고리별 수수료율 테이블 (하드코딩)
```

### 파일 형식 규칙
- `main.js`, `categoryTree.js`, `commissionRates.js`: **ESM** (`package.json`에 `"type": "module"`)
- `preload.cjs`: **반드시 CJS**. Electron preload는 contextIsolation 환경에서 CJS 강제. `.cjs` 확장자로 강제 CJS 로드.
- ESM에서 `__dirname` 없음 → `fileURLToPath(import.meta.url)` 폴리필 사용 (`main.js:7-9`)

## Wing API 호출 패턴

**원칙: 브라우저 컨텍스트 안에서 fetch 실행.** 쿠키·XSRF 토큰·Origin이 자동으로 정상값이 되어 봇 디텍션에 안 걸림.

### `callWingAPI(jsExpression)` — main.js:108
1. 로그인 윈도우가 떠있으면 **그 윈도우 webContents**에서 `executeJavaScript` 실행
2. 없으면 **임시 숨김 BrowserWindow**로 wing.coupang.com 로드 후 실행 → 즉시 close

### 사용하는 엔드포인트

| 메서드 | 경로 | 용도 | 호출 시점 |
|-------|------|------|---------|
| POST | `/tenants/seller-web/pre-matching/search` | 상품 정보 조회 (productName, salePrice, categoryId, 판매수·조회수·리뷰수) | URL 입력 시마다 |
| GET  | `/tenants/rfm-ss/api/cms/categories` | 카테고리 트리 (categoryId → categoryPath) | 세션당 1회 (`categoryTree.js` 캐시) |

### XSRF 토큰 패턴
모든 POST는 쿠키에서 `XSRF-TOKEN` 추출 → `x-xsrf-token` 헤더로 전송. 토큰 없으면 `NO_TOKEN` 반환 → 사용자에게 "쿠팡 로그인 필요" 안내.

### URL 1건당 API 횟수
- 첫 조회: **2회** (pre-matching/search + categories)
- 이후: **1회** (categories는 메모리 캐시)

## 로그인 플로우

1. "쿠팡 로그인" 버튼 → `open-coupang-login` IPC → `createLoginWindow()` (main.js:30)
2. 새 BrowserWindow로 `wing.coupang.com` 로드 → Wing의 자체 xauth 리다이렉트로 로그인
3. **오버레이 주입**: 로그인 페이지 하단에 "로그인 완료 후 닫기" 버튼 삽입 (`injectOverlay`, main.js:49)
   - `did-finish-load` / `did-navigate` / `did-navigate-in-page` 세 이벤트에 모두 바인딩 — Wing→xauth 리다이렉트 대응
4. 세션 쿠키는 Electron session에 자동 저장 → 이후 `callWingAPI`가 숨김 윈도우에서도 같은 세션 공유

## 테마 시스템

**CSS 변수 + `data-theme` 속성**으로 라이트/다크 전환. 기본값 **라이트**.

### FOUC 방지
`<head>` 최상단 인라인 스크립트가 CSS 로드 전에 localStorage 읽고 `data-theme` 속성 설정 (`index.html` 최상단). 이 스크립트는 절대 지우지 말 것 — 삭제 시 다크→라이트 플래시 발생.

```javascript
// localStorage key: 'gomargin-theme' (값: 'light' | 'dark')
```

### CSS 구조
- `:root` — 다크 팔레트 (기본)
- `[data-theme="light"]` — 라이트 오버라이드 블록
- 색상·그림자·틴트 모두 변수화 (`--bg-app`, `--bg-card`, `--text-primary`, `--accent-indigo`, `--shadow-card` 등)

### 토글 버튼
타이틀바 `#theme-toggle`. 🌙/☀️ 아이콘은 `.icon-moon` / `.icon-sun` span으로 CSS가 조건부 display.

## 로고

🚀 이모지를 로고로 사용.
- `.page-logo` — 메인 타이틀 (rotate -8deg + indigo glow)
- `.titlebar-logo` — 타이틀바 (translateY -0.5px 시각 정렬)

## 수수료율 조회 (`commissionRates.js`)

하드코딩된 카테고리 경로 테이블. 매칭 순서:
1. `categoryPath`로 정확 매칭
2. 실패 시 `productName` 키워드 폴백
3. 모두 실패 시 **10.8%** 기본값

출처: https://cloud.mkt.coupang.com/Fee-Table

## IPC 핸들러 목록 (main.js)

| 채널 | 용도 |
|------|------|
| `open-coupang-login` | Wing 로그인 창 열기 |
| `fetch-product-info` | URL → 상품 정보 조회 (핵심 기능) |
| `window-minimize` / `window-maximize` / `window-close` | 커스텀 타이틀바 컨트롤 |
| `window-zoom` | 줌 팩터 설정 |
| `open-external` | https/http만 shell로 기본 브라우저에 열기 (프로토콜 화이트리스트) |

## 외부 링크 보안

`open-external` 핸들러는 `new URL()` 파싱 + `protocol` 화이트리스트(`https:`, `http:`)로 `file://`, `javascript:` 등 악성 프로토콜 차단. 외부 링크 추가 시 반드시 이 IPC 경유.

## Wing 봇 디텍션 관점

현재 호출 패턴은 **실제 판매자 Wing UI 사용과 구분 불가능**. 이유:
- 실제 Chromium BrowserWindow에서 fetch → TLS·UA·JA3 정상
- `wing.coupang.com`에 로드된 컨텍스트 → Origin/Referer 정상
- 쿠키 자동 전송 (훔쳐와서 외부 호출 아님)
- pre-matching/search는 상품 등록 UI가 원래 자주 호출하는 엔드포인트

**안전한 사용 패턴**: 사람이 수동으로 URL 하나씩 입력. **위험한 패턴**: 자동 루프·burst·초당 다건.

리스크 헷지 아이디어 (필요시): 같은 URL 디바운스, 리프레시 버튼 쿨다운 3~5초.

## 디자인 규칙

- 타이포그래피: Pretendard + `word-break: keep-all` + `overflow-wrap: anywhere`
- 모달 스프링: `cubic-bezier(0.34, 1.56, 0.64, 1)` (replace_all 금지 — 일괄 치환 시 다른 트랜지션도 같이 바뀜. 적용 대상 확인 후 수정)
- 카드 double-bezel: 외부 drop + 0.5px crisp edge + inset top highlight
- `#main-content`는 `flex: 0 1 auto; min-height: 0` — `flex: 1`로 바꾸면 내용 아래 빈 공간 생김

## 디버깅

### CDP로 렌더러 접속
```bash
# Electron 렌더러 탭 목록
curl http://localhost:9343/json
# chrome-devtools MCP로 evaluate_script 가능
```

### Wing API 응답 덤프
렌더러 콘솔에서 다음 실행:
```javascript
await window.api.fetchProductInfo('<url>')
```

### 로그인 창에서 직접 API 테스트
로그인 창 DevTools 열어서 fetch 직접 호출 (쿠키·XSRF 자동 적용).

## 알려진 제약

- Wing 세션은 일정 시간 미사용 시 만료 → `NO_TOKEN` 에러. 재로그인 필요.
- 경쟁사 실재고·아이템위너는 이 앱에서 조회 안 함 — 별도 스킬 `/coupang-stock` 담당.
- 사이즈 분류(극소형/소형/...)는 pre-matching/search 응답에 **없음**. 자동 추출 불가 (상세페이지 파싱 또는 수동 입력 필요).
