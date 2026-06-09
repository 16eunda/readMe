import { FontAwesome5, MaterialCommunityIcons } from "@expo/vector-icons";
import { Modal, Text, TouchableOpacity, View } from "react-native";

export type SortOption = "rating-desc" | "rating-asc" | "date-desc" | "date-asc";

export default function SortModal({
  visible,
  currentSort,
  onSelect,
  onClose,
}: {
  visible: boolean;
  currentSort: SortOption;
  onSelect: (sort: SortOption) => void;
  onClose: () => void;
}) {
  const options: { value: SortOption; label: string; iconType: "star" | "clock" }[] = [
    { value: "rating-desc", label: "별점 높은순", iconType: "star" },
    { value: "rating-asc", label: "별점 낮은순", iconType: "star" },
    { value: "date-desc", label: "최신순", iconType: "clock" },
    { value: "date-asc", label: "오래된순", iconType: "clock" },
  ];

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
            overflow: "hidden",
          }}
        >
          <View style={{ padding: 16, borderBottomWidth: 1, borderColor: "#eee" }}>
            <Text style={{ fontSize: 18, fontWeight: "bold" }}>정렬</Text>
          </View>

          {options.map((option) => (
            <TouchableOpacity
              key={option.value}
              onPress={() => {
                onSelect(option.value);
                onClose();
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                borderBottomWidth: 1,
                borderColor: "#f0f0f0",
                backgroundColor: currentSort === option.value ? "#f0f8ff" : "#fff",
              }}
            >
              {option.iconType === "star" ? (
                <FontAwesome5
                  name="star"
                  size={20}
                  solid={option.value === "rating-desc"}  // 높은 순은 채움, 낮은 순은 테두리
                  color={currentSort === option.value ? "#FFD84E" : "#D1D1D1"}  // 선택되면 노란색, 아니면 회색
                  style={{ marginRight: 12 }}
                />
              ) : (
                <MaterialCommunityIcons
                  name={option.value === "date-desc" ? "clock" : "clock-outline"}
                  size={24}
                  color={currentSort === option.value ? "#4A90E2" : "#666"}
                  style={{ marginRight: 12 }}
                />
              )}
              <Text
                style={{
                  fontSize: 16, 
                  flex: 1,
                  color: currentSort === option.value ? "#4A90E2" : "#333",
                  fontWeight: currentSort === option.value ? "600" : "400",
                }}
              >
                {option.label}
              </Text>
              {currentSort === option.value && (
                <MaterialCommunityIcons name="check" size={20} color="#4A90E2" />
              )}
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            onPress={onClose}
            style={{
              padding: 16,
              alignItems: "center",
              backgroundColor: "#f5f5f5",
            }}
          >
            <Text style={{ fontSize: 16, color: "#666" }}>취소</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
