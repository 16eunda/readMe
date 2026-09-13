import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../constants/config';
import { getDeviceId } from './deviceId';
import { clearTokens, getToken, setToken } from './tokenStorage';

export const BASE_URL = API_BASE_URL;

// 인증 관련 요청은 응답이 없으면 앱이 로딩 화면에서 멈추므로 반드시 상한을 둔다.
const AUTH_REQUEST_TIMEOUT_MS = 10000;

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = AUTH_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 재발급 결과는 반드시 세 가지를 구분해야 한다.
// - refreshed:    새 accessToken 확보
// - unauthorized: 서버가 refreshToken을 명시적으로 거부 → 세션 종료가 확정된 상태
// - unavailable:  네트워크 오류/타임아웃/5xx → "아직 확인하지 못한" 상태.
//                 이 경우 토큰을 지우면 서버 장애나 오프라인 실행만으로 로그아웃된다.
export type RefreshOutcome =
  | { status: 'refreshed'; accessToken: string }
  | { status: 'unauthorized' }
  | { status: 'unavailable' };

// 세션이 확정적으로 끝났을 때 앱 전역 로그인 상태를 정리하기 위한 콜백.
// 저장소만 비우고 UserContext의 user state를 그대로 두면, 화면은 로그인 상태인데
// 실제 요청은 비회원으로 나가는 불일치가 발생한다.
let onAuthFailure: (() => void) | null = null;

export function setAuthFailureHandler(handler: (() => void) | null) {
  onAuthFailure = handler;
}

// 앱 전체에서 단 하나의 refresh 요청만 진행되도록 하는 공유 락.
// UserContext(앱 시작/백그라운드 복귀)와 authenticatedFetch(401 응답) 양쪽 모두
// 반드시 이 함수를 통해서만 재발급을 시도해야 한다. 각자 별도 재발급 로직을 두면
// 같은 refreshToken으로 동시에 두 번 재발급을 시도하게 되고, 서버가 refreshToken을
// 1회용으로 회전시키는 경우 둘 중 하나는 반드시 실패해 불필요한 로그아웃을 유발한다.
let refreshPromise: Promise<RefreshOutcome> | null = null;

// refreshToken으로 accessToken 재발급
async function requestRefresh(): Promise<RefreshOutcome> {
  const refreshToken = await getToken('refreshToken');
  if (!refreshToken) {
    console.log('⚠️ refreshToken 없음 → 재발급 불가');
    return { status: 'unauthorized' };
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${refreshToken}`,
      },
    });
  } catch (error) {
    // 네트워크 오류/타임아웃: 세션이 끝난 게 아니므로 토큰을 보존한다.
    console.log('⚠️ 토큰 재발급 실패(네트워크) - 토큰 유지:', error);
    return { status: 'unavailable' };
  }

  if (response.status === 401 || response.status === 403) {
    console.log('❌ refreshToken 거부됨 → 세션 종료');
    await clearTokens();
    await AsyncStorage.removeItem('user');
    return { status: 'unauthorized' };
  }

  if (!response.ok) {
    // 5xx 등 일시적 서버 오류: 토큰을 유지하고 다음 기회에 다시 시도한다.
    console.log('⚠️ 토큰 재발급 실패(status:', response.status, ') - 토큰 유지');
    return { status: 'unavailable' };
  }

  const data = await response.json().catch(() => null);
  const newAccessToken = data?.accessToken;
  if (typeof newAccessToken !== 'string' || !newAccessToken) {
    console.log('⚠️ 재발급 응답에 accessToken 없음 - 토큰 유지');
    return { status: 'unavailable' };
  }

  await setToken('accessToken', newAccessToken);

  // 백엔드가 재발급 때마다 refreshToken도 새로 준다(쓰는 동안 로그인 유지, 30일 슬라이딩).
  // 저장에 실패해도 기존 refreshToken은 만료일까지 유효하므로 재발급 자체를 실패로 보지 않는다.
  const newRefreshToken = data?.refreshToken;
  if (typeof newRefreshToken === 'string' && newRefreshToken) {
    try {
      await setToken('refreshToken', newRefreshToken);
    } catch (error) {
      console.log('⚠️ 새 refreshToken 저장 실패 - 기존 토큰 유지:', error);
    }
  }

  console.log('✅ accessToken 재발급 성공');
  return { status: 'refreshed', accessToken: newAccessToken };
}

export function getRefreshedAccessToken(): Promise<RefreshOutcome> {
  if (!refreshPromise) {
    refreshPromise = requestRefresh()
      // 저장소(Keychain/Keystore) 접근 실패 같은 예외는 "확인 불가"로 처리한다.
      // 여기서 reject되면 호출부(특히 AppState 리스너)가 통째로 깨진다.
      .catch((error) => {
        console.error('토큰 재발급 처리 오류:', error);
        return { status: 'unavailable' } as const;
      })
      .then((outcome) => {
        // 세션 종료가 확정된 경우에만 앱 전역 로그인 상태를 정리한다.
        if (outcome.status === 'unauthorized') onAuthFailure?.();
        return outcome;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// 인증이 필요한 API 요청 헬퍼
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {},
  deviceId?: string
): Promise<Response> {
  const [storedAccessToken, storedUser, resolvedDeviceId] = await Promise.all([
    getToken('accessToken'),
    AsyncStorage.getItem('user'),
    deviceId ? Promise.resolve(deviceId) : getDeviceId(),
  ]);
  // user 정보 없이 accessToken만 남아 있는 비정상 상태에서는 비회원 요청으로 처리한다.
  const accessToken = storedUser ? storedAccessToken : null;
  const normalizedDeviceId = String(resolvedDeviceId || '').trim();
  if (!normalizedDeviceId) {
    throw new Error(`deviceId 없이 API 요청을 보낼 수 없습니다: ${url}`);
  }
  
  // deviceId는 로그인 여부와 관계없이 항상 전송한다.
  // 로그인 사용자는 Authorization이 함께 전송되며, 비회원은 deviceId로 식별된다.
  const headers: HeadersInit = {
    ...options.headers,
    'X-Device-Id': normalizedDeviceId,
    ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
  };
  // deviceId 값은 비회원 데이터 접근 키이므로 로그에 남기지 않는다.
  console.log('🌐 API 요청 식별 정보:', {
    method: options.method ?? 'GET',
    url,
    authenticated: !!accessToken,
  });

  // 첫 요청
  let response = await fetch(url, {
    ...options,
    headers,
  });

  // 401이 아니면 바로 반환
  if (response.status !== 401) {
    return response;
  }

  console.log('🔄 401 감지, 토큰 재발급 시도');

  // 동시에 여러 요청이 401을 받아도 하나의 재발급 결과를 함께 기다린다.
  // 재발급이 확정적으로 실패한 경우(unauthorized)의 로그인 상태 정리는
  // getRefreshedAccessToken이 authFailureHandler로 한 번만 처리한다.
  const outcome = await getRefreshedAccessToken();

  if (outcome.status !== 'refreshed') {
    console.log('❌ 토큰 재발급 실패:', outcome.status);
    return response; // 원래 401 응답 반환 (재시도 루프를 만들지 않는다)
  }

  // 원래 요청 재시도
  const retryHeaders: HeadersInit = {
    ...options.headers,
    'X-Device-Id': normalizedDeviceId,
    'Authorization': `Bearer ${outcome.accessToken}`
  };

  return fetch(url, {
    ...options,
    headers: retryHeaders,
  });
}
