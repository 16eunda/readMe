import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { API_BASE_URL } from '../constants/config';
import { authenticatedFetch } from '../utils/api';
import { getDeviceId } from '../utils/deviceId';

type User = {
  userId: string;
  username: string;
  token: string;
} | null;

export type IncomingFile = {
  uri: string;
  name: string;
} | null;

type UserContextType = {
  user: User;
  deviceId: string | null;
  login: (userId: string, username: string, token: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
  incomingFile: IncomingFile;
  setIncomingFile: (file: IncomingFile) => void;
  isPremium: boolean;
  checkSubscription: () => Promise<boolean>;
  markPremiumRequired: () => Promise<void>;
};

const USER_KEY = 'user';

const UserContext = createContext<UserContextType>({
  user: null,
  deviceId: null,
  login: async () => {},
  logout: async () => {},
  isLoading: true,
  incomingFile: null,
  setIncomingFile: () => {},
  isPremium: false,
  checkSubscription: async () => false,
  markPremiumRequired: async () => {},
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const userRef = useRef<User>(null); // AppState 클로저에서 최신 user 값 읽기용

  // setUser + userRef 동시 업데이트
  const setUserSync = (u: User) => {
    userRef.current = u;
    setUser(u);
  };

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [incomingFile, setIncomingFile] = useState<IncomingFile>(null);
  const [isPremium, setIsPremium] = useState(false);

  // 구독 상태 확인 (서버에서 최신 상태 조회)
  const markPremiumRequired = useCallback(async () => {
    setIsPremium(false);
    await AsyncStorage.setItem('isPremium', 'false');
  }, []);

  const checkSubscription = useCallback(async (): Promise<boolean> => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/subscriptions/status`);
      if (response.ok) {
        const data = await response.json();
        const premium = data.isPremium ?? false;
        setIsPremium(premium);
        await AsyncStorage.setItem('isPremium', String(premium));
        return premium;
      } else {
        // 구독 상태를 확인하지 못하면 프리미엄 기능을 닫는 쪽이 안전하다.
        await markPremiumRequired();
        return false;
      }
    } catch {
      await markPremiumRequired();
      return false;
    }
  }, [markPremiumRequired]);

  // 앱 시작 시 저장된 로그인 정보와 디바이스 ID 로드
  useEffect(() => {
    loadUserData();
  }, []);

  // 백그라운드 복귀 시 토큰 체크
  useEffect(() => {
    let prevAppState = AppState.currentState;

    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      // background → active 전환일 때만 체크 (foreground → active 등 제외)
      const isReturningFromBackground =
        (prevAppState === 'background' || prevAppState === 'inactive') &&
        nextAppState === 'active';

      prevAppState = nextAppState;

      if (!isReturningFromBackground) return;

      console.log('📱 백그라운드에서 복귀 - 인증 상태 복구 시도');
      setIsLoading(true);
      try {
        const refreshToken = await AsyncStorage.getItem('refreshToken');
        if (refreshToken) {
          const newAccessToken = await refreshAccessToken(refreshToken);
          if (newAccessToken) {
            // user state 복원: 메모리에서 날아간 경우 AsyncStorage에서 다시 읽기
            const userData = await AsyncStorage.getItem(USER_KEY);
            if (userData) {
              const parsedUser = JSON.parse(userData);
              setUserSync({ ...parsedUser, token: newAccessToken });
              console.log('✅ 백그라운드 복귀 - 토큰 재발급 + user 상태 복원 완료');
            } else {
              const cur = userRef.current;
              if (cur) setUserSync({ ...cur, token: newAccessToken });
              console.log('✅ 백그라운드 복귀 - 토큰 재발급 완료');
            }
          } else {
            // 재발급 실패 - accessToken도 없으면 로그아웃
            const accessToken = await AsyncStorage.getItem('accessToken');
            if (!accessToken) {
              console.log('❌ accessToken도 없음 → 로그아웃');
              await logout();
            } else {
              // accessToken이 아직 살아있으면 user state만 복원 시도
              const userData = await AsyncStorage.getItem(USER_KEY);
              if (userData && !userRef.current) {
                setUserSync(JSON.parse(userData));
                console.log('⚠️ refreshToken 재발급 실패, 기존 accessToken + user 복원');
              } else {
                console.log('⚠️ refreshToken 재발급 실패, 기존 accessToken 유지');
              }
            }
          }
        } else {
          // refreshToken 없음 - accessToken + userData로 복원 시도
          const accessToken = await AsyncStorage.getItem('accessToken');
          const userData = await AsyncStorage.getItem(USER_KEY);
          if (accessToken && userData && !userRef.current) {
            setUserSync(JSON.parse(userData));
            console.log('✅ 백그라운드 복귀 - refreshToken 없지만 accessToken으로 user 복원');
          }
        }
        await checkSubscription();
      } finally {
        setIsLoading(false);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const loadUserData = async () => {
    try {
      // 1. 디바이스 ID 로드
      const id = await getDeviceId();
      setDeviceId(id);

      // 2. refreshToken으로 accessToken 재발급 시도
      const refreshToken = await AsyncStorage.getItem('refreshToken');
      console.log('🔐 앱 시작 인증 상태:', {
        hasRefreshToken: !!refreshToken,
      });
      if (refreshToken) {
        console.log('🔄 refreshToken 발견, accessToken 재발급 시도');
        const newAccessToken = await refreshAccessToken(refreshToken);
        
        if (newAccessToken) {
          // 재발급 성공 - 사용자 정보 로드
          const userData = await AsyncStorage.getItem(USER_KEY);
          if (userData) {
            const parsedUser = JSON.parse(userData);
            setUserSync({ ...parsedUser, token: newAccessToken });
            console.log('✅ 토큰 재발급 성공 + 로그인 복원');
            await checkSubscription();
            setIsLoading(false);
            return;
          }
        } else {
          // 재발급 실패 - 로그아웃 처리
          console.log('❌ 토큰 재발급 실패, 로그아웃 처리');
          await AsyncStorage.multiRemove([USER_KEY, 'accessToken', 'refreshToken']);
        }
      }

      // 3. refreshToken 없으면 기존 accessToken 체크
      const userData = await AsyncStorage.getItem(USER_KEY);
      const accessToken = await AsyncStorage.getItem('accessToken');
      console.log('🔐 저장 토큰/유저 존재 여부:', {
        hasUserData: !!userData,
        hasAccessToken: !!accessToken,
      });
      
      if (userData && accessToken) {
        // accessToken 유효성 검증
        try {
          const verifyRes = await fetch(`${API_BASE_URL}/auth/user/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (verifyRes.ok) {
            setUserSync(JSON.parse(userData));
            console.log('✅ 기존 로그인 정보 로드 (토큰 유효)');
            await checkSubscription();
          } else {
            // 토큰 만료 or 유효하지 않음 → 로그아웃
            console.log('❌ 저장된 accessToken 만료/무효 → 자동 로그아웃');
            await AsyncStorage.multiRemove([USER_KEY, 'accessToken', 'refreshToken', 'isPremium']);
          }
        } catch {
          // 네트워크 오류 시 일단 로그인 상태 유지
          setUserSync(JSON.parse(userData));
          console.log('⚠️ 토큰 검증 실패 (네트워크 오류), 기존 로그인 정보 유지');
          await checkSubscription();
        }
      }
    } catch (error) {
      console.error('사용자 데이터 로드 실패:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // refreshToken으로 accessToken 재발급
  const refreshAccessToken = async (refreshToken: string): Promise<string | null> => {
    try {
      console.log('🔄 accessToken 재발급 시도...');
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${refreshToken}`
        },
      });

      console.log('🔄 재발급 응답 status:', response.status);

      if (!response.ok) {
        const errorBody = await response.text();
        console.log('❌ 재발급 실패 body:', errorBody);
        return null;
      }

      const data = await response.json();
      console.log('🔄 재발급 응답 data keys:', Object.keys(data));
      const newAccessToken = data.accessToken;
      
      if (!newAccessToken) {
        console.log('❌ 응답에 accessToken 없음:', JSON.stringify(data));
        return null;
      }

      await AsyncStorage.setItem('accessToken', newAccessToken);
      console.log('✅ accessToken 재발급 성공');
      
      return newAccessToken;
    } catch (error) {
      console.error('토큰 재발급 오류:', error);
      return null;
    }
  };

  const login = async (userId: string, username: string, token: string) => {
    const newUser = { userId, username, token };
    setUserSync(newUser);
    
    await AsyncStorage.setItem(USER_KEY, JSON.stringify({ userId, username }));
    await AsyncStorage.setItem('accessToken', token);
    console.log('✅ 로그인 완료:', username);
    await checkSubscription();
  };

  const logout = async () => {
    setUserSync(null);
    setIsPremium(false);
    await AsyncStorage.multiRemove([USER_KEY, 'accessToken', 'refreshToken', 'isPremium']);
    console.log('✅ 로그아웃 완료');
  };

  return (
    <UserContext.Provider value={{ user, deviceId, login, logout, isLoading, incomingFile, setIncomingFile, isPremium, checkSubscription, markPremiumRequired }}>
      {children}
    </UserContext.Provider>
  );
}

// Hook으로 쉽게 사용
export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser는 UserProvider 안에서 사용해야 합니다');
  }
  return context;
}
