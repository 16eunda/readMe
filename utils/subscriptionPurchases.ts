import { Platform } from 'react-native';
import { isGooglePlayInstall } from '../modules/external-file-info/src';
import { authenticatedFetch, BASE_URL } from './api';

type Iap = typeof import('react-native-iap');
type Purchase = import('react-native-iap').Purchase;

// Google Play Console에 등록한 구독 상품 ID와 일치해야 한다.
export const SUBSCRIPTION_PRODUCT_IDS = {
  monthly: 'monthly_2900',
  yearly: 'yearly_19900',
} as const;

const PLAN_TYPE_BY_PRODUCT_ID: Record<string, 'monthly' | 'yearly'> = {
  [SUBSCRIPTION_PRODUCT_IDS.monthly]: 'monthly',
  [SUBSCRIPTION_PRODUCT_IDS.yearly]: 'yearly',
};

// ========== Billing 연결 공유 ==========
// react-native-iap 연결은 앱 전체에서 하나이고, initConnection/endConnection은 호출 횟수를 세지 않는다.
// 앱 시작 복원과 구독 화면이 각자 연결을 열고 닫으면 먼저 끝난 쪽이 다른 쪽의 연결을 끊어 버린다.
// 그래서 사용하는 곳의 수를 세고, 마지막 사용자가 놓을 때만 연결을 닫는다.
let connectionUsers = 0;
let connection: Promise<Iap> | null = null;
let disconnecting: Promise<void> = Promise.resolve();

// 개발 빌드(Expo Go/에뮬레이터)와 Play 스토어 외 설치본에서는 Billing을 쓸 수 없다.
async function canUseIap(): Promise<boolean> {
  if (__DEV__) return false;
  if (Platform.OS === 'android' && !(await isGooglePlayInstall())) return false;
  return true;
}

async function openConnection(): Promise<Iap> {
  // 직전 endConnection이 끝나기 전에 연결하면 새로 연 연결이 뒤늦게 끊긴다.
  await disconnecting;
  const iap = await import('react-native-iap');
  await iap.initConnection();
  return iap;
}

// 연결하지 못하면 null을 반환한다. null이 아니면 반드시 releaseIapConnection()을 한 번 호출한다.
export async function acquireIapConnection(): Promise<Iap | null> {
  if (!(await canUseIap())) {
    console.log('ℹ️ 이 빌드에서는 결제를 사용할 수 없습니다 (개발 빌드 또는 Play 스토어 외 설치)');
    return null;
  }

  connectionUsers += 1;
  const pending = connection ?? (connection = openConnection());
  try {
    return await pending;
  } catch (error) {
    connectionUsers -= 1;
    if (connection === pending) connection = null;
    console.log('IAP 연결 실패:', error);
    return null;
  }
}

export function releaseIapConnection(): void {
  connectionUsers = Math.max(0, connectionUsers - 1);
  if (connectionUsers > 0 || !connection) return;

  const closing = connection;
  connection = null;
  disconnecting = closing
    .then((iap) => iap.endConnection())
    .then(() => undefined, () => undefined);
}

// ========== 서버 등록 ==========
export type RegisterResult = 'registered' | 'owned-by-other-account' | 'rejected';

// 구매 토큰을 서버에 등록한다. 계정/기기 식별은 서버가 Authorization·X-Device-Id 헤더로 한다.
// 네트워크 오류는 호출부가 처리하도록 그대로 던진다.
export async function registerSubscriptionPurchase(purchase: Purchase): Promise<RegisterResult> {
  const res = await authenticatedFetch(`${BASE_URL}/subscriptions/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      purchaseToken: purchase.purchaseToken,
      productId: purchase.productId,
      planType: PLAN_TYPE_BY_PRODUCT_ID[purchase.productId],
      platform: Platform.OS.toUpperCase(),
    }),
  });

  if (res.ok) return 'registered';

  if (res.status === 409) {
    const body = await res.json().catch(() => null);
    if (body?.code === 'SUBSCRIPTION_OWNED_BY_OTHER_ACCOUNT') return 'owned-by-other-account';
  }
  console.log('⚠️ 구독 등록 거부 (status:', res.status, ')');
  return 'rejected';
}

// ========== 구매 복원 ==========
export type RestoreResult = 'restored' | 'nothing' | 'owned-by-other-account' | 'failed';

// 구매가 여러 건일 때 사용자에게 알릴 결과는 가장 의미 있는 한 가지다.
const RESTORE_RESULT_PRIORITY: Record<RestoreResult, number> = {
  nothing: 0,
  failed: 1,
  'owned-by-other-account': 2,
  restored: 3,
};

const RESTORE_RESULT_BY_REGISTER: Record<RegisterResult, RestoreResult> = {
  registered: 'restored',
  'owned-by-other-account': 'owned-by-other-account',
  rejected: 'failed',
};

// Google Play에 남아 있는 구독을 서버에 다시 등록한다. 예외를 던지지 않는다.
// - 재설치/기기 변경: 비회원 구독이 새 deviceId로 옮겨진다.
// - 결제 직후 앱이 꺼진 경우: 서버가 이번에 승인한다 (미승인 구매는 3일 뒤 Google이 자동 환불).
export async function restorePurchases(): Promise<RestoreResult> {
  if (Platform.OS !== 'android') return 'nothing'; // 백엔드는 아직 Android 구독만 검증한다

  const iap = await acquireIapConnection();
  if (!iap) return 'failed';

  try {
    const purchases = await iap.getAvailablePurchases();
    let result: RestoreResult = 'nothing';

    for (const purchase of purchases) {
      // 보류 중(현금 결제 등)인 구매는 확정된 뒤 purchaseUpdatedListener로 다시 온다.
      if (!purchase.purchaseToken || purchase.purchaseState !== 'purchased') continue;
      if (!(purchase.productId in PLAN_TYPE_BY_PRODUCT_ID)) continue;

      let registered: RegisterResult;
      try {
        registered = await registerSubscriptionPurchase(purchase);
      } catch (error) {
        console.log('⚠️ 구매 복원 등록 실패(네트워크):', error);
        registered = 'rejected';
      }

      if (registered === 'registered') {
        await iap.finishTransaction({ purchase, isConsumable: false }).catch(() => {});
      }

      const next = RESTORE_RESULT_BY_REGISTER[registered];
      if (RESTORE_RESULT_PRIORITY[next] > RESTORE_RESULT_PRIORITY[result]) result = next;
    }

    return result;
  } catch (error) {
    console.log('⚠️ 구매 복원 실패:', error);
    return 'failed';
  } finally {
    releaseIapConnection();
  }
}
