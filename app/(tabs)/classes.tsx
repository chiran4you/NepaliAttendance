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
  updateClass,
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
  const [editing, setEditing] = useState<ClassItem | null>(null);

  if (!tenant) return null;

  const refresh = async () => {
    const rows = await listClasses(tenant.tenantId);
    setClasses(rows);
  };

  useEffect(() => {
    refresh();
  }, [tenant.tenantId]);

  const startEdit = (item: ClassItem) => {
    setEditing(item);
    setName(item.name ?? "");
    setSection(item.section ? String(item.section) : "");
  };

  const cancelEdit = () => {
    setEditing(null);
    setName("");
    setSection("");
  };

  const onAddOrSave = async () => {
    const n = name.trim();
    const s = section.trim();

    if (!n) {
      Alert.alert("Missing", "Please enter class name (e.g., Grade 10).");
      return;
    }

    // EDIT MODE => UPDATE
    if (editing) {
      await updateClass({
        id: editing.id,
        tenantId: tenant.tenantId,
        name: n,
        section: s ? s : null,
      });
      cancelEdit();
      refresh();
      return;
    }

    // ADD MODE => INSERT (with limit check)
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

  const confirmDelete = (item: ClassItem) => {
    Alert.alert("Delete class?", `${item.name}${item.section ? ` - ${item.section}` : ""}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          // if you're deleting the class currently being edited, exit edit mode
          if (editing?.id === item.id) cancelEdit();

          await deleteClass(item.id, tenant.tenantId);
          refresh();
        },
      },
    ]);
  };

  const onLongPressItem = (item: ClassItem) => {
    Alert.alert(
      "Class options",
      `${item.name}${item.section ? ` - ${item.section}` : ""}`,
      [
        { text: "Edit", onPress: () => startEdit(item) },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => confirmDelete(item),
        },
        { text: "Cancel", style: "cancel" },
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
          {editing ? (
            <View style={styles.editBanner}>
              <Text style={styles.editBannerText}>
                Editing:{" "}
                <Text style={{ fontWeight: "900", color: Colors.textPrimary }}>
                  {editing.name}
                  {editing.section ? ` (${editing.section})` : ""}
                </Text>
              </Text>
            </View>
          ) : null}

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
            onPress={onAddOrSave}
            disabled={!editing && classes.length >= MAX_CLASSES}
            style={({ pressed }) => [
              styles.primaryBtn,
              !editing && classes.length >= MAX_CLASSES && { opacity: 0.5 },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.primaryBtnText}>
              {editing
                ? "Save Changes"
                : classes.length >= MAX_CLASSES
                  ? "Class limit reached"
                  : "Add Class"}
            </Text>
          </Pressable>

          {/* Attractive, tight action row when editing */}
          {editing ? (
            <View style={styles.actionRow}>
              <Pressable
                onPress={cancelEdit}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.secondaryBtnText}>Cancel Edit</Text>
              </Pressable>

              <Pressable
                onPress={() => confirmDelete(editing)}
                style={({ pressed }) => [
                  styles.dangerBtn,
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.dangerBtnText}>Delete</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <FlatList
          data={classes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 12, paddingTop: 4 }}
          renderItem={({ item }) => (
            <Pressable onLongPress={() => onLongPressItem(item)} style={styles.card}>
              <Text style={styles.className}>
                {item.name} {item.section ? `(${item.section})` : ""}
              </Text>
              <Text style={styles.subtleSmall}>Long-press for options</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.subtle}>No classes yet.</Text>}
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

  editBanner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#C7D2FE",
    backgroundColor: "#EEF2FF",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  editBannerText: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.textSecondary,
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

  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#F8FAFC",
  },
  secondaryBtnText: {
    fontWeight: "900",
    color: Colors.textPrimary,
  },

  dangerBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
  },
  dangerBtnText: {
    fontWeight: "900",
    color: "#B42318",
  },

  className: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
});
