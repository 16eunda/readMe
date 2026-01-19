import { Modal, Text, TouchableOpacity, View } from "react-native";

type FileOptionsModalProps = {
  visible: boolean;
  onDelete: () => void;
  onMove: () => void;
  onClose: () => void;
};

export default function FileOptionsModal({
  visible,
  onDelete,
  onMove,
  onClose,
}: FileOptionsModalProps) {
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
            width: "75%",
            backgroundColor: "#fff",
            borderRadius: 12,
            paddingVertical: 15,
          }}
        >
          {/* 삭제 */}
          <TouchableOpacity
            style={{ padding: 15 }}
            onPress={onDelete}
          >
            <Text
              style={{
                fontSize: 16,
                color: "red",
                textAlign: "center",
              }}
            >
              파일 삭제
            </Text>
          </TouchableOpacity>

          {/* 이동 */}
          <TouchableOpacity style={{ padding: 15 }} onPress={onMove}>
            <Text
              style={{
                fontSize: 16,
                textAlign: "center",
              }}
            >
              폴더로 이동
            </Text>
          </TouchableOpacity>

          {/* 취소 */}
          <TouchableOpacity
            style={{ padding: 15 }}
            onPress={onClose}
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
        </View>
      </View>
    </Modal>
  );
}
