// app/subscription.tsx
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useUser } from '../contexts/UserContext';
import { authenticatedFetch, BASE_URL } from '../utils/api';

// ✅ Google Play Console에서 등록한 구독 상품 ID와 일치해야 함
const PRODUCT_IDS = {
  monthly: 'monthly_2900',
  yearly: 'yearly_19900',
};

// Expo Go / 에뮬레이터에서는 IAP 불가 → 빌드된 APK에서만 동작
const IS_IAP_AVAILABLE = !__DEV__;

const FEATURES = [
  { emoji: '🤖', text: 'AI 독서 추천 무제한' },
  { emoji: '📚', text: '파일 무제한 보관 및 AI로 자동 분석' },
  { emoji: '⚡', text: 'AI 책 요약 & 핵심 정리' },
  { emoji: '📊', text: '상세 독서 통계 (출시 예정)' },
  { emoji: '🚫', text: '광고 없는 깔끔한 환경' },
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

  // IAP 초기화 및 결제 리스너 등록
  useEffect(() => {
    let purchaseListener: any;

    const setup = async () => {
      if (!IS_IAP_AVAILABLE) {
        console.log('ℹ️ IAP는 빌드된 APK에서만 동작합니다 (Expo Go 불가)');
        return;
      }
      try {
        const iap = await import('react-native-iap');
        await iap.initConnection();
        await iap.fetchProducts({
          skus: Object.values(PRODUCT_IDS),
          type: 'subs',
        });

        // 결제 완료 리스너
        purchaseListener = iap.purchaseUpdatedListener(async (purchase: any) => {
          try {
            if (!purchase.purchaseToken) return;

            // 백엔드에 구독 요청
            const res = await authenticatedFetch(`${BASE_URL}/subscriptions/subscribe`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                purchaseToken: purchase.purchaseToken,
                productId: purchase.productId,
                planType: purchase.productId === 'monthly_2900' ? 'monthly' : 'yearly',
                platform: Platform.OS.toUpperCase(),
              }),
            });

            if (res.ok) {
              await iap.finishTransaction({ purchase, isConsumable: false });
              await checkSubscription();
              Alert.alert('🎉 구독 완료!', '프리미엄 기능을 모두 이용할 수 있어요!', [
                { text: '확인', onPress: () => router.back() },
              ]);
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
        console.log('IAP 초기화 실패 (에뮬레이터/Expo Go에서는 정상):', e);
      }
    };

    setup();
    return () => purchaseListener?.remove();
  }, []);

  const handleSubscribe = async () => {
    if (!user) {
      Alert.alert('로그인 필요', '구독하려면 먼저 로그인해 주세요.', [{ text: '확인' }]);
      return;
    }

    if (!IS_IAP_AVAILABLE) {
      Alert.alert('알림', '결제는 설치된 앱(APK)에서만 가능합니다.\nExpo Go에서는 테스트할 수 없어요.');
      return;
    }

    try {
      setIsLoading(true);
      const sku = selectedPlan === 'monthly' ? PRODUCT_IDS.monthly : PRODUCT_IDS.yearly;
      const iap = await import('react-native-iap');
      await iap.requestPurchase({
        request: {
          google: { skus: [sku] },
          apple: { sku },
        },
        type: 'subs',
      });
      // 결제 결과는 purchaseUpdatedListener에서 처리됨
    } catch (e: any) {
      setIsLoading(false);
      if (e?.code !== 'E_USER_CANCELLED') {
        Alert.alert('결제 오류', '결제 중 오류가 발생했습니다. 다시 시도해주세요.');
      }
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
                <Text style={styles.featureEmoji}>{f.emoji}</Text>
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
          <Text style={styles.bigEmoji}>✨</Text>
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
              <Text style={styles.featureEmoji}>{f.emoji}</Text>
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { padding: 24, paddingBottom: 60 },

  // 헤더
  header: { alignItems: 'center', marginBottom: 28 },
  bigEmoji: { fontSize: 60, marginBottom: 12 },
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
  featureEmoji: { fontSize: 22, marginRight: 12 },
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

  // 이미 프리미엄인 경우
  premiumActive: {
    flex: 1,
    alignItems: 'center',
    padding: 24,
    paddingTop: 48,
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
