import React from "react";
import AppNavigator from "./src/navigation/AppNavigator";
import { PremiumProvider } from "./src/premium/PremiumContext";

export default function App() {
  return (
    <PremiumProvider>
      <AppNavigator />
    </PremiumProvider>
  );
}
