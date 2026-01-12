// app/(tabs)/_layout.tsx
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "../../src/constants/colors";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarStyle: {
          backgroundColor: "#FFFFFF",
          borderTopColor: Colors.border,
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "700",
        },
      }}
    >
      {/* 1. Classes */}
      <Tabs.Screen
        name="classes"
        options={{
          title: "Classes",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="school" size={size} color={color} />
          ),
        }}
      />

      {/* 2. Students */}
      <Tabs.Screen
        name="students"
        options={{
          title: "Students",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />

      {/* 3. Attendance */}
      <Tabs.Screen
        name="attendance"
        options={{
          title: "Attendance",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkmark-done" size={size} color={color} />
          ),
        }}
      />

      {/* 4. Reports */}
      <Tabs.Screen
        name="reports"
        options={{
          title: "Reports",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart" size={size} color={color} />
          ),
        }}
      />

      {/* 5. Settings */}
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
