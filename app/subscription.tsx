// app/subscription.tsx
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ICONS } from '../constants/icons';
import { useUser } from '../contexts/UserContext';
import {
  acquireIapConnection,
  registerSubscriptionPurchase,
  releaseIapConnection,
  restorePurchases,
  SUBSCRIPTION_PRODUCT_IDS,
} from '../utils/subscriptionPurchases';

const FEATURES = [
  { icon: ICONS.robot, text: 'AI 독서 추천 무제한' },
  { icon: ICONS.books, text: '파일 무제한 보관 및 AI로 자동 분석' },
  { icon: ICONS.lightning, text: 'AI 책 요약 & 핵심 정리' },
  { icon: ICONS.chart, text: '상세 독서 통계 (출시 예정)' },
  { icon: ICONS.noAds, text: '광고 없는 깔끔한 환경' },
//   { emoji: '🤖', text: 'AI 독서 추천 무제한' },
//   { emoji: '📚', text: '파일 무제한 보관 (무료: 최대 10개)' },
//   { emoji: '🚫', text: '광고 없는 깔끔한 환경' },
//   { emoji: '🎨', text: '모든 리더 테마 & 폰트' },
//   { emoji: '📝', text: '독서 메모 기능 (출시 예정)' },
//   { emoji: '📊', text: '상세 독서 통계 (출시 예정)' },
];

const PLANS = [
  {
    id: 'monthly' as const,
    label: '월간',
    price: '₩2,900',
    sub: '매월 결제',
    badge: null,
  },
  {
    id: 'yearly' as const,
    label: '연간',
    price: '₩19,900',
    sub: '매년 결제 · 월 ₩1,658',
    badge: '43% 절약',
  },
];

const PURPLE = '#7C3AED';
const PURPLE_LIGHT = '#FAF5FF';
const PURPLE_BORDER = '#E8DCFF';

