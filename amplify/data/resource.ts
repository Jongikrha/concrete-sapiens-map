import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { adminUsersFn } from '../functions/admin-users/resource';

// js/storage.js의 Story 객체(js/composer.js openComposer 제출 핸들러에서 생성)와
// 필드를 그대로 맞춘다. publicId 조회는 부팅 시 가져온 캐시에서 로컬로 처리하므로
// 여기선 인덱스를 만들지 않는다(YAGNI — 필요해지면 그때 추가해도 스키마 변경은
// 가볍게 반영된다는 걸 이미 확인함).
const schema = a.schema({
  Story: a
    .model({
      publicId: a.string().required(),
      lat: a.float().required(),
      lng: a.float().required(),
      placeId: a.string(),
      officialPlaceName: a.string(),
      address: a.string(),
      customName: a.string(),
      content: a.string().required(),
      youtubeUrl: a.string(),
      // 유튜브 oEmbed로 자동 추출한 원본 제목을 작성 폼에서 파싱한 뒤 사용자가
      // 확인/수정한 값 — 카드와 미니 플레이어가 재생 전에도 바로 "🎧 아티스트 ·
      // 곡명"을 보여줄 수 있게 저장해둔다. 둘 다 optional: 이 기능 이전 기억엔
      // 없고, 파싱이 아티스트를 못 찾으면 musicTitle만 채워진다.
      musicArtist: a.string(),
      musicTitle: a.string(),
      // 첨부 사진(1장) — amplify/storage/resource.ts의 story-photos/ 경로에 올린
      // 파일의 S3 키만 저장한다. URL은 만료되는 presigned URL이라 여기 저장해봐야
      // 금방 못 쓰게 되므로, 화면에 그릴 때 js/storage.js가 getUrl()로 그때그때
      // 새로 만든다. optional — 이 필드 이전 기억엔 당연히 없고, 사진 없는 글도 계속 허용.
      photoKey: a.string(),
      // 사진 크롭 위치(포커스 포인트) — object-fit: cover로 표시할 때 어느
      // 지점을 중심으로 자를지 0~100 퍼센트로 저장한다. 작성 마법사에서
      // 드래그로 지정하고(js/composer.js), 없으면 화면(storySheet.js/admin.js)
      // 에서 50(중앙)으로 취급한다. optional — 이 필드 이전 사진엔 당연히 없음.
      photoFocusX: a.integer(),
      photoFocusY: a.integer(),
      hashtags: a.string().array(),
      authorMode: a.string().required(),
      displayAuthorName: a.string().required(),
      dateMode: a.string().required(),
      referenceDate: a.string(),
      createdAt: a.datetime().required(),
      reportCount: a.integer().required(),
      status: a.string().required(),
      reactionCount: a.integer().required(),
      shareCount: a.integer().required(),
      // 어드민 전용 필드 — 공개 화면에는 절대 노출하지 않는다.
      // authorDeviceId: 실계정 없이 브라우저 단위 비식별 상관관계(진짜 신원 아님).
      authorDeviceId: a.string(),
      viewCount: a.integer(),
      // 어드민 벌크 등록(CSV 붙여넣기)으로 만든 가라 데이터 표시용 —
      // 실제 이용자 글과 구분해서 나중에 한 번에 골라 지울 수 있게 한다.
      isSeed: a.boolean(),
    })
    .authorization((allow) => [
      // identityPool 인증모드에서 "로그인한 사용자"는 guest와 다른 IAM
      // 역할(authenticated)로 평가된다 — allow.guest()만 있으면 회원가입
      // 도입 이후 로그인한 사용자의 쓰기/읽기가 전부 거부된다. 게스트와
      // 동일한 권한을 authenticated에도 그대로 미러링한다.
      allow.guest().to(['create', 'read', 'update']),
      allow.authenticated('identityPool').to(['create', 'read', 'update']),
      allow.group('Admins'),
    ]),

  // 스토리 작성자의 실계정(회원가입) 연결 — PageView와 동일한 write-only
  // 패턴. Story 모델에 이메일을 직접 넣으면 guest read 권한 때문에 누구나
  // 열람 가능해져(브라우저 devtools로 Storage.getAllStories() 확인 가능)
  // 회원가입 기획서 15/18장의 "이메일은 절대 공개 노출하지 않는다" 원칙에
  // 위배된다. 그래서 별도 모델로 분리해 게스트는 쓰기만, 관리자만 읽게
  // 한다. 필드 단위 권한(field-level authorization)은 Gen2에서 배포 실패
  // 사례가 보고돼 있어(필수 필드 전체에 권한을 붙여야 하는 등) 대신 이미
  // 검증된 모델 단위 분리 패턴을 재사용한다.
  StoryAuthor: a
    .model({
      storyId: a.string().required(),
      userId: a.string().required(),
      email: a.string().required(),
    })
    .authorization((allow) => [
      allow.guest().to(['create']),
      allow.authenticated('identityPool').to(['create']),
      // 로그인 계정 기준으로 "내가 남긴 기억"을 기기 무관하게 보여주기
      // 위해 본인 글만 owner 기반으로 읽을 수 있게 허용한다(2026-08-14).
      // owner 필드가 sub로 정상 채워지려면 create/read 둘 다 userPool
      // authMode로 호출해야 한다(js/storage.js recordStoryAuthor/
      // listMyStoryAuthors 참고, admin.js가 이미 쓰는 것과 같은 패턴).
      // 기존 identityPool 경로(위 authenticated 규칙)로 만든 레코드는
      // owner가 안 채워져 이 규칙으론 안 읽힌다 — 이번 변경 이후 계정으로
      // 로그인해서 새로 쓴 글부터 기기 무관 조회가 된다.
      // delete는 회원 탈퇴(js/storage.js deleteMyStoryAuthors, 2026-09-02)
      // 때 본인이 자기 계정-글 연결(이메일 포함)을 직접 지우게 하려고
      // 추가했다 — Story(기억) 본문 자체는 별도 모델이라 이 권한과 무관
      // 하게 지도에 남는다.
      allow.owner().to(['create', 'read', 'delete']),
      allow.group('Admins').to(['read']),
    ]),

  // 금칙어 목록 — 게스트는 작성 화면에서 체크할 수 있게 읽기만, 편집은 관리자만.
  BannedWord: a
    .model({
      word: a.string().required(),
    })
    .authorization((allow) => [
      allow.group('Admins'),
      allow.guest().to(['read']),
      allow.authenticated('identityPool').to(['read']),
    ]),

  // 방문 로그 — write-only 텔레메트리. 게스트는 쓰기만(자기가 남긴 것도 못 읽음),
  // 관리자만 읽는다.
  PageView: a
    .model({
      storyId: a.string(), // ?story=로 특정 기억을 보고 들어온 경우만 채움
      // 어드민이 자기 자신(개발/테스트) 방문을 통계에서 빼려고 추가
      // (2026-08-25). Story.authorDeviceId와 동일한 비식별 브라우저 ID —
      // 진짜 신원 아님, 어드민 집계 필터링 용도로만 예외 허용
      // ([[feedback_identity_never_device_based]] 참고).
      deviceId: a.string(),
    })
    .authorization((allow) => [
      allow.guest().to(['create']),
      allow.authenticated('identityPool').to(['create']),
      allow.group('Admins').to(['read']),
    ]),

  // 방문 통계에서 뺄 기기 ID 목록(어드민 전용, 2026-08-25) — 처음엔
  // localStorage에만 뒀는데, 어드민이 데스크톱/모바일 등 브라우저를
  // 바꿔가며 통계를 보면 그때마다 다시 등록해야 해서 백엔드로 옮겼다.
  // 등록 자체는 여전히 "그 기기의 브라우저로 어드민 접속 → 화면에
  // 표시된 자기 기기 ID를 제외 버튼으로 추가"하는 셀프서비스 흐름이고,
  // 저장만 공유되어 어느 브라우저에서 통계를 보든 동일하게 반영된다.
  AdminExcludedDevice: a
    .model({
      deviceId: a.string().required(),
    })
    .authorization((allow) => [allow.group('Admins')]),

  // 가벼운 퍼널 이벤트 로그 — "이맘때 기억" 노출/클릭, 작성 폼 시작/완료
  // 같은 지표를 세려고 추가(2026-08-21). PageView와 같은 write-only
  // 텔레메트리 패턴 — 게스트도 쓰기만, 관리자만 읽는다. type은 자유
  // 문자열("throwback_opened", "throwback_confirmed", "composer_opened",
  // "composer_submitted")로 두고 종류가 늘어도 스키마 변경 없이 대응한다.
  AppEvent: a
    .model({
      type: a.string().required(),
    })
    .authorization((allow) => [
      allow.guest().to(['create']),
      allow.authenticated('identityPool').to(['create']),
      allow.group('Admins').to(['read']),
    ]),

  // 회원 깃발(어드민 전용 메모/표시) — userId를 기본키로 써서 회원 한 명당
  // 레코드 하나(있으면 깃발 켜짐, 없으면 꺼짐)로 단순하게 다룬다. Cognito
  // 커스텀 속성으로는 못 만든다 — UserPool Schema는 생성 후 CDK로 업데이트가
  // 안 되는 구조적 제약이 있어(backend.ts의 addPropertyDeletionOverride
  // 참고) DynamoDB 쪽에 별도 모델로 분리했다.
  UserFlag: a
    .model({
      userId: a.string().required(),
      note: a.string(),
    })
    .identifier(['userId'])
    .authorization((allow) => [allow.group('Admins')]),

  // 회원관리(어드민 전용) — Cognito Admin API(ListUsers/AdminDisableUser 등)는
  // IAM 관리자 권한이 필요해 브라우저에서 직접 호출할 수 없다. adminUsersFn
  // 하나가 fieldName으로 분기해서 처리한다(amplify/functions/admin-users).
  AdminUser: a.customType({
    username: a.string().required(),
    userId: a.string().required(),
    email: a.string().required(),
    enabled: a.boolean().required(),
    status: a.string().required(),
    createdAt: a.string().required(),
    isAdmin: a.boolean().required(),
  }),

  adminListUsers: a
    .query()
    .returns(a.ref('AdminUser').array())
    .authorization((allow) => [allow.group('Admins')])
    .handler(a.handler.function(adminUsersFn)),

  adminSetUserEnabled: a
    .mutation()
    .arguments({ username: a.string().required(), enabled: a.boolean().required() })
    .returns(a.boolean())
    .authorization((allow) => [allow.group('Admins')])
    .handler(a.handler.function(adminUsersFn)),

  adminDeleteUser: a
    .mutation()
    .arguments({ username: a.string().required() })
    .returns(a.boolean())
    .authorization((allow) => [allow.group('Admins')])
    .handler(a.handler.function(adminUsersFn)),

  adminSetUserAdmin: a
    .mutation()
    .arguments({ username: a.string().required(), isAdmin: a.boolean().required() })
    .returns(a.boolean())
    .authorization((allow) => [allow.group('Admins')])
    .handler(a.handler.function(adminUsersFn)),

  adminSetUserPassword: a
    .mutation()
    .arguments({ username: a.string().required(), password: a.string().required() })
    .returns(a.boolean())
    .authorization((allow) => [allow.group('Admins')])
    .handler(a.handler.function(adminUsersFn)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});
