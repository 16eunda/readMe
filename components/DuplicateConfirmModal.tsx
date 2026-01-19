import { Modal, Text, TouchableOpacity, View } from "react-native";

type DuplicateConfirmModalProps = {
  visible: boolean;
  fileName: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function DuplicateConfirmModal({
  visible,
  fileName,
  onConfirm,
  onCancel,
}: DuplicateConfirmModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <View
          style={{
            width: "80%",
            backgroundColor: "#fff",
            borderRadius: 12,
            padding: 20,
          }}
        >
          {/* 제목 */}
          <Text
            style={{
              fontSize: 18,
              fontWeight: "bold",
              textAlign: "center",
              marginBottom: 15,
            }}
          >
            중복된 파일
          </Text>

          {/* 내용 */}
          <Text
            style={{
              fontSize: 14,
              color: "#555",
              textAlign: "center",
              marginBottom: 25,
              lineHeight: 20,
            }}
          >
            "{fileName}"{"\n"}
            이미 추가된 파일입니다.{"\n\n"}
            그래도 추가하시겠습니까?
          </Text>

          {/* 버튼들 */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            {/* 취소 */}
            <TouchableOpacity
              style={{
                flex: 1,
                padding: 15,
                backgroundColor: "#f0f0f0",
                borderRadius: 8,
              }}
              onPress={onCancel}
            >
              <Text
                style={{
                  fontSize: 16,
                  textAlign: "center",
                  color: "#666",
                }}
              >
                취소
              </Text>
            </TouchableOpacity>

            {/* 확인 */}
            <TouchableOpacity
              style={{
                flex: 1,
                padding: 15,
                backgroundColor: "#007AFF",
                borderRadius: 8,
              }}
              onPress={onConfirm}
            >
              <Text
                style={{
                  fontSize: 16,
                  textAlign: "center",
                  color: "#fff",
                  fontWeight: "600",
                }}
              >
                확인
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
