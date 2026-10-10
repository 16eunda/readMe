import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, TextInput, TouchableOpacity, View } from "react-native";

export default function SearchBar({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (text: string) => void;
  onClear?: () => void;
}) {
  return (
    <View style={styles.container}>
      <Ionicons name="search" size={20} color="#666" style={{ marginRight: 6 }} />
      <TextInput
        style={styles.input}
        placeholder="search"
        placeholderTextColor="#aaa"
        value={value}
        onChangeText={onChange}
      />
      {/* 검색어가 있을 때만 지우기 버튼을 보여 준다. 새 검색어를 바로 입력할 수 있게 키보드는 그대로 둔다. */}
      {value.length > 0 && onClear && (
        <TouchableOpacity
          onPress={onClear}
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
          accessibilityRole="button"
          accessibilityLabel="검색어 지우기"
        >
          <Ionicons name="close-circle" size={20} color="#999" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eee",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
});
