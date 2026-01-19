import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, TextInput, View } from "react-native";

export default function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
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
