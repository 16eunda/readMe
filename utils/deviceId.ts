import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const DEVICE_ID_KEY = '@device_id';
let deviceIdPromise: Promise<string> | null = null;

/**
 * 디바이스 고유 ID 생성
 * 비회원 데이터는 deviceId만 알면 조회할 수 있으므로 추측할 수 없어야 한다.
 * Math.random은 암호학적 난수가 아니므로 OS 보안 난수로 UUID v4를 만든다.
 */
function generateDeviceId(): string {
  return Crypto.randomUUID();
}

/**
 * 디바이스 ID 가져오기 (없으면 생성)
 * 이미 저장된 ID는 바꾸지 않는다. 바꾸면 그 기기의 비회원 데이터가 사라진다.
 * deviceId 값은 비밀번호처럼 다뤄야 하므로 로그에 남기지 않는다.
 */
export function getDeviceId(): Promise<string> {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      try {
        let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);

        if (!deviceId) {
          deviceId = generateDeviceId();
          await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
          console.log('🆔 새 디바이스 ID 생성');
        } else {
          console.log('🆔 기존 디바이스 ID 로드');
        }

        return deviceId;
      } catch (error) {
        console.error('디바이스 ID 가져오기 실패:', error);
        // 에러 시 앱 실행 중에는 동일하게 유지되는 임시 ID 사용.
        // 시각 기반 ID는 추측할 수 있고 같은 순간 실패한 기기끼리 겹칠 수 있으므로 난수로 만든다.
        return generateDeviceId();
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
