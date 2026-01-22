// app/(tabs)/ranking.tsx
import { API_BASE_URL } from "@/constants/config";
import { FileRankingDto } from "@/types/file";
import React, { useCallback, useEffect, useState } from "react";
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

const ITEMS_PER_PAGE = 10;

export default function RankingScreen() {
  const [period, setPeriod] = useState<"한달" | "올해">("한달");
  const [rankings, setRankings] = useState<FileRankingDto[]>([]);
  const [displayedItems, setDisplayedItems] = useState(ITEMS_PER_PAGE);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRankings = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    
    try {
      const endpoint = period === "한달" 
        ? `${API_BASE_URL}/ranking/month`
        : `${API_BASE_URL}/ranking/year`;
      
      const response = await fetch(endpoint);
      
      if (!response.ok) {
        throw new Error(`서버 오류: ${response.status}`);
      }

      const data: FileRankingDto[] = await response.json();
      setRankings(data);
      setDisplayedItems(ITEMS_PER_PAGE);
    } catch (err) {
      console.error("랭킹 로드 실패:", err);
      setError(err instanceof Error ? err.message : "랭킹을 불러오는데 실패했습니다");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRankings();
  }, [period]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchRankings(false);
  }, [period]);

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
      <Text
        key={i}
        style={i < rating ? styles.starOn : styles.starOff}
      >
        ★
      </Text>
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
        <View key={item.fileId} style={styles.card}>
          <Text style={styles.rank}>{index + 1}.</Text>

          <View style={styles.cardContent}>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>

            <Text style={styles.date}>
              {new Date(item.uploadDate).toLocaleDateString('ko-KR')}
            </Text>
            <Text style={styles.progress}>
              진행도: {Math.round(item.progress)}%
            </Text>

            <View style={styles.starRow}>
              {renderStars(item.rating)}
            </View>
          </View>

          <Text style={styles.readCount}>{item.readCount}회</Text>
        </View>
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

      {/* 하단 여백 */}
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
    backgroundColor: "#e0e0e0",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    alignItems: "flex-start",
    minHeight: 120,
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

  starOn: {
    fontSize: 18,
    color: "#f4a261",
    marginRight: 2,
  },

  starOff: {
    fontSize: 18,
    color: "#bbb",
    marginRight: 2,
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
});
