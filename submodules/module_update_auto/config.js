import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// 현재 파일의 디렉토리 경로 가져오기
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// 경로 설정 (필요시 수정)
// ============================================
// 프로젝트 루트 경로 (상대 경로 또는 절대 경로)
// 예: '../../' 또는 '/Users/username/project'
const PROJECT_ROOT = '../../';

// 서브모듈 이름 (기본값: module_update_auto)
const SUBMODULE_NAME = 'module_update_auto';

// ============================================
// 경로 계산
// ============================================
// 프로젝트 루트 경로 계산
function resolveProjectRoot() {
    // 절대 경로인 경우 그대로 사용
    if (path.isAbsolute(PROJECT_ROOT)) {
        return PROJECT_ROOT;
    }
    
    // 상대 경로인 경우 현재 파일 기준으로 해석
    const resolvedPath = path.resolve(__dirname, PROJECT_ROOT);
    
    // 상대 경로로 프로젝트 루트 찾기 (submodules 폴더 확인)
    let dir = resolvedPath;
    for (let i = 0; i < 10; i++) {
        const submodulesPath = path.join(dir, 'submodules');
        if (fs.existsSync(submodulesPath)) {
            return dir;
        }
        
        const parentDir = path.dirname(dir);
        if (parentDir === dir) {
            break;
        }
        dir = parentDir;
    }
    
    return resolvedPath;
}

// 프로젝트 루트 경로
const projectRoot = resolveProjectRoot();

// 서브모듈 경로
const submodulePath = path.join(projectRoot, 'submodules', SUBMODULE_NAME);

// 버전 파일 경로
const config = {
    // 프로젝트 루트 경로 (절대 경로)
    projectRoot: projectRoot,
    
    // 메인 프로젝트 버전 파일 경로 (절대 경로)
    versionFile: path.join(projectRoot, 'VERSION.txt'),
    
    // 서브모듈 경로 (절대 경로)
    submodulePath: submodulePath,
    
    // 서브모듈 버전 파일 경로 (절대 경로)
    submoduleVersionFile: path.join(submodulePath, 'SUBMODULE_VERSION.txt'),
    
    // 상대 경로 버전 (필요시 사용)
    relativePaths: {
        // 프로젝트 루트로부터의 상대 경로
        versionFile: path.relative(projectRoot, path.join(projectRoot, 'VERSION.txt')),
        submoduleVersionFile: path.relative(projectRoot, path.join(submodulePath, 'SUBMODULE_VERSION.txt')),
    }
};

export default config;

