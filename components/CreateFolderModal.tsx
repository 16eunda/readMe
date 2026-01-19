import { Button, Modal, Text, TextInput, View } from "react-native";

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
            width: "85%",
            backgroundColor: "#fff",
            padding: 20,
            borderRadius: 12,
          }}
        >
          <Text style={{ fontSize: 18, marginBottom: 12 }}>새 폴더 이름</Text>

          <TextInput
            style={{
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 8,
              padding: 10,
              marginBottom: 15,
            }}
            placeholder="폴더 이름 입력"
            value={folderName}
            onChangeText={setFolderName}
          />

          <Button title="생성" onPress={onCreate} />
          <View style={{ height: 10 }} />
          <Button title="취소" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
