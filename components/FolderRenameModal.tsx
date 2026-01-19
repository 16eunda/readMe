import { Button, Modal, Text, TextInput, View } from "react-native";

export default function FolderRenameModal({
  visible,
  name,
  onChangeName,
  onSave,
  onClose,
}: {
  visible: boolean;
  name: string;
  onChangeName: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
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
            width: "80%",
            backgroundColor: "#fff",
            padding: 20,
            borderRadius: 12,
          }}
        >
          <Text style={{ fontSize: 18, marginBottom: 12 }}>폴더 이름 변경</Text>

          <TextInput
            style={{
              borderWidth: 1,
              borderColor: "#aaa",
              borderRadius: 6,
              padding: 8,
              marginBottom: 12,
            }}
            value={name}
            onChangeText={onChangeName}
          />

          <Button title="저장" onPress={onSave} />
          <Button title="취소" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
