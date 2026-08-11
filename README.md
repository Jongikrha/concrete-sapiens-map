# 콘크리트 사피엔스 지도 — MVP

전국 모든 장소에 실명·자유닉네임·익명으로 짧은 기억을 남기는 지도 기반 게시판.

## 폴더 구조

```
concrete-sapiens-map/
├── index.html          # 메인 페이지 (지도 + UI 골격)
├── css/
│   └── style.css        # 디자인 시스템 (동판/콘크리트 컨셉)
└── js/
    ├── config.js         # 카카오 API 키, 상수 설정
    ├── storage.js         # 데이터 저장 계층 (지금은 localStorage)
    └── app.js             # 지도 초기화, 마커, 검색, 작성 로직
```

## 1. 로컬에서 실행하기

### 1) 카카오 API 키 발급
1. https://developers.kakao.com 접속 → 애플리케이션 추가
2. **앱 설정 > 플랫폼 > Web**에 아래 도메인 등록
   - `http://localhost:5500` (아래 로컬 서버 사용 시)
   - 나중에 `https://concretesapiens.com` 도 추가
3. **앱 키 > JavaScript 키** 복사

> `map.todoc.us`를 만들 때 이미 발급받은 키가 있다면, 그 앱의 플랫폼 설정에
> `concretesapiens.com` 도메인만 추가로 등록하고 그대로 재사용해도 됩니다.

### 2) 키 입력
`js/config.js` 파일을 열어서:
```js
KAKAO_APP_KEY: "YOUR_KAKAO_JAVASCRIPT_KEY_HERE",
```
이 부분을 발급받은 JavaScript 키로 교체.

### 3) 로컬 서버로 열기
카카오맵 SDK는 `file://` 로 직접 열면 동작하지 않습니다. 로컬 서버가 필요해요.

**VS Code 사용 시**: Live Server 확장 설치 → index.html 우클릭 → "Open with Live Server"

**터미널 사용 시** (Python이 설치되어 있다면):
```bash
cd concrete-sapiens-map
python3 -m http.server 5500
```
그 다음 브라우저에서 `http://localhost:5500` 접속.

## 2. 지금 동작하는 기능 (프론트엔드 프로토타입)

**디자인 (Concrete Archive 스펙 P0 반영)**
- Concrete Black / Paper White / Signal Orange 3색 중심 톤
- 지도 위 DIM 레이어(반투명 검정, `pointer-events: none`)
- 카카오 기본 핀 대신 Memory Dot(점) 마커, 선택 시 Signal Orange
- Bottom Sheet 방식 이야기 열람 (X 버튼 / ESC / Swipe Down / 지도 빈 곳 탭으로 닫기)
- Story 카드는 연도를 가장 크게 강조하는 타이포그래피
- 용어 전면 교체: 기억 남기기 / 기억 전달하기 / 어딘가의 기억 / 나도 이 기억이 떠올랐어요

