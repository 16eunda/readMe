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
    fontWeight: "bold",
  },

  topArea: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 10
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
    paddingBottom: 120,        // 바텀 메뉴 가리는 것 방지
  },

  homeTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12,
  },

  bottomMenu: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    height: 60,
    backgroundColor: "#eee",
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
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