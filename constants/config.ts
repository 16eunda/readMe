import { Platform } from "react-native";

export const API_BASE_URL =
  Platform.OS === "web"
    ? "http://localhost:8080"
    : "https://readme-backend-2.onrender.com";
