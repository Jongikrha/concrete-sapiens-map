# 프로젝트 작업 규칙

## 배경

이 프로젝트는 jongik.rha가 바이브코딩으로 계속 직접 작업 중입니다. `main`에 실시간으로
push가 들어올 수 있으므로, 저(Claude)와 함께하는 작업은 아래 규칙을 기본으로 따릅니다.

## 대화 언어

- Claude는 항상 한글로 대답한다.

## Git 워크플로우

- **작업 시작 전** 항상 `git fetch origin` + `git status`로 로컬이 `origin/main`보다
  뒤처지지 않았는지 확인한다. 뒤처져 있으면 `git pull --ff-only origin main`으로 반영한다.
- **한 줄짜리 즉시 수정**(오타, 사소한 값 조정 등)은 로컬 `main`에서 바로 작업해도 된다.
  단 push 직전에 다시 `git fetch`로 그 사이 밀리지 않았는지 확인한다.
- **여러 파일/여러 커밋에 걸치는 작업**(리팩토링, 새 기능 추가 등)은 반드시 별도
  브랜치에서 진행한다. jongik.rha가 같은 파일(`js/app.js`, `css/style.css` 등)을
  동시에 건드릴 수 있어 충돌 위험이 높기 때문이다.
  - 작업 중간중간 `git fetch origin` + `git rebase origin/main` (또는 merge)으로
    최신 상태를 계속 반영한다.
  - 완료 후 그 시점의 `main` 기준으로 합친다.
- PR 리뷰 프로세스는 강제하지 않는다 — 브랜치는 "리뷰 게이트"가 아니라 배포 중
  중간 상태가 라이브에 나가는 것을 막는 안전장치일 뿐이다.

## 배포 (AWS Amplify)

- Amplify 앱 `concrete-sapiens-map`(appId `deamvdd5u8dcf`, `todoc` AWS 프로필)의
  `main` 브랜치가 `stage: PRODUCTION` + `enableAutoBuild: true`로 확인됨 —
  **`main`에 push하면 곧바로 라이브 사이트에 배포된다** (가정이 아니라 확인된 사실).
  `amplify.yml`은 빌드 없이 리포를 그대로 배포하는 구조.
- 그러므로 **동작이 검증되지 않은 중간 상태를 `main`에 push하지 않는다.** 리팩토링처럼
  여러 단계로 나뉘는 작업은 각 단계를 로컬(브라우저)에서 확인한 뒤에만 `main`에 올린다.
- Amplify 콘솔 상태는 `aws amplify get-branch --app-id deamvdd5u8dcf --branch-name main --profile todoc`로 확인 가능.

## 백엔드 배포 (Amplify Gen2 — Cognito/AppSync)

- `amplify/auth/resource.ts`, `amplify/data/resource.ts`(스키마/인증 규칙)는
  **`main`에 push한다고 자동 반영되지 않는다.** `amplify.yml`이 빌드를 스킵하는
  정적 배포라, 백엔드는 별도로 `npm run deploy`(`scripts/deploy-backend.sh`)를
  실행해야 한다 — `ampx sandbox --once --identifier prod --profile concrete-sapiens-deploy`로
  실제 AWS 리소스에 배포한 뒤, 재생성된 `amplify_outputs.json`을 커밋+push까지 처리한다.

### 배포 전용 IAM 사용자 — `concrete-sapiens-deploy`

- `todoc` 프로필(계정 전체 관리자 권한, 다른 클라이언트 사이트까지 건드릴 수
  있음)을 여러 작업자에게 나눠주지 않으려고 이 프로젝트 배포에만 쓰는 별도
  IAM 사용자를 만들었다(2026-08-12). 자격증명이 새도 이 프로젝트 배포 경로
  밖으로는 못 나간다 — `todoc`과 독립적으로 회수/재발급 가능.
