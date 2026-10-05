import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { createPreviewText } from "../utils/preview";

export default function PreviewModal({
  visible,
  file,
  previewText,
  lastProgress,
  folder,
  onClose
}: any) {
  const router = useRouter();
  const singleLinePreview = createPreviewText(previewText);
  // 모달이 닫히는 동안 버튼을 한 번 더 누르면 Reader가 두 번 열려, 뒤로가기를 눌러도 같은 Reader가 다시 보인다.
  // 한 번 이동을 시작하면 모달이 다시 열릴 때까지 추가 탭은 무시한다.
  const openingRef = useRef(false);
  useEffect(() => {
    if (visible) openingRef.current = false;
  }, [visible]);

  if (!file) return null;

  const openReader = (resetProgress: boolean) => {
    if (openingRef.current) return;
    openingRef.current = true;
    router.push({
      pathname: "/reader",
      params: {
        fileId: file.id,
        uri: file.uri,
        name: file.title,
        type: file.type,
        ...(resetProgress ? { resetProgress: "true" } : {}),
        folder,
      },
    });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <View
          style={{
            width: "85%",
            maxHeight: "80%",
            backgroundColor: "#fff",
            padding: 20,
            borderRadius: 12,
            position: "relative",
          }}
        >
          {/* X 닫기 버튼 */}
          <TouchableOpacity
            onPress={onClose}
            style={{
              position: "absolute",
              top: 15,
              right: 15,
              zIndex: 10,
              padding: 4,
              backgroundColor: "#f0f0f0",
              borderRadius: 15,
              width: 30,
              height: 30,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <MaterialCommunityIcons name="close" size={20} color="#333" />
          </TouchableOpacity>

          <Text style={{ fontSize: 20, fontWeight: "bold", paddingRight: 40 }}>
            {file.title}
          </Text>

          <Text style={{ marginTop: 10, color: "#666" }}>
            마지막 위치에서 이어 읽기 ({Math.round(lastProgress * 100)}%)
          </Text>

          <ScrollView
            style={{ marginTop: 14, maxHeight: 200 }}
            showsVerticalScrollIndicator={false}
          >
            <Text
              style={{
                fontSize: 16,
                color: "#333",
                lineHeight: 24,
              }}
            >
              {singleLinePreview}
            </Text>
          </ScrollView>

          <View
            style={{
              marginTop: 20,
              flexDirection: "row",
              justifyContent: "space-between",
            }}
          >
            <Pressable
              onPress={() => openReader(true)}
              style={{
                padding: 10,
                backgroundColor: "#ddd",
                borderRadius: 8,
                width: "47%",
                alignItems: "center",
              }}
            >
              <Text>처음부터</Text>
            </Pressable>

            <Pressable
              onPress={() => openReader(false)}
              style={{
                padding: 10,
                backgroundColor: "#b84a8c",
                borderRadius: 8,
                width: "47%",
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#fff" }}>이어 읽기</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
