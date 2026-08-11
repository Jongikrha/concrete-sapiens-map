import { defineAuth } from '@aws-amplify/backend';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['Admins'],
  senders: {
    email: {
      fromEmail: 'no-reply@concretesapiens.com',
      fromName: '콘크리트 사피엔스 지도',
    },
  },
});
