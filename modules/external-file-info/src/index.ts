import { requireOptionalNativeModule } from "expo-modules-core";

type ExternalFileInfoModule = {
  getDisplayNameAsync?: (uri: string) => Promise<string | null>;
  readTextFileAsync?: (uri: string) => Promise<string>;
  isGooglePlayInstallAsync?: () => Promise<boolean>;
  claimExternalIntentAsync?: (uri: string) => Promise<boolean>;
  getTaskId?: () => number | null;
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

// 외부 파일 Intent를 한 번만 처리하기 위한 판별. 새로 전달된 요청이면 true,
// 백그라운드 복귀 등으로 Activity가 복원되면서 이미 처리한 Intent를 다시 받은 경우 false.
// 네이티브 모듈이 없는 플랫폼은 판별 수단이 없으므로 기존처럼 새 요청으로 처리한다.
export async function claimExternalFileIntent(uri: string): Promise<boolean> {
  try {
    return (await ExternalFileInfo?.claimExternalIntentAsync?.(uri)) ?? true;
  } catch {
    return true;
  }
}

// 현재 Android 태스크 ID. 최근 앱에서 앱을 지운 뒤 다시 실행하면 새 태스크가 되므로
// 같은 태스크인지로 새 실행을 구분한다. 네이티브 모듈이 없거나(iOS 등) 알 수 없으면 null.
export function getCurrentTaskId(): number | null {
  try {
    const taskId = ExternalFileInfo?.getTaskId?.();
    return typeof taskId === "number" ? taskId : null;
  } catch {
    return null;
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
