import { Button, Modal, Text, TouchableOpacity, View } from "react-native";

export default function FileMoveModal({
  visible,
  folders,
  selectedFile,
  onMove,
  onClose,
}: {
  visible: boolean;
  folders: any[];
  selectedFile: any;
  onMove: (folder: any) => void;
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
          <Text style={{ fontSize: 18, marginBottom: 12 }}>
            이동할 폴더 선택
          </Text>

          {/* 폴더 목록 */}
          {folders.length === 0 ? (
            <Text style={{ marginVertical: 20 }}>폴더가 없습니다.</Text>
          ) : (
            folders
              .filter((folder) => folder && folder.name)
              .map((folder) => (
                <TouchableOpacity
                  key={folder.id}
                  style={{ padding: 10 }}
                  onPress={() => onMove(folder)}
                >
                  <Text style={{ fontSize: 16 }}>📁 {folder.name}</Text>
                </TouchableOpacity>
              ))
          )}

          <Button title="취소" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
