import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { API_BASE_URL } from '../constants/config';
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
  checkSubscription: () => Promise<void>;
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
  checkSubscription: async () => {},
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [incomingFile, setIncomingFile] = useState<IncomingFile>(null);
  const [isPremium, setIsPremium] = useState(false);

  // 구독 상태 확인 (서버에서 최신 상태 조회)
  const checkSubscription = async () => {
    try {
      const token = await AsyncStorage.getItem('accessToken');
      if (!token) {
        setIsPremium(false);
        return;
      }
      const response = await fetch(`${API_BASE_URL}/subscriptions/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const premium = data.isPremium ?? false;
        setIsPremium(premium);
        await AsyncStorage.setItem('isPremium', String(premium));
      } else {
        // API 미구현 or 오류 시 캐시 사용
        const cached = await AsyncStorage.getItem('isPremium');
        setIsPremium(cached === 'true');
      }
    } catch {
      // 네트워크 오류 시 캐시 사용
      const cached = await AsyncStorage.getItem('isPremium');
      setIsPremium(cached === 'true');
    }
  };

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

      console.log('📱 백그라운드에서 복귀');
      const refreshToken = await AsyncStorage.getItem('refreshToken');
      if (refreshToken) {
        const newAccessToken = await refreshAccessToken(refreshToken);
        if (newAccessToken) {
          setUser(prev => prev ? { ...prev, token: newAccessToken } : null);
        } else {
          // 재발급 실패해도 바로 로그아웃 X → accessToken이 아직 유효할 수 있음
          const accessToken = await AsyncStorage.getItem('accessToken');
          if (!accessToken) {
            console.log('❌ accessToken도 없음 → 로그아웃');
            await logout();
          } else {
            console.log('⚠️ refreshToken 재발급 실패, 기존 accessToken 유지');
          }
        }
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
      if (refreshToken) {
        console.log('🔄 refreshToken 발견, accessToken 재발급 시도');
        const newAccessToken = await refreshAccessToken(refreshToken);
        
        if (newAccessToken) {
          // 재발급 성공 - 사용자 정보 로드
          const userData = await AsyncStorage.getItem(USER_KEY);
          if (userData) {
            const parsedUser = JSON.parse(userData);
            setUser({ ...parsedUser, token: newAccessToken });
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
      
      if (userData && accessToken) {
        // accessToken 유효성 검증
        try {
          const verifyRes = await fetch(`${API_BASE_URL}/auth/user/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (verifyRes.ok) {
            setUser(JSON.parse(userData));
            console.log('✅ 기존 로그인 정보 로드 (토큰 유효)');
            await checkSubscription();
          } else {
            // 토큰 만료 or 유효하지 않음 → 로그아웃
            console.log('❌ 저장된 accessToken 만료/무효 → 자동 로그아웃');
            await AsyncStorage.multiRemove([USER_KEY, 'accessToken', 'refreshToken', 'isPremium']);
          }
        } catch {
          // 네트워크 오류 시 일단 로그인 상태 유지
          setUser(JSON.parse(userData));
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
    setUser(newUser);
    
    // AsyncStorage에 저장 (앱 재시작해도 유지)
    // 참고: token은 accessToken을 의미 (향후 refreshToken도 별도 저장 가능)
    await AsyncStorage.setItem(USER_KEY, JSON.stringify({ userId, username }));
    await AsyncStorage.setItem('accessToken', token);
    console.log('✅ 로그인 완료:', username);
    await checkSubscription();
  };

  const logout = async () => {
    setUser(null);
    setIsPremium(false);
    await AsyncStorage.multiRemove([USER_KEY, 'accessToken', 'refreshToken', 'isPremium']);
    console.log('✅ 로그아웃 완료');
  };

  return (
    <UserContext.Provider value={{ user, deviceId, login, logout, isLoading, incomingFile, setIncomingFile, isPremium, checkSubscription }}>
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
