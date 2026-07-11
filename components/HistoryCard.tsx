import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import StarRating from './StarRating';
import { formatDisplayDate } from '@/utils/date';

type Props = {
  id: number;
  title: string;
  date: string;
  lastReadAt?: string | null;
  uri?: string;
  rating: number;
};

export default function HistoryCard({ id, title, date, lastReadAt, uri, rating }: Props) {
  return (
    <TouchableOpacity style={styles.card} onPress={() => {
      router.push({
        pathname: "/reader",
        params: { fileId: id, uri: uri, name: title  }
      })
    }}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.date}>{formatDisplayDate(lastReadAt ?? date)}</Text>
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
