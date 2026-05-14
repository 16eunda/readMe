import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from "react";
import {
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { useUser } from "../contexts/UserContext";
import { BASE_URL } from "../utils/api";

type LoginModalProps = {
  visible: boolean;
  onClose: () => void;
  onLoginSuccess: (userId: string, username: string, token: string) => void;
};

export default function LoginModal({ visible, onClose, onLoginSuccess }: LoginModalProps) {
  const { deviceId } = useUser();
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // 아이디 입력 시 영어만 허용
  const handleUsernameChange = (text: string) => {
    // 영문자, 숫자만 허용 (특수문자 제외)
    const filteredText = text.replace(/[^a-zA-Z0-9]/g, '');
    setUsername(filteredText);
  };

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert("오류", "아이디와 비밀번호를 입력해주세요.");
      return;
    }

    setIsLoading(true);
    
    try {
      const response = await fetch(`${BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          username, 
          password,
          deviceId  // ⭐ 중요: deviceId 전송
        }),
      });
      
      if (!response.ok) {
        const error = await response.text();
        Alert.alert("로그인 실패", error);
        return;
      }
      
      const data = await response.json();
      
      // 백엔드가 accessToken, refreshToken을 주면 둘 다 저장
      // 현재는 token 하나만 주는 경우도 처리
      const accessToken = data.accessToken || data.token;
      const refreshToken = data.refreshToken;
      
      if (refreshToken) {
        await AsyncStorage.setItem('refreshToken', refreshToken);
        console.log('✅ refreshToken 저장');
      }
      
      onLoginSuccess(data.userId, data.username, accessToken);
      resetForm();
    } catch (error) {
      console.error("로그인 오류:", error);
      Alert.alert("오류", "서버에 연결할 수 없습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert("오류", "모든 필드를 입력해주세요.");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("오류", "비밀번호가 일치하지 않습니다.");
      return;
    }

    if (password.length < 4) {
      Alert.alert("오류", "비밀번호는 4자 이상이어야 합니다.");
      return;
    }

    setIsLoading(true);
    
    try {
      const response = await fetch(`${BASE_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      
      if (!response.ok) {
        const error = await response.text();
        Alert.alert("회원가입 실패", error);
        return;
      }
      
      Alert.alert("회원가입 완료", "로그인해주세요.", [
        { text: "확인", onPress: () => setIsSignUp(false) }
      ]);
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      console.error("회원가입 오류:", error);
      Alert.alert("오류", "서버에 연결할 수 없습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setIsSignUp(false);
    setShowPassword(false);
    setShowConfirmPassword(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>{isSignUp ? "회원가입" : "로그인"}</Text>

          <TextInput
            style={styles.input}
            placeholder="아이디 (영문, 숫자만 가능)"
            value={username}
            onChangeText={handleUsernameChange}
            autoCapitalize="none"
            keyboardType="ascii-capable"
          />

          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="비밀번호"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword(!showPassword)}
            >
              <Ionicons
                name={showPassword ? "eye" : "eye-off"}
                size={22}
                color="#888"
              />
            </TouchableOpacity>
          </View>

          {isSignUp && (
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="비밀번호 확인"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                <Ionicons
                  name={showConfirmPassword ? "eye" : "eye-off"}
                  size={22}
                  color="#888"
                />
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, isLoading && styles.disabledButton]}
            onPress={isSignUp ? handleSignUp : handleLogin}
            disabled={isLoading}
          >
            <Text style={styles.primaryButtonText}>
              {isLoading ? "처리 중..." : (isSignUp ? "회원가입" : "로그인")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setIsSignUp(!isSignUp)}
          >
            <Text style={styles.secondaryButtonText}>
              {isSignUp ? "이미 계정이 있으신가요? 로그인" : "계정이 없으신가요? 회원가입"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={resetForm}>
            <Text style={styles.cancelButtonText}>취소</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },

  modal: {
    width: "85%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
  },

  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 24,
    textAlign: "center",
  },

  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },

  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    marginBottom: 12,
  },

  passwordInput: {
    flex: 1,
    padding: 12,
    fontSize: 16,
  },

  eyeButton: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },

  primaryButton: {
    backgroundColor: "#4A90E2",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },

  disabledButton: {
    backgroundColor: "#B0C4DE",
    opacity: 0.6,
  },

  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  secondaryButton: {
    marginTop: 12,
    padding: 8,
    alignItems: "center",
  },

  secondaryButtonText: {
    color: "#4A90E2",
    fontSize: 14,
  },

  cancelButton: {
    marginTop: 8,
    padding: 8,
    alignItems: "center",
  },

  cancelButtonText: {
    color: "#888",
    fontSize: 14,
  },
});
