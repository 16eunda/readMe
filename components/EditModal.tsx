import { MaterialIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
    Modal,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

export default function EditModal({ file, onClose, onSave }: any) {
  const [title, setTitle] = useState(file.title);
  const [review, setReview] = useState(file.review || "");
  const [rating, setRating] = useState(file.rating || 0);

  return (
    <Modal animationType="fade" transparent={true} visible={true}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.header}>Info</Text>

          {/* 제목 */}
          <Text style={styles.label}>제목</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
          />

          {/* 리뷰 */}
          <Text style={styles.label}>리뷰</Text>
          <TextInput
            style={[styles.input, { height: 100 }]}
            value={review}
            onChangeText={setReview}
            multiline
          />

          {/* 별점 */}
          <Text style={styles.label}>별점</Text>
          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <TouchableOpacity key={n} onPress={() => setRating(n)}>
                <MaterialIcons
                  name={n <= rating ? "star" : "star-border"}
                  size={32}
                  color={n <= rating ? "#FFC149" : "#ccc"}
                />
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>취소</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.saveBtn}
              onPress={() => onSave({ ...file, title, review, rating })}
            >
              <Text style={styles.saveText}>저장</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
    padding: 20,
  },
  modal: {
    backgroundColor: "#e6e6e6",
    borderRadius: 20,
    padding: 20,
  },
  header: {
    fontSize: 22,
    textAlign: "center",
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#faf5f5",
    borderRadius: 12,
    padding: 10,
    fontSize: 16,
  },
  starRow: {
    flexDirection: "row",
    marginTop: 6,
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  cancelBtn: {
    padding: 12,
    marginRight: 10,
  },
  saveBtn: {
    backgroundColor: "#b84a8c",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  saveText: {
    color: "#fff",
    fontWeight: "bold",
  },
  cancelText: {
    color: "#444",
  },
});
