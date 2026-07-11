// app/(tabs)/settings.tsx
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  Alert,
  Dimensions,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import LoginModal from "../../components/LoginModal";
import { useUser } from "../../contexts/UserContext";
import { authenticatedFetch, BASE_URL } from "../../utils/api";

type FileStats = {
  totalCount: number;
  completedCount: number;
  fiveStarCount: number;
};

const SCREEN_HEIGHT = Dimensions.get("window").height;

export default function SettingsScreen() {
  // 전역 상태 사용
  const { user, deviceId, login, logout, isPremium, isLoading: userLoading } = useUser();
  const router = useRouter();

  // ========== Hooks는 컴포넌트 안에서만! ==========
  const [stats, setStats] = useState<FileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginModalVisible, setLoginModalVisible] = useState(false);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await authenticatedFetch(`${BASE_URL}/files/stats`, {}, deviceId ?? undefined);

      if (response.ok) {
        const data = await response.json();
        console.log("📊 통계 데이터:", data);
        setStats(data);
      } else {
        console.error("통계 조회 실패:", response.status);
      }
    } catch (err) {
      console.error("stats fetch error", err);
    } finally {
      setLoading(false);
    }
  };

  // UserContext 로딩 완료 후, user 상태가 확정되면 통계 조회
  // (토큰 재발급 완료 전에 fetchStats가 실행되는 race condition 방지)
  useFocusEffect(
    useCallback(() => {
      if (!userLoading) {
        fetchStats();
      }
    }, [userLoading, user])
  );

  const handleLoginSuccess = async (userId: string, username: string, token: string) => {
    await login(userId, username, token);
    setLoginModalVisible(false);
    fetchStats(); // 로그인 후 통계 새로고침
  };

  const handleLogout = async () => {
    await logout();
  };

  const handleWithdraw = () => {
    // 1단계: 탈퇴 의사 확인
    Alert.alert(
      "회원 탈퇴",
      "정말로 탈퇴하시겠어요?\n\n탈퇴 시 모든 데이터가 삭제되며\n복구가 불가능합니다.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "탈퇴하기",
          style: "destructive",
          onPress: () => {
            // 2단계: 최종 확인
            Alert.alert(
              "마지막 확인",
              "정말 탈퇴하시겠어요?\n모든 책 기록, 별점, 읽기 기록이\n영구적으로 삭제됩니다.",
              [
                { text: "취소", style: "cancel" },
                {
                  text: "네, 탈퇴합니다",
                  style: "destructive",
                  onPress: withdrawAccount,
                },
              ]
            );
          },
        },
      ]
    );
  };

  // 실제 탈퇴 처리 함수
  const withdrawAccount = async () => {
    try {
      const res = await authenticatedFetch(`${BASE_URL}/auth/user/me`, {
        method: "DELETE",
      }, deviceId ?? undefined);

      if (res.ok) {
        await logout();
        Alert.alert("탈퇴 완료", "그동안 이용해 주셔서 감사합니다.");
      } else {
        const err = await res.text();
        Alert.alert("탈퇴 실패", "오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
        console.error("탈퇴 실패:", res.status, err);
      }
    } catch (e) {
      Alert.alert("탈퇴 실패", "네트워크 오류가 발생했습니다.");
      console.error("탈퇴 오류:", e);
    }
  };
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
      {/* 프로필 */}
      <View style={styles.profileSection}>
        <View style={styles.avatar} />
        <Text style={styles.nickname}>
          {user ? user.username : "게스트"}
        </Text>
        {!user && (
          <TouchableOpacity 
            style={styles.loginButton}
            onPress={() => setLoginModalVisible(true)}
          >
            <Text style={styles.loginButtonText}>로그인 / 회원가입</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 통계 */}
      <View style={styles.statsSection}>
        <StatRow
            label="기록한 파일 수"
            value={loading ? "-" : String(stats?.totalCount ?? 0)}
        />
        <StatRow
            label="완독한 파일 수"
            value={loading ? "-" : String(stats?.completedCount ?? 0)}
        />

        <StatRow
            label="별이 5개!!!"
            value={loading ? "-" : String(stats?.fiveStarCount ?? 0)}
        />
      </View>

      {/* 구독 배너 */}
      <TouchableOpacity
        style={isPremium ? styles.premiumBanner : styles.freeBanner}
        onPress={() => router.push('/subscription')}
        activeOpacity={0.8}
      >
        <View style={styles.bannerLeft}>
          <Text style={styles.bannerEmoji}>{isPremium ? '👑' : '⭐'}</Text>
          <View>
            <Text style={[styles.bannerTitle, isPremium && styles.bannerTitlePremium]}>
              {isPremium ? 'readMe 프리미엄' : 'readMe 무료 플랜'}
            </Text>
            <Text style={styles.bannerSub}>
              {isPremium
                ? '모든 기능을 이용 중이에요!'
                : 'AI 추천 등 프리미엄 기능 이용하기'}
            </Text>
          </View>
        </View>
        <Text style={[styles.bannerChevron, isPremium && styles.bannerChevronPremium]}>›</Text>
      </TouchableOpacity>

      {/* 오늘의 명언 */}
      <View style={styles.quoteSection}>
        <Text style={styles.quoteTitle}>오늘의 명언</Text>

        <View style={styles.quoteCard}>
          <View style={styles.quoteInner}>
            <Text style={styles.quoteAuthor}>사르트르</Text>
            <View style={styles.quoteDivider} />
            <Text style={styles.quoteText}>
              내가 세계를 알게 된 것은 책에 의해서였다.
            </Text>
          </View>
        </View>
      </View>


      {/* 로그아웃 + 회원탈퇴 가로 배치 - 로그인 상태일 때만 */}
      {user && (
        <View style={styles.accountActions}>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutText}>로그아웃</Text>
          </TouchableOpacity>
          <View style={styles.accountDivider} />
          <TouchableOpacity style={styles.withdrawButton} onPress={handleWithdraw}>
            <Text style={styles.withdrawText}>회원탈퇴</Text>
          </TouchableOpacity>
        </View>
      )}
      </ScrollView>

      {/* 로그인 모달 */}
      <LoginModal
        visible={loginModalVisible}
        onClose={() => setLoginModalVisible(false)}
        onLoginSuccess={handleLoginSuccess}
      />
    </SafeAreaView>
  );
}

