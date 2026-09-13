import { requireOptionalNativeModule } from "expo-modules-core";

type ExternalFileInfoModule = {
  getDisplayNameAsync?: (uri: string) => Promise<string | null>;
  readTextFileAsync?: (uri: string) => Promise<string>;
  isGooglePlayInstallAsync?: () => Promise<boolean>;
  isLaunchedFromHistoryAsync?: () => Promise<boolean>;
  clearCurrentIntentDataAsync?: (expectedUri: string) => Promise<void>;
  getCurrentIntentInfoAsync?: () => Promise<ExternalIntentInfo | null>;
};

export type ExternalIntentInfo = {
  action: string | null;
  data: string | null;
  mimeType: string | null;
  flags: string;
  grantReadUriFlag: boolean;
  persistableGrantFlag: boolean;
  clipDataUris: string[];
  readPermission: "granted" | "denied" | "not-content-uri" | "no-data";
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

// 개발 로그용: 현재 Activity Intent의 action/MIME/flag/ClipData와 URI 읽기 권한
export async function getCurrentExternalIntentInfo(): Promise<ExternalIntentInfo | null> {
  try {
    return (await ExternalFileInfo?.getCurrentIntentInfoAsync?.()) ?? null;
  } catch {
    return null;
  }
}
