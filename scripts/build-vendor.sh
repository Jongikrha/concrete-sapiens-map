#!/usr/bin/env bash
# js/vendor/aws-amplify.bundle.js를 다시 만든다 — aws-amplify 버전을
# 올리거나(package.json dependencies) scripts/vendor-build/aws-amplify-entry.mjs의
# export 목록을 바꿨을 때만 실행하면 된다. 이 프로젝트는 "빌드 없는 정적
# 배포"가 원칙이라(amplify.yml 참고) 이 스크립트를 배포 파이프라인에 끼워
# 넣지 않는다 — 결과물(js/vendor/aws-amplify.bundle.js)을 직접 커밋해두고
# 배포 시엔 그냥 정적 파일로 서빙만 한다.
#
# process/global 등 Node 전용 전역을 참조하는 코드가 aws-amplify 안에
# 섞여 있어서(프레임워크 감지용 등) 브라우저에 없는 process를 --banner로
# 미리 채워 넣는다 — 안 하면 "process is not defined"로 조용히 죽는다
# (2026-09-08 확인).
set -euo pipefail
cd "$(dirname "$0")/.."

npx esbuild scripts/vendor-build/aws-amplify-entry.mjs \
  --bundle --format=esm --platform=browser --target=es2020 --minify \
  --define:process.env.NODE_ENV='"production"' \
  --banner:js="var process=globalThis.process||(globalThis.process={env:{}});" \
  --outfile=js/vendor/aws-amplify.bundle.js

echo "[build:vendor] js/vendor/aws-amplify.bundle.js 갱신 완료"
