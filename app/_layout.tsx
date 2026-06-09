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
import { getExternalFileDisplayName } from '../modules/external-file-info/src';

export const unstable_settings = {
  anchor: '(tabs)',
};

const getSupportedFileNameFromUrl = (url: string) => {
  const decoded = decodeURIComponent(url.split('?')[0]);
  const lastSegment = decoded.split('/').pop() || '';
  const cleanName = lastSegment.trim();
  return /\.(txt|epub)$/i.test(cleanName) ? cleanName : null;
};

const getFileExtensionFromUri = async (uri: string) => {
  try {
    const base64Start = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64Start.startsWith('UEsD') || base64Start.startsWith('UEs') ? '.epub' : '.txt';
  } catch (e) {
    const info = await FileSystem.getInfoAsync(uri).catch(() => null);
    const fileSize = info && 'size' in info ? ((info as any).size ?? 0) : 0;
    return fileSize > 1024 * 100 ? '.epub' : '.txt';
  }
};

const normalizeSupportedFileName = (name: string | null | undefined, ext: string) => {
  const cleanName = (name || '').trim().replace(/[\\/]/g, '_');
  if (!cleanName) return null;
  if (/\.(txt|epub)$/i.test(cleanName)) return cleanName;
  return `${cleanName}${ext}`;
};

const makeExternalFileName = (sourceUrl: string, ext: string, displayName?: string | null) => {
  const nativeName = normalizeSupportedFileName(displayName, ext);
  if (nativeName) return nativeName;

  const urlName = normalizeSupportedFileName(getSupportedFileNameFromUrl(sourceUrl), ext);
  if (urlName) return urlName;

  const decoded = decodeURIComponent(sourceUrl.split('?')[0]);
  const lastSegment = decoded.split('/').pop() || '';
  const id = lastSegment.replace(/[^a-zA-Z0-9_-]/g, '');
  const suffix = id ? `_${id}` : `_${Date.now()}`;
  return `external${suffix}${ext}`;
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
          // 일반 �ープ링크 (앱 내부 라우팅) → 처리 안 함
          return;
        }
      }

      // 파일 열기 URL인지 확인 (file:// 또는 content://)
      const isFileUrl = normalizedUrl.startsWith('file://') || normalizedUrl.startsWith('content://');
      if (!isFileUrl) return;

      let name = 'unknown';
      let finalUri = '';

      try {
        const cacheDir = FileSystem.cacheDirectory ?? '';
        
        if (normalizedUrl.startsWith('content://')) {
          // content URI는 제공자에 따라 원본 파일명이 없을 수 있으므로 먼저 복사 후 타입을 판별한다.
          const tempName = 'temp_' + Date.now();
          const tempUri = cacheDir + tempName;
          
          // 캐시에 임시 복사
          await FileSystem.copyAsync({ from: normalizedUrl, to: tempUri });
          console.log('✅ 임시 복사 완료:', tempUri);

          const ext = await getFileExtensionFromUri(tempUri);
          const displayName = await getExternalFileDisplayName(normalizedUrl);
          name = makeExternalFileName(normalizedUrl, ext, displayName);
          finalUri = cacheDir + name;
          
          // 임시 파일을 최종 이름으로 이동
          const existingInfo = await FileSystem.getInfoAsync(finalUri);
          if (existingInfo.exists) {
            await FileSystem.deleteAsync(finalUri, { idempotent: true });
          }
          await FileSystem.moveAsync({ from: tempUri, to: finalUri });
          console.log('✅ 파일명 판별 완료:', name);
        } else {
          // file:// URI: 파일명 직접 추출
          const urlName = getSupportedFileNameFromUrl(normalizedUrl);
          
          // 확장자가 없거나 지원되지 않으면 거절
          if (!urlName) {
            console.log('⚠️ 지원되지 않는 파일:', normalizedUrl);
            return;
          }
          name = urlName;
          
          finalUri = cacheDir + name;
          
          // 캐시에 복사
          const existingInfo = await FileSystem.getInfoAsync(finalUri);
          if (existingInfo.exists) {
            await FileSystem.deleteAsync(finalUri, { idempotent: true });
          }
          await FileSystem.copyAsync({ from: normalizedUrl, to: finalUri });
          console.log('✅ 파일 복사 완료:', finalUri);
        }

        console.log('📂 외부 파일 수신 완료:', name);
        setIncomingFile({ uri: finalUri, name });
        router.replace('/(tabs)' as any);
      } catch (e) {
        console.error('❌ 외부 파일 처리 실패:', e);
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