/* ---------- 재사용 ---------- */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

/* ---------- 스타일 ---------- */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },

  scroll: {
    flex: 1,
  },

  content: {
    padding: 20,
    paddingTop: 30,
    paddingBottom: 40,
  },

  profileSection: {
    alignItems: "center",
    marginBottom: 24,
  },

  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#ddd",
    marginBottom: 12,
  },

  nickname: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },

  loginButton: {
    backgroundColor: "#4A90E2",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 8,
  },

  loginButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },

  statsSection: {
    marginBottom: 24,
  },

  statRow: {
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingVertical: 12,
  },

  statLabel: {
    fontSize: 14,
    fontWeight: "500",
  },

  statValue: {
    marginTop: 4,
    color: "#555",
  },

  quoteSection: {
    marginTop: 16,
  },

  quoteTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },

  quoteCard: {
    backgroundColor: "#e0e0e0",
    borderRadius: 12,
    minHeight: 160,
  },

  quoteInner: {
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
    minHeight: 160,
  },

  quoteAuthor: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 6,
  },

  quoteDivider: {
    width: 24,
    height: 2,
    backgroundColor: "#888",
    marginBottom: 12,
  },

  quoteText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",        // 텍스트 중앙
    color: "#333",
  },

  // ── 구독 배너 ──
  freeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F7F7F7',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  premiumBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAF5FF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E8DCFF',
  },
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  bannerEmoji: { fontSize: 28 },
  bannerTitle: { fontSize: 14, fontWeight: '700', color: '#333' },
  bannerTitlePremium: { color: '#7C3AED' },
  bannerSub: { fontSize: 12, color: '#888', marginTop: 2 },
  bannerChevron: { fontSize: 26, color: '#bbb' },
  bannerChevronPremium: { color: '#7C3AED' },

  accountActions: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 24,
    paddingVertical: 8,
  },

  accountDivider: {
    width: 1,
    height: 14,
    backgroundColor: "#ddd",
    marginHorizontal: 16,
  },

  logoutButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },

  logoutText: {
    color: "#555",
    fontSize: 14,
  },

  withdrawButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },

  withdrawText: {
    color: "#bbb",   // 연하게 숨겨놀음
    fontSize: 12,
  },
});
