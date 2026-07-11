import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../constants/config';
import { getDeviceId } from './deviceId';

export const BASE_URL = API_BASE_URL;

let refreshPromise: Promise<string | null> | null = null;

// refreshToken으로 accessToken 재발급
async function refreshAccessToken(): Promise<string | null> {
  try {
    const refreshToken = await AsyncStorage.getItem('refreshToken');
    if (!refreshToken) {
      console.log('⚠️ refreshToken 없음');
      return null;
    }

    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${refreshToken}`
      },
    });

    if (!response.ok) {
      console.log('❌ 토큰 재발급 실패:', response.status);
      // refreshToken도 만료된 경우 모두 삭제
      await AsyncStorage.multiRemove(['accessToken', 'refreshToken', 'user']);
      return null;
    }

    const data = await response.json();
    const newAccessToken = data.accessToken;
    
    // 새 accessToken 저장
    await AsyncStorage.setItem('accessToken', newAccessToken);
    console.log('✅ accessToken 재발급 성공');
    
    return newAccessToken;
  } catch (error) {
    console.error('토큰 재발급 오류:', error);
    return null;
  }
}

function getRefreshedAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
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
    AsyncStorage.getItem('accessToken'),
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
  console.log('🌐 API 요청 식별 정보:', {
    method: options.method ?? 'GET',
    url,
    deviceId: normalizedDeviceId,
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
  const newToken = await getRefreshedAccessToken();

  if (!newToken) {
    // 재발급 실패 - 로그아웃 처리 필요 (호출자가 처리)
    console.log('❌ 토큰 재발급 실패, 로그아웃 필요');
    return response; // 원래 401 응답 반환
  }

  // 원래 요청 재시도
  const retryHeaders: HeadersInit = {
    ...options.headers,
    'X-Device-Id': normalizedDeviceId,
    'Authorization': `Bearer ${newToken}`
  };

  return fetch(url, {
    ...options,
    headers: retryHeaders,
  });
}
