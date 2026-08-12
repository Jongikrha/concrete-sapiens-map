import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  AdminDeleteUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
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
  arguments: { username?: string; enabled?: boolean; isAdmin?: boolean };
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

    default:
      throw new Error(`알 수 없는 필드: ${field}`);
  }
};

export { handler };
