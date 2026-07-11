import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useUser } from "../contexts/UserContext";
import { authenticatedFetch, BASE_URL } from "../utils/api";

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
  const { isPremium, deviceId, markPremiumRequired } = useUser();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AiInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [premiumRequired, setPremiumRequired] = useState(false);

  // 전체 편집 모드
  const [editing, setEditing] = useState(false);
  const [editedData, setEditedData] = useState<AiInfo | null>(null);
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);
  const tagInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible && isPremium && !premiumRequired && fileId) {
      fetchAnalysis();
    }
    if (!visible) {
      setAnalysis(null);
      setFailed(false);
      setPremiumRequired(false);
      setEditing(false);
      setEditedData(null);
      setNewTag("");
    }
  }, [visible, isPremium, premiumRequired, fileId]);

  const showPremiumLock = !isPremium || premiumRequired;

  async function handlePremiumRequired() {
    setAnalysis(null);
    setEditing(false);
    setEditedData(null);
    setFailed(false);
    setPremiumRequired(true);
    await markPremiumRequired();
  }

  async function fetchAnalysis() {
    setLoading(true);
    setFailed(false);
    try {
      const res = await authenticatedFetch(`${BASE_URL}/files/${fileId}/ai-info`, {}, deviceId ?? undefined);
      if (res.ok) {
        const data = await res.json();
        console.log("📊 AI 분석 결과:", data);
        if (data.analysisStatus === "PREMIUM_REQUIRED") {
          await handlePremiumRequired();
          return;
        }
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
        if (res.status === 403) {
          const text = await res.text().catch(() => "");
          if (text.includes("PREMIUM_REQUIRED")) {
            await handlePremiumRequired();
            return;
          }
        }
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  function startEdit() {
    if (!analysis) return;
    setEditedData({ ...analysis, keywords: [...analysis.keywords] });
    setNewTag("");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditedData(null);
    setNewTag("");
  }

  function addTag() {
    const tag = newTag.trim();
    if (!tag || !editedData) { setNewTag(""); return; }
    if (editedData.keywords.includes(tag)) { setNewTag(""); return; }
    setEditedData({ ...editedData, keywords: [...editedData.keywords, tag] });
    setNewTag("");
    setTimeout(() => tagInputRef.current?.focus(), 50);
  }

  function removeTag(index: number) {
    if (!editedData) return;
    setEditedData({ ...editedData, keywords: editedData.keywords.filter((_, i) => i !== index) });
  }

  async function saveAll() {
    if (!fileId || !analysis || !editedData) return;
    setSaving(true);
    try {
      const res = await authenticatedFetch(`${BASE_URL}/files/${fileId}/ai-info`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editedData),
      }, deviceId ?? undefined);
      if (res.ok) {
        setAnalysis({ ...editedData });
        setEditing(false);
        setEditedData(null);
      }
    } catch {
      // 실패 시 편집 상태 유지
      console.error("AI 분석 정보 저장 실패");
    } finally {
      console.log("저장 완료", editedData);
      setSaving(false);
    }
  }

  const data = editing ? editedData : analysis;

  const inputStyle = (borderColor: string) => ({
    fontSize: 14 as const,
    color: "#333" as const,
    lineHeight: 22 as const,
    backgroundColor: "#fff" as const,
    borderRadius: 8 as const,
    paddingHorizontal: 10 as const,
    paddingVertical: 6 as const,
    borderWidth: 1 as const,
    borderColor,
  });

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
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <Text style={{ fontSize: 18, fontWeight: "bold", color: "#1a1a1a" }}>✨ AI 분석</Text>
            {!editing ? (
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={{ fontSize: 15, color: "#888" }}>닫기</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity onPress={cancelEdit} style={{ paddingHorizontal: 14, paddingVertical: 6, backgroundColor: "#F3F4F6", borderRadius: 10 }}>
                  <Text style={{ fontSize: 14, color: "#666" }}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveAll} disabled={saving} style={{ paddingHorizontal: 14, paddingVertical: 6, backgroundColor: "#7C3AED", borderRadius: 10, minWidth: 52, alignItems: "center" }}>
                  {saving ? <ActivityIndicator size={14} color="#fff" /> : <Text style={{ fontSize: 14, color: "#fff", fontWeight: "bold" }}>저장</Text>}
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* 파일 제목 */}
          <Text
            style={{ fontSize: 13, color: "#aaa", marginBottom: 20 }}
            numberOfLines={1}
          >
            {fileTitle}
          </Text>

          {/* ── 비프리미엄 ── */}
          {showPremiumLock && (
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
          {!showPremiumLock && loading && (
            <View style={{ paddingVertical: 48, alignItems: "center" }}>
              <ActivityIndicator size="large" color="#7C3AED" />
              <Text style={{ marginTop: 14, color: "#888", fontSize: 14 }}>
                분석 불러오는 중...
              </Text>
            </View>
          )}

          {/* ── 실패 ── */}
          {!showPremiumLock && !loading && failed && (
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
          {!showPremiumLock && !loading && data && (
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* 편집 버튼 (보기 모드) */}
              {!editing && (
                <TouchableOpacity
                  onPress={startEdit}
                  style={{ alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#F3F0FF", borderRadius: 10 }}
                >
                  <Text style={{ fontSize: 13, color: "#7C3AED" }}>✏️</Text>
                  <Text style={{ fontSize: 13, color: "#7C3AED", fontWeight: "600" }}>전체 편집</Text>
                </TouchableOpacity>
              )}

              {/* 요약 */}
              <View style={{ backgroundColor: "#F5F0FF", borderRadius: 14, padding: 16, marginBottom: 12 }}>
                <Text style={{ fontWeight: "bold", color: "#7C3AED", marginBottom: 8, fontSize: 14 }}>📖 요약</Text>
                {editing && editedData ? (
                  <TextInput
                    value={editedData.summary}
                    onChangeText={(t) => setEditedData({ ...editedData, summary: t })}
                    multiline
                    style={inputStyle("#D8B4FE")}
                    placeholderTextColor="#999"
                  />
                ) : (
                  <Text style={{ fontSize: 14, color: "#333", lineHeight: 22 }}>{data.summary}</Text>
                )}
              </View>

              {/* 장르 + 분위기 */}
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                <View style={{ flex: 1, backgroundColor: "#FFF8E1", borderRadius: 14, padding: 16 }}>
                  <Text style={{ fontWeight: "bold", color: "#D97706", marginBottom: 6, fontSize: 14 }}>🎭 장르</Text>
                  {editing && editedData ? (
                    <TextInput
                      value={editedData.genre}
                      onChangeText={(t) => setEditedData({ ...editedData, genre: t })}
                      style={inputStyle("#FDE68A")}
                      placeholderTextColor="#999"
                    />
                  ) : (
                    <Text style={{ fontSize: 14, color: "#333" }}>{data.genre}</Text>
                  )}
                </View>
                <View style={{ flex: 1, backgroundColor: "#F0F9FF", borderRadius: 14, padding: 16 }}>
                  <Text style={{ fontWeight: "bold", color: "#0284C7", marginBottom: 6, fontSize: 14 }}>🌈 분위기</Text>
                  {editing && editedData ? (
                    <TextInput
                      value={editedData.mood}
                      onChangeText={(t) => setEditedData({ ...editedData, mood: t })}
                      style={inputStyle("#BAE6FD")}
                      placeholderTextColor="#999"
                    />
                  ) : (
                    <Text style={{ fontSize: 14, color: "#333" }}>{data.mood}</Text>
                  )}
                </View>
              </View>

              {/* 키워드 */}
              <View style={{ backgroundColor: "#F0FFF4", borderRadius: 14, padding: 16, marginBottom: 12 }}>
                <Text style={{ fontWeight: "bold", color: "#059669", marginBottom: 10, fontSize: 14 }}>🏷️ 키워드</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {(editing && editedData ? editedData.keywords : data.keywords).map((kw, i) => (
                    <View key={i} style={{ backgroundColor: "#D1FAE5", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Text style={{ fontSize: 13, color: "#065F46" }}>{kw}</Text>
                      {editing && (
                        <TouchableOpacity onPress={() => removeTag(i)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                          <Text style={{ fontSize: 12, color: "#059669", fontWeight: "bold" }}>✕</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
                {editing && (
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, gap: 8 }}>
                    <TextInput
                      ref={tagInputRef}
                      value={newTag}
                      onChangeText={setNewTag}
                      onSubmitEditing={addTag}
                      placeholder="새 태그 입력..."
                      placeholderTextColor="#9CA3AF"
                      returnKeyType="done"
                      style={{ flex: 1, backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: "#111", borderWidth: 1, borderColor: "#A7F3D0" }}
                    />
                    <TouchableOpacity onPress={addTag} style={{ backgroundColor: "#059669", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}>
                      <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 14 }}>+</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* 추천 대상 */}
              <View style={{ backgroundColor: "#FFF1F2", borderRadius: 14, padding: 16, marginBottom: 24 }}>
                <Text style={{ fontWeight: "bold", color: "#BE123C", marginBottom: 8, fontSize: 14 }}>🎯 추천 대상</Text>
                {editing && editedData ? (
                  <TextInput
                    value={editedData.target}
                    onChangeText={(t) => setEditedData({ ...editedData, target: t })}
                    multiline
                    style={inputStyle("#FECDD3")}
                    placeholderTextColor="#999"
                  />
                ) : (
                  <Text style={{ fontSize: 14, color: "#333", lineHeight: 22 }}>{data.target}</Text>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
