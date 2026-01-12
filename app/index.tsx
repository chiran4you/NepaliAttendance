import React from "react";
import { Redirect } from "expo-router";

export default function Index() {
  // Always start from setup, it will redirect to tabs if tenant already activated
  return <Redirect href="/setup" />;
}
