// app/(tabs)/ranking.tsx
import { API_BASE_URL } from "@/constants/config";
import { FileRankingDto } from "@/types/file";
import { getDeviceId } from "@/utils/deviceId";
import { FontAwesome5 } from "@expo/vector-icons";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from "react";
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

const ITEMS_PER_PAGE = 10;

export default function RankingScreen() {
  const { isPremium, isLoading: isUserLoading } = useUser();
  const [period, setPeriod] = useState<"한달" | "올해">("한달");
  const [rankings, setRankings] = useState<FileRankingDto[]>([]);
  const [displayedItems, setDisplayedItems] = useState(ITEMS_PER_PAGE);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 클라이언트 사이드 통계 계산
  const stats = useMemo(() => {
    if (rankings.length === 0) return null;
    const totalReadCount = rankings.reduce((sum, r) => sum + r.readCount, 0);
    const ratedBooks = rankings.filter(r => r.rating > 0);
    const avgRating = ratedBooks.length > 0
      ? ratedBooks.reduce((sum, r) => sum + r.rating, 0) / ratedBooks.length
      : 0;
    const completedCount = rankings.filter(r => r.progress >= 0.95).length;
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
      const endpoint = period === "한달"
        ? `${API_BASE_URL}/ranking/month`
        : `${API_BASE_URL}/ranking/year`;
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
      setError(err instanceof Error ? err.message : "랭킹을 불러오는데 실패했습니다");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      // 프리미엄 유저는 프리미엄 랝킹 페이지로 이동
      if (isPremium) {
        router.replace('/(tabs)/ranking-premium' as any);
        return;
      }
      console.log('🎯 랜킹 페이지: 화면 포커스됨, period:', period);
      fetchRankings();
    }, [period, isPremium, isUserLoading])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRankings(false);
  }, [period, isUserLoading]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const paddingToBottom = 20;
    
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom) {
      if (displayedItems < rankings.length) {
        setDisplayedItems(prev => Math.min(prev + ITEMS_PER_PAGE, rankings.length));
      }
    }
  };

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

  return (
    <ScrollView 
      style={styles.container} 
      showsVerticalScrollIndicator={false}
      onScroll={handleScroll}
      scrollEventThrottle={400}
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

      {/* 로딩 상태 */}
      {loading && rankings.length === 0 && (
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
      {!loading && !error && visibleRankings.map((item, index) => (
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
                ? new Date(item.lastReadAt).toLocaleDateString("ko-KR")
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

      {/* 더 보기 로딩 */}
      {!loading && visibleRankings.length < rankings.length && (
        <View style={styles.loadMoreContainer}>
          <ActivityIndicator size="small" color="#999" />
          <Text style={styles.loadMoreText}>
            {displayedItems} / {rankings.length}
          </Text>
        </View>
      )}

      {/* 프리미엄 유도 배너 */}
      {!isPremium && !loading && rankings.length > 0 && (
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

  /* 무한 스크롤 */
  loadMoreContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
    gap: 8,
  },
  loadMoreText: {
    fontSize: 13,
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
