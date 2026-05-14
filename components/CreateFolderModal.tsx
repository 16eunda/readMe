import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

export default function CreateFolderModal({
  visible,
  folderName,
  setFolderName,
  onCreate,
  onClose,
}: {
  visible: boolean;
  folderName: string;
  setFolderName: (v: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.header}>새 폴더 이름</Text>

          <TextInput
            style={styles.input}
            placeholder="폴더 이름 입력"
            value={folderName}
            onChangeText={setFolderName}
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>취소</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.saveBtn} onPress={onCreate}>
              <Text style={styles.saveText}>생성</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 20,
  },
  modal: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
  },
  header: {
    fontSize: 22,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 20,
  },
  input: {
    backgroundColor: "#F5F5F5",
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  cancelBtn: {
    padding: 12,
    marginRight: 10,
  },
  saveBtn: {
    backgroundColor: "#4A90E2",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  saveText: {
    color: "#fff",
    fontWeight: "bold",
  },
  cancelText: {
    color: "#444",
  },
});
