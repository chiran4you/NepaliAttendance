// app/(tabs)/students.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Alert,
  Linking,
  StyleSheet,
  Platform,
} from "react-native";
import { randomUUID } from "expo-crypto";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

import Screen from "../../src/components/Screen";
import AppHeader from "../../src/components/AppHeader";
import { Colors } from "../../src/constants/colors";
import { useTenant } from "../../src/tenant/TenantContext";
import { listClasses, ClassItem } from "../../src/db/classRepo";
import {
  addStudentAutoRoll,
  updateStudent,
  deleteStudent,
  listStudents,
  StudentItem,
  getNextRollNo,
} from "../../src/db/studentRepo";

export default function StudentsScreen() {
  const { tenant } = useTenant();

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");

  const [students, setStudents] = useState<StudentItem[]>([]);
  const [nextRoll, setNextRoll] = useState<number>(1);

  const [editingStudent, setEditingStudent] = useState<StudentItem | null>(null);

  // form fields
  const [name, setName] = useState("");
  const [dob, setDob] = useState(""); // YYYY-MM-DD
  const [parentName, setParentName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");

  if (!tenant) return null;

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId),
    [classes, selectedClassId]
  );

  const refreshClasses = async () => {
    const rows = await listClasses(tenant.tenantId);
    setClasses(rows);

    if (!selectedClassId && rows.length > 0) setSelectedClassId(rows[0].id);
    if (selectedClassId && !rows.some((c) => c.id === selectedClassId)) {
      setSelectedClassId(rows[0]?.id ?? "");
    }
  };

  const refreshStudents = async (classId: string) => {
    if (!classId) {
      setStudents([]);
      setNextRoll(1);
      return;
    }
    const rows = await listStudents(tenant.tenantId, classId);
    setStudents(rows);
    setNextRoll(await getNextRollNo(tenant.tenantId, classId));
  };

  // Refresh classes whenever this tab becomes active
  useFocusEffect(
    React.useCallback(() => {
      refreshClasses();
    }, [tenant.tenantId])
  );

  // Refresh students when class changes
  useEffect(() => {
    refreshStudents(selectedClassId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  const validateDob = (d: string) => {
    if (!d.trim()) return true; // optional
    return /^\d{4}-\d{2}-\d{2}$/.test(d.trim());
  };

  const onAddStudent = async () => {
    if (!selectedClassId) {
      Alert.alert("No class selected", "Please create/select a class first.");
      return;
    }

    const n = name.trim();
    if (!n) {
      Alert.alert("Missing", "Please enter student's name.");
      return;
    }

    if (!validateDob(dob)) {
      Alert.alert("Invalid DOB", "Use format YYYY-MM-DD (example: 2012-05-21).");
      return;
    }

    if (editingStudent) {
      await updateStudent({
        id: editingStudent.id,
        tenantId: tenant.tenantId,
        name: n,
        dob: dob.trim() ? dob.trim() : null,
        parentName: parentName.trim() ? parentName.trim() : null,
        phone: phone.trim() ? phone.trim() : null,
        address: address.trim() ? address.trim() : null,
      });
    } else {
      await addStudentAutoRoll({
        id: randomUUID(),
        tenantId: tenant.tenantId,
        classId: selectedClassId,
        name: n,
        dob: dob.trim() ? dob.trim() : null,
        parentName: parentName.trim() ? parentName.trim() : null,
        phone: phone.trim() ? phone.trim() : null,
        address: address.trim() ? address.trim() : null,
        createdAt: Date.now(),
      });
    }

    clearForm();
    await refreshStudents(selectedClassId);
  };

  const onDeleteStudent = (s: StudentItem) => {
    Alert.alert("Delete student?", `${s.rollNo}. ${s.name}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (editingStudent?.id === s.id) cancelEdit();
          await deleteStudent(s.id, tenant.tenantId);
          await refreshStudents(selectedClassId);
        },
      },
    ]);
  };

  const onCall = async (num?: string | null) => {
    const p = (num ?? "").trim();
    if (!p) return Alert.alert("No number", "This student has no contact number.");
    const url = `tel:${p}`;
    const ok = await Linking.canOpenURL(url);
    if (!ok) return Alert.alert("Not supported", "Calling is not supported on this device.");
    Linking.openURL(url);
  };

  const clearForm = () => {
    setName("");
    setDob("");
    setParentName("");
    setPhone("");
    setAddress("");
    setEditingStudent(null);
  };

  const startEdit = (st: StudentItem) => {
    setEditingStudent(st);
    setName(st.name ?? "");
    setDob(st.dob ? String(st.dob) : "");
    setParentName(st.parentName ? String(st.parentName) : "");
    setPhone(st.phone ? String(st.phone) : "");
    setAddress(st.address ? String(st.address) : "");
  };

  const cancelEdit = () => {
    setEditingStudent(null);
    setName("");
    setDob("");
    setParentName("");
    setPhone("");
    setAddress("");
  };

  const renderClassChip = (c: ClassItem) => {
    const active = c.id === selectedClassId;
    return (
      <Pressable
        key={c.id}
        onPress={() => setSelectedClassId(c.id)}
        style={({ pressed }) => [
          styles.chip,
          active ? styles.chipActive : styles.chipInactive,
          pressed && { opacity: 0.9 },
        ]}
      >
        <Text style={[styles.chipText, active && styles.chipTextActive]}>
          {c.name}
          {c.section ? ` (${c.section})` : ""}
        </Text>
      </Pressable>
    );
  };

  return (
    <Screen>
      <AppHeader name={tenant.schoolName} address={tenant.schoolAddress} />

      <FlatList
        data={students}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerArea}>
            <Text style={styles.title}>Students</Text>

            {/* Class selector */}
            <View style={styles.section}>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionTitle}>Select Class</Text>
                {!!selectedClass && (
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>
                      Next roll: <Text style={styles.pillTextStrong}>{nextRoll}</Text>
                    </Text>
                  </View>
                )}
              </View>

              {classes.length === 0 ? (
                <View style={styles.infoCard}>
                  <Text style={styles.subtle}>
                    No classes yet. Go to the Classes tab and add a class first.
                  </Text>
                </View>
              ) : (
                <View style={styles.chipWrap}>{classes.map(renderClassChip)}</View>
              )}
            </View>

            {/* Add student form */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>{editingStudent ? "Edit Student" : "Add Student"}</Text>
                <Pressable
                  onPress={editingStudent ? cancelEdit : clearForm}
                  style={({ pressed }) => [
                    styles.ghostBtn,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.ghostBtnText}>{editingStudent ? "Cancel" : "Clear"}</Text>
                </Pressable>
              </View>

              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Student's Name"
                placeholderTextColor={Colors.muted}
                style={styles.input}
              />

              <View style={styles.row}>
                <TextInput
                  value={dob}
                  onChangeText={setDob}
                  placeholder="DOB (YYYY-MM-DD)"
                  placeholderTextColor={Colors.muted}
                  style={[styles.input, styles.flex1]}
                />
                <Text style={styles.helper}>Optional</Text>
              </View>

              <TextInput
                value={parentName}
                onChangeText={setParentName}
                placeholder="Parent's Name"
                placeholderTextColor={Colors.muted}
                style={styles.input}
              />

              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="Contact number"
                placeholderTextColor={Colors.muted}
                keyboardType="phone-pad"
                style={styles.input}
              />

              <TextInput
                value={address}
                onChangeText={setAddress}
                placeholder="Address"
                placeholderTextColor={Colors.muted}
                style={styles.input}
              />

              <Pressable
                onPress={onAddStudent}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.primaryBtnText}>{editingStudent ? "Save Changes" : "Save Student"}</Text>
              </Pressable>

              {editingStudent ? (
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
                    onPress={() => onDeleteStudent(editingStudent)}
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

            {/* List header */}
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>
                {selectedClass ? `Class: ${selectedClass.name}${selectedClass.section ? ` (${selectedClass.section})` : ""}` : "Students"}
              </Text>
              <Text style={styles.subtleSmall}>
                {selectedClassId ? `${students.length} students` : ""}
              </Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onLongPress={() => {
              Alert.alert("Student options", `${item.rollNo}. ${item.name}`, [
                { text: "Edit", onPress: () => startEdit(item) },
                { text: "Delete", style: "destructive", onPress: () => onDeleteStudent(item) },
                { text: "Cancel", style: "cancel" },
              ]);
            }}
            style={({ pressed }) => [
              styles.studentCard,
              pressed && { opacity: 0.92 },
            ]}
          >
            <View style={styles.studentTop}>
              <View style={styles.studentTitleWrap}>
                <Text style={styles.studentName} numberOfLines={1}>
                  {item.rollNo}. {item.name}
                </Text>

                {!!item.parentName && (
                  <Text style={styles.meta} numberOfLines={1}>
                    Parent: {item.parentName}
                  </Text>
                )}
              </View>

              <Pressable
                onPress={() => onCall(item.phone)}
                style={({ pressed }) => [
                  styles.callBtn,
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Ionicons name="call" size={18} color="#fff" />
              </Pressable>
            </View>

            <View style={styles.details}>
              {!!item.dob && <Text style={styles.detailText}>DOB: {item.dob}</Text>}
              {!!item.address && (
                <Text style={styles.detailText} numberOfLines={2}>
                  Address: {item.address}
                </Text>
              )}
              {!item.dob && !item.address ? (
                <Text style={styles.subtleSmall}>No extra details</Text>
              ) : null}
            </View>

            <Text style={styles.hint}>Long-press to delete</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>
              {selectedClassId ? "No students yet" : "Select a class"}
            </Text>
            <Text style={styles.subtle}>
              {selectedClassId
                ? "Add students to this class using the form above."
                : "Choose a class to view students."}
            </Text>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: 16,
    paddingBottom: 28,
    gap: 12,
  },

  headerArea: {
    gap: 12,
    paddingBottom: 4,
  },

  title: {
    fontSize: 22,
    fontWeight: "800",
    color: Colors.textPrimary,
  },

  section: { gap: 10 },

  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.textPrimary,
  },

  subtle: {
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  subtleSmall: {
    color: Colors.textSecondary,
    fontSize: 12,
  },

  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  pill: {
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: "#C7D2FE",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "700",
  },
  pillTextStrong: {
    color: Colors.primary,
    fontWeight: "900",
  },

  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipInactive: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.primarySoft,
    borderColor: "#C7D2FE",
  },
  chipText: {
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  chipTextActive: { color: Colors.primary },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
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

  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: Colors.textPrimary,
  },

  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: Colors.textPrimary,
    backgroundColor: "#fff",
  },

  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  flex1: { flex: 1 },
  helper: { color: Colors.muted, fontSize: 12, fontWeight: "700" },

  primaryBtn: {
    marginTop: 4,
    backgroundColor: Colors.primary,
    borderRadius: 14,
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
    fontWeight: "900",
  },

  ghostBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#fff",
  },
  ghostBtnText: {
    fontWeight: "800",
    color: Colors.textSecondary,
    fontSize: 12,
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

  studentCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
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

  studentTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  studentTitleWrap: { flex: 1, gap: 3 },
  studentName: {
    fontSize: 16,
    fontWeight: "900",
    color: Colors.textPrimary,
  },
  meta: {
    fontSize: 12.5,
    color: Colors.textSecondary,
  },

  callBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.16,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 3 },
      default: {},
    }),
  },

  details: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 4,
  },
  detailText: {
    color: Colors.textPrimary,
    lineHeight: 18,
  },

  hint: {
    marginTop: 2,
    color: Colors.textSecondary,
    fontSize: 12,
  },

  emptyWrap: { paddingTop: 12, gap: 6 },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: Colors.textPrimary,
  },
});
