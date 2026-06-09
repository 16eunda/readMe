import { requireOptionalNativeModule } from "expo-modules-core";

type ExternalFileInfoModule = {
  getDisplayNameAsync?: (uri: string) => Promise<string | null>;
};

const ExternalFileInfo = requireOptionalNativeModule<ExternalFileInfoModule>("ExternalFileInfo");

export async function getExternalFileDisplayName(uri: string): Promise<string | null> {
  try {
    return (await ExternalFileInfo?.getDisplayNameAsync?.(uri)) ?? null;
  } catch {
    return null;
  }
}
