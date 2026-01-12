// app/(tabs)/classes.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Alert,
  StyleSheet,
  Platform,
} from "react-native";
import { randomUUID } from "expo-crypto";

import Screen from "../../src/components/Screen";
import AppHeader from "../../src/components/AppHeader";
import { Colors } from "../../src/constants/colors";
import { useTenant } from "../../src/tenant/TenantContext";
import {
  addClass,
  deleteClass,
  listClasses,
  countClasses,
  ClassItem,
} from "../../src/db/classRepo";

const MAX_CLASSES = 5;

export default function ClassesScreen() {
  const { tenant } = useTenant();
  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [classes, setClasses] = useState<ClassItem[]>([]);

  if (!tenant) return null;

  const refresh = async () => {
    const rows = await listClasses(tenant.tenantId);
    setClasses(rows);
  };

  useEffect(() => {
    refresh();
  }, [tenant.tenantId]);

  const onAdd = async () => {
    const n = name.trim();
    const s = section.trim();

    if (!n) {
      Alert.alert("Missing", "Please enter class name (e.g., Grade 10).");
      return;
    }

    const existing = await countClasses(tenant.tenantId);
    if (existing >= MAX_CLASSES) {
      Alert.alert(
        "Limit reached",
        `You can create a maximum of ${MAX_CLASSES} classes on this device.`
      );
      return;
    }

    await addClass({
      id: randomUUID(),
      tenantId: tenant.tenantId,
      name: n,
      section: s ? s : null,
      createdAt: Date.now(),
    });

    setName("");
    setSection("");
    refresh();
  };

  const onDelete = (item: ClassItem) => {
    Alert.alert(
      "Delete class?",
      `${item.name}${item.section ? ` - ${item.section}` : ""}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteClass(item.id, tenant.tenantId);
            refresh();
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <AppHeader name={tenant.schoolName} address={tenant.schoolAddress} />

      <View style={styles.content}>
        <View>
          <Text style={styles.title}>Classes</Text>
          <Text style={styles.subtle}>
            {classes.length}/{MAX_CLASSES} used
          </Text>
        </View>

        <View style={styles.card}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Class name (e.g., Grade 10)"
            placeholderTextColor={Colors.muted}
            style={styles.input}
          />
          <TextInput
            value={section}
            onChangeText={setSection}
            placeholder="Section (optional, e.g., A)"
            placeholderTextColor={Colors.muted}
            style={styles.input}
          />

          <Pressable
            onPress={onAdd}
            disabled={classes.length >= MAX_CLASSES}
            style={({ pressed }) => [
              styles.primaryBtn,
              classes.length >= MAX_CLASSES && { opacity: 0.5 },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.primaryBtnText}>
              {classes.length >= MAX_CLASSES
                ? "Class limit reached"
                : "Add Class"}
            </Text>
          </Pressable>
        </View>

        <FlatList
          data={classes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 12, paddingTop: 4 }}
          renderItem={({ item }) => (
            <Pressable
              onLongPress={() => onDelete(item)}
              style={styles.card}
            >
              <Text style={styles.className}>
                {item.name} {item.section ? `(${item.section})` : ""}
              </Text>
              <Text style={styles.subtleSmall}>Long-press to delete</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.subtle}>No classes yet.</Text>
          }
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    padding: 16,
    gap: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  subtle: {
    marginTop: 4,
    color: Colors.textSecondary,
  },
  subtleSmall: {
    marginTop: 6,
    fontSize: 12,
    color: Colors.textSecondary,
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 2 },
      default: {},
    }),
  },

  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    color: Colors.textPrimary,
    backgroundColor: "#fff",
  },

  primaryBtn: {
    marginTop: 6,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "800",
  },

  className: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
});
