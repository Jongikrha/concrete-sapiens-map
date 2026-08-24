import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  AdminDeleteUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminSetUserPasswordCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';

// 실제 권한 경계는 AppSync @auth(allow.group('Admins'))다 — 이 Lambda는
// 그 뒤에서만 호출되므로 그룹 재확인은 하지 않는다. 다만 관리자가 자기
// 자신을 정지/삭제/강등해서 스스로 잠기는 사고는 여기서 막는다.
const ADMINS_GROUP = 'Admins';
const client = new CognitoIdentityProviderClient({});
const userPoolId = process.env.USER_POOL_ID as string;

function getAttribute(user: UserType, name: string): string | undefined {
  return user.Attributes?.find((a) => a.Name === name)?.Value;
}

async function listAdminUsernames(): Promise<Set<string>> {
  const names = new Set<string>();
  let nextToken: string | undefined;
  do {
    const res = await client.send(
      new ListUsersInGroupCommand({ UserPoolId: userPoolId, GroupName: ADMINS_GROUP, NextToken: nextToken })
    );
    (res.Users || []).forEach((u) => u.Username && names.add(u.Username));
    nextToken = res.NextToken;
  } while (nextToken);
  return names;
}

async function adminListUsers() {
  const adminUsernames = await listAdminUsernames();
  const users: UserType[] = [];
  let paginationToken: string | undefined;
  do {
    const res = await client.send(
      new ListUsersCommand({ UserPoolId: userPoolId, Limit: 60, PaginationToken: paginationToken })
    );
    users.push(...(res.Users || []));
    paginationToken = res.PaginationToken;
  } while (paginationToken);

  return users.map((u) => ({
    username: u.Username as string,
    userId: getAttribute(u, 'sub') || '',
    email: getAttribute(u, 'email') || u.Username || '',
    enabled: u.Enabled ?? true,
    status: u.UserStatus || 'UNKNOWN',
    createdAt: u.UserCreateDate ? u.UserCreateDate.toISOString() : '',
    isAdmin: adminUsernames.has(u.Username as string),
  }));
}

function assertNotSelf(callerUsername: string, targetUsername: string) {
  if (callerUsername === targetUsername) {
    throw new Error('자기 자신에게는 이 작업을 할 수 없습니다.');
  }
}

// Amplify의 function-directive 핸들러 이벤트는 aws-lambda 패키지가 정의하는
// "Direct Lambda Resolver"(event.info.fieldName) 형태가 아니라, fieldName/
// typeName/identity가 최상위에 바로 오는 형태다(실제 배포해서 CloudWatch
// 로그로 확인함, 2026-08-12). aws-lambda의 AppSyncResolverHandler 타입은
// 이 실제 모양과 안 맞아서 여기선 실제로 쓰는 필드만 최소한으로 타이핑한다.
type AdminUsersEvent = {
  fieldName: string;
  identity?: { username?: string };
  arguments: { username?: string; enabled?: boolean; isAdmin?: boolean; password?: string };
};

const handler = async (event: AdminUsersEvent) => {
  const field = event.fieldName;
  const callerUsername = event.identity?.username || '';
  const args = event.arguments;

  switch (field) {
    case 'adminListUsers':
      return adminListUsers();

    case 'adminSetUserEnabled': {
      const { username, enabled } = args;
      if (!username) throw new Error('username이 필요합니다.');
      assertNotSelf(callerUsername, username);
      await client.send(
        new (enabled ? AdminEnableUserCommand : AdminDisableUserCommand)({
          UserPoolId: userPoolId,
          Username: username,
        })
      );
      return true;
    }

    case 'adminDeleteUser': {
      const { username } = args;
      if (!username) throw new Error('username이 필요합니다.');
      assertNotSelf(callerUsername, username);
      await client.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
      return true;
    }

    case 'adminSetUserAdmin': {
      const { username, isAdmin } = args;
      if (!username) throw new Error('username이 필요합니다.');
      if (!isAdmin) assertNotSelf(callerUsername, username);
      const Command = isAdmin ? AdminAddUserToGroupCommand : AdminRemoveUserFromGroupCommand;
      await client.send(
        new Command({ UserPoolId: userPoolId, Username: username, GroupName: ADMINS_GROUP })
      );
      return true;
    }

    // SES 프로덕션 액세스가 반려된 동안의 계정 복구 창구다(2026-08-24).
    // 이 앱의 계정 복구 수단은 인증된 이메일 하나뿐인데, 재설정 코드 메일이
    // Cognito 공용 발신자로 나가면서 gmail에서 스팸으로 분류돼 사용자가
    // 사실상 복구를 못 하는 상황이 생겼다. 사용자가 직접 문의해 오면
    // 관리자가 임시 비밀번호를 정해 다른 경로로 전달하는 용도다.
    // permanent: true로 두는 이유 — false면 다음 로그인에서 Cognito가
    // NEW_PASSWORD_REQUIRED 챌린지를 띄우는데, js/auth.js의 로그인 흐름이
    // 이 챌린지를 처리하지 않아 오히려 로그인이 막힌다. 바로 쓸 수 있는
    // 비밀번호로 설정하고, 사용자가 로그인한 뒤 스스로 변경하게 한다.
    case 'adminSetUserPassword': {
      const { username, password } = args;
      if (!username) throw new Error('username이 필요합니다.');
      if (!password) throw new Error('password가 필요합니다.');
      // User Pool 정책과 같은 최소 길이. 여기서 먼저 막지 않으면 Cognito가
      // InvalidPasswordException을 던져 어드민 화면에 영문 에러가 그대로 뜬다.
      if (password.length < 8) throw new Error('비밀번호는 8자 이상이어야 합니다.');
      await client.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: userPoolId,
          Username: username,
          Password: password,
          Permanent: true,
        })
      );
      return true;
    }

    default:
      throw new Error(`알 수 없는 필드: ${field}`);
  }
};

export { handler };
