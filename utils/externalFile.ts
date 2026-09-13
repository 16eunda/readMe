// 외부 앱(파일 탐색기 등)에서 전달된 URL 판별과 지원 파일 형식 판정.
// 외부 파일 수신(app/_layout.tsx), 라우터 경로 변환(app/+native-intent.ts),
// 앱 내부 파일 추가(Home)가 같은 기준을 쓰도록 한 곳에 둔다.

const APP_SCHEME_PREFIX = "myreaderapp2://";

/**
 * 외부 파일 URL이면 실제로 읽을 수 있는 file:// 또는 content:// URL을 돌려준다.
 * 앱 내부 딥링크처럼 파일이 아닌 URL이면 null.
 */
export function toExternalFileUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  // 앱 스킴(myreaderapp2://)으로 온 content URI 복원
  // 예: myreaderapp2://media/external/file/1234 → content://media/external/file/1234
  if (url.startsWith(APP_SCHEME_PREFIX)) {
    const path = url.slice(APP_SCHEME_PREFIX.length);
    if (path.startsWith("media/") || path.startsWith("com.") || path.includes("/file/")) {
      return `content://${path}`;
    }
    // 일반 딥링크 (앱 내부 라우팅)
    return null;
  }

  if (url.startsWith("file://") || url.startsWith("content://")) return url;
  return null;
}

// 지원 형식 판정. 확장자가 없는 파일은 기존대로 TXT로 취급한다.
export function getFileExtension(name: string) {
  const index = String(name || "").lastIndexOf(".");
  return index > 0 ? String(name).slice(index).toLowerCase() : "";
}

export function isSupportedFileName(name: string) {
  const extension = getFileExtension(name);
  return extension === "" || extension === ".txt" || extension === ".epub";
}
