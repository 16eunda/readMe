import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { File as ExpoFile, type FileHandle } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as Linking from 'expo-linking';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { UserProvider, useUser } from '../contexts/UserContext';
import {
  claimExternalFileIntent,
  clearExternalFileIntent,
  getCurrentExternalIntentInfo,
  getExternalFileDisplayName,
} from '../modules/external-file-info/src';
import { isSupportedFileName, toExternalFileUrl } from '../utils/externalFile';
import { flushActiveReaderSession, getActiveReaderSessionFileId } from '../utils/readerLifecycle';

const ACTIVE_READER_SESSION_KEY = '@active_reader_session';

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
  let handle: FileHandle | null = null;
  try {
    handle = new ExpoFile(uri).open();
    const signature = handle.readBytes(4);
    const isZip = signature.length >= 4
      && signature[0] === 0x50
      && signature[1] === 0x4b
      && (
        (signature[2] === 0x03 && signature[3] === 0x04)
        || (signature[2] === 0x05 && signature[3] === 0x06)
        || (signature[2] === 0x07 && signature[3] === 0x08)
      );
    return isZip ? '.epub' : '.txt';
  } catch {
    return '.txt';
  } finally {
    handle?.close();
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

// 앱 내부 [+ 파일 추가]와 같은 안내 문구를 쓴다.
const showUnsupportedFileAlert = (fileName: string) => {
  Alert.alert(
    '지원하지 않는 파일',
    `EPUB 또는 TXT 파일만 등록할 수 있습니다.\n\n${fileName}`,
  );
};

type IncomingUrlSource = 'initial' | 'event';

// UserProvider 안에서 실행되는 컴포넌트 (useUser 사용 가능)
function AppContent() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const processingUrlsRef = useRef(new Set<string>());
  const lastIncomingUrlRef = useRef<{ url: string; handledAt: number } | null>(null);
  const incomingOperationIdRef = useRef(0);
  const didReadInitialUrlRef = useRef(false);
  const { setIncomingFile } = useUser();

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const restoreActiveReader = async () => {
      // 복원 확인(비동기) 도중 외부 파일이 들어오면 새 파일이 우선이다.
      const operationIdAtStart = incomingOperationIdRef.current;
      try {
        const serialized = await AsyncStorage.getItem(ACTIVE_READER_SESSION_KEY);
        if (!serialized) return;

        const session = JSON.parse(serialized);
        if (!session?.fileId || !session?.uri || !session?.name) {
          await AsyncStorage.removeItem(ACTIVE_READER_SESSION_KEY);
          return;
        }
        const fileInfo = await FileSystem.getInfoAsync(String(session.uri));
        if (!fileInfo.exists) {
          await AsyncStorage.removeItem(ACTIVE_READER_SESSION_KEY);
          return;
        }

        if (incomingOperationIdRef.current !== operationIdAtStart) {
          console.log('↩️ 외부 파일 수신이 시작되어 이전 리더 세션 복원 취소');
          return;
        }

        router.replace({
          pathname: '/reader',
          params: {
            fileId: String(session.fileId),
            uri: String(session.uri),
            name: String(session.name),
            type: session.type ? String(session.type) : undefined,
            // 읽기를 끝냈을 때 파일을 열었던 폴더로 돌아가기 위해 함께 복원한다.
            folder: session.folder ? String(session.folder) : undefined,
          },
        });
      } catch (error) {
        console.log('활성 리더 세션 복원 실패:', error);
      }
    };

    const processIncomingUrl = async (url: string | null, source: IncomingUrlSource) => {
      if (!url) return;

      console.log('🔗 수신 URL:', url);

      // 파일 열기 URL(file:// / content://, 앱 스킴으로 감싼 content URI)만 처리한다.
      const normalizedUrl = toExternalFileUrl(url);
      if (!normalizedUrl) return;
      if (normalizedUrl !== url) {
        console.log('🔄 content URI 복원:', normalizedUrl);
      }

      const now = Date.now();
      const lastIncoming = lastIncomingUrlRef.current;
      const isImmediateDuplicate =
        lastIncoming?.url === normalizedUrl && now - lastIncoming.handledAt < 5000;
      if (processingUrlsRef.current.has(normalizedUrl) || isImmediateDuplicate) {
        console.log('↩️ 이미 처리한 외부 파일 이벤트 무시:', normalizedUrl);
        return;
      }

      processingUrlsRef.current.add(normalizedUrl);
      const operationId = incomingOperationIdRef.current + 1;
      incomingOperationIdRef.current = operationId;
      const isCurrentOperation = () => incomingOperationIdRef.current === operationId;

      if (__DEV__) {
        const intentInfo = await getCurrentExternalIntentInfo();
        console.log('[External Intent Received]', {
          source,
          url,
          action: intentInfo?.action,
          data: intentInfo?.data,
          mimeType: intentInfo?.mimeType,
          flags: intentInfo?.flags,
          grantReadUriFlag: intentInfo?.grantReadUriFlag,
          persistableGrantFlag: intentInfo?.persistableGrantFlag,
          clipData: intentInfo?.clipDataUris,
        });
        console.log('[App State]', {
          start: source === 'initial' ? 'cold start (initial intent)' : 'warm start (new intent event)',
          route: pathnameRef.current,
          currentReaderFileId: getActiveReaderSessionFileId(),
        });
        console.log('[External File Handling] permission', {
          uri: normalizedUrl,
          readPermission: intentInfo?.data === url ? intentInfo?.readPermission : 'intent-changed',
        });
      }

      let name = 'unknown';
      let finalUri = '';

      try {
        const cacheDir = FileSystem.cacheDirectory ?? '';
        if (__DEV__) console.log('[External File Handling] copy start', { operationId, uri: normalizedUrl });
        
        if (normalizedUrl.startsWith('content://')) {
          // content URI는 제공자에 따라 원본 파일명이 없을 수 있으므로 먼저 복사 후 타입을 판별한다.
          const tempName = `incoming_${operationId}_${Date.now()}.tmp`;
          const tempUri = cacheDir + tempName;
          const displayNamePromise = getExternalFileDisplayName(normalizedUrl);
          
          // 파일명 조회와 원본 복사는 서로 독립적이므로 동시에 진행한다.
          const [, displayName] = await Promise.all([
            FileSystem.copyAsync({ from: normalizedUrl, to: tempUri }),
            displayNamePromise,
          ]);
          console.log('✅ 임시 복사 완료:', tempUri);

          // 앱 내부 파일 추가와 같은 기준: 확장자가 있는데 TXT/EPUB가 아니면 등록하지 않는다.
          if (displayName && !isSupportedFileName(displayName)) {
            await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
            console.log('⚠️ 지원되지 않는 파일:', displayName);
            if (isCurrentOperation()) showUnsupportedFileAlert(displayName);
            return;
          }

          const displayExtension = displayName?.match(/\.(txt|epub)$/i)?.[0]?.toLowerCase();
          const ext = displayExtension || await getFileExtensionFromUri(tempUri);
          name = makeExternalFileName(normalizedUrl, ext, displayName);
          finalUri = `${cacheDir}incoming_${operationId}_${Date.now()}${ext}`;
          
          // 각 선택마다 고유한 캐시 경로를 사용해 동시에 들어온 파일이 서로 덮어쓰지 않게 한다.
          await FileSystem.moveAsync({ from: tempUri, to: finalUri });
          console.log('✅ 파일명 판별 완료:', name);
        } else {
          // file:// URI: 파일명 직접 추출
          const urlName = getSupportedFileNameFromUrl(normalizedUrl);
          
          // 확장자가 없거나 지원되지 않으면 거절
          if (!urlName) {
            console.log('⚠️ 지원되지 않는 파일:', normalizedUrl);
            if (isCurrentOperation()) {
              const rawName = decodeURIComponent(normalizedUrl.split('?')[0]).split('/').pop();
              showUnsupportedFileAlert(rawName || normalizedUrl);
            }
            return;
          }
          name = urlName;
          
          const ext = urlName.slice(urlName.lastIndexOf('.')).toLowerCase();
          finalUri = `${cacheDir}incoming_${operationId}_${Date.now()}${ext}`;
          
          // 캐시에 복사
          await FileSystem.copyAsync({ from: normalizedUrl, to: finalUri });
          console.log('✅ 파일 복사 완료:', finalUri);
        }

        if (!isCurrentOperation()) {
          await FileSystem.deleteAsync(finalUri, { idempotent: true }).catch(() => {});
          console.log('↩️ 더 최신 파일이 선택되어 이전 외부 파일 결과 폐기:', name);
          return;
        }

        console.log('📂 외부 파일 수신 완료:', name);
        if (__DEV__) console.log('[External File Handling] normalized file', { name, uri: finalUri });
        lastIncomingUrlRef.current = { url: normalizedUrl, handledAt: Date.now() };
        await clearExternalFileIntent(url);

        // 새 파일로 전환이 확정된 뒤에만 열려 있던 Reader의 최신 위치를 저장하고 session을 닫는다.
        // 복사 실패·지원하지 않는 파일·더 최신 파일 수신으로 끝나는 경우에는 읽던 Reader를 그대로 둔다.
        const previousReaderFileId = getActiveReaderSessionFileId();
        if (previousReaderFileId) console.log('[Reader] previous reader close', { fileId: previousReaderFileId });
        await flushActiveReaderSession('external-file');
        if (previousReaderFileId) console.log('[Reader] position saved', { fileId: previousReaderFileId });

        // 스택에 이미 있는 Home까지 화면을 닫는다. replace는 Reader 자리에 새 Home을 하나 더 만들어
        // Home이 중복 마운트되고, 각 Home이 같은 외부 파일을 두고 경쟁하게 된다.
        // 위치 저장으로 Reader session을 끝냈으므로 더 최신 파일이 들어왔더라도 Reader는 닫는다.
        router.dismissTo('/(tabs)' as any);
        if (!isCurrentOperation()) {
          await FileSystem.deleteAsync(finalUri, { idempotent: true }).catch(() => {});
          console.log('↩️ 더 최신 파일이 선택되어 이전 외부 파일 결과 폐기:', name);
          return;
        }
        setIncomingFile({ uri: finalUri, name });
      } catch (e) {
        console.error('❌ 외부 파일 처리 실패:', e);
        if (isCurrentOperation()) {
          Alert.alert('파일 추가 실패', String(e));
        }
      } finally {
        processingUrlsRef.current.delete(normalizedUrl);
      }
    };

    // 앱이 종료된 상태에서 파일로 열린 경우 (cold start)
    // router 객체가 바뀌어 effect가 다시 연결되더라도 cold-start 인텐트는 한 번만 소비한다.
    if (!didReadInitialUrlRef.current) {
      didReadInitialUrlRef.current = true;
      Linking.getInitialURL().then(async (initialUrl) => {
        // 백그라운드에서 프로세스가 종료된 뒤 복귀하면 Activity가 복원되면서 처음 파일을 연 Intent가
        // 그대로 다시 전달된다. 새로 전달된 Intent만 등록하고, 복원이면 읽던 Reader를 되살린다.
        const isNewIntent = initialUrl ? await claimExternalFileIntent(initialUrl) : false;
        if (initialUrl && isNewIntent) {
          await processIncomingUrl(initialUrl, 'initial');
        } else {
          if (initialUrl) {
            console.log('↩️ 이미 처리한 외부 파일 intent가 Activity 복원으로 다시 전달됨 - 등록하지 않음');
          }
          await restoreActiveReader();
        }
      });
    }

    // 앱이 백그라운드에 있다가 파일로 열린 경우
    const subscription = Linking.addEventListener('url', ({ url }) => {
      // onNewIntent로 온 URL은 항상 새 요청이다. 처리했다고 기록해 두어야
      // 이후 Activity가 이 Intent로 복원될 때 다시 등록하지 않는다.
      void claimExternalFileIntent(url);
      processIncomingUrl(url, 'event');
    });

    return () => subscription.remove();
  }, [router, setIncomingFile]);

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
