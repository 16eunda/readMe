import { Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";

type DuplicateConfirmModalProps = {
  visible: boolean;
  fileName: string;
  /** 여러 개를 한 번에 등록할 때 발견된 중복 파일 이름들 */
  fileNames?: string[];
  onConfirm: () => void;
  onCancel: () => void;
};

export default function DuplicateConfirmModal({
  visible,
  fileName,
  fileNames,
  onConfirm,
  onCancel,
}: DuplicateConfirmModalProps) {
  const duplicateNames = fileNames?.filter(Boolean) ?? [];
  const isMultiple = duplicateNames.length > 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
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
          {isMultiple ? (
            <View style={{ marginBottom: 25 }}>
              <Text
                style={{
                  fontSize: 14,
                  color: "#555",
                  textAlign: "center",
                  lineHeight: 20,
                }}
              >
                {duplicateNames.length}개가 이미 추가된 파일입니다.
              </Text>
              <ScrollView style={{ maxHeight: 140, marginTop: 12 }}>
                {duplicateNames.map((name) => (
                  <Text
                    key={name}
                    numberOfLines={1}
                    style={{ fontSize: 13, color: "#777", lineHeight: 20 }}
                  >
                    · {name}
                  </Text>
                ))}
              </ScrollView>
              <Text
                style={{
                  fontSize: 14,
                  color: "#555",
                  textAlign: "center",
                  lineHeight: 20,
                  marginTop: 12,
                }}
              >
                그래도 모두 추가하시겠습니까?
              </Text>
            </View>
          ) : (
            <Text
              style={{
                fontSize: 14,
                color: "#555",
                textAlign: "center",
                marginBottom: 25,
                lineHeight: 20,
              }}
            >
              &quot;{fileName}&quot;{"\n"}
              이미 추가된 파일입니다.{"\n\n"}
              그래도 추가하시겠습니까?
            </Text>
          )}

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
