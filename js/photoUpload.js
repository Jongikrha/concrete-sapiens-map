// ============================================================
// 기억 첨부 사진 — 리사이즈 + 업로드 (2026-09-01 도입)
// ============================================================
// 빌드 도구가 없는 정적 사이트라 리사이즈는 브라우저 Canvas API로 직접
// 처리한다. 원본을 그대로 올리면 스마트폰 사진(수 MB~십수 MB)이 그대로
// S3에 쌓여 비용/로딩 속도에 불리해서, 긴 변 기준 PHOTO_MAX_DIMENSION으로
// 줄이고 JPEG로 재인코딩해서 올린다.
//
// 실제 업로드/URL 생성 함수(uploadData/getUrl)는 js/backend.js(ES 모듈)가
// window._storageReady(Promise)로 넘겨준다 — storage.js/auth.js와 같은 이유로
// 이 파일도 import 없는 클래식 스크립트로 남긴다.

const PHOTO_MAX_DIMENSION = 1600;
const PHOTO_JPEG_QUALITY = 0.82;
// getUrl() 기본 만료는 900초(15분) — 기억 아카이브를 오래 열어두고 여러 글을
// 둘러보다 보면 그 안에 만료돼서 깨진 이미지로 뜨는 게 실제로 발생했다
// (2026-09-01 확인). js/storySheet.js가 photoKey별로 URL을 세션 동안 캐싱해
// 재사용하는 것과 맞물려 한 번 만료되면 새로고침 전까진 계속 깨져 보인다.
// Cognito Identity Pool 게스트 임시자격증명 유효기간(기본 1시간)보다 길게
// 잡아도 어차피 그 안에서 잘리니, 1시간으로 넉넉히 늘린다.
const PHOTO_URL_EXPIRES_SECONDS = 3600;

const PhotoUpload = {
  URL_EXPIRES_SECONDS: PHOTO_URL_EXPIRES_SECONDS,

  // File -> 리사이즈된 JPEG Blob. HEIC 등 브라우저가 <img>로 못 그리는
  // 포맷이면 reject한다(호출부가 안내 문구를 보여준다).
  resizeImageFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const scale = Math.min(1, PHOTO_MAX_DIMENSION / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("사진을 처리할 수 없어요."))),
          "image/jpeg",
          PHOTO_JPEG_QUALITY
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("사진을 읽을 수 없어요."));
      };
      img.src = objectUrl;
    });
  },

  // 리사이즈된 Blob을 story-photos/ 아래 publicId 기반 키로 업로드하고
  // S3 키를 돌려준다(amplify/storage/resource.ts의 경로 규칙과 맞춤).
  async upload(blob, publicId) {
    const { uploadData } = await window._storageReady;
    const key = `story-photos/${publicId}-${Date.now()}.jpg`;
    const task = uploadData({ path: key, data: blob, options: { contentType: "image/jpeg" } });
    await task.result;
    return key;
  },

  // 저장된 photoKey로 표시용 URL을 만든다 — presigned URL이라 저장해두고
  // 재사용할 수 없어(만료됨) 화면에 그릴 때마다 새로 만든다(Story.photoKey만
  // 저장하는 이유, amplify/data/resource.ts 참고).
  async getUrl(key) {
    const { getUrl } = await window._storageReady;
    const result = await getUrl({ path: key, options: { expiresIn: PHOTO_URL_EXPIRES_SECONDS } });
    return result.url.toString();
  },
};
