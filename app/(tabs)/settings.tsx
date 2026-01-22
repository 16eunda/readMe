// app/(tabs)/settings.tsx
import { useEffect, useState } from "react";
import {
  Dimensions,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  View
} from "react-native";

type FileStats = {
  totalCount: number;
  completedCount: number;
  fiveStarCount: number;
};

// BASE_URL을 컴포넌트 외부로 이동
const getBaseURL = () => {
  if (Platform.OS === "web") {
    return "http://localhost:8080";
  } else if (Platform.OS === "android") {
    return "http://10.0.2.2:8080";
  } else if (Platform.OS === "ios") {
    return "http://127.0.0.1:8080";
  } else {
    return "http://192.168.35.99:8080";
  }
};

const BASE_URL = getBaseURL();
const SCREEN_HEIGHT = Dimensions.get("window").height;

export default function SettingsScreen() {
  // ========== Hooks는 컴포넌트 안에서만! ==========
  const [stats, setStats] = useState<FileStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE_URL}/files/stats`)
      .then((res) => res.json())
      .then((data) => {
        setStats(data);
      })
      .catch((err) => {
        console.error("stats fetch error", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
      {/* 프로필 */}
      <View style={styles.profileSection}>
        <View style={styles.avatar} />
        <Text style={styles.nickname}>나는야 독서왕</Text>
      </View>

      {/* 통계 */}
      <View style={styles.statsSection}>
        <StatRow
            label="기록한 파일 수"
            value={loading ? "-" : String(stats?.totalCount ?? 0)}
        />
        <StatRow
            label="완독한 파일 수"
            value={loading ? "-" : String(stats?.completedCount ?? 0)}
        />

        <StatRow
            label="별이 5개!!!"
            value={loading ? "-" : String(stats?.fiveStarCount ?? 0)}
        />
      </View>

      {/* 오늘의 명언 */}
      <View style={styles.quoteSection}>
        <Text style={styles.quoteTitle}>오늘의 명언</Text>

        <View style={styles.quoteCard}>
          <View style={styles.quoteInner}>
            <Text style={styles.quoteAuthor}>사르트르</Text>
            <View style={styles.quoteDivider} />
            <Text style={styles.quoteText}>
              내가 세계를 알게 된 것은 책에 의해서였다.
            </Text>
          </View>
        </View>
      </View>
      </View>
    </SafeAreaView>
  );
}

/* ---------- 재사용 ---------- */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

/* ---------- 스타일 ---------- */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },

  content: {
    flex: 1,
    padding: 20,
    paddingTop: 30,
  },

  profileSection: {
    alignItems: "center",
    marginBottom: 24,
  },

  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#ddd",
    marginBottom: 12,
  },

  nickname: {
    fontSize: 16,
    fontWeight: "600",
  },

  statsSection: {
    marginBottom: 24,
  },

  statRow: {
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingVertical: 12,
  },

  statLabel: {
    fontSize: 14,
    fontWeight: "500",
  },

  statValue: {
    marginTop: 4,
    color: "#555",
  },

  quoteSection: {
    flex: 1,
    marginTop: 16,
  },

  quoteTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },

  quoteCard: {
    flex: 1,
    backgroundColor: "#e0e0e0",
    borderRadius: 12,
  },

  quoteInner: {
    flex: 1,
    justifyContent: "center",   // 세로 중앙
    alignItems: "center",       // 가로 중앙
    padding: 20,
  },

  quoteAuthor: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 6,
  },

  quoteDivider: {
    width: 24,
    height: 2,
    backgroundColor: "#888",
    marginBottom: 12,
  },

  quoteText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",        // 텍스트 중앙
    color: "#333",
  },

  logoutButton: {
    alignItems: "center",
    marginTop: 24,
    paddingVertical: 12,
  },

  logoutText: {
    color: "#555",
    fontSize: 14,
  },
});
