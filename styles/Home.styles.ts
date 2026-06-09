import { StyleSheet } from "react-native";

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  
  folderMenu: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginVertical: 12,
    gap: 12, // 항목 간 간격
    paddingRight: 8, // 오른쪽에서 약간 떨어지게
  },

  folderGridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 15,
    justifyContent: "flex-start",
  },

  centerBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  fab: {
    position: "absolute",
    bottom: 80,
    left: "50%",
    transform: [{ translateX: -30 }], // 가운데 정렬용
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#4A90E2",
    justifyContent: "center",
    alignItems: "center",
  },

  fabText: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "300", // bold에서 light로 변경하여 둥글둥글하게
    lineHeight: 60, // 버튼 높이와 동일하게 설정하여 수직 중앙 정렬
    textAlign: "center", // 수평 중앙 정렬
    includeFontPadding: false, // 안드로이드에서 폰트 패딩 제거
  },

  topArea: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 10
  },

  folderGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 15,
    marginBottom: 15,
  },

  folderGridItem: {
    backgroundColor: "transparent",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
    width: "23%",
    marginRight: "2.66%",
    marginBottom: 4,
    alignItems: "center",
    justifyContent: "center",
  },

  folderIcon: {
    fontSize: 40,
  },

  folderGridText: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 4,
    color: "#333",
  },

  folderScroll: {
    marginTop: 10,
  },

  listArea: {
    flex: 1,                   // 핵심!!!
    paddingHorizontal: 20,
  },

  emptyArea: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  emptyText: {
    color: "#888",
    fontSize: 16,
  },

  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },

  homeTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12,
  },

  breadcrumbScroll: {
    marginBottom: 12,
    maxHeight: 40,
  },

  breadcrumbItem: {
    fontSize: 14,
    color: "#666",
    paddingVertical: 6,
    paddingHorizontal: 0,
  },

  breadcrumbActive: {
    color: "#4A90E2",
    fontWeight: "bold",
  },

  breadcrumbSeparator: {
    fontSize: 16,
    color: "#999",
    marginHorizontal: 4,
  },

  modalBackground: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },

  modalBox: {
    width: "80%",
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 12,
  },

  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },

  folderItem: {
    backgroundColor: "#eaeaea",
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginRight: 10,
    borderRadius: 10,
  },

  folderText: {
    fontSize: 16,
    fontWeight: "bold",
  },

  optionBox: {
    width: "70%",
    backgroundColor: "#fff",
    paddingVertical: 20,
    borderRadius: 12,
    alignItems: "center",
  },
  optionText: {
    fontSize: 18,
    paddingVertical: 10,
  },
});