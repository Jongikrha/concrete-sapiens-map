import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

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
    })
    .authorization((allow) => [
      allow.guest().to(['create']),
      allow.authenticated('identityPool').to(['create']),
      allow.group('Admins').to(['read']),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});
