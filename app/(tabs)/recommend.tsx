import { API_BASE_URL } from "@/constants/config";
import { getDeviceId } from "@/utils/deviceId";
import { FontAwesome5 } from "@expo/vector-icons";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useUser } from '../../contexts/UserContext';

interface RecommendedFile {
  id: number;
  title: string;
  aiGenre?: string;
  aiKeywords?: string;
  uri?: string;
  preview?: string;
  rating: number;
  progress: number;
}

export default function Recommend() {
  const { user, isPremium } = useUser();
  const [recommendations, setRecommendations] = useState<RecommendedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRecommendations, setHasRecommendations] = useState(false);
  const [hasFetched, setHasFetched] = useState(false); // 추천을 한 번이라도 시도했는지
  const [loadingStep, setLoadingStep] = useState(0);
  const loadingTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const router = useRouter();

  const LOADING_MESSAGES = [
    "열심히 찾는 중...",
    "거의 다 찾았어요...!",
    "이제 화면 보여줄게요",
  ];

  const clearLoadingTimers = () => {
    loadingTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    loadingTimersRef.current = [];
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const fetchRecommendations = async () => {    if (!user) {
      Alert.alert(
        '로그인 필요',
        'AI 추쳍은 로그인 후 이용할 수 있어요.',
        [{ text: '확인' }]
      );
      return;
    }
    if (!isPremium) {
      router.push('/subscription');
      return;
    }    clearLoadingTimers();
    setLoading(true);
    setHasFetched(true); // 추천 시도 기록
    setLoadingStep(0);

    const startTime = Date.now();
    const step1Timer = setTimeout(() => setLoadingStep(1), 700);
    const step2Timer = setTimeout(() => setLoadingStep(2), 1400);
    loadingTimersRef.current.push(step1Timer, step2Timer);
    try {
      const token = await AsyncStorage.getItem("accessToken");
      const deviceId = await getDeviceId();

      const res = await fetch(`${API_BASE_URL}/recommendations`, {
        headers: {
          "X-Device-Id": deviceId,
          ...(token && { Authorization: `Bearer ${token}` })
        },
      });
      if (res.ok) {
        const data = await res.json();
        setRecommendations(data);
        setHasRecommendations(data.length > 0);
      }
    } catch (e) {
      console.error("추천 불러오기 실패:", e);
    } finally {
      const minLoadingMs = 2000;
      const elapsed = Date.now() - startTime;
      if (elapsed < minLoadingMs) {
        await sleep(minLoadingMs - elapsed);
      }
      setLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      clearLoadingTimers();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      // 탭 포커스될 때마다 추천 새로고침 (단, 첫 진입 시엔 자동으로 불러오지 않음)
      if (hasFetched) {
        fetchRecommendations();
      }
    }, [hasFetched])
  );

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

  return (
    <SafeAreaView style={styles.container}>
      {/* 첫 진입 상태: 아직 추천을 받지 않음 */}
      {!hasFetched && !loading && (
        <View style={styles.emptyContainer}>
          {/* 아이콘 */}
          <FontAwesome5 name="book-open" size={64} color="#ddd" />
          
          {/* 후킹 문구 */}
          <Text style={styles.hookingText}>
            나에게 맞는 책을 만나기는{"\n"}하늘의 별따기 ⭐
          </Text>
          <Text style={styles.subText}>
            AI가 당신의 취향을 분석해{"\n"}딱 맞는 책을 찾아드려요
          </Text>
          {/* 프리미엄 배지 */}
          {(!user || !isPremium) && (
            <View style={styles.premiumBadge}>
              <Text style={styles.premiumBadgeText}>🔒 프리미엄 전용 기능</Text>
            </View>
          )}
          {/* 추천받기 버튼 */}
          <TouchableOpacity
            style={styles.bigButton}
            onPress={fetchRecommendations}
            activeOpacity={0.8}
          >
            <FontAwesome5 name="magic" size={24} color="#fff" />
            <Text style={styles.buttonText}>추천받기!</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 추천을 시도했지만 결과가 없는 경우 */}
      {hasFetched && !hasRecommendations && !loading && (
        <View style={styles.emptyContainer}>
          <FontAwesome5 name="book-reader" size={64} color="#ddd" />
          
          <Text style={styles.hookingText}>
            아직 추천할 책이 부족해요 📚
          </Text>
          <Text style={styles.subText}>
            더 많은 책을 읽고 평가하면{"\n"}더 정확한 추천을 받을 수 있어요
          </Text>

          <View style={styles.tipsBox}>
            <Text style={styles.tipsTitle}>💡 추천 정확도를 높이려면?</Text>
            <Text style={styles.tipsText}>• 최소 3권 이상의 책을 읽어보세요</Text>
            <Text style={styles.tipsText}>• 읽은 책에 별점을 매겨주세요</Text>
            <Text style={styles.tipsText}>• 다양한 장르를 시도해보세요</Text>
          </View>

          <TouchableOpacity
            style={[styles.bigButton, styles.secondaryButton]}
            onPress={fetchRecommendations}
            activeOpacity={0.8}
          >
            <FontAwesome5 name="redo" size={20} color="#007AFF" />
            <Text style={[styles.buttonText, styles.secondaryButtonText]}>다시 시도하기</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>
            {LOADING_MESSAGES[loadingStep] ?? "AI가 분석 중..."}
          </Text>
        </View>
      )}

      {hasRecommendations && !loading && (
        <ScrollView 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 40, paddingBottom: 20 }}
        >
          <Text style={styles.sectionTitle}>당신을 위한 추천 📚</Text>
          
          {recommendations.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.card}
              onPress={() => {
                // reader 페이지로 이동 (구현 필요시)
                router.push({
                        pathname: "/reader",
                        params: { fileId: item.id, uri: item.uri, name: item.title  }
                      })
              }}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.aiGenre && (
                  <View style={styles.genreBadge}>
                    <Text style={styles.genreText}>{item.aiGenre}</Text>
                  </View>
                )}
              </View>

              {item.preview && (
                <Text style={styles.preview} numberOfLines={2}>
                  {item.preview}
                </Text>
              )}

              <View style={styles.cardFooter}>
                <View style={styles.starRow}>{renderStars(item.rating)}</View>
                {item.progress > 0 && (
                  <Text style={styles.progressText}>
                    {Math.round(item.progress * 100)}% 읽음
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          ))}

          <View style={{ height: 40 }} />
          
          {/* 다시 추천받기 버튼 */}
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={fetchRecommendations}
          >
            <FontAwesome5 name="sync-alt" size={16} color="#007AFF" />
            <Text style={styles.refreshText}>다시 추천받기</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12,
  },
  sectionHeader: {
    marginBottom: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  hookingText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#333",
    textAlign: "center",
    marginTop: 30,
    marginBottom: 12,
    lineHeight: 32,
  },
  subText: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    marginBottom: 40,
    lineHeight: 22,
  },
  bigButton: {
    backgroundColor: "#007AFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    paddingHorizontal: 40,
    borderRadius: 16,
    gap: 12,
    elevation: 4,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111",
    marginBottom: 16,
  },
  card: {
    backgroundColor: "#f7f7f7",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: "#111",
    marginRight: 8,
  },
  genreBadge: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  genreText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  preview: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  starRow: {
    flexDirection: "row",
  },
  progressText: {
    fontSize: 13,
    color: "#007AFF",
    fontWeight: "600",
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    gap: 8,
    marginTop: 20,
  },
  refreshText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "600",
  },
  tipsBox: {
    backgroundColor: "#F0F8FF",
    borderRadius: 12,
    padding: 20,
    marginVertical: 24,
    width: "100%",
    borderWidth: 1,
    borderColor: "#D0E7FF",
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333",
    marginBottom: 12,
  },
  tipsText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 6,
    lineHeight: 20,
  },
  secondaryButton: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#007AFF",
  },
  secondaryButtonText: {
    color: "#007AFF",
  },
  premiumBadge: {
    backgroundColor: '#FAF5FF',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E8DCFF',
  },
  premiumBadgeText: {
    color: '#7C3AED',
    fontSize: 13,
    fontWeight: '600',
  },
});
