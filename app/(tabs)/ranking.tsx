// app/(tabs)/ranking.tsx
import React, { useState } from "react";
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

export default function RankingScreen() {
  const [period, setPeriod] = useState("한달");

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* 기간 탭 */}
      <View style={styles.tabContainer}>
        {["오늘", "한달", "올해"].map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tab,
              period === tab && styles.activeTab,
            ]}
            onPress={() => setPeriod(tab)}
          >
            <Text
              style={[
                styles.tabText,
                period === tab && styles.activeTabText,
              ]}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 타이틀 */}
      <Text style={styles.sectionTitle}>11월 랭킹</Text>

      {/* 랭킹 카드 1 */}
      <View style={styles.card}>
        <Text style={styles.rank}>1.</Text>

        <View style={styles.cardContent}>
          <Text style={styles.title}>미안함에 대한 고찰</Text>

          <Text style={styles.date}>2025.01.01</Text>
          <Text style={styles.progress}>진행도 : 80%</Text>

          <View style={styles.starRow}>
            <Text style={styles.starOn}>★</Text>
            <Text style={styles.starOn}>★</Text>
            <Text style={styles.starOn}>★</Text>
            <Text style={styles.starOff}>★</Text>
            <Text style={styles.starOff}>★</Text>
          </View>
        </View>

        <Text style={styles.readCount}>10회</Text>
      </View>

      {/* 랭킹 카드 2 */}
      <View style={styles.card}>
        <Text style={styles.rank}>2.</Text>
      </View>

      {/* 랭킹 카드 3 */}
      <View style={styles.card}>
        <Text style={styles.rank}>3.</Text>
      </View>

      {/* 랭킹 카드 4 */}
      <View style={styles.card}>
        <Text style={styles.rank}>4.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 20,
  },

  /* 탭 */
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#e0e0e0",
    borderRadius: 20,
    padding: 4,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 16,
    alignItems: "center",
  },
  activeTab: {
    backgroundColor: "#fff",
  },
  tabText: {
    fontSize: 14,
    color: "#555",
  },
  activeTabText: {
    fontWeight: "700",
    color: "#000",
  },

  /* 타이틀 */
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },

  /* 카드 */
  card: {
    flexDirection: "row",
    backgroundColor: "#e0e0e0",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    alignItems: "flex-start",
    minHeight: 120,
  },

  rank: {
    fontSize: 16,
    fontWeight: "700",
    marginRight: 12,
  },

  cardContent: {
    flex: 1,
  },

  title: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
  },

  date: {
    fontSize: 13,
    color: "#555",
    marginBottom: 4,
  },

  progress: {
    fontSize: 13,
    color: "#555",
    marginBottom: 6,
  },

  starRow: {
    flexDirection: "row",
  },

  starOn: {
    fontSize: 18,
    color: "#f4a261",
    marginRight: 2,
  },

  starOff: {
    fontSize: 18,
    color: "#bbb",
    marginRight: 2,
  },

  readCount: {
    fontSize: 18,
    fontWeight: "700",
    marginLeft: 12,
    alignSelf: "center",
  },
});
