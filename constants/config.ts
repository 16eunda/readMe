// API 주소는 코드에서 바꾸지 않는다. EXPO_PUBLIC_API_URL 로 받는다.
// - npm run android        → 값 없음 → 운영 서버
// - npm run android:local  → 로컬 백엔드 (에뮬레이터에서 본 내 Mac: 10.0.2.2:10000)
// - eas build              → eas.json 의 build 프로필 env 값 (운영 서버)
// 값이 없으면 운영 주소를 쓴다. 설정을 빠뜨려도 출시 빌드가 로컬 주소를 부르는 일은 없다.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "https://api.myreadmeapp.com";
