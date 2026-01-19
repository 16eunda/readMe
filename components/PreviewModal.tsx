import { useRouter } from "expo-router";
import { Modal, Pressable, Text, View } from "react-native";

export default function PreviewModal({
  visible,
  file,
  previewText,
  lastProgress,
  onClose
}: any) {
  const router = useRouter();

  if (!file) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
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
            backgroundColor: "#fff",
            padding: 20,
            borderRadius: 12,
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "bold" }}>
            {file.title}
          </Text>

          <Text style={{ marginTop: 10, color: "#666" }}>
            마지막 위치에서 이어 읽기 ({Math.round(lastProgress * 100)}%)
          </Text>

          <Text
            style={{
              marginTop: 14,
              fontSize: 16,
              color: "#333",
              lineHeight: 24,
            }}
          >
            {previewText}
          </Text>

          <View
            style={{
              marginTop: 20,
              flexDirection: "row",
              justifyContent: "space-between",
            }}
          >
            <Pressable
              onPress={() => {
                router.push({
                  pathname: "/reader",
                  params: {
                    fileId: file.id,
                    uri: file.uri,
                    name: file.title,
                  },
                });
                onClose();
              }}
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
              onPress={() => {
                router.push({
                  pathname: "/reader",
                  params: {
                    fileId: file.id,
                    uri: file.uri,
                    name: file.title,
                  },
                });
                onClose();
              }}
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
