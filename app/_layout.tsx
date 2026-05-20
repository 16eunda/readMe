import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as FileSystem from 'expo-file-system/legacy';
import * as Linking from 'expo-linking';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { UserProvider, useUser } from '../contexts/UserContext';

export const unstable_settings = {
  anchor: '(tabs)',
};

// UserProvider 안에서 실행되는 컴포넌트 (useUser 사용 가능)
function AppContent() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const { setIncomingFile } = useUser();

  useEffect(() => {
    const processIncomingUrl = async (url: string | null) => {
      if (!url) return;

      console.log('🔗 수신 URL:', url);

      // 앱 스킴(myreaderapp2://)으로 온 content URI 복원
      // 예: myreaderapp2://media/external/file/1234 → content://media/external/file/1234
      let normalizedUrl = url;
      if (url.startsWith('myreaderapp2://')) {
        const path = url.replace('myreaderapp2://', '');
        // 파일 경로 패턴이면 content://로 변환
        if (path.startsWith('media/') || path.startsWith('com.') || path.includes('/file/')) {
          normalizedUrl = 'content://' + path;
          console.log('🔄 content URI 복원:', normalizedUrl);
        } else {
          // 일반 딥링크 (앱 내부 라우팅) → 처리 안 함
          return;
        }
      }

      // deep link가 아닌 파일 열기 URL인지 확인 (file:// 또는 content://)
      const isFileUrl = normalizedUrl.startsWith('file://') || normalizedUrl.startsWith('content://');
      if (!isFileUrl) return;

      // 파일명 추출 (content URI는 숫자 ID일 수 있으므로 별도 처리)
      const decoded = decodeURIComponent(normalizedUrl);
      let name = decoded.split('/').pop() || 'unknown';

      // content://media/... 같이 파일명에 확장자가 없는 경우 → 확장자 체크 스킵 후 처리 시도
      const hasExtension = name.endsWith('.txt') || name.endsWith('.epub');
      // 확장자 없는 숫자 ID인 경우 일단 시도 (복사 후 실제 파일 내용으로 판단)
      const isMediaContentUri = normalizedUrl.startsWith('content://media/');

      // .txt 또는 .epub 파일만 처리 (단, content://media/ URI는 확장자 없어도 허용)
      if (!hasExtension && !isMediaContentUri) return;

      // content URI에서 확장자 없으면 임시로 epub로 시도 (나중에 실제 파일로 판단)
      if (!hasExtension) name = name + '.epub';

      console.log('📂 외부 파일 수신:', name);

      // 앱 캐시 디렉토리로 즉시 복사
      // iOS: 임시 접근권한이 만료되기 전에 복사해야 함
      const destUri = (FileSystem.cacheDirectory ?? '') + name;
      try {
        // 같은 이름의 파일이 이미 캐시에 있으면 덮어쓰기
        const existingInfo = await FileSystem.getInfoAsync(destUri);
        if (existingInfo.exists) {
          await FileSystem.deleteAsync(destUri, { idempotent: true });
        }

        await FileSystem.copyAsync({ from: normalizedUrl, to: destUri });
        console.log('✅ 외부 파일 캐시 복사 완료:', destUri);

        setIncomingFile({ uri: destUri, name });

        // 홈 탭으로 이동 (index.tsx에서 파일 처리)
        router.replace('/(tabs)' as any);
      } catch (e) {
        console.error('❌ 외부 파일 복사 실패:', e);
      }
    };

    // 앱이 종료된 상태에서 파일로 열린 경우 (cold start)
    Linking.getInitialURL().then(processIncomingUrl);

    // 앱이 백그라운드에 있다가 파일로 열린 경우
    const subscription = Linking.addEventListener('url', ({ url }) => {
      processIncomingUrl(url);
    });

    return () => subscription.remove();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="subscription" options={{ headerShown: false }} />
        <Stack.Screen name="reader" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,        // 30초 내에는 캐시 반환 (네트워크 요청 안 함)
        gcTime: 5 * 60 * 1000,       // 5분간 메모리에 보관
        refetchOnWindowFocus: true,   // 포커스 복귀 시 stale이면 백그라운드 재조회
        retry: 1,
      },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <UserProvider>
          <AppContent />
        </UserProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
