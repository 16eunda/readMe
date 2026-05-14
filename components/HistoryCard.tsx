import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import StarRating from './StarRating';

type Props = {
  id: number;
  title: string;
  date: string;
  uri?: string;
  rating: number;
};

export default function HistoryCard({ id, title, date, uri, rating }: Props) {
  return (
    <TouchableOpacity style={styles.card} onPress={() => {
      router.push({
        pathname: "/reader",
        params: { fileId: id, uri: uri, name: title  }
      })
    }}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.date}>{date}</Text>
      <StarRating rating={rating} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f7f7f7',
    borderRadius: 16,
    padding: 14,
    marginVertical: 8,
    elevation: 2,
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
