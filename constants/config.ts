import { Platform } from "react-native";

export const API_BASE_URL =
  Platform.OS === "web"
    ? "http://localhost:8080"
    : Platform.OS === "android"
    ? "http://10.0.2.2:8080"
    : Platform.OS === "ios"
    ? "http://127.0.0.1:8080"
    : "http://192.168.35.99:8080"; // Expo Go 실제 기기
