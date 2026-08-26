import { Redirect } from 'expo-router';

// 외부 파일 URL은 루트 레이아웃에서 한 번만 처리한다.
// 여기서 다시 복사하면 동일 인텐트가 중복 등록 흐름으로 전달될 수 있다.
export default function NotFound() {
  return <Redirect href="/(tabs)" />;
}
