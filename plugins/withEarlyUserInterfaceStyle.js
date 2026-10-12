// app.json의 userInterfaceStyle("light")을 Android 앱 시작 시점부터 적용한다.
// expo-system-ui는 이 값을 MainActivity onCreate에서 AppCompatDelegate.setDefaultNightMode로 적용하는데,
// 그때는 Activity가 이미 시스템 다크 모드 설정으로 만들어진 뒤라 다크 모드 기기에서 앱을 새로 실행하면
// RN Appearance가 'dark'를 돌려준다(상태바 아이콘이 흰색이 되어 흰 화면에서 보이지 않고 탭바만 어두워진다).
// 시스템 설정이 한 번 바뀌어야 'light'로 돌아오므로, Activity가 만들어지기 전(Application.onCreate)에 같은 값을 적용한다.
// android/는 prebuild 생성물이라 MainApplication.kt를 직접 고치면 EAS 빌드에서 사라진다.
const { withMainApplication } = require('expo/config-plugins');

const TAG = '// @generated withEarlyUserInterfaceStyle';
const IMPORT_LINE = `import androidx.appcompat.app.AppCompatDelegate ${TAG}`;
const NIGHT_MODE_BY_STYLE = {
  light: 'AppCompatDelegate.MODE_NIGHT_NO',
  dark: 'AppCompatDelegate.MODE_NIGHT_YES',
};

module.exports = function withEarlyUserInterfaceStyle(config) {
  // expo-system-ui와 같은 우선순위로 값을 읽는다. automatic(기본)은 시스템을 따르므로 넣을 코드가 없다.
  const style = config.android?.userInterfaceStyle ?? config.userInterfaceStyle;
  const nightMode = NIGHT_MODE_BY_STYLE[style];

  return withMainApplication(config, (mainApplication) => {
    if (mainApplication.modResults.language !== 'kt') {
      throw new Error('withEarlyUserInterfaceStyle: Kotlin MainApplication만 지원합니다.');
    }

    // 이전 prebuild에서 넣은 줄을 지우고 현재 설정으로 다시 넣는다.
    let contents = mainApplication.modResults.contents
      .split('\n')
      .filter((line) => !line.includes(TAG))
      .join('\n');

    if (nightMode) {
      contents = contents.replace(/^(package [^\n]+\n)/m, `$1\n${IMPORT_LINE}\n`);
      const withCall = contents.replace(
        /(\n(\s*)super\.onCreate\(\)\n)/,
        `$1$2AppCompatDelegate.setDefaultNightMode(${nightMode}) ${TAG}\n`,
      );
      if (withCall === contents) {
        throw new Error('withEarlyUserInterfaceStyle: MainApplication.onCreate의 super.onCreate()를 찾지 못했습니다.');
      }
      contents = withCall;
    }

    mainApplication.modResults.contents = contents;
    return mainApplication;
  });
};
