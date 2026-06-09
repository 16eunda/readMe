import * as FileSystem from 'expo-file-system/legacy';
import * as Linking from 'expo-linking';
import { Redirect, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { useUser } from '../contexts/UserContext';
import { getExternalFileDisplayName } from '../modules/external-file-info/src';

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
  } catch {
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

// 파일 탐색기에서 앱을 열 때 myreaderapp2://media/... 형식의 딥링크가
// 라우트로 해석되어 Unmatched Route가 뜨는 것을 방지
export default function NotFound() {
  const pathname = usePathname();
  const { setIncomingFile } = useUser();

  useEffect(() => {
    const handleFileUrl = async () => {
      // myreaderapp2://media/... 패턴 감지
      const currentUrl = await Linking.getInitialURL();
      if (!currentUrl) return;

      console.log('🔀 NotFound에서 수신 URL:', currentUrl);

      let normalizedUrl = currentUrl;
      if (currentUrl.startsWith('myreaderapp2://')) {
        const path = currentUrl.replace('myreaderapp2://', '');
        if (path.startsWith('media/') || path.startsWith('com.') || path.includes('/file/')) {
          normalizedUrl = 'content://' + path;
          console.log('🔄 content URI 복원:', normalizedUrl);

          try {
            const cacheDir = FileSystem.cacheDirectory ?? '';
            const tempUri = cacheDir + 'temp_' + Date.now();
            await FileSystem.copyAsync({ from: normalizedUrl, to: tempUri });

            const ext = await getFileExtensionFromUri(tempUri);
            const displayName = await getExternalFileDisplayName(normalizedUrl);
            const name = makeExternalFileName(normalizedUrl, ext, displayName);
            const destUri = cacheDir + name;
            const existingInfo = await FileSystem.getInfoAsync(destUri);
            if (existingInfo.exists) {
              await FileSystem.deleteAsync(destUri, { idempotent: true });
            }
            await FileSystem.moveAsync({ from: tempUri, to: destUri });
            console.log('✅ NotFound: 외부 파일 캐시 복사 완료:', destUri);
            setIncomingFile({ uri: destUri, name });
          } catch (e) {
            console.error('❌ NotFound: 파일 복사 실패:', e);
          }
        }
      }
    };

    handleFileUrl();
  }, []);

  // 홈 탭으로 리다이렉트 (incomingFile은 index.tsx에서 처리)
  return <Redirect href="/(tabs)" />;
}
