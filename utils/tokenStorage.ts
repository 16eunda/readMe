import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// accessToken/refreshToken은 계정 탈취로 직결되는 민감 정보이므로
// (구) AsyncStorage(평문 저장) 대신 기기 Keychain/Keystore 기반 SecureStore에 저장한다.
export const ACCESS_TOKEN_KEY = 'accessToken';
export const REFRESH_TOKEN_KEY = 'refreshToken';

type TokenKey = typeof ACCESS_TOKEN_KEY | typeof REFRESH_TOKEN_KEY;

// 기존 버전에서 AsyncStorage에 평문 저장돼 있던 토큰을 SecureStore로 1회 이전한다.
async function migrateFromAsyncStorage(key: TokenKey): Promise<string | null> {
  const legacyValue = await AsyncStorage.getItem(key);
  if (legacyValue == null) return null;

  await SecureStore.setItemAsync(key, legacyValue);
  await AsyncStorage.removeItem(key);
  return legacyValue;
}

export async function getToken(key: TokenKey): Promise<string | null> {
  const value = await SecureStore.getItemAsync(key);
  if (value != null) return value;
  return migrateFromAsyncStorage(key);
}

export async function setToken(key: TokenKey, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

// iOS Keychain은 앱을 삭제해도 내용이 남기 때문에, 재설치하면 이전 설치의 토큰이
// 그대로 되살아난다. AsyncStorage는 앱 삭제 시 함께 지워지므로 여기에 설치 표식을 두고,
// 표식이 없는데 이전 세션 흔적도 전혀 없으면 "재설치"로 보고 Keychain을 정리한다.
const INSTALL_MARKER_KEY = '@auth_install_marker';

export async function clearOrphanedTokensOnFreshInstall(): Promise<void> {
  const [marker, legacyUser, legacyAccessToken, legacyRefreshToken] = await Promise.all([
    AsyncStorage.getItem(INSTALL_MARKER_KEY),
    AsyncStorage.getItem('user'),
    AsyncStorage.getItem(ACCESS_TOKEN_KEY),
    AsyncStorage.getItem(REFRESH_TOKEN_KEY),
  ]);

  if (marker) return;
  await AsyncStorage.setItem(INSTALL_MARKER_KEY, '1');

  // 구버전(AsyncStorage 평문 저장)에서 업데이트된 경우에는 기존 세션을 그대로 살려야 하므로
  // 아무것도 지우지 않는다. getToken()이 SecureStore로 이전해 준다.
  if (legacyUser || legacyAccessToken || legacyRefreshToken) return;

  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    // 과거 버전이 남겨뒀을 수 있는 평문 토큰도 함께 정리한다.
    AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY]),
  ]);
}
