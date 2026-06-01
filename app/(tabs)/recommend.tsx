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

// 장르별 색상 매핑
const GENRE_COLORS: Record<string, { bg: string; text: string }> = {
  "로맨스": { bg: "#FEE2E2", text: "#BE123C" },
  "판타지": { bg: "#EDE9FE", text: "#6D28D9" },
  "동화": { bg: "#FEF9C3", text: "#92400E" },
  "논픽션": { bg: "#DCFCE7", text: "#166534" },
  "미스터리": { bg: "#E0F2FE", text: "#075985" },
  "SF": { bg: "#F0FDF4", text: "#14532D" },
  "미분류": { bg: "#F3F4F6", text: "#6B7280" },
};

function getGenreStyle(genre?: string) {
  if (!genre) return GENRE_COLORS["미분류"];
  return GENRE_COLORS[genre] ?? { bg: "#EDE9FE", text: "#6D28D9" };
}

// 파일 확장자로 아이콘 결정
function getFileIcon(title: string) {
  if (title.endsWith(".epub")) return { icon: "book", color: "#7C3AED" };
  return { icon: "file-alt", color: "#0284C7" };
}

export default function Recommend() {
  const { user, isPremium, isLoading: isUserLoading } = useUser();
  const [recommendations, setRecommendations] = useState<RecommendedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRecommendations, setHasRecommendations] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const loadingTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const router = useRouter();

  const LOADING_MESSAGES = [
    "취향을 분석하는 중...",
    "딱 맞는 책을 찾고 있어요 📖",
    "거의 다 됐어요!",
  ];

  const clearLoadingTimers = () => {
    loadingTimersRef.current.forEach((id) => clearTimeout(id));
    loadingTimersRef.current = [];
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const fetchRecommendations = async () => {
    if (isUserLoading) return;
    if (!user) {
      Alert.alert("로그인 필요", "AI 추천은 로그인 후 이용할 수 있어요.", [{ text: "확인" }]);
      return;
    }
    if (!isPremium) {
      router.push("/subscription");
      return;
    }
    clearLoadingTimers();
    setLoading(true);
    setHasFetched(true);
    setLoadingStep(0);
    const startTime = Date.now();
    loadingTimersRef.current.push(
      setTimeout(() => setLoadingStep(1), 800),
      setTimeout(() => setLoadingStep(2), 1600),
    );
    try {
      const token = await AsyncStorage.getItem("accessToken");
      const deviceId = await getDeviceId();
      const res = await fetch(`${API_BASE_URL}/recommendations`, {
        headers: {
          "X-Device-Id": deviceId,
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.recommendations ?? []);
        setRecommendations(list);
        setHasRecommendations(list.length > 0);
      }
    } catch (e) {
      console.error("추천 불러오기 실패:", e);
    } finally {
      const elapsed = Date.now() - startTime;
      if (elapsed < 2000) await sleep(2000 - elapsed);
      setLoading(false);
    }
  };

  useEffect(() => () => clearLoadingTimers(), []);
  useFocusEffect(useCallback(() => {}, []));

  return (
    <SafeAreaView style={styles.container}>
      {/* ── 첫 진입 ── */}
      {!hasFetched && !loading && (
        <View style={styles.centerWrap}>
          {/* 그라데이션 원형 배경 */}
          <View style={styles.heroBg}>
            <FontAwesome5 name="magic" size={40} color="#7C3AED" />
          </View>

          <Text style={styles.heroTitle}>AI 맞춤 추천</Text>
          <Text style={styles.heroSub}>
            당신이 읽은 책들을 분석해{"\n"}취향에 딱 맞는 책을 골라드려요
          </Text>

          {(!user || !isPremium) && (
            <View style={styles.premiumChip}>
              <FontAwesome5 name="crown" size={11} color="#D97706" />
              <Text style={styles.premiumChipText}>프리미엄 전용</Text>
            </View>
          )}

          <TouchableOpacity style={styles.cta} onPress={fetchRecommendations} activeOpacity={0.85}>
            <FontAwesome5 name="magic" size={18} color="#fff" />
            <Text style={styles.ctaText}>추천받기</Text>
          </TouchableOpacity>

          {/* 안내 카드 */}
          <View style={styles.infoRow}>
            {[
              { icon: "book", label: "읽은 책 분석" },
              { icon: "brain", label: "AI 취향 파악" },
              { icon: "heart", label: "맞춤 추천" },
            ].map((it, i) => (
              <View key={i} style={styles.infoCard}>
                <FontAwesome5 name={it.icon as any} size={20} color="#7C3AED" />
                <Text style={styles.infoLabel}>{it.label}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── 결과 없음 ── */}
      {hasFetched && !hasRecommendations && !loading && (
        <View style={styles.centerWrap}>
          <View style={[styles.heroBg, { backgroundColor: "#FEF3C7" }]}>
            <FontAwesome5 name="book-reader" size={40} color="#D97706" />
          </View>
          <Text style={styles.heroTitle}>아직 데이터가 부족해요</Text>
          <Text style={styles.heroSub}>
            더 많은 책을 읽고 평가할수록{"\n"}추천 정확도가 올라가요
          </Text>
          <View style={styles.tipsList}>
            {["최소 3권 이상 읽어보세요", "읽은 책에 별점을 남겨보세요", "다양한 장르를 시도해보세요"].map((t, i) => (
              <View key={i} style={styles.tipRow}>
                <View style={styles.tipDot} />
                <Text style={styles.tipText}>{t}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={[styles.cta, { backgroundColor: "#F59E0B" }]} onPress={fetchRecommendations} activeOpacity={0.85}>
            <FontAwesome5 name="redo" size={16} color="#fff" />
            <Text style={styles.ctaText}>다시 시도하기</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── 로딩 ── */}
      {loading && (
        <View style={styles.centerWrap}>
          <View style={styles.loadingRing}>
            <ActivityIndicator size="large" color="#7C3AED" />
          </View>
          <Text style={styles.loadingTitle}>{LOADING_MESSAGES[loadingStep]}</Text>
          <View style={styles.dotRow}>
            {LOADING_MESSAGES.map((_, i) => (
              <View key={i} style={[styles.dot, i === loadingStep && styles.dotActive]} />
            ))}
          </View>
        </View>
      )}

      {/* ── 추천 결과 ── */}
      {hasRecommendations && !loading && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
          {/* 헤더 */}
          <View style={styles.resultHeader}>
            <View>
              <Text style={styles.resultTitle}>맞춤 추천 결과</Text>
              <Text style={styles.resultSub}>총 {recommendations.length}권을 골랐어요</Text>
            </View>
            <TouchableOpacity style={styles.reloadBtn} onPress={fetchRecommendations}>
              <FontAwesome5 name="sync-alt" size={14} color="#7C3AED" />
              <Text style={styles.reloadText}>새로고침</Text>
            </TouchableOpacity>
          </View>

          {/* 카드 목록 */}
          {recommendations.map((item, index) => {
            const { icon, color } = getFileIcon(item.title);
            const genreStyle = getGenreStyle(item.aiGenre);
            const pct = Math.round(item.progress * 100);
            const keywords = item.aiKeywords
              ? item.aiKeywords.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 3)
              : [];

            return (
              <TouchableOpacity
                key={item.id}
                style={styles.card}
                onPress={() => router.push({ pathname: "/reader", params: { fileId: item.id, uri: item.uri, name: item.title } })}
                activeOpacity={0.9}
              >
                {/* 왼쪽 인덱스 */}
                <View style={styles.cardIndex}>
                  <Text style={styles.cardIndexText}>{String(index + 1).padStart(2, "0")}</Text>
                </View>

                {/* 본문 */}
                <View style={styles.cardBody}>
                  {/* 파일 아이콘 + 제목 */}
                  <View style={styles.cardTop}>
                    <View style={[styles.fileIcon, { backgroundColor: color + "22" }]}>
                      <FontAwesome5 name={icon as any} size={16} color={color} />
                    </View>
                    <Text style={styles.cardTitle} numberOfLines={2}>{item.title.replace(/\.[^.]+$/, "")}</Text>
                  </View>

                  {/* 키워드 태그 */}
                  {keywords.length > 0 && (
                    <View style={styles.tagRow}>
                      {keywords.map((kw, ki) => (
                        <View key={ki} style={styles.tag}>
                          <Text style={styles.tagText}># {kw}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* 하단 정보 */}
                  <View style={styles.cardMeta}>
                    {item.aiGenre ? (
                      <View style={[styles.genreChip, { backgroundColor: genreStyle.bg }]}>
                        <Text style={[styles.genreChipText, { color: genreStyle.text }]}>{item.aiGenre}</Text>
                      </View>
                    ) : null}
                    {pct > 0 && (
                      <View style={styles.progressWrap}>
                        <View style={styles.progressBar}>
                          <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
                        </View>
                        <Text style={styles.progressLabel}>{pct}%</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* 화살표 */}
                <FontAwesome5 name="chevron-right" size={12} color="#CBD5E1" />
              </TouchableOpacity>
            );
          })}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FAFAFA" },

  // ── 중앙 정렬 래퍼 ──
  centerWrap: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32 },

  // ── 히어로 ──
  heroBg: {
    width: 88, height: 88, borderRadius: 28,
    backgroundColor: "#EDE9FE",
    justifyContent: "center", alignItems: "center",
    marginBottom: 20,
    shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15, shadowRadius: 12, elevation: 5,
  },
  heroTitle: { fontSize: 24, fontWeight: "800", color: "#1E1B4B", marginBottom: 8, textAlign: "center" },
  heroSub: { fontSize: 14, color: "#64748B", textAlign: "center", lineHeight: 22, marginBottom: 28 },

  premiumChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#FEF3C7", borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 24,
    borderWidth: 1, borderColor: "#FDE68A",
  },
  premiumChipText: { fontSize: 12, fontWeight: "700", color: "#D97706" },

  cta: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#7C3AED",
    paddingVertical: 16, paddingHorizontal: 40,
    borderRadius: 18, marginBottom: 36,
    shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "700" },

  infoRow: { flexDirection: "row", gap: 12, marginTop: 4 },
  infoCard: {
    flex: 1, alignItems: "center", gap: 8,
    backgroundColor: "#fff", borderRadius: 16, paddingVertical: 16,
    borderWidth: 1, borderColor: "#EDE9FE",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  infoLabel: { fontSize: 11, color: "#7C3AED", fontWeight: "600", textAlign: "center" },

  // ── 로딩 ──
  loadingRing: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: "#EDE9FE",
    justifyContent: "center", alignItems: "center",
    marginBottom: 24,
  },
  loadingTitle: { fontSize: 17, fontWeight: "700", color: "#1E1B4B", marginBottom: 16 },
  dotRow: { flexDirection: "row", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#DDD6FE" },
  dotActive: { backgroundColor: "#7C3AED", width: 20 },

  // ── 결과 없음 ──
  tipsList: { width: "100%", marginBottom: 28, gap: 10 },
  tipRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  tipDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#F59E0B" },
  tipText: { fontSize: 14, color: "#475569", lineHeight: 20 },

  // ── 결과 목록 ──
  listContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },
  resultHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end",
    marginBottom: 20,
  },
  resultTitle: { fontSize: 20, fontWeight: "800", color: "#1E1B4B" },
  resultSub: { fontSize: 13, color: "#94A3B8", marginTop: 3 },
  reloadBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#EDE9FE", paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 12,
  },
  reloadText: { fontSize: 13, color: "#7C3AED", fontWeight: "600" },

  // ── 카드 ──
  card: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff", borderRadius: 20,
    padding: 16, marginBottom: 12,
    shadowColor: "#1E1B4B", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07, shadowRadius: 10, elevation: 3,
    gap: 12,
  },
  cardIndex: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: "#F1F5F9",
    justifyContent: "center", alignItems: "center",
  },
  cardIndexText: { fontSize: 12, fontWeight: "700", color: "#94A3B8" },
  cardBody: { flex: 1, gap: 8 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  fileIcon: {
    width: 32, height: 32, borderRadius: 8,
    justifyContent: "center", alignItems: "center",
  },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: "#1E293B", lineHeight: 20 },

  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  tag: { backgroundColor: "#F8FAFC", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: "#E2E8F0" },
  tagText: { fontSize: 11, color: "#64748B", fontWeight: "500" },

  cardMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  genreChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  genreChipText: { fontSize: 11, fontWeight: "700" },

  progressWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  progressBar: { width: 60, height: 5, backgroundColor: "#E2E8F0", borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#7C3AED", borderRadius: 4 },
  progressLabel: { fontSize: 11, color: "#7C3AED", fontWeight: "700" },
});

