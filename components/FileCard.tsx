import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { GestureResponderEvent, StyleSheet, Text, TouchableOpacity, View } from "react-native";
// 아이콘
import { formatDisplayDate } from "@/utils/date";
import { MaterialCommunityIcons } from "@expo/vector-icons";

export type FileItem = {
  id: string;
  title: string;
  preview: string;
  date: string;
  rating: number;
  uri: string;
  path: string;
  review: string;
  aiSummary?: string | null;
};

type FileCardProps = {
  item: FileItem;
  isSelectMode?: boolean;
  isSelected?: boolean;
  isLocated?: boolean;
  onPress?: (file: FileItem) => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  onOptionsPress?: (file: FileItem) => void;
  onAiPress?: (file: FileItem) => void;
};

export default function FileCard({ item, isSelectMode, isSelected, isLocated, onPress, onLongPress, onOptionsPress, onAiPress }: FileCardProps ) {
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
      style={[
        styles.card,
        isSelectMode && isSelected && styles.cardSelected,
        isLocated && styles.cardLocated,
      ]}
      
      onPress={() => onPress?.(item)}
      onLongPress={onLongPress}
    >
      {isSelectMode && (
        <View style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 10
        }}>
          <MaterialCommunityIcons
            name={isSelected ? "checkbox-marked" : "checkbox-blank-outline"}
            size={24}
            color="#4A90E2"
          />
        </View>
      )}
      {/* 제목 + 메뉴 */}
      <View style={styles.row}>
        <Text style={[styles.title, isSelectMode && styles.titleWithCheck]} numberOfLines={1}>
          {item.title}
        </Text>

        {!isSelectMode && (
          <TouchableOpacity
            style={styles.optionsButton}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            pressRetentionOffset={{ top: 12, right: 12, bottom: 12, left: 12 }}
            onPress={(event) => {
              event.stopPropagation();
              onOptionsPress?.(item);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${item.title} 파일 메뉴`}
          >
            <Ionicons name="ellipsis-vertical" size={18} color="#555" />
          </TouchableOpacity>
        )}
      </View>
      

      {/* 날짜 */}
      <Text style={styles.date}>{formatDisplayDate(item.date)}</Text>

      {/* 경로 표시 (root가 아닐 때만) */}
      {item.path !== "root" && (
        <Text style={styles.path}>📁 {formatPath(item.path)}</Text>
      )}

      {/* 미리보기 (3줄 출력) */}
      <Text style={styles.preview} numberOfLines={3}>
        {item.preview}
      </Text>

      {/* 별점 + AI 뱃지 */}
      <View style={[styles.starRow, { justifyContent: "space-between", alignItems: "center" }]}>
        <View style={{ flexDirection: "row" }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <FontAwesome5
              key={n}
              name="star"
              size={18}
              solid={n <= item.rating}
              color={n <= item.rating ? "#FFD84E" : "#D1D1D1"}
              style={{ marginRight: 2 }}
            />
          ))}
        </View>

        {!isSelectMode && (
          <TouchableOpacity
            onPress={() => onAiPress?.(item)}
            style={[
              styles.aiBadge,
              item.aiSummary ? styles.aiBadgeActive : styles.aiBadgeInactive,
            ]}
          >
            <Text
              style={[
                styles.aiBadgeText,
                { color: item.aiSummary ? "#7C3AED" : "#9CA3AF" },
              ]}
            >
              ✨ AI 분석{item.aiSummary ? " 보기" : ""}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#f7f7f7",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    elevation: 2,
    borderWidth: 2,
    borderColor: "transparent",
  },

  cardSelected: {
    backgroundColor: "#e8f4f8",
    borderWidth: 2,
    borderColor: "#4A90E2",
  },

  cardLocated: {
    backgroundColor: "#FFF8E1",
    borderColor: "#F5A623",
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

  titleWithCheck: {
    marginRight: 36,
  },

  optionsButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: -10,
    marginRight: -10,
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

  aiBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },

  aiBadgeActive: {
    backgroundColor: "#F5F0FF",
    borderWidth: 1,
    borderColor: "#C4B5FD",
  },

  aiBadgeInactive: {
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },

  aiBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
});