- **주의**: CDK 부트스트랩의 `cfn-exec-role`에 `AdministratorAccess`가 붙어있는
  게 이 계정의 기본 구조라, 이 키로 `sts:AssumeRole` 체인을 타면 실질적으로는
  계정 관리자 권한과 동급이다(진짜 최소권한을 원하면 이 프로젝트 전용 CDK
  부트스트랩을 새로 파야 하는데, 지금 라이브 배포 경로를 건드리는 거라
  하지 않았다). 그래도 **자격증명 자체는 `todoc`과 분리**돼 있어서 이 키만
  회수해도 다른 사이트에는 영향 없다.
  - 부여된 권한: CDK 부트스트랩 역할(`cdk-hnb659fds-{deploy,file-publishing,
    lookup,image-publishing}-role`) assume, `amplify-concretesapiensmap-*`
    스택 조회, `/amplify/concretesapiensmap/*` SSM 파라미터, 이 프로젝트의
    Amplify codegen 자산 S3 버킷. DB 스키마(모델/필드)를 나중에 바꿔도 이
    권한들은 전부 고정된 리소스라 추가 권한 없이 그대로 동작한다 — 실제
    리소스 생성은 CDK 부트스트랩 역할을 통해 이뤄지기 때문.
  - IAM 정책은 `aws iam get-user-policy --user-name concrete-sapiens-deploy
    --policy-name cdk-deploy-assume --profile todoc`로 확인 가능.
- **`amplify/` 아래 스키마를 바꾼 프론트 코드를 `npm run deploy` 없이 먼저
  push하면 라이브 사이트가 깨진다** (2026-08-11 확인 — `StoryAuthor` 모델 참조
  코드가 먼저 배포되어 어드민 로그인 후 `Cannot read properties of undefined
  (reading 'list')`로 크래시, `Story` 모델의 `authenticated` 권한 누락으로
  로그인 사용자 쓰기 거부도 같은 패턴으로 발생). `amplify/*.ts`를 건드리는
  작업은 항상 프론트 코드보다 먼저(또는 같은 시점에) `npm run deploy`부터
  실행한다.
- 로컬 `.git/hooks/pre-push`에 경고 훅이 설치되어 있다 — `amplify/` 스키마가
  `amplify_outputs.json`보다 최근에 바뀐 채 push하면 경고를 띄운다(막지는
  않음). 이 훅은 git에 커밋되지 않는 로컬 파일이라 새 머신에서 클론하면
  다시 설치해야 한다.
- dev 전용 샌드박스는 `--identifier dev`(별도 스택), 로컬 테스트는
  `amplify_outputs.local.json`(gitignore 대상)을 쓴다 — prod 리소스를
  건드리지 않기 위함.

### 담당자별로 다르게 진행된다 — jongik.rha vs AWS 접근 권한자

- jongik.rha는 비개발자(바이브코딩)라 `npm run deploy`도, AWS CLI도 없다.
  `.git/hooks/pre-push` 경고 훅도 로컬 clone 전용이라 그의 환경에는 애초에
  설치돼 있지 않다 — **그의 push를 배포 여부로 막거나 되돌리려 하지 않는다.**
  `amplify/*.ts`를 건드린 채 배포 없이 push하는 게 정상적으로 발생하는
  상황이라고 전제한다(2026-08-12 확인 — 실제로 이 패턴으로 라이브가 두 번
  깨졌었음).
- 대신 **AWS 접근 권한이 있는 쪽(Claude 세션)이 매 작업 시작 시 드리프트를
  선제적으로 확인**한다. `git fetch` + `git status` 확인 직후, 아래로
  `amplify/`가 배포보다 앞서 있는지 같이 확인하는 걸 루틴으로 삼는다:
  ```
  git log -1 --format=%ct -- amplify/auth/resource.ts amplify/data/resource.ts amplify/backend.ts
  git log -1 --format=%ct -- amplify_outputs.json
  ```
  앞의 값이 더 크면(=스키마가 더 최근에 바뀌었으면) 다른 작업을 시작하기
  전에 `npm run deploy`부터 실행해 배포와 소스를 맞춘다.
