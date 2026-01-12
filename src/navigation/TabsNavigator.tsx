import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import ClassesStack from "./stacks/ClassesStack";
import StudentsStack from "./stacks/StudentsStack";
import AttendanceStack from "./stacks/AttendanceStack";
import ReportsStack from "./stacks/ReportsStack";
import SettingsStack from "./stacks/SettingsStack";

const Tab = createBottomTabNavigator();

export default function TabsNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { height: 62, paddingTop: 6, paddingBottom: 10 },
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tab.Screen
        name="ClassesTab"
        component={ClassesStack}
        options={{
          title: "Class",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="google-classroom" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="StudentsTab"
        component={StudentsStack}
        options={{
          title: "Students",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="account-group" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="AttendanceTab"
        component={AttendanceStack}
        options={{
          title: "Attendance",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="clipboard-check-outline" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="ReportsTab"
        component={ReportsStack}
        options={{
          title: "Reports",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="chart-bar" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsStack}
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="cog-outline" color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
