import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SettingsHomeScreen from "../../screens/settings/SettingsHomeScreen";
import LicenseScreen from "../../screens/settings/LicenseScreen";

export type SettingsStackParamList = {
  SettingsHome: undefined;
  License: undefined;
};

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export default function SettingsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="SettingsHome" component={SettingsHomeScreen} options={{ title: "Settings" }} />
      <Stack.Screen name="License" component={LicenseScreen} options={{ title: "License" }} />
    </Stack.Navigator>
  );
}