- **AWS 자격증명이 없는 세션(`~/.aws/`나 `todoc` 프로필이 없는 환경)에서
  드리프트를 발견해도 배포를 시도하지 않는다.** `npm run deploy`가 실패하면
  그걸로 끝 — **사람에게 AWS 자격증명을 입력해달라고 요청하지 않는다.**
  자격증명을 채팅으로 주고받는 것 자체가 금지된 행동이고, 실제로 이렇게
  물어봤다가 다른 작업자(AWS 키가 있는 사람)에게 실시간으로 화면이 전달되며
  그 사람 작업을 막아버린 사고가 있었다(2026-08-12 확인). 이 경우엔 그냥
  "백엔드 배포는 AWS 접근 권한이 있는 사람이 별도로 처리해야 함"이라고
  한 줄로 남기고, 원래 하던 작업(프론트 등)을 계속 진행한다. 배포는
  드리프트를 감지한 그 세션의 책임이 아니라, 다음에 AWS 키를 든 세션이
  들어왔을 때 처리할 일이다.

## 커밋

- 사용자가 명시적으로 지시하지 않으면 커밋하지 않는다 (전역 규칙과 동일, 여기서 재확인).
- 커밋은 단일 책임 원칙을 따른다. WIP 성격의 여러 변경을 한 커밋에 몰아넣지 않는다.

## 리팩토링 방향

- 빌드 도구/번들러를 새로 들이지 않는다 — 이 프로젝트는 "빌드 없는 정적 사이트"가
  핵심 특징이다.
- **`<script type="module">`로 바로 전환하지 않는다.** 모듈 스크립트는 실행이
  defer되는데, 카카오맵 SDK는 별도 비동기 `<script>`로 로드되고 `onload` 시점에
  `window.startConcreteSapiensApp`이 정의돼 있는지만 확인한다(index.html 인라인
  스크립트). SDK가 모듈보다 먼저 로드되면 앱 초기화가 조용히 스킵되는 레이스
  컨디션이 생길 수 있다(2026-08-11 확인). 이 부팅 시퀀스를 별도로 재설계하기 전까지는
  `js/app.js`를 쪼갤 때도 `config.js`/`storage.js`와 같은 방식 — **클래식 스크립트 +
  전역 함수**로 분리한다(예: `js/backup.js`). 도메인별(지도/작성폼/이야기열람/검색/
  필터/백업)로 나누되, `index.html`의 `<script src>` 순서만 정확히 맞추면 된다.
- 관심사 하나씩 분리 → 브라우저에서 수동 확인 → 커밋, 순서로 진행한다. 한 번에 전체를
  갈아엎지 않는다.

## 테스트

- 테스트 도구가 아직 없다. 추가할 때는 별도 의존성 없이 Node 내장 `node:test` +
  `assert`로 시작한다 (이 프로젝트의 "빌드/의존성 없음" 철학 유지).
- 우선순위는 `js/storage.js`의 순수 함수(DOM/카카오 SDK 의존 없음)다. `js/app.js`는
  DOM/SDK 결합이 강해 단위테스트 비용이 크므로, 기능 추가 시 수동 QA 체크리스트로
  커버하다가 회귀가 반복되는 지점만 선별적으로 테스트를 추가한다.

## API 키 / 과금

- `js/config.js`의 카카오 JS 키는 도메인 화이트리스트로 보호되는 클라이언트 노출
  전제의 키라 커밋해도 구조적으로 문제없다. 단, 운영 도메인이 카카오 콘솔에
  등록돼 있는지, 비즈월렛/유료 API 사용 설정이 켜져 있지 않은지는 배포 전 확인한다
  (꺼져 있으면 무료 쿼터 초과 시 과금이 아니라 API 호출 실패로 처리됨).