**기능**
- 전국 지도 자유 탐험, 클러스터링(미니멀 단색 스타일)
- 검색형 + 자유 핀형 장소 지정
- 텍스트 전용 작성 (익명/자유 닉네임, 200자, #해시태그 인라인)
- 시점 3단 선택: 지금 / 과거 / 기억나지 않음
- 반응(나도 이 기억이 떠올랐어요) — **정확한 숫자는 공개 화면에 노출하지 않음** (개발기획서 §21)
- **댓글 기능 없음** — 서비스 핵심 원칙(개발기획서 §2)에 따라 의도적으로 제외
- 기억 전달하기: Web Share API 우선 사용, 미지원 시 링크 복사
- Story별 `publicId` + `?story=<publicId>` 형태 딥링크 (같은 브라우저 내에서만 정상 동작 — 아래 한계 참고)
- 최초 진입 시 최근 이야기 중 랜덤 랜딩 (fallback: 전체 ACTIVE 랜덤 → 기본 지도)
- 해시태그 상단 바: 많이 쓰인 순 상위 30개 (`config.js`의 `TOP_HASHTAG_LIMIT`)
- 내 주변, 어딘가의 기억(랜덤 발견), 신고(5회 누적 시 자동 숨김)

데이터는 지금 **브라우저 localStorage**에만 저장됩니다.

## 3. 아직 구현되지 않은 것 (백엔드 필요)

통합 개발기획서 v1.0에 명시된 아래 기능들은 진짜 백엔드(인증 서비스, DB, 서버)가 있어야 구현 가능해서 이번 프론트엔드 작업에는 포함하지 않았습니다.

- **회원가입 / 로그인 / 이메일 인증** (Cognito 등)
- **계정과 작성자 표시 이름 분리, 이메일 비공개** — 지금은 계정 자체가 없어 임시로 브라우저 로컬 상태만 사용
- **관리자 시스템(`/admin`)** — 신고 검토 큐, 콘텐츠 숨김/삭제/작성자 제재, 회원 상태 관리, Admin Log, 금칙어 관리
- **Story별 진짜 영구 공유 URL** — 지금 `?story=` 딥링크는 같은 브라우저의 localStorage에서만 조회되므로, 실제로 다른 사람에게 링크를 보내면 그 사람 브라우저에는 데이터가 없어 "이 기억은 더 이상 지도에 남아 있지 않습니다"로 표시됩니다. 서버 DB에 저장돼야 진짜로 동작합니다.
- **OG 카드 자동 생성** (SNS/메신저 공유 미리보기 이미지) — 서버 렌더링 필요
- **MY MEMORY** (나의 기억) 개인 보관함 화면
- Memory Dot 선택 시 미세한 pulse 애니메이션 (P1)

데이터는 지금 **브라우저 localStorage**에만 저장됩니다. 즉 지금은 나 혼자만 보는
데모 상태이고, 다른 사람과 데이터를 공유하려면 아래 3번 백엔드 연동이 필요합니다.

## 3. 다음 단계: 진짜 서비스로 만들기

### A. 백엔드 연동 (여러 사람이 함께 쓰려면 필수)
`js/storage.js` 파일의 함수들만 동일한 입출력 형태를 유지하며 실제 API 호출로
바꾸면 됩니다. `app.js`는 손댈 필요 없음.

### E. 회원가입 / 로그인 / 관리자 (통합 개발기획서 §30~§52)
이건 storage.js 교체만으로는 안 되고 별도로 설계해야 합니다.
- Amplify Auth(Cognito)로 이메일+비밀번호 회원가입, 이메일 인증
- Story 작성 버튼을 눌렀을 때만 로그인을 요구하는 흐름 (지도/열람은 비회원도 가능)
- `/admin` 별도 라우트 + ADMIN 권한 체크 + 관리자 MFA
- Story ↔ 실제 userId는 서버에서만 연결, 공개 화면에는 절대 노출 안 함
- 신고 5건 누적 시 자동 HIDDEN 처리 후 관리자 최종 검토 (지금은 자동 HIDDEN까지만 프론트에서 흉내 냄)

이 부분은 다음 대화에서 데이터 모델과 API 설계부터 같이 잡는 걸 추천드려요.

추천 경로 (기존 todoc.us 경험 재사용):
1. AWS Amplify에 `amplify add api` (GraphQL, AppSync + DynamoDB)
2. `Story` 모델을 스키마로 정의 (기획서의 데이터 모델 그대로)
3. `storage.js`를 Amplify DataStore/API 호출로 교체

### B. 도메인 연결
1. `concretesapiens.com` 구매 (가비아, Cloudflare Registrar, Namecheap 등)
2. AWS Amplify Hosting에 배포 (`amplify add hosting` → `amplify publish`)
3. Amplify 콘솔에서 커스텀 도메인 연결 → 구매처(가비아 등)에서 CNAME/네임서버 설정

### C. 콘텐츠 정책
- 신고 임계치, 금지어 필터는 `config.js`의 `REPORT_HIDE_THRESHOLD` 및
  별도 필터 로직으로 확장 가능
- 이용 가이드라인 페이지(실명 비방 금지 등) 추가 필요

### D. 책 연계
- 초기 시드 데이터(`storage.js`의 `seedIfEmpty` 함수)에 작가님 본인의
  실제 기록으로 교체 → 처음 들어온 사람이 빈 지도가 아니라 이야기부터
  마주치게 하기
