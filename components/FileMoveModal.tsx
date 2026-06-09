import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";

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
  const [currentPath, setCurrentPath] = useState("root");

  // 현재 경로의 폴더들만 필터링
  const visibleFolders = folders.filter((f) => f && f.path === currentPath);

  // Breadcrumb 경로 계산
  const getBreadcrumb = () => {
    if (currentPath === "root") {
      return [{ id: "root", name: "Home" }];
    }

    const path: any[] = [];
    let folderId = currentPath;

    while (folderId && folderId !== "root") {
      const folder = folders.find((f) => String(f.id) === String(folderId));
      if (!folder) break;
      
      path.unshift({ id: folder.id, name: folder.name });
      folderId = folder.path;
    }

    path.unshift({ id: "root", name: "Home" });
    return path;
  };

  const breadcrumb = getBreadcrumb();

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
            maxHeight: "70%",
            backgroundColor: "#fff",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {/* 헤더 */}
          <View style={{ padding: 16, borderBottomWidth: 1, borderColor: "#eee" }}>
            <Text style={{ fontSize: 18, fontWeight: "bold", marginBottom: 8 }}>
              이동할 위치 선택
            </Text>
            
            {/* Breadcrumb */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {breadcrumb.map((item, index) => (
                  <View key={item.id} style={{ flexDirection: "row", alignItems: "center" }}>
                    <TouchableOpacity
                      onPress={() => setCurrentPath(String(item.id))}
                      style={{ flexDirection: "row", alignItems: "center" }}
                    >
                      {index === 0 ? (
                        <MaterialCommunityIcons name="home" size={14} color="#4A90E2" style={{ marginRight: 4 }} />
                      ) : (
                        <MaterialCommunityIcons name="folder" size={14} color="#4A90E2" style={{ marginRight: 4 }} />
                      )}
                      <Text style={{ fontSize: 13, color: "#4A90E2" }}>
                        {item.name}
                      </Text>
                    </TouchableOpacity>
                    {index < breadcrumb.length - 1 && (
                      <Text style={{ marginHorizontal: 6, color: "#999" }}> › </Text>
                    )}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* 폴더 목록 */}
          <ScrollView style={{ maxHeight: 300 }}>
            {visibleFolders.length === 0 ? (
              <View style={{ padding: 20, alignItems: "center" }}>
                <Text style={{ color: "#999" }}>폴더가 없습니다</Text>
              </View>
            ) : (
              visibleFolders.map((folder) => (
                <TouchableOpacity
                  key={folder.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: 14,
                    borderBottomWidth: 1,
                    borderColor: "#f0f0f0",
                  }}
                  onPress={() => setCurrentPath(String(folder.id))}
                >
                  <MaterialCommunityIcons name="folder" size={24} color="#FFA500" style={{ marginRight: 12 }} />
                  <Text style={{ fontSize: 16, flex: 1 }}>{folder.name}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={20} color="#999" />
                </TouchableOpacity>
              ))
            )}
          </ScrollView>

          {/* 하단 버튼 */}
          <View style={{ padding: 12, borderTopWidth: 1, borderColor: "#eee", gap: 8 }}>
            <TouchableOpacity
              onPress={() => {
                onMove({ id: currentPath, name: breadcrumb[breadcrumb.length - 1].name });
                setCurrentPath("root");
              }}
              style={{
                padding: 14,
                backgroundColor: "#4A90E2",
                borderRadius: 8,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
                여기로 이동
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setCurrentPath("root");
                onClose();
              }}
              style={{
                padding: 14,
                backgroundColor: "#f5f5f5",
                borderRadius: 8,
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 16, color: "#666" }}>취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
