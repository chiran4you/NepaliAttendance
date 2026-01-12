// app/_layout.tsx
import React from "react";
import { Stack } from "expo-router";
import { TenantProvider } from "../src/tenant/TenantContext";

export default function RootLayout() {
  return (
    <TenantProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="setup" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </TenantProvider>
  );
}
