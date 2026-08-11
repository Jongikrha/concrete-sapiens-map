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
    })
    .authorization((allow) => [allow.guest().to(['create', 'read', 'update'])]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'identityPool',
  },
});
