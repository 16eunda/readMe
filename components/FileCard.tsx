import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { GestureResponderEvent, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export type FileItem = {
  id: string;
  title: string;
  preview: string;
  date: string;
  rating: number;
  uri: string;
  path: string;
  review: string;
};

type FileCardProps = {
  item: FileItem;
  onPress?: (file: FileItem) => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  onOptionsPress?: (file: FileItem) => void;
};

export default function FileCard({ item, onPress, onLongPress, onOptionsPress }: FileCardProps ) {
  if (!item) return null;
  if (!item.title) return null;

  const router = useRouter();

  // path 표시용 함수 추가
  const formatPath = (path: string) => {
    if (!path) return "";
    const parts = path.split("/").slice(1); // root 제거
    return parts.join(" > ");
  };

  return (
    <TouchableOpacity
      style={styles.card}
      
      onPress={() => onPress?.(item)}
      onLongPress={onLongPress}
    >
      {/* 제목 + 메뉴 */}
      <View style={styles.row}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>

        <TouchableOpacity onPress={() => onOptionsPress?.(item)}>
          <Ionicons name="ellipsis-vertical" size={18} color="#555" />
        </TouchableOpacity>
      </View>
      

      {/* 날짜 */}
      <Text style={styles.date}>{item.date}</Text>

      {/* 경로 표시 (root가 아닐 때만) */}
      {item.path !== "root" && (
        <Text style={styles.path}>📁 {formatPath(item.path)}</Text>
      )}

      {/* 미리보기 (3줄 출력) */}
      <Text style={styles.preview} numberOfLines={3}>
        {item.preview}
      </Text>

      {/* 별점 */}
      <View style={styles.starRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <FontAwesome5
            key={n}
            name="star"
            size={18}
            solid={n <= item.rating}
            color={n <= item.rating ? "#FFD84E" : "#D1D1D1"}
          />
        ))}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#f7f7f7",
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    elevation: 2,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  title: {
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    marginRight: 10,
  },

  date: {
    color: "#888",
    marginBottom: 8,
    marginTop: 3,
    fontSize: 12,
  },

  path: {
    fontSize: 13,
    color: "#777",
    marginBottom: 6,
  },

  preview: {
    fontSize: 14,
    color: "#444",
    marginBottom: 10,
  },

  starRow: {
    flexDirection: "row",
    marginTop: 5,
  },
});
