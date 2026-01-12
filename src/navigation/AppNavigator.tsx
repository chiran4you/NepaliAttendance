import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import TabsNavigator from "./TabsNavigator";

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <TabsNavigator />
    </NavigationContainer>
  );
}
