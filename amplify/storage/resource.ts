import { defineStorage } from '@aws-amplify/backend';

// 기억 첨부 사진(1장) 전용 버킷. Story 모델과 마찬가지로 게스트도 쓰기/읽기가
// 가능해야 한다 — 로그인 없이 글을 쓰는 게 기본 경로이고, 지도의 모든 방문자가
// 사진을 볼 수 있어야 하기 때문(allow.guest 읽기는 Story의 guest read 정책과
// 동일한 이유). 경로에 사용자 identity를 넣지 않고 story-photos/ 하나로 두는
// 이유도 같다 — 사진은 "내 것"이 아니라 지도에 공개되는 콘텐츠라 본인 소유
// 스코프로 나눌 필요가 없다(작성자 판정 자체를 이 경로로 하지 않음,
// [[feedback_identity_never_device_based]] 참고 — 어차피 이 버킷 접근권한은
// 신원 판정에 안 쓴다).
// 삭제(delete)는 일부러 아무 역할에도 주지 않는다 — 신고 처리는 Story.status를
// HIDDEN으로 바꾸는 것으로 충분하고(js/admin.js hideStory 패턴), 사진 실물을
// 지우는 기능은 지금 범위 밖이라 만들지 않는다(YAGNI).
export const storage = defineStorage({
  name: 'concreteSapiensMapPhotos',
  access: (allow) => ({
    'story-photos/*': [
      allow.guest.to(['read', 'write']),
      allow.authenticated.to(['read', 'write']),
      allow.groups(['Admins']).to(['read', 'write']),
    ],
  }),
});
