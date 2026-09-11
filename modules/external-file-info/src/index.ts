import { requireOptionalNativeModule } from "expo-modules-core";

type ExternalFileInfoModule = {
  getDisplayNameAsync?: (uri: string) => Promise<string | null>;
  readTextFileAsync?: (uri: string) => Promise<string>;
  isGooglePlayInstallAsync?: () => Promise<boolean>;
  isLaunchedFromHistoryAsync?: () => Promise<boolean>;
  clearCurrentIntentDataAsync?: (expectedUri: string) => Promise<void>;
};

const ExternalFileInfo = requireOptionalNativeModule<ExternalFileInfoModule>("ExternalFileInfo");

export async function getExternalFileDisplayName(uri: string): Promise<string | null> {
  try {
    return (await ExternalFileInfo?.getDisplayNameAsync?.(uri)) ?? null;
  } catch {
    return null;
  }
}

export async function readExternalTextFile(uri: string): Promise<string | null> {
  try {
    return (await ExternalFileInfo?.readTextFileAsync?.(uri)) ?? null;
  } catch {
    return null;
  }
}

export async function isGooglePlayInstall(): Promise<boolean> {
  try {
    return (await ExternalFileInfo?.isGooglePlayInstallAsync?.()) ?? false;
  } catch {
    return false;
  }
}

export async function isLaunchedFromHistory(): Promise<boolean> {
  try {
    return (await ExternalFileInfo?.isLaunchedFromHistoryAsync?.()) ?? false;
  } catch {
    return false;
  }
}

export async function clearExternalFileIntent(expectedUri: string): Promise<void> {
  try {
    await ExternalFileInfo?.clearCurrentIntentDataAsync?.(expectedUri);
  } catch {
    // 파일은 이미 앱 저장소로 복사됐으므로 intent 정리 실패가 등록을 막으면 안 된다.
  }
}
