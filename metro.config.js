const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// EXPO_PUBLIC_API_URL 은 번들에 그대로 박힌다. 캐시 키에 주소를 넣어서
// `npm run android` ↔ `npm run android:local` 을 오갈 때 이전 주소가 남지 않게 한다.
config.cacheVersion = `${config.cacheVersion ?? ''}|api:${process.env.EXPO_PUBLIC_API_URL ?? ''}`;

module.exports = config;