export default function SubscriptionScreen() {
  const router = useRouter();
  const { isPremium, user, checkSubscription } = useUser();
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>('yearly');
  const [isLoading, setIsLoading] = useState(false);
  const [iapReady, setIapReady] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // IAP 초기화 및 결제 리스너 등록
  useEffect(() => {
    let purchaseListener: { remove: () => void } | undefined;
    let errorListener: { remove: () => void } | undefined;
    let connected = false;
    let active = true;

    const setup = async () => {
      // Billing 연결은 앱 시작 시 구매 복원과 공유한다. 이 화면이 직접 initConnection/endConnection을
      // 부르면 복원이 끝나면서 이 화면의 연결까지 끊긴다.
      const iap = await acquireIapConnection();
      if (!iap) return;
      if (!active) {
        releaseIapConnection();
        return;
      }
      connected = true;

      try {
        await iap.fetchProducts({
          skus: Object.values(SUBSCRIPTION_PRODUCT_IDS),
          type: 'subs',
        });
        if (!active) return;
        setIapReady(true);

        // 결제 실패/취소 리스너.
        // requestPurchase는 결제창을 띄우고 바로 반환하며 실제 결과는 이벤트로만 전달된다.
        // 이 리스너가 없으면 사용자가 결제창을 취소했을 때 isLoading이 true로 남아
        // 구독 버튼이 계속 비활성 상태가 된다.
        errorListener = iap.purchaseErrorListener((error) => {
          setIsLoading(false);
          // react-native-iap 15의 취소 코드는 'user-cancelled'다. 문자열 비교 대신 라이브러리 판정을 쓴다.
          if (iap.isUserCancelledError(error)) return;
          console.log('결제 오류:', error?.code, error?.message);
          Alert.alert('결제 오류', '결제를 완료하지 못했습니다. 다시 시도해주세요.');
        });

        // 결제 완료 리스너
        purchaseListener = iap.purchaseUpdatedListener(async (purchase) => {
          try {
            if (!purchase.purchaseToken) return;

            // 아직 승인 대기 중인 결제(예: 현금 결제)는 결제가 끝난 것이 아니므로
            // 서버에 등록하거나 승인하지 않는다. 결제가 확정되면 다시 전달된다.
            if (purchase.purchaseState === 'pending') {
              console.log('ℹ️ 보류 중인 결제 - 확정 후 다시 처리됩니다.');
              Alert.alert('결제 대기 중', '결제가 승인되면 프리미엄이 자동으로 적용됩니다.');
              return;
            }

            // 백엔드에 구독 등록 (구매 복원과 같은 요청을 쓴다)
            const registered = await registerSubscriptionPurchase(purchase);

            if (registered === 'registered') {
              // 백엔드에 구독이 등록된 시점에 먼저 프리미엄 상태를 반영하고 사용자에게 알린다.
              // finishTransaction이 네트워크 등으로 실패해도 결제/서버 등록 자체는 끝난 것이므로
              // 사용자에게 완료 사실을 숨기지 않는다. 끝내지 못한 트랜잭션은 react-native-iap가
              // 다음 initConnection 때 purchaseUpdatedListener로 다시 전달해 재시도할 수 있다.
              await checkSubscription();
              Alert.alert('🎉 구독 완료!', '프리미엄 기능을 모두 이용할 수 있어요!', [
                { text: '확인', onPress: () => router.back() },
              ]);
              try {
                await iap.finishTransaction({ purchase, isConsumable: false });
              } catch (finishError) {
                console.error('finishTransaction 실패 (다음 실행 시 재시도됨):', finishError);
              }
            } else if (registered === 'owned-by-other-account') {
              Alert.alert('다른 계정의 구독', '이 Google Play 구독은 다른 계정에 연결돼 있어요. 구독한 계정으로 로그인해 주세요.');
            } else {
              Alert.alert('오류', '구독 검증에 실패했습니다. 고객센터에 문의해주세요.');
            }
          } catch (e) {
            console.error('구독 처리 오류:', e);
          } finally {
            setIsLoading(false);
          }
        });
      } catch (e) {
        console.log('IAP 초기화 실패:', e);
        if (active) {
          setIapReady(false);
          connected = false;
          releaseIapConnection();
        }
      }
    };

    void setup();
    return () => {
      active = false;
      purchaseListener?.remove();
      errorListener?.remove();
      if (connected) releaseIapConnection();
    };
  }, []);

  const alertIapUnavailable = () => {
    const message = Platform.OS === 'android'
      ? 'Google Play에서 설치한 최신 앱과 활성화된 Google Play 스토어가 필요합니다.'
      : '결제 서비스를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.';
    Alert.alert('결제를 사용할 수 없어요', message);
  };

  const handleSubscribe = async () => {
    if (!user) {
      Alert.alert('로그인 필요', '구독하려면 먼저 로그인해 주세요.', [{ text: '확인' }]);
      return;
    }

    if (!iapReady) {
      alertIapUnavailable();
      return;
    }

    // iapReady면 이미 로드된 모듈이다.
    const iap = await import('react-native-iap');
    try {
      setIsLoading(true);
      const sku = selectedPlan === 'monthly' ? SUBSCRIPTION_PRODUCT_IDS.monthly : SUBSCRIPTION_PRODUCT_IDS.yearly;
      await iap.requestPurchase({
        request: {
          google: { skus: [sku] },
          apple: { sku },
        },
        type: 'subs',
      });
      // 결제 결과는 purchaseUpdatedListener에서 처리됨
    } catch (e) {
      setIsLoading(false);
      if (!iap.isUserCancelledError(e)) {
        Alert.alert('결제 오류', '결제 중 오류가 발생했습니다. 다시 시도해주세요.');
      }
    }
  };

  // 재설치·기기 변경 후 구독 복원. 비회원 구독도 복원되므로 로그인을 요구하지 않는다.
  const handleRestore = async () => {
    if (!iapReady) {
      alertIapUnavailable();
      return;
    }

    setIsRestoring(true);
    try {
      const result = await restorePurchases();
      if (result === 'restored') {
        await checkSubscription();
        Alert.alert('복원 완료', '프리미엄 구독이 복원되었어요.');
      } else if (result === 'owned-by-other-account') {
        Alert.alert('다른 계정의 구독', '이 구독은 다른 계정에 연결돼 있어요. 구독한 계정으로 로그인해 주세요.');
      } else if (result === 'nothing') {
        Alert.alert('복원할 구독 없음', '이 Google 계정으로 결제한 구독을 찾지 못했어요.');
      } else {
        Alert.alert('복원 실패', '잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setIsRestoring(false);
    }
  };

  // ── 이미 구독 중인 경우 ──
  if (isPremium) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: '구독 관리', headerBackTitle: '뒤로' }} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.premiumActive}
        >
          <Text style={styles.bigEmoji}>👑</Text>
          <Text style={styles.premiumTitle}>프리미엄 회원</Text>
          <Text style={styles.premiumSub}>모든 기능을 이용하고 있어요!</Text>

          <View style={[styles.featureCard, { width: '100%' }]}>
            {FEATURES.map((f, i) => (
              <View
                key={i}
                style={[
                  styles.featureRow,
                  i < FEATURES.length - 1 && styles.featureRowBorder,
                ]}
              >
                <Image source={f.icon} style={styles.featureIcon} />
                <Text style={styles.featureText}>{f.text}</Text>
                <Text style={{ fontSize: 18 }}>✅</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.manageBtn, { width: '100%', alignItems: 'center' }]}
            onPress={() =>
              Alert.alert(
                '구독 관리',
                'App Store 또는 Google Play에서 구독을 관리할 수 있어요.',
                [{ text: '확인' }]
              )
            }
          >
            <Text style={styles.manageBtnText}>구독 관리하기</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── 구독 유도 화면 ──
  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ title: 'readMe Premium', headerBackTitle: '뒤로' }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* 헤더 */}
        <View style={styles.header}>
          <Image source={ICONS.sparkle} style={styles.bigIcon} />
          <Text style={styles.title}>readMe Premium</Text>
          <Text style={styles.subtitle}>더 스마트하게 읽는 경험</Text>
        </View>

        {/* 기능 목록 */}
        <View style={styles.featureCard}>
          {FEATURES.map((f, i) => (
            <View
              key={i}
              style={[
                styles.featureRow,
                i < FEATURES.length - 1 && styles.featureRowBorder,
              ]}
            >
              <Image source={f.icon} style={styles.featureIcon} />
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {/* 플랜 선택 */}
        <Text style={styles.planTitle}>플랜 선택</Text>
        {PLANS.map((plan) => (
          <TouchableOpacity
            key={plan.id}
            style={[
              styles.planCard,
              selectedPlan === plan.id && styles.planCardActive,
            ]}
            onPress={() => setSelectedPlan(plan.id)}
            activeOpacity={0.8}
          >
            <View style={styles.planLeft}>
              <Text
                style={[
                  styles.planLabel,
                  selectedPlan === plan.id && styles.planLabelActive,
                ]}
              >
                {plan.label}
              </Text>
              <Text
                style={[
                  styles.planSub,
                  selectedPlan === plan.id && styles.planSubActive,
                ]}
              >
                {plan.sub}
              </Text>
            </View>

            <View style={styles.planRight}>
              {plan.badge && (
                <View style={styles.saveBadge}>
                  <Text style={styles.saveBadgeText}>{plan.badge}</Text>
                </View>
              )}
              <Text
                style={[
                  styles.planPrice,
                  selectedPlan === plan.id && styles.planPriceActive,
                ]}
              >
                {plan.price}
              </Text>
            </View>

            {selectedPlan === plan.id && (
              <View style={styles.checkCircle}>
                <Text style={styles.checkMark}>✓</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}

        {/* 구독 버튼 */}
        <TouchableOpacity
          style={[styles.subscribeBtn, isLoading && { opacity: 0.7 }]}
          onPress={handleSubscribe}
          activeOpacity={0.85}
          disabled={isLoading}
        >
          {isLoading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.subscribeBtnText}>프리미엄 시작하기</Text>
          }
        </TouchableOpacity>

        <Text style={styles.trialText}>
          매월 자동 결제 · 언제든 취소 가능
        </Text>
        <Text style={styles.finePrint}>
          구독은 App Store / Google Play 계정으로 청구됩니다.{'\n'}
          구독 기간 중 취소해도 만료일까지 이용 가능합니다.
        </Text>

        {/* 구매 복원 */}
        <TouchableOpacity
          style={styles.restoreBtn}
          onPress={handleRestore}
          disabled={isRestoring || isLoading}
        >
          {isRestoring
            ? <ActivityIndicator color={PURPLE} />
            : <Text style={styles.restoreBtnText}>구매 복원</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { padding: 24, paddingTop: 0, paddingBottom: 60 },

  // 헤더
  header: { alignItems: 'center', marginBottom: 28 },
  bigEmoji: { fontSize: 60, marginBottom: 12 },
  bigIcon: { width: 76, height: 76, marginBottom: 12 },
  title: { fontSize: 26, fontWeight: '800', color: '#111', marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#666' },

  // 기능 카드
  featureCard: {
    backgroundColor: PURPLE_LIGHT,
    borderRadius: 16,
    paddingHorizontal: 20,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: PURPLE_BORDER,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  featureRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F0EBFF',
  },
  featureIcon: { width: 28, height: 28, marginRight: 12 },
  featureText: { flex: 1, fontSize: 15, color: '#333', fontWeight: '500' },

  // 플랜
  planTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
    marginBottom: 12,
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E5E5E5',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  planCardActive: {
    borderColor: PURPLE,
    backgroundColor: PURPLE_LIGHT,
  },
  planLeft: { flex: 1 },
  planLabel: { fontSize: 16, fontWeight: '700', color: '#444' },
  planLabelActive: { color: PURPLE },
  planSub: { fontSize: 12, color: '#999', marginTop: 2 },
  planSubActive: { color: '#9F67E8' },
  planRight: { alignItems: 'flex-end', marginRight: 12 },
  planPrice: { fontSize: 20, fontWeight: '800', color: '#333' },
  planPriceActive: { color: PURPLE },
  saveBadge: {
    backgroundColor: PURPLE,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 4,
  },
  saveBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '800' },

  // 구독 버튼
  subscribeBtn: {
    backgroundColor: PURPLE,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 12,
    shadowColor: PURPLE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  subscribeBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  trialText: {
    textAlign: 'center',
    color: '#666',
    fontSize: 13,
    marginBottom: 16,
  },
  finePrint: {
    textAlign: 'center',
    color: '#aaa',
    fontSize: 11,
    lineHeight: 17,
  },
  restoreBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  restoreBtnText: {
    color: '#888',
    fontSize: 13,
    textDecorationLine: 'underline',
  },

  // 이미 프리미엄인 경우
  premiumActive: {
    flex: 1,
    alignItems: 'center',
    padding: 24,
    paddingTop: 24,
  },
  premiumTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: PURPLE,
    marginBottom: 8,
  },
  premiumSub: { fontSize: 15, color: '#666', marginBottom: 32 },
  manageBtn: {
    borderWidth: 2,
    borderColor: PURPLE,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 8,
  },
  manageBtnText: { color: PURPLE, fontSize: 16, fontWeight: '700' },
});
