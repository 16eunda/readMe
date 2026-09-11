// app/(tabs)/ranking.tsx
import { API_BASE_URL } from "@/constants/config";
import { FileRankingDto } from "@/types/file";
import { getDeviceId } from "@/utils/deviceId";
import { FontAwesome5 } from "@expo/vector-icons";
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useUser } from '../../contexts/UserContext';
import { authenticatedFetch } from '../../utils/api';

const ITEMS_PER_BATCH = 20;

const formatRankingDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '날짜 정보 없음';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}. ${month}. ${day}`;
};

export default function RankingScreen() {
  const { isPremium, isLoading: isUserLoading, checkSubscription, markPremiumRequired } = useUser();
  const [period, setPeriod] = useState<"한달" | "올해">("한달");
  const [rankings, setRankings] = useState<FileRankingDto[]>([]);
  const [displayedItems, setDisplayedItems] = useState(ITEMS_PER_BATCH);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const revealStartedAtRef = useRef<number | null>(null);

  const fetchRankings = useCallback(async (showLoading = true) => {
    if (isUserLoading) return;
    const requestId = ++requestIdRef.current;
    const startedAt = Date.now();
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const deviceId = await getDeviceId();
      const requestStartedAt = Date.now();
      const endpoint = period === "한달"
        ? `${API_BASE_URL}/ranking/month`
        : `${API_BASE_URL}/ranking/year`;
      const response = await authenticatedFetch(endpoint, {}, deviceId);
      const responseAt = Date.now();
      if (requestId !== requestIdRef.current) return;
      if (response.status === 403) {
        const text = await response.text().catch(() => "");
        if (text.includes("PREMIUM_REQUIRED")) {
          await markPremiumRequired();
          setRankings([]);
          setError(null);
          return;
        }
      }
      if (!response.ok) throw new Error(`서버 오류: ${response.status}`);
      const data: FileRankingDto[] = await response.json();
      const parsedAt = Date.now();
      if (requestId !== requestIdRef.current) return;
      setRankings(data);
      setDisplayedItems(ITEMS_PER_BATCH);
      requestAnimationFrame(() => {
        console.log("⏱️ Ranking 로딩", {
          deviceIdMs: requestStartedAt - startedAt,
          apiMs: responseAt - requestStartedAt,
          parseMs: parsedAt - responseAt,
          firstRenderMs: Date.now() - parsedAt,
          totalMs: Date.now() - startedAt,
          itemCount: data.length,
        });
      });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "랭킹을 불러오는데 실패했습니다");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [isUserLoading, markPremiumRequired, period]);

  useFocusEffect(
    useCallback(() => {
      if (isUserLoading) return;
      let active = true;
      setLoading(true);
      checkSubscription().then((premium) => {
        if (!active) return;
        // 프리미엄 유저는 프리미엄 랭킹 페이지로 이동
        if (premium) {
          router.replace('/(tabs)/ranking-premium' as any);
          return;
        }
        console.log('🎯 랜킹 페이지: 화면 포커스됨, period:', period);
        fetchRankings();
      });
      return () => {
        active = false;
        requestIdRef.current += 1;
      };
    }, [checkSubscription, fetchRankings, isUserLoading, period])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRankings(false);
  }, [fetchRankings]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const distanceFromEnd = contentSize.height - layoutMeasurement.height - contentOffset.y;

    if (distanceFromEnd <= layoutMeasurement.height && displayedItems < rankings.length) {
      if (revealStartedAtRef.current != null) return;
      revealStartedAtRef.current = Date.now();
      setDisplayedItems(prev => Math.min(prev + ITEMS_PER_BATCH, rankings.length));
    }
  }, [displayedItems, rankings.length]);

  useEffect(() => {
    if (revealStartedAtRef.current == null) return;
    requestAnimationFrame(() => {
      if (revealStartedAtRef.current == null) return;
      console.log("⏱️ Ranking 다음 묶음 표시", {
        displayedItems,
        renderMs: Date.now() - revealStartedAtRef.current,
      });
      revealStartedAtRef.current = null;
    });
  }, [displayedItems]);

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <FontAwesome5
        key={i}
        name="star"
        size={18}
        solid={i < rating}
        color={i < rating ? "#FFD84E" : "#D1D1D1"}
        style={{ marginRight: 2 }}
      />
    ));
  };

  const getPeriodTitle = () => {
    const now = new Date();
    if (period === "한달") {
      return `${now.getMonth() + 1}월 랭킹`;
    }
    return `${now.getFullYear()}년 랭킹`;
  };

  const visibleRankings = rankings.slice(0, displayedItems);
  const hasRankings = rankings.length > 0;
  const showInitialLoading = loading && !hasRankings;

  return (
    <ScrollView 
      style={styles.container} 
      showsVerticalScrollIndicator={false}
      onScroll={handleScroll}
      scrollEventThrottle={100}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* 기간 탭 */}
      <View style={styles.tabContainer}>
        {(["한달", "올해"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tab,
              period === tab && styles.activeTab,
            ]}
            onPress={() => setPeriod(tab)}
          >
            <Text
              style={[
                styles.tabText,
                period === tab && styles.activeTabText,
              ]}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 타이틀 */}
      <Text style={styles.sectionTitle}>{getPeriodTitle()}</Text>

      {/* 프리미엄 유도 배너 */}
      {!isPremium && rankings.length > 0 && (
        <TouchableOpacity
          style={styles.premiumTeaser}
          onPress={() => router.push('/subscription' as any)}
          activeOpacity={0.8}
        >
          <View style={styles.teaserLeft}>
            <Text style={styles.teaserEmoji}>📅</Text>
            <View>
              <Text style={styles.teaserTitle}>지난 달 / 다른 년도 랭킹도 보고 싶다면?</Text>
              <Text style={styles.teaserSub}>프리미엄으로 모든 기간 조회 + 상세 통계</Text>
            </View>
          </View>
          <Text style={styles.teaserChevron}>›</Text>
        </TouchableOpacity>
      )}

      {/* 로딩 상태 */}
      {showInitialLoading && (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>랭킹을 불러오는 중...</Text>
        </View>
      )}

      {/* 에러 상태 */}
      {error && (
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
          <Text style={styles.emptySubText}>아직 랭킹 데이터가 없습니다</Text>
        </View>
      )}

      {/* 랭킹 카드 목록 */}
      {!error && visibleRankings.map((item, index) => (
        <TouchableOpacity key={item.fileId} style={styles.card} 
        onPress={() => {
          // 파일 상세 페이지로 이동
          router.push({
            pathname: "/reader",
            params: { fileId: item.fileId, uri: item.uri, name: item.title }
          })
        }}>
          <Text style={styles.rank}>{index + 1}.</Text>

          <View style={styles.cardContent}>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>

            <Text style={styles.date}>
              {item.lastReadAt
                ? formatRankingDate(item.lastReadAt)
                : '날짜 정보 없음'}
            </Text>
            <Text style={styles.progress}>
              진행도: {Math.round(item.progress * 100)}%
            </Text>

            <View style={styles.starRow}>
              {renderStars(item.rating)}
            </View>
          </View>

          <Text style={styles.readCount}>{item.readCount}회</Text>
        </TouchableOpacity>
      ))}

      {visibleRankings.length > 0 && (
        <View style={styles.bottomPadding} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 20,
  },

  /* 탭 */
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#e0e0e0",
    borderRadius: 20,
    padding: 4,
    marginTop: 20,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 16,
    alignItems: "center",
  },
  activeTab: {
    backgroundColor: "#fff",
  },
  tabText: {
    fontSize: 14,
    color: "#555",
  },
  activeTabText: {
    fontWeight: "700",
    color: "#000",
  },

  /* 타이틀 */
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },

  /* 카드 */
  card: {
    flexDirection: "row",
    backgroundColor: "#f7f7f7",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    alignItems: "flex-start",
    minHeight: 120,
    elevation: 2,
  },

  rank: {
    fontSize: 16,
    fontWeight: "700",
    marginRight: 12,
  },

  cardContent: {
    flex: 1,
  },

  title: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
  },

  date: {
    fontSize: 13,
    color: "#555",
    marginBottom: 4,
  },

  progress: {
    fontSize: 13,
    color: "#555",
    marginBottom: 6,
  },

  starRow: {
    flexDirection: "row",
  },

  readCount: {
    fontSize: 18,
    fontWeight: "700",
    marginLeft: 12,
    alignSelf: "center",
  },

  /* 로딩 & 에러 상태 */
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 400,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  errorText: {
    fontSize: 15,
    color: "#e74c3c",
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptySubText: {
    fontSize: 15,
    color: "#999",
  },

  bottomPadding: {
    height: 40,
  },

  /* 프리미엄 유도 배너 */
  premiumTeaser: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAF5FF',
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E8DCFF',
    marginBottom: 18,
  },
  teaserLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  teaserEmoji: { fontSize: 28 },
  teaserTitle: { fontSize: 14, fontWeight: '700', color: '#7C3AED' },
  teaserSub: { fontSize: 12, color: '#9F67E8', marginTop: 2 },
  teaserChevron: { fontSize: 28, color: '#7C3AED', fontWeight: '700' },
});
