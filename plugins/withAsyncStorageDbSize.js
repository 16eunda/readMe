// Android AsyncStorage는 DB 크기 상한이 기본 6MB이고, 넘으면 모든 setItem이 실패한다.
// 책마다 수십~수백 KB인 EPUB 위치 인덱스 캐시(@reader_epub_locations:)가 쌓이면 상한에 닿아
// 이어읽기 위치·리더 설정 저장까지 조용히 실패하므로 상한을 늘린다.
// android/는 prebuild 생성물이라 gradle.properties를 직접 고치면 EAS 빌드에서 사라진다.
const { withGradleProperties } = require('expo/config-plugins');

const PROPERTY_KEY = 'AsyncStorage_db_size_in_MB';

module.exports = function withAsyncStorageDbSize(config, { sizeInMB = 50 } = {}) {
  return withGradleProperties(config, (gradleConfig) => {
    gradleConfig.modResults = gradleConfig.modResults.filter(
      (item) => !(item.type === 'property' && item.key === PROPERTY_KEY),
    );
    gradleConfig.modResults.push({
      type: 'property',
      key: PROPERTY_KEY,
      value: String(sizeInMB),
    });
    return gradleConfig;
  });
};
