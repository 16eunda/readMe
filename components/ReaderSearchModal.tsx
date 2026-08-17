import { Search, X } from "lucide-react-native";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface ReaderSearchResult {
  id: string;
  before: string;
  match: string;
  after: string;
  locationLabel: string;
  textOffset?: number;
  cfi?: string;
}

interface ReaderSearchModalProps {
  visible: boolean;
  query: string;
  results: ReaderSearchResult[];
  loading: boolean;
  limited: boolean;
  error: string | null;
  onQueryChange: (query: string) => void;
  onSelect: (result: ReaderSearchResult) => void;
  onClose: () => void;
}

export default function ReaderSearchModal({
  visible,
  query,
  results,
  loading,
  limited,
  error,
  onQueryChange,
  onSelect,
  onClose,
}: ReaderSearchModalProps) {
  const insets = useSafeAreaInsets();
  const trimmedQuery = query.trim();

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.dismissArea} onPress={onClose} />
        <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>본문 검색</Text>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="검색 종료"
              accessibilityHint="검색 결과와 본문의 강조 표시를 지웁니다"
            >
              <X size={22} color="#242424" />
            </TouchableOpacity>
          </View>

          <View style={styles.searchField}>
            <Search size={19} color="#777" />
            <TextInput
              autoFocus
              value={query}
              onChangeText={onQueryChange}
              placeholder="검색어 입력"
              placeholderTextColor="#8b8b8b"
              selectionColor="#b84a8c"
              returnKeyType="search"
              autoCorrect={false}
              clearButtonMode="while-editing"
              style={styles.input}
              accessibilityLabel="본문 검색어"
            />
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryText}>
              {trimmedQuery
                ? `${limited ? "100+" : results.length}개 결과`
                : "검색어를 입력하세요"}
            </Text>
            {loading && (
              <View style={styles.searchingRow}>
                <ActivityIndicator size="small" color="#b84a8c" />
                <Text style={styles.searchingText}>검색 중</Text>
              </View>
            )}
          </View>

          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={results.length === 0 ? styles.emptyList : styles.resultList}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.resultRow}
                onPress={() => onSelect(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.locationLabel}, ${item.before}${item.match}${item.after}`}
              >
                <Text style={styles.location}>{item.locationLabel}</Text>
                <Text style={styles.excerpt} numberOfLines={3}>
                  {item.before}
                  <Text style={styles.match}>{item.match}</Text>
                  {item.after}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                {error ? (
                  <Text style={styles.errorText}>{error}</Text>
                ) : trimmedQuery && !loading ? (
                  <>
                    <Search size={28} color="#aaa" />
                    <Text style={styles.emptyTitle}>일치하는 내용이 없습니다</Text>
                    <Text style={styles.emptyHint}>다른 검색어를 입력해 보세요.</Text>
                  </>
                ) : null}
              </View>
            }
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.36)",
  },
  dismissArea: {
    flex: 1,
  },
  panel: {
    height: "82%",
    backgroundColor: "#f7f7f8",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 18,
  },
  handle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 2,
    backgroundColor: "#c5c5c7",
  },
  header: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#202020",
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  searchField: {
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: "#d7d7da",
    borderRadius: 6,
    backgroundColor: "#fff",
  },
  input: {
    flex: 1,
    height: 44,
    paddingVertical: 0,
    color: "#202020",
    fontSize: 16,
  },
  summaryRow: {
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryText: {
    color: "#666",
    fontSize: 13,
  },
  searchingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchingText: {
    color: "#777",
    fontSize: 12,
  },
  resultList: {
    paddingBottom: 12,
  },
  emptyList: {
    flexGrow: 1,
  },
  resultRow: {
    minHeight: 88,
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  location: {
    marginBottom: 6,
    color: "#8b3a6c",
    fontSize: 12,
    fontWeight: "700",
  },
  excerpt: {
    color: "#333",
    fontSize: 15,
    lineHeight: 22,
  },
  match: {
    color: "#181818",
    fontWeight: "800",
    backgroundColor: "#f6d878",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#d9d9dc",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingBottom: 40,
  },
  emptyTitle: {
    marginTop: 12,
    color: "#333",
    fontSize: 15,
    fontWeight: "700",
  },
  emptyHint: {
    marginTop: 5,
    color: "#888",
    fontSize: 13,
  },
  errorText: {
    color: "#b42318",
    fontSize: 14,
    textAlign: "center",
  },
});
