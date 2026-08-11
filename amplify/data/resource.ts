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
      allow.guest().to(['create', 'read', 'update']),
      allow.group('Admins'),
    ]),

  // 금칙어 목록 — 게스트는 작성 화면에서 체크할 수 있게 읽기만, 편집은 관리자만.
  BannedWord: a
    .model({
      word: a.string().required(),
    })
    .authorization((allow) => [allow.group('Admins'), allow.guest().to(['read'])]),

  // 방문 로그 — write-only 텔레메트리. 게스트는 쓰기만(자기가 남긴 것도 못 읽음),
  // 관리자만 읽는다.
  PageView: a
    .model({
      storyId: a.string(), // ?story=로 특정 기억을 보고 들어온 경우만 채움
    })
    .authorization((allow) => [allow.guest().to(['create']), allow.group('Admins').to(['read'])]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});
