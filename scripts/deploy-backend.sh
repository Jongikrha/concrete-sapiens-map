#!/usr/bin/env bash
# 백엔드(Cognito/AppSync) 스키마를 prod에 배포하고, amplify_outputs.json이
# 바뀌면 커밋 + push까지 한 번에 처리한다.
#
# amplify.yml이 빌드를 스킵하는 정적 배포라, amplify/*.ts 스키마 변경은
# 이 스크립트를 거치지 않으면 라이브 사이트에 반영되지 않는다 — 프론트
# 코드가 먼저 push되면 배포된 스키마와 어긋나서 사이트가 깨질 수 있다.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[deploy] origin 최신 상태 확인..."
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "[deploy] main이 origin/main보다 뒤처져 있습니다. 먼저 반영하세요: git pull --ff-only origin main" >&2
  exit 1
fi

echo "[deploy] prod 백엔드 배포 중 (ampx sandbox --once --identifier prod)..."
npx ampx sandbox --once --identifier prod --profile todoc

if git diff --quiet -- amplify_outputs.json; then
  echo "[deploy] 백엔드 변경 없음 — amplify_outputs.json 그대로, 커밋 안 함."
  exit 0
fi

echo "[deploy] amplify_outputs.json 변경 감지 — 커밋 후 push"
git add amplify_outputs.json
git commit -m "[fix] prod 백엔드 스키마 배포 반영 (amplify_outputs.json 갱신)"
git push origin main
echo "[deploy] 완료"
