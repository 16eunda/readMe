import * as FileSystem from 'expo-file-system/legacy';
import * as Linking from 'expo-linking';
import { Redirect, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { useUser } from '../contexts/UserContext';

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

          // 파일명 추출 (content URI는 숫자 ID)
          const decoded = decodeURIComponent(normalizedUrl);
          let name = decoded.split('/').pop() || 'unknown';
          const hasExtension = name.endsWith('.txt') || name.endsWith('.epub');
          if (!hasExtension) name = name + '.epub';

          try {
            const destUri = (FileSystem.cacheDirectory ?? '') + name;
            const existingInfo = await FileSystem.getInfoAsync(destUri);
            if (existingInfo.exists) {
              await FileSystem.deleteAsync(destUri, { idempotent: true });
            }
            await FileSystem.copyAsync({ from: normalizedUrl, to: destUri });
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
