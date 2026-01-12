import { Stack } from "expo-router";
import { TenantProvider } from "../src/tenant/TenantContext";

export default function RootLayout() {
  return (
    <TenantProvider>
      <Stack>
        <Stack.Screen name="setup" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </TenantProvider>
  );
}
