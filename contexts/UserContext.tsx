import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { API_BASE_URL } from '../constants/config';
import {
  authenticatedFetch,
  fetchWithTimeout,
  getRefreshedAccessToken,
  setAuthFailureHandler,
} from '../utils/api';
import { getDeviceId } from '../utils/deviceId';
import {
  clearOrphanedTokensOnFreshInstall,
  clearTokens,
  getToken,
  setToken,
} from '../utils/tokenStorage';

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
const AUTH_VERIFY_TIMEOUT_MS = 10000;
const SUBSCRIPTION_REQUEST_TIMEOUT_MS = 10000;

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
  const isPremiumRef = useRef(false); // checkSubscription 실패 시 "직전 상태"를 읽기 위한 동기 참조

  const setIsPremiumSync = (premium: boolean) => {
    isPremiumRef.current = premium;
    setIsPremium(premium);
  };

  // 서버가 명시적으로 "프리미엄 아님"이라고 응답했을 때만 호출한다 (예: 403 PREMIUM_REQUIRED).
  const markPremiumRequired = useCallback(async () => {
    setIsPremiumSync(false);
    await AsyncStorage.setItem('isPremium', 'false');
  }, []);

  // 구독 상태 확인 (서버에서 최신 상태 조회)
  const checkSubscription = useCallback(async (): Promise<boolean> => {
    // 응답이 오지 않으면 앱 시작/복귀 흐름이 그대로 멈추므로 대기 시간에 상한을 둔다.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUBSCRIPTION_REQUEST_TIMEOUT_MS);
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/subscriptions/status`, {
        signal: controller.signal,
      });
      if (response.ok) {
        const data = await response.json();
        const premium = data.isPremium ?? false;
        setIsPremiumSync(premium);
        await AsyncStorage.setItem('isPremium', String(premium));
        return premium;
      }
      if (response.status === 401 || response.status === 403) {
        // 서버가 명시적으로 인증/권한을 거부한 경우에만 안전하게 무료로 전환한다.
        await markPremiumRequired();
        return false;
      }
      // 5xx 등 일시적 서버 오류: 구독이 없다는 뜻이 아니라 아직 확인을 못한 것이므로
      // 이미 프리미엄이던 사용자를 일시적 오류만으로 무료 사용자로 떨어뜨리지 않는다.
      // (실제 프리미엄 기능 접근 통제는 각 API가 호출 시점에 서버에서 다시 검증한다.)
      console.log('⚠️ 구독 상태 조회 실패(status:', response.status, ') - 기존 상태 유지:', isPremiumRef.current);
      return isPremiumRef.current;
    } catch {
      console.log('⚠️ 구독 상태 조회 실패(네트워크) - 기존 상태 유지:', isPremiumRef.current);
      return isPremiumRef.current;
    } finally {
      clearTimeout(timer);
    }
  }, [markPremiumRequired]);

  // 토큰 재발급이 확정적으로 거부되면(refreshToken 만료/무효) 앱의 로그인 상태도 함께 정리한다.
  // 저장소만 비워지고 user state가 남아 있으면, 화면은 로그인 상태인데 실제 요청은
  // 비회원(deviceId)으로 나가 다른 데이터가 보이는 불일치가 발생한다.
  useEffect(() => {
    setAuthFailureHandler(() => {
      console.log('🔒 인증 만료 감지 → 로그인 상태 정리');
      void logout();
    });
    return () => setAuthFailureHandler(null);
  }, []);

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
        const refreshToken = await getToken('refreshToken');
        if (refreshToken) {
          // getRefreshedAccessToken()은 authenticatedFetch의 401 처리와 같은 락을 공유한다.
          // 여기서 별도 재발급 요청을 만들면 같은 refreshToken으로 동시에 두 번 재발급을
          // 시도하게 되어(예: 포커스 복귀 직후 화면이 API를 호출하는 경우), 서버가
          // refreshToken을 1회용으로 회전시킬 때 불필요한 로그아웃을 유발할 수 있다.
          const outcome = await getRefreshedAccessToken();
          if (outcome.status === 'refreshed') {
            // user state 복원: 메모리에서 날아간 경우 AsyncStorage에서 다시 읽기
            const userData = await AsyncStorage.getItem(USER_KEY);
            if (userData) {
              const parsedUser = JSON.parse(userData);
              setUserSync({ ...parsedUser, token: outcome.accessToken });
              console.log('✅ 백그라운드 복귀 - 토큰 재발급 + user 상태 복원 완료');
            } else {
              const cur = userRef.current;
              if (cur) setUserSync({ ...cur, token: outcome.accessToken });
              console.log('✅ 백그라운드 복귀 - 토큰 재발급 완료');
            }
          } else if (outcome.status === 'unauthorized') {
            // 서버가 refreshToken을 거부한 경우에만 로그아웃한다.
            console.log('❌ refreshToken 만료/무효 → 로그아웃');
            await logout();
          } else {
            // 네트워크/서버 오류: 기존 세션을 유지하고, 메모리 상태만 복원한다.
            const userData = await AsyncStorage.getItem(USER_KEY);
            if (userData && !userRef.current) {
              setUserSync(JSON.parse(userData));
              console.log('⚠️ 재발급 보류(네트워크/서버 오류), 저장된 로그인 정보로 복원');
            } else {
              console.log('⚠️ 재발급 보류(네트워크/서버 오류), 기존 로그인 상태 유지');
            }
          }
        } else {
          // refreshToken 없음 - accessToken + userData로 복원 시도
          const accessToken = await getToken('accessToken');
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
      // 0. 재설치 직후라면 Keychain에 남아 있던 이전 설치의 토큰을 정리한다.
      await clearOrphanedTokensOnFreshInstall();

      // 1. 디바이스 ID 로드
      const id = await getDeviceId();
      setDeviceId(id);

      // 2. refreshToken으로 accessToken 재발급 시도
      let refreshUnavailable = false;
      const refreshToken = await getToken('refreshToken');
      console.log('🔐 앱 시작 인증 상태:', {
        hasRefreshToken: !!refreshToken,
      });
      if (refreshToken) {
        console.log('🔄 refreshToken 발견, accessToken 재발급 시도');
        // authenticatedFetch와 같은 재발급 락을 공유한다 (중복 재발급 방지).
        const outcome = await getRefreshedAccessToken();

        if (outcome.status === 'refreshed') {
          // 재발급 성공 - 사용자 정보 로드
          const userData = await AsyncStorage.getItem(USER_KEY);
          if (userData) {
            const parsedUser = JSON.parse(userData);
            setUserSync({ ...parsedUser, token: outcome.accessToken });
            console.log('✅ 토큰 재발급 성공 + 로그인 복원');
            await checkSubscription();
            setIsLoading(false);
            return;
          }
        } else if (outcome.status === 'unauthorized') {
          // 서버가 refreshToken을 명시적으로 거부한 경우에만 세션을 정리한다.
          console.log('❌ refreshToken 만료/무효 → 로그아웃 처리');
          await clearTokens();
          await AsyncStorage.multiRemove([USER_KEY, 'isPremium']);
        } else {
          // 네트워크 오류/타임아웃/서버 장애: 세션이 끝난 게 아니다.
          // 토큰을 지우지 않고 아래 3단계에서 저장된 정보로 오프라인 복원을 시도한다.
          // (여기서 토큰을 지우면 비행기 모드로 앱을 한 번 켠 것만으로 로그아웃된다.)
          refreshUnavailable = true;
          console.log('⚠️ 토큰 재발급 보류(네트워크/서버 오류) - 저장된 로그인 정보 유지');
        }
      }

      // 3. refreshToken 없으면 기존 accessToken 체크
      const userData = await AsyncStorage.getItem(USER_KEY);
      const accessToken = await getToken('accessToken');
      console.log('🔐 저장 토큰/유저 존재 여부:', {
        hasUserData: !!userData,
        hasAccessToken: !!accessToken,
      });

      if (userData && refreshUnavailable) {
        // 방금 네트워크/서버 문제로 재발급을 확인하지 못한 상태다.
        // 여기서 accessToken을 다시 검증해봐야 이미 만료된 토큰이라 401이 날 뿐이고,
        // 그 401로 로그아웃하면 아직 유효할 수 있는 refreshToken까지 버리게 된다.
        // 저장된 정보로 복원해 두고, 다음 재발급 기회(화면 복귀/다음 401)에 회복시킨다.
        setUserSync(JSON.parse(userData));
        console.log('⚠️ 재발급 보류 상태 - 저장된 로그인 정보로 복원');
        await checkSubscription();
      } else if (userData && accessToken) {
        // accessToken 유효성 검증
        try {
          const verifyRes = await fetchWithTimeout(
            `${API_BASE_URL}/auth/user/me`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
            AUTH_VERIFY_TIMEOUT_MS,
          );
          if (verifyRes.ok) {
            setUserSync(JSON.parse(userData));
            console.log('✅ 기존 로그인 정보 로드 (토큰 유효)');
            await checkSubscription();
          } else if (verifyRes.status === 401 || verifyRes.status === 403) {
            // 서버가 명시적으로 거부한 경우에만 로그아웃한다.
            console.log('❌ 저장된 accessToken 만료/무효 → 자동 로그아웃');
            await clearTokens();
            await AsyncStorage.multiRemove([USER_KEY, 'isPremium']);
          } else {
            // 5xx 등 서버 장애를 로그아웃으로 처리하지 않는다.
            setUserSync(JSON.parse(userData));
            console.log('⚠️ 토큰 검증 보류(status:', verifyRes.status, ') - 기존 로그인 정보 유지');
            await checkSubscription();
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

  const login = async (userId: string, username: string, token: string) => {
    // 저장소를 먼저 채운 뒤 state를 바꾼다.
    // state가 먼저 바뀌면 그 변화를 감지한 화면이 재조회를 시작할 수 있는데,
    // 그 시점에 아직 토큰이 저장되지 않았다면 그 요청은 비회원으로 나간다.
    await AsyncStorage.setItem(USER_KEY, JSON.stringify({ userId, username }));
    await setToken('accessToken', token);
    setUserSync({ userId, username, token });
    console.log('✅ 로그인 완료:', username);
    await checkSubscription();
  };

  const logout = async () => {
    // 저장소를 먼저 비운 뒤 state를 바꾼다.
    // 순서가 반대면, 로그아웃을 감지한 화면이 재조회를 시작하는 시점에 토큰이 아직 남아 있어
    // 이전 사용자의 데이터를 받아와 로그아웃된 화면에 그대로 보여줄 수 있다.
    try {
      await clearTokens();
      await AsyncStorage.multiRemove([USER_KEY, 'isPremium']);
    } catch (error) {
      // 저장소 정리에 실패하더라도 화면 상태는 반드시 로그아웃으로 되돌린다.
      console.error('로그아웃 저장소 정리 실패:', error);
    }
    setUserSync(null);
    setIsPremiumSync(false);
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
