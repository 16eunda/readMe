import { requireOptionalNativeModule } from "expo-modules-core";

type ExternalFileInfoModule = {
  getDisplayNameAsync?: (uri: string) => Promise<string | null>;
  readTextFileAsync?: (uri: string) => Promise<string>;
  isGooglePlayInstallAsync?: () => Promise<boolean>;
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
