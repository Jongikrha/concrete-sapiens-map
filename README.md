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

## 2. 지금 동작하는 기능 (MVP)

- 전국 지도 자유 탐험 (드래그/줌, 클러스터링)
- 지도 클릭 → 자유 핀 찍고 기록 남기기
- 장소 검색(카카오 Places) → 검색된 장소에 기록 남기기
- 한 스팟에 여러 기록이 있으면 리스트로 표시, "최신순 / 시간여행순" 정렬
- 작성 시 이름(실명/자유닉네임/익명 자유), 본문(200자, #해시태그 인라인), 날짜 토글(미지정/지금/과거 회상)
- **좋아요**: 기록마다 좋아요 토글 (브라우저 단위로 중복 방지, 추후 로그인 연동 시 유저 단위로 교체 필요)
- **댓글**: 기록마다 댓글 작성/열람 (이름 선택 입력)
- 해시태그 상단 바: 전체 이야기에서 **많이 쓰인 순 상위 30개**만 노출 (`config.js`의 `TOP_HASHTAG_LIMIT`로 개수 조정 가능)
- 해시태그 클릭 → 전국 필터
- 내 위치로 이동, 랜덤 발견(우연한 탐색)
- 신고 버튼 (5회 누적 시 자동 비노출)

데이터는 지금 **브라우저 localStorage**에만 저장됩니다. 즉 지금은 나 혼자만 보는
데모 상태이고, 다른 사람과 데이터를 공유하려면 아래 3번 백엔드 연동이 필요합니다.

## 3. 다음 단계: 진짜 서비스로 만들기

### A. 백엔드 연동 (여러 사람이 함께 쓰려면 필수)
`js/storage.js` 파일의 함수들(`getAllStories`, `saveStory`, `reportStory`,
`toggleLike`, `addComment`, `getTopHashtags` 등)만 동일한 입출력 형태를 유지하며
실제 API 호출로 바꾸면 됩니다. `app.js`는 손댈 필요 없음.

> 참고: 지금 좋아요 중복 방지는 브라우저 localStorage 기준이라 같은 사람이
> 시크릿창이나 다른 기기로 우회하면 중복으로 누를 수 있습니다. 서버 연동 시에는
> 유저 ID(또는 최소한 IP/디바이스 지문) 기준으로 좋아요 테이블을 따로 두는 걸 추천합니다.

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
