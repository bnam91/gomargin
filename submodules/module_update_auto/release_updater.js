import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class ReleaseUpdater {
    constructor(owner, repo, versionFile = "VERSION.txt") {
        this.owner = owner;
        this.repo = repo;
        // 경로 정규화 (절대 경로 또는 상대 경로 모두 처리)
        this.versionFile = path.isAbsolute(versionFile) 
            ? versionFile 
            : path.resolve(process.cwd(), versionFile);
        this.apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`; 
        // --개발용
        this.token = process.env.GITHUB_TOKEN;
    }
    
    // 서브모듈 모드인지 확인 (파일명 또는 경로에 SUBMODULE_VERSION.txt 포함 여부)
    isSubmoduleMode() {
        const fileName = path.basename(this.versionFile);
        const filePath = this.versionFile.toLowerCase();
        return fileName === "SUBMODULE_VERSION.txt" || filePath.includes("submodule_version.txt");
    }

    async getLatestRelease() {
        try {
            const repoLabel = this.isSubmoduleMode() 
                ? "[서브모듈]" 
                : `[${this.owner}/${this.repo}]`;
            
            const headers = {
                'Accept': 'application/vnd.github.v3+json'
            };
            
            const response = await axios.get(this.apiUrl, { headers });
            const releaseData = response.data;
            return {
                tag_name: releaseData.tag_name,
                name: releaseData.name,
                published_at: releaseData.published_at,
                body: releaseData.body,
                assets: releaseData.assets
            };
        } catch (error) {
            const repoLabel = this.isSubmoduleMode() 
                ? "[서브모듈]" 
                : `[${this.owner}/${this.repo}]`;
            console.error(`${repoLabel} GitHub API 요청 중 오류 발생:`, error.message);
            if (error.response) {
                console.error(`${repoLabel} 상세 에러 정보:`, {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data
                });
            }
            return null;
        }
    }

    getCurrentVersion() {
        try {
            if (!fs.existsSync(this.versionFile)) {
                return null;
            }
            const versionInfo = JSON.parse(fs.readFileSync(this.versionFile, 'utf8'));
            return versionInfo.tag_name;
        } catch (error) {
            const repoLabel = this.isSubmoduleMode() 
                ? "[서브모듈]" 
                : `[${this.owner}/${this.repo}]`;
            console.error(`${repoLabel} 버전 파일 읽기 오류:`, error.message);
            return null;
        }
    }

    saveVersionInfo(releaseInfo) {
        try {
            // 디렉토리가 없으면 자동 생성
            const dir = path.dirname(this.versionFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(
                this.versionFile,
                JSON.stringify(releaseInfo, null, 2),
                'utf8'
            );
            return true;
        } catch (error) {
            const repoLabel = this.isSubmoduleMode() 
                ? "[서브모듈]" 
                : `[${this.owner}/${this.repo}]`;
            console.error(`${repoLabel} 버전 정보 저장 중 오류 발생:`, error.message);
            return false;
        }
    }

    async updateToLatest() {
        const repoLabel = this.isSubmoduleMode() 
            ? "[서브모듈]" 
            : `[${this.owner}/${this.repo}]`;
        
        const currentVersion = this.getCurrentVersion();
        const latestRelease = await this.getLatestRelease();

        if (!latestRelease) {
            console.log(`${repoLabel} ❌ 최신 릴리즈 정보를 가져올 수 없습니다.`);
            return false;
        }

        const latestVersion = latestRelease.tag_name;

        if (currentVersion === null) {
            console.log(`${repoLabel} ⚠️ 첫 실행: 최신 버전 ${latestVersion}을 설치합니다.`);
            return await this.performUpdate(latestRelease, repoLabel);
        } else if (currentVersion !== latestVersion) {
            console.log(`${repoLabel} 🔄 업데이트 필요: ${currentVersion} → ${latestVersion}`);
            return await this.performUpdate(latestRelease, repoLabel);
        } else {
            console.log(`${repoLabel} ✅ 이미 최신 버전입니다: ${currentVersion}`);
            return true;
        }
    }

    async performUpdate(releaseInfo, repoLabel = '') {
        try {
            // Git으로 최신 릴리즈 태그 체크아웃
            console.log(`${repoLabel} 🔄 Git 태그 가져오는 중...`);
            await this.executeCommand('git fetch --tags');
            
            console.log(`${repoLabel} 🔄 버전 ${releaseInfo.tag_name}으로 체크아웃 중...`);
            await this.executeCommand(`git checkout ${releaseInfo.tag_name}`);

            // 버전 정보 저장
            this.saveVersionInfo(releaseInfo);

            console.log(`${repoLabel} ✅ 버전 ${releaseInfo.tag_name}으로 업데이트 완료`);

            // 업데이트 후 추가 작업
            await this.postUpdateActions(repoLabel);

            return true;
        } catch (error) {
            console.error(`${repoLabel} Git 명령 실행 중 오류 발생:`, error.message);
            return false;
        }
    }

    async postUpdateActions(repoLabel = '') {
        if (fs.existsSync('package.json')) {
            try {
                console.log(`${repoLabel} 📦 의존성 패키지 설치 중...`);
                await this.executeCommand('npm install');
            } catch (error) {
                console.error(`${repoLabel} 의존성 설치 중 오류 발생:`, error.message);
            }
        }
    }

    executeCommand(command) {
        return new Promise((resolve, reject) => {
            // versionFile의 디렉토리에서 실행
            const workDir = path.dirname(this.versionFile);
            exec(command, { cwd: workDir }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout);
            });
        });
    }
}

export default ReleaseUpdater;