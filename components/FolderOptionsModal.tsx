import { Modal, Text, TouchableOpacity, View } from "react-native";

export default function FolderOptionsModal({
  visible,
  onClose,
  onRename,
  onDelete,
}: {
  visible: boolean;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
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
            paddingVertical: 16,
            borderRadius: 12,
          }}
        >
          <TouchableOpacity onPress={onRename} style={{ padding: 14 }}>
            <Text style={{ fontSize: 16 }}>이름 변경</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onDelete} style={{ padding: 14 }}>
            <Text style={{ fontSize: 16, color: "red" }}>삭제</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={{ padding: 14 }}>
            <Text style={{ fontSize: 16 }}>취소</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
