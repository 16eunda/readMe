import { toExternalFileUrl } from '../utils/externalFile';

// 파일 탐색기에서 "이 앱으로 열기"로 전달된 file:// / content:// URL은 화면 경로가 아니다.
// expo-router가 이 URL을 경로로 해석하면 +not-found → /(tabs)로 화면을 한 겹 더 쌓아
// Home이 중복 마운트되고, 열려 있던 Reader는 위치를 저장하기 전에 포커스를 잃는다.
// 외부 파일은 app/_layout.tsx 한 곳에서만 처리하므로 라우터는 이동하지 않게 한다.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    if (toExternalFileUrl(path)) {
      // 최초 실행은 기본 화면(Home)에서 시작하고, 실행 중 수신은 현재 화면을 유지한다.
      return initial ? '/' : '';
    }
  } catch {
    // 경로 판별 실패가 앱 시작을 막으면 안 된다.
  }
  return path;
}
