import { FontAwesome5 } from "@expo/vector-icons";
import { View } from 'react-native';

type Props = {
  rating: number; // 0~5
};

export default function StarRating({ rating }: Props) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <FontAwesome5
          key={i}
          name="star"
          size={18}
          solid={i <= rating}
          color={i <= rating ? "#FFD84E" : "#D1D1D1"}
          style={{ marginRight: 2 }}
        />
      ))}
    </View>
  );
}
