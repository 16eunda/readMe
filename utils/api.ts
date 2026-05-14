import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const getBaseURL = () => {
  if (Platform.OS === "web") {
    return "http://localhost:8080";
  } else {
    return "https://readme-backend-2.onrender.com";
  }
};

export const BASE_URL = getBaseURL();

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

// 토큰 재발급 대기자 추가
function subscribeTokenRefresh(callback: (token: string) => void) {
  refreshSubscribers.push(callback);
}

// 재발급 완료 시 모든 대기 요청 재개
function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach(callback => callback(token));
  refreshSubscribers = [];
}

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

// 인증이 필요한 API 요청 헬퍼
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {},
  deviceId?: string
): Promise<Response> {
  const accessToken = await AsyncStorage.getItem('accessToken');
  
  // 헤더 구성
  const headers: HeadersInit = {
    ...options.headers,
    ...(deviceId && { 'X-Device-Id': deviceId }),
    ...(accessToken && { 'Authorization': `Bearer ${accessToken}` })
  };

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

  // 이미 재발급 중이면 대기
  if (isRefreshing) {
    return new Promise((resolve) => {
      subscribeTokenRefresh(async (newToken: string) => {
        // 새 토큰으로 재요청
        const retryHeaders: HeadersInit = {
          ...options.headers,
          ...(deviceId && { 'X-Device-Id': deviceId }),
          'Authorization': `Bearer ${newToken}`
        };
        
        const retryResponse = await fetch(url, {
          ...options,
          headers: retryHeaders,
        });
        resolve(retryResponse);
      });
    });
  }

  // 재발급 시작
  isRefreshing = true;
  const newToken = await refreshAccessToken();
  isRefreshing = false;

  if (!newToken) {
    // 재발급 실패 - 로그아웃 처리 필요 (호출자가 처리)
    console.log('❌ 토큰 재발급 실패, 로그아웃 필요');
    return response; // 원래 401 응답 반환
  }

  // 대기 중인 요청들에게 새 토큰 전달
  onTokenRefreshed(newToken);

  // 원래 요청 재시도
  const retryHeaders: HeadersInit = {
    ...options.headers,
    ...(deviceId && { 'X-Device-Id': deviceId }),
    'Authorization': `Bearer ${newToken}`
  };

  return fetch(url, {
    ...options,
    headers: retryHeaders,
  });
}
