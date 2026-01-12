import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ClassesScreen from "../../screens/classes/ClassesScreen";

const Stack = createNativeStackNavigator();

export default function ClassesStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Classes" component={ClassesScreen} />
    </Stack.Navigator>
  );
}
