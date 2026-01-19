import { StyleSheet, Text, View } from 'react-native';
import StarRating from './StarRating';

type Props = {
  title: string;
  date: string;
  rating: number;
};

export default function HistoryCard({ title, date, rating }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.date}>{date}</Text>
      <StarRating rating={rating} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#E5E5E5',
    borderRadius: 12,
    padding: 14,
    marginVertical: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  date: {
    fontSize: 12,
    color: '#777',
    marginBottom: 6,
  },
});
