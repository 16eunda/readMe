// app/(tabs)/ranking-premium.tsx
import { API_BASE_URL } from "@/constants/config";
import { FileRankingDto } from "@/types/file";
import { getDeviceId } from "@/utils/deviceId";
import { FontAwesome5 } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useUser } from "../../contexts/UserContext";

const PURPLE = "#7C3AED";
const ITEMS_PER_PAGE = 10;

export default function RankingPremiumScreen() {
  const { isPremium, isLoading: isUserLoading } = useUser();
  const now = new Date();

  const [period, setPeriod] = useState<"한달" | "올해">("한달");
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [rankings, setRankings] = useState<FileRankingDto[]>([]);
  const [displayedItems, setDisplayedItems] = useState(ITEMS_PER_PAGE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 비프리미엄 → /subscription 리다이렉트
  useFocusEffect(
    useCallback(() => {
      if (!isPremium) {
        router.replace("/subscription" as any);
      }
    }, [isPremium])
  );

  // 클라이언트 통계 계산
  const stats = useMemo(() => {
    if (rankings.length === 0) return null;
    const totalReadCount = rankings.reduce((sum, r) => sum + r.readCount, 0);
    const ratedBooks = rankings.filter((r) => r.rating > 0);
    const avgRating =
      ratedBooks.length > 0
        ? ratedBooks.reduce((sum, r) => sum + r.rating, 0) / ratedBooks.length
        : 0;
    const completedCount = rankings.filter((r) => r.progress >= 0.95).length;
    return {
      totalReadCount,
      avgRating: Math.round(avgRating * 10) / 10,
      completedCount,
    };
  }, [rankings]);

  const fetchRankings = async (showLoading = true) => {
    if (isUserLoading) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const token = await AsyncStorage.getItem("accessToken");
      const deviceId = await getDeviceId();
      const endpoint =
        period === "한달"
          ? `${API_BASE_URL}/ranking/month?year=${selectedYear}&month=${selectedMonth}`
          : `${API_BASE_URL}/ranking/year?year=${selectedYear}`;
      const response = await fetch(endpoint, {
        headers: {
          "X-Device-Id": deviceId,
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      });
      if (!response.ok) throw new Error(`서버 오류: ${response.status}`);
      const data: FileRankingDto[] = await response.json();
      setRankings(data);
      setDisplayedItems(ITEMS_PER_PAGE);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "랭킹을 불러오는데 실패했습니다"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchRankings(); // TODO: 테스트 끝나면 → if (isPremium) fetchRankings();
    }, [period, selectedYear, selectedMonth, isPremium, isUserLoading])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRankings(false);
  }, [period, selectedYear, selectedMonth, isUserLoading]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 20) {
      if (displayedItems < rankings.length) {
        setDisplayedItems((prev) =>
          Math.min(prev + ITEMS_PER_PAGE, rankings.length)
        );
      }
    }
  };

  const renderStars = (rating: number) =>
    Array.from({ length: 5 }, (_, i) => (
      <FontAwesome5
        key={i}
        name="star"
        size={14}
        solid={i < rating}
        color={i < rating ? "#FFD84E" : "#D1D1D1"}
        style={{ marginRight: 2 }}
      />
    ));

  const getMedal = (i: number) => {
    if (i === 0) return "🥇";
    if (i === 1) return "🥈";
    if (i === 2) return "🥉";
    return null;
  };

  // 이전 기간으로
  const prevPeriod = () => {
    if (period === "한달") {
      if (selectedMonth === 1) {
        setSelectedMonth(12);
        setSelectedYear((y) => y - 1);
      } else {
        setSelectedMonth((m) => m - 1);
      }
    } else {
      setSelectedYear((y) => y - 1);
    }
  };

  // 다음 기간으로 (현재 이후는 이동 불가)
  const nextPeriod = () => {
    if (isNextDisabled()) return;
    if (period === "한달") {
      if (selectedMonth === 12) {
        setSelectedMonth(1);
        setSelectedYear((y) => y + 1);
      } else {
        setSelectedMonth((m) => m + 1);
      }
    } else {
      setSelectedYear((y) => y + 1);
    }
  };

  const isNextDisabled = () => {
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth() + 1;
    if (period === "한달")
      return selectedYear === nowYear && selectedMonth === nowMonth;
    return selectedYear >= nowYear;
  };

  const periodLabel =
    period === "한달" ? `${selectedYear}년 ${selectedMonth}월` : `${selectedYear}년`;

  const visibleRankings = rankings.slice(0, displayedItems);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={400}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* 프리미엄 배지 */}
        <View style={styles.premiumBadge}>
          <Text style={styles.premiumBadgeText}>👑 readMe 프리미엄</Text>
        </View>

        {/* 기간 탭 */}
        <View style={styles.tabContainer}>
          {(["한달", "올해"] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, period === tab && styles.activeTab]}
              onPress={() => setPeriod(tab)}
            >
              <Text
                style={[styles.tabText, period === tab && styles.activeTabText]}
              >
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 날짜 네비게이터 */}
        <View style={styles.navigator}>
          <TouchableOpacity style={styles.navBtn} onPress={prevPeriod}>
            <Text style={styles.navArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.navLabel}>{periodLabel}</Text>
          <TouchableOpacity
            style={[styles.navBtn, isNextDisabled() && styles.navBtnDisabled]}
            onPress={nextPeriod}
            disabled={isNextDisabled()}
          >
            <Text
              style={[
                styles.navArrow,
                isNextDisabled() && styles.navArrowDisabled,
              ]}
            >
              ›
            </Text>
          </TouchableOpacity>
        </View>

        {/* 통계 요약 카드 */}
        {stats && (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{stats.totalReadCount}</Text>
              <Text style={styles.statLabel}>총 읽기 횟수</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>
                {stats.avgRating > 0 ? `★ ${stats.avgRating}` : "-"}
              </Text>
              <Text style={styles.statLabel}>평균 별점</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{stats.completedCount}</Text>
              <Text style={styles.statLabel}>완독</Text>
            </View>
          </View>
        )}

        {/* 로딩 */}
        {loading && rankings.length === 0 && (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={PURPLE} />
            <Text style={styles.loadingText}>랭킹을 불러오는 중...</Text>
          </View>
        )}

        {/* 에러 */}
        {!loading && error && (
          <View style={styles.centerContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => fetchRankings()}
            >
              <Text style={styles.retryButtonText}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 빈 상태 */}
        {!loading && !error && rankings.length === 0 && (
          <View style={styles.centerContainer}>
            <Text style={styles.emptyText}>📊</Text>
            <Text style={styles.emptySubText}>
              해당 기간의 랭킹 데이터가 없습니다
            </Text>
          </View>
        )}

        {/* 랭킹 카드 */}
        {!loading &&
          !error &&
          visibleRankings.map((item, index) => (
            <TouchableOpacity
              key={item.fileId}
              style={[styles.card, index < 3 && styles.cardTop]}
              onPress={() =>
                router.push({
                  pathname: "/reader",
                  params: {
                    fileId: item.fileId,
                    uri: item.uri,
                    name: item.title,
                  },
                })
              }
              activeOpacity={0.75}
            >
              <View style={styles.rankCol}>
                {getMedal(index) ? (
                  <Text style={styles.medal}>{getMedal(index)}</Text>
                ) : (
                  <Text style={styles.rankNum}>{index + 1}</Text>
                )}
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <View style={styles.progressBg}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.round(item.progress * 100)}%` as any,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.progressLabel}>
                  {Math.round(item.progress * 100)}% 읽음
                </Text>
                <View style={styles.starRow}>{renderStars(item.rating)}</View>
              </View>
              <View style={styles.countCol}>
                <Text style={styles.countNum}>{item.readCount}</Text>
                <Text style={styles.countLabel}>회</Text>
              </View>
            </TouchableOpacity>
          ))}

        {/* 무한 스크롤 로딩 */}
        {!loading && visibleRankings.length < rankings.length && (
          <View style={styles.loadMoreContainer}>
            <ActivityIndicator size="small" color="#999" />
            <Text style={styles.loadMoreText}>
              {displayedItems} / {rankings.length}
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 20 },

  premiumBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#FAF5FF",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E8DCFF",
  },
  premiumBadgeText: { fontSize: 13, fontWeight: "700", color: PURPLE },

  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#e0e0e0",
    borderRadius: 20,
    padding: 4,
    marginBottom: 16,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 16, alignItems: "center" },
  activeTab: { backgroundColor: "#fff" },
  tabText: { fontSize: 14, color: "#555" },
  activeTabText: { fontWeight: "700", color: "#000" },

  navigator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    gap: 20,
  },
  navBtn: { padding: 8 },
  navBtnDisabled: { opacity: 0.3 },
  navArrow: { fontSize: 32, color: PURPLE, fontWeight: "700" },
  navArrowDisabled: { color: "#ccc" },
  navLabel: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111",
    minWidth: 140,
    textAlign: "center",
  },

  statsRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: "#FAF5FF",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E8DCFF",
  },
  statNum: {
    fontSize: 18,
    fontWeight: "800",
    color: PURPLE,
    marginBottom: 4,
  },
  statLabel: { fontSize: 11, color: "#9F67E8" },

  card: {
    flexDirection: "row",
    backgroundColor: "#f7f7f7",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    alignItems: "center",
    elevation: 1,
  },
  cardTop: { backgroundColor: "#FFFBF0" },
  rankCol: { width: 36, alignItems: "center", marginRight: 12 },
  medal: { fontSize: 26 },
  rankNum: { fontSize: 16, fontWeight: "800", color: "#555" },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: "700", marginBottom: 8, color: "#111" },
  progressBg: {
    height: 5,
    backgroundColor: "#E5E5E5",
    borderRadius: 3,
    marginBottom: 4,
  },
  progressFill: { height: 5, backgroundColor: PURPLE, borderRadius: 3 },
  progressLabel: { fontSize: 11, color: "#999", marginBottom: 6 },
  starRow: { flexDirection: "row", alignItems: "center" },
  countCol: { alignItems: "center", marginLeft: 12 },
  countNum: { fontSize: 20, fontWeight: "800", color: "#333" },
  countLabel: { fontSize: 11, color: "#999" },

  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 300,
    paddingTop: 40,
  },
  loadingText: { marginTop: 12, fontSize: 14, color: "#666" },
  errorText: {
    fontSize: 15,
    color: "#e74c3c",
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: PURPLE,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  emptyText: { fontSize: 48, marginBottom: 12 },
  emptySubText: { fontSize: 15, color: "#999" },

  loadMoreContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 8,
  },
  loadMoreText: { fontSize: 13, color: "#999" },
});
