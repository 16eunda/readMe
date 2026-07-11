import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '@device_id';
let deviceIdPromise: Promise<string> | null = null;

/**
 * 디바이스 고유 ID 생성
 * UUID v4 형식 (간단 버전)
 */
function generateDeviceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 디바이스 ID 가져오기 (없으면 생성)
 */
export function getDeviceId(): Promise<string> {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      try {
        let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);

        if (!deviceId) {
          deviceId = generateDeviceId();
          await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
          console.log('🆔 새 디바이스 ID 생성:', deviceId);
        } else {
          console.log('🆔 기존 디바이스 ID 로드:', deviceId);
        }

        return deviceId;
      } catch (error) {
        console.error('디바이스 ID 가져오기 실패:', error);
        // 에러 시 앱 실행 중에는 동일하게 유지되는 임시 ID 사용
        return 'temp-' + Date.now();
      }
    })();
  }

  return deviceIdPromise;
}

/**
 * 디바이스 ID 삭제 (디버깅용)
 */
export async function clearDeviceId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DEVICE_ID_KEY);
    deviceIdPromise = null;
    console.log('🆔 디바이스 ID 삭제됨');
  } catch (error) {
    console.error('디바이스 ID 삭제 실패:', error);
  }
}
