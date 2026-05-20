import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useUser } from "../contexts/UserContext";
import { BASE_URL } from "../utils/api";

type AiInfo = {
  genre: string;
  keywords: string[];
  mood: string;
  summary: string;
  target: string;
};

type AiAnalysisModalProps = {
  visible: boolean;
  fileId: string | null;
  fileTitle: string;
  onClose: () => void;
};

export default function AiAnalysisModal({
  visible,
  fileId,
  fileTitle,
  onClose,
}: AiAnalysisModalProps) {
  const { isPremium, deviceId } = useUser();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AiInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (visible && isPremium && fileId) {
      fetchAnalysis();
    }
    if (!visible) {
      setAnalysis(null);
      setFailed(false);
    }
  }, [visible, isPremium, fileId]);

  async function fetchAnalysis() {
    setLoading(true);
    setFailed(false);
    try {
      const token = await AsyncStorage.getItem("accessToken");
      const res = await fetch(`${BASE_URL}/files/${fileId}/ai-info`, {
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
          ...(deviceId && { "X-Device-Id": deviceId }),
        },
      });
      if (res.ok) {
        const data = await res.json();
        console.log("📊 AI 분석 결과:", data);
        // keywords가 문자열로 오면 파싱, 없으면 빈 배열
        if (typeof data.keywords === "string") {
          console.log("🔍 keywords 문자열 감지:", data.keywords);

          try {
            // 1) JSON 배열 문자열인 경우
            const parsed = JSON.parse(data.keywords);

            data.keywords = Array.isArray(parsed) ? parsed : [];
            console.log("✅ keywords JSON 파싱 성공:", data.keywords);
          } catch {
            // 2) 그냥 "가정, 부부, 생활" 같은 쉼표 문자열인 경우
            data.keywords = data.keywords
              .split(",")
              .map((keyword: string) => keyword.trim())
              .filter(Boolean);

            console.log("✅ keywords 쉼표 문자열 변환 성공:", data.keywords);
          }
        }
        if (!Array.isArray(data.keywords)) data.keywords = [];
        setAnalysis(data);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "flex-end",
        }}
      >
        <View
          style={{
            backgroundColor: "#fff",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 24,
            maxHeight: "82%",
          }}
        >
          {/* 헤더 */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "bold", color: "#1a1a1a" }}>
              ✨ AI 분석
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={{ fontSize: 15, color: "#888" }}>닫기</Text>
            </TouchableOpacity>
          </View>

          {/* 파일 제목 */}
          <Text
            style={{ fontSize: 13, color: "#aaa", marginBottom: 20 }}
            numberOfLines={1}
          >
            {fileTitle}
          </Text>

          {/* ── 비프리미엄 ── */}
          {!isPremium && (
            <View style={{ alignItems: "center", paddingVertical: 32 }}>
              <Text style={{ fontSize: 44, marginBottom: 14 }}>🔒</Text>
              <Text
                style={{ fontSize: 17, fontWeight: "bold", marginBottom: 8, color: "#1a1a1a" }}
              >
                프리미엄 전용 기능
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  color: "#777",
                  textAlign: "center",
                  lineHeight: 22,
                  marginBottom: 28,
                  paddingHorizontal: 12,
                }}
              >
                AI가 책 내용을 자동으로 분석해{"\n"}장르·키워드·분위기·요약을 알려드려요.
              </Text>
              <TouchableOpacity
                onPress={() => {
                  onClose();
                  router.push("/subscription" as any);
                }}
                style={{
                  backgroundColor: "#7C3AED",
                  paddingHorizontal: 36,
                  paddingVertical: 14,
                  borderRadius: 14,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 16 }}>
                  프리미엄 시작하기 →
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── 로딩 중 ── */}
          {isPremium && loading && (
            <View style={{ paddingVertical: 48, alignItems: "center" }}>
              <ActivityIndicator size="large" color="#7C3AED" />
              <Text style={{ marginTop: 14, color: "#888", fontSize: 14 }}>
                분석 불러오는 중...
              </Text>
            </View>
          )}

          {/* ── 실패 ── */}
          {isPremium && !loading && failed && (
            <View style={{ alignItems: "center", paddingVertical: 32 }}>
              <Text style={{ fontSize: 14, color: "#999" }}>
                분석 정보를 불러올 수 없어요.
              </Text>
              <TouchableOpacity onPress={fetchAnalysis} style={{ marginTop: 14 }}>
                <Text style={{ color: "#7C3AED", fontWeight: "600" }}>
                  다시 시도
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── 분석 결과 ── */}
          {isPremium && !loading && analysis && (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* 요약 */}
              <View
                style={{
                  backgroundColor: "#F5F0FF",
                  borderRadius: 14,
                  padding: 16,
                  marginBottom: 12,
                }}
              >
                <Text style={{ fontWeight: "bold", color: "#7C3AED", marginBottom: 8, fontSize: 14 }}>
                  📖 요약
                </Text>
                <Text style={{ fontSize: 14, color: "#333", lineHeight: 22 }}>
                  {analysis.summary}
                </Text>
              </View>

              {/* 장르 + 분위기 */}
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                <View
                  style={{
                    flex: 1,
                    backgroundColor: "#FFF8E1",
                    borderRadius: 14,
                    padding: 16,
                  }}
                >
                  <Text style={{ fontWeight: "bold", color: "#D97706", marginBottom: 6, fontSize: 14 }}>
                    🎭 장르
                  </Text>
                  <Text style={{ fontSize: 14, color: "#333" }}>{analysis.genre}</Text>
                </View>
                <View
                  style={{
                    flex: 1,
                    backgroundColor: "#F0F9FF",
                    borderRadius: 14,
                    padding: 16,
                  }}
                >
                  <Text style={{ fontWeight: "bold", color: "#0284C7", marginBottom: 6, fontSize: 14 }}>
                    🌈 분위기
                  </Text>
                  <Text style={{ fontSize: 14, color: "#333" }}>{analysis.mood}</Text>
                </View>
              </View>

              {/* 키워드 */}
              <View
                style={{
                  backgroundColor: "#F0FFF4",
                  borderRadius: 14,
                  padding: 16,
                  marginBottom: 12,
                }}
              >
                <Text style={{ fontWeight: "bold", color: "#059669", marginBottom: 10, fontSize: 14 }}>
                  🏷️ 키워드
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {analysis.keywords.map((kw, i) => (
                    <View
                      key={i}
                      style={{
                        backgroundColor: "#D1FAE5",
                        borderRadius: 20,
                        paddingHorizontal: 12,
                        paddingVertical: 4,
                      }}
                    >
                      <Text style={{ fontSize: 13, color: "#065F46" }}>{kw}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* 추천 대상 */}
              <View
                style={{
                  backgroundColor: "#FFF1F2",
                  borderRadius: 14,
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <Text style={{ fontWeight: "bold", color: "#BE123C", marginBottom: 8, fontSize: 14 }}>
                  🎯 추천 대상
                </Text>
                <Text style={{ fontSize: 14, color: "#333", lineHeight: 22 }}>
                  {analysis.target}
                </Text>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
