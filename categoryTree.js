// Wing 카테고리 트리 fetch + 캐싱
// /tenants/rfm-ss/api/cms/categories → { categoryId(number) → categoryPath(string) } Map
// sourcing-pipeline/scripts/01_collect_keywords.py:fetch_category_code_map 패턴 차용.

let _cache = null          // Map<number, string>
let _cachePromise = null   // in-flight promise (중복 호출 방지)

const FETCH_EXPR = `
(async function() {
  try {
    const resp = await fetch('/tenants/rfm-ss/api/cms/categories');
    if (!resp.ok) return { error: 'HTTP_' + resp.status };
    const data = await resp.json();
    const map = {};
    function walk(node) {
      const d = node.displayItemCategoryDto;
      if (d && d.displayItemCategoryCode != null) {
        // 이름이 아니라 ID로 키잉 — ID는 고유하므로 중복 걱정 없음
        map[d.displayItemCategoryCode] = d.categoryPath || d.name || '';
      }
      (node.child || []).forEach(walk);
    }
    walk(data);
    return { map };
  } catch(e) { return { error: e.message }; }
})()
`

/**
 * callWingAPI 함수를 주입받아 카테고리 트리를 로드하고 Map 반환.
 * 캐싱: 한 세션 1회만 호출. 실패 시 null 반환 (호출부에서 graceful degrade).
 */
export async function loadCategoryTree(callWingAPI) {
  if (_cache) return _cache
  if (_cachePromise) return _cachePromise

  _cachePromise = (async () => {
    try {
      const result = await callWingAPI(FETCH_EXPR)
      if (result.error) {
        console.warn('[categoryTree] fetch failed:', result.error)
        return null
      }
      const m = new Map()
      for (const [k, v] of Object.entries(result.map || {})) {
        m.set(Number(k), v)
      }
      _cache = m
      console.log(`[categoryTree] loaded ${m.size} categories`)
      return m
    } catch (e) {
      console.warn('[categoryTree] fetch threw:', e.message)
      return null
    } finally {
      _cachePromise = null
    }
  })()

  return _cachePromise
}

/**
 * categoryId(숫자) → categoryPath(문자열) 변환. 없으면 null.
 * 트리가 아직 로드 안 됐으면 즉시 null (비동기 대기 안 함).
 */
export function resolveCategoryPath(categoryId) {
  if (!_cache) return null
  return _cache.get(Number(categoryId)) || null
}

/** 캐시 초기화 (테스트용) */
export function _resetCache() {
  _cache = null
  _cachePromise = null
}
