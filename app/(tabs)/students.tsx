// app/(tabs)/students.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Modal,
  ScrollView,
} from "react-native";
import { randomUUID } from "expo-crypto";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import Screen from "../../src/components/Screen";
import AppHeader from "../../src/components/AppHeader";
import { Colors } from "../../src/constants/colors";
import { useTenant } from "../../src/tenant/TenantContext";
import { usePremium } from "../../src/premium/usePremium";
import {
  createAndShareStudentTemplate,
  parseStudentWorkbook,
  StudentImportRow,
} from "../../src/premium/studentImport";
import { listClasses, ClassItem } from "../../src/db/classRepo";
import {
  addStudentAutoRoll,
  addStudentManualRoll,
  updateStudent,
  deleteStudent,
  listStudents,
  StudentItem,
  getNextRollNo,
  arrangeStudentsAlphabetically,
  arrangeStudentsReverseAlphabetically,
  applyStudentRollOrder,
  addStudentsBulk,
} from "../../src/db/studentRepo";

export default function StudentsScreen() {
  const { tenant } = useTenant();
  const { premiumEnabled, reload: reloadPremium } = usePremium(tenant?.tenantId ?? null);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");

  const [students, setStudents] = useState<StudentItem[]>([]);
  const [nextRoll, setNextRoll] = useState<number>(1);

  const [autoRoll, setAutoRoll] = useState<boolean>(true);
  const [manualRoll, setManualRoll] = useState<string>("");

  const [editingStudent, setEditingStudent] = useState<StudentItem | null>(null);

  // form fields
  const [name, setName] = useState("");
  const [dob, setDob] = useState(""); // YYYY-MM-DD
  const [parentName, setParentName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showRollManager, setShowRollManager] = useState(false);
  const [manualOrder, setManualOrder] = useState<StudentItem[]>([]);
  const [manualMode, setManualMode] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<StudentImportRow[]>([]);
  const [importFileName, setImportFileName] = useState("");
  const [importing, setImporting] = useState(false);

  const listRef = useRef<FlatList<StudentItem>>(null);
  const saveSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Refresh classes and premium entitlement whenever this tab becomes active.
  // This is important after Premium is activated from the Settings tab while
  // the Students tab remains mounted in the tab navigator.
  useFocusEffect(
    React.useCallback(() => {
      void Promise.all([refreshClasses(), reloadPremium()]);
    }, [tenant.tenantId, reloadPremium])
  );

  // Refresh students when class changes
  useEffect(() => {
    refreshStudents(selectedClassId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId]);

  useEffect(() => {
    return () => {
      if (saveSuccessTimerRef.current) {
        clearTimeout(saveSuccessTimerRef.current);
      }
    };
  }, []);

  const showSavedFeedback = () => {
    setSaveSuccess(true);

    if (saveSuccessTimerRef.current) {
      clearTimeout(saveSuccessTimerRef.current);
    }

    saveSuccessTimerRef.current = setTimeout(() => {
      setSaveSuccess(false);
      saveSuccessTimerRef.current = null;
    }, 1800);
  };

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
    try {

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
      if (autoRoll) {
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
      } else {
        const roll = Number(manualRoll);

        if (!roll || roll <= 0) {
          Alert.alert("Invalid roll number", "Please enter a valid positive number.");
          return;
        }

        await addStudentManualRoll({
          id: randomUUID(),
          tenantId: tenant.tenantId,
          classId: selectedClassId,
          rollNo: roll,
          name: n,
          dob: dob.trim() ? dob.trim() : null,
          parentName: parentName.trim() ? parentName.trim() : null,
          phone: phone.trim() ? phone.trim() : null,
          address: address.trim() ? address.trim() : null,
          createdAt: Date.now(),
        });
      }
    }

    clearForm();
    await refreshStudents(selectedClassId);
    showSavedFeedback();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Something went wrong.");
    }
  };

  const openRollManager = () => {
    setManualOrder([...students]);
    setManualMode(false);
    setShowRollManager((current) => !current);
  };

  const moveManualStudent = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= manualOrder.length) return;

    setManualOrder((current) => {
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const saveManualOrder = async () => {
    try {
      await applyStudentRollOrder(
        tenant.tenantId,
        selectedClassId,
        manualOrder.map((student) => student.id)
      );
      await refreshStudents(selectedClassId);
      setManualMode(false);
      setShowRollManager(false);
      Alert.alert("Done", "Roll numbers have been reassigned using your custom order.");
    } catch (e: any) {
      Alert.alert("Could not save order", e?.message ?? "Something went wrong.");
    }
  };

  const onArrangeReverseAlphabetically = () => {
    if (!selectedClassId || students.length <= 1) return;

    Alert.alert(
      "Arrange reverse alphabetically?",
      "Students will be sorted from Z to A and their roll numbers will be reassigned from 1 onward.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Arrange",
          onPress: async () => {
            try {
              await arrangeStudentsReverseAlphabetically(
                tenant.tenantId,
                selectedClassId
              );
              await refreshStudents(selectedClassId);
              setShowRollManager(false);
              Alert.alert("Done", "Students and roll numbers have been arranged from Z to A.");
            } catch (e: any) {
              Alert.alert("Could not arrange students", e?.message ?? "Something went wrong.");
            }
          },
        },
      ]
    );
  };

  const onArrangeAlphabetically = () => {
    if (!selectedClassId || students.length <= 1) return;

    Alert.alert(
      "Arrange alphabetically?",
      "Students will be sorted by name and their roll numbers will be reassigned from 1 onward. Existing attendance records will remain linked to the same students.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Arrange",
          onPress: async () => {
            try {
              await arrangeStudentsAlphabetically(tenant.tenantId, selectedClassId);
              await refreshStudents(selectedClassId);
              setShowRollManager(false);
              Alert.alert("Done", "Students and roll numbers have been arranged alphabetically.");
            } catch (e: any) {
              Alert.alert("Could not arrange students", e?.message ?? "Something went wrong.");
            }
          },
        },
      ]
    );
  };

  const openImportStudents = () => {
    if (!selectedClassId) {
      Alert.alert("No class selected", "Please create or select a class before importing students.");
      return;
    }

    if (!premiumEnabled) {
      Alert.alert(
        "Premium Feature",
        "Bulk student import from Excel or CSV is available with Premium. Activate Premium from Settings to continue."
      );
      return;
    }

    setImportRows([]);
    setImportFileName("");
    setImportOpen(true);
  };

  const chooseImportFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "text/csv",
          "text/comma-separated-values",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) return;
      const asset = result.assets[0];
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const parsed = parseStudentWorkbook(base64);

      if (parsed.length === 0) {
        Alert.alert("No student rows", "The selected file contains headings but no student records.");
        return;
      }

      setImportFileName(asset.name ?? "Selected file");
      setImportRows(parsed);
    } catch (e: any) {
      Alert.alert("Could not read file", e?.message ?? "Please use the sample Excel template.");
    }
  };

  const downloadImportTemplate = async () => {
    try {
      await createAndShareStudentTemplate();
    } catch (e: any) {
      Alert.alert("Could not create template", e?.message ?? "Please try again.");
    }
  };

  const confirmImportStudents = async () => {
    const validRows = importRows.filter((row) => row.errors.length === 0);
    const invalidCount = importRows.length - validRows.length;

    if (validRows.length === 0) {
      Alert.alert("Nothing to import", "Correct the file errors and choose the file again.");
      return;
    }

    const performImport = async () => {
      setImporting(true);
      try {
        const now = Date.now();
        await addStudentsBulk(
          validRows.map((row, index) => ({
            id: randomUUID(),
            tenantId: tenant.tenantId,
            classId: selectedClassId,
            rollNo: row.rollNo,
            name: row.name,
            dob: row.dob,
            parentName: row.parentName,
            phone: row.phone,
            address: row.address,
            createdAt: now + index,
          }))
        );

        await refreshStudents(selectedClassId);
        setImportOpen(false);
        setImportRows([]);
        Alert.alert(
          "Import complete",
          `${validRows.length} student${validRows.length === 1 ? "" : "s"} imported${
            invalidCount ? `; ${invalidCount} invalid row${invalidCount === 1 ? " was" : "s were"} skipped` : ""
          }.`
        );
      } catch (e: any) {
        Alert.alert("Import failed", e?.message ?? "No students were imported.");
      } finally {
        setImporting(false);
      }
    };

    if (invalidCount > 0) {
      Alert.alert(
        "Skip invalid rows?",
        `${validRows.length} valid rows will be imported and ${invalidCount} invalid rows will be skipped.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Import Valid Rows", onPress: performImport },
        ]
      );
      return;
    }

    await performImport();
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
    setSaveSuccess(false);
    setName("");
    setDob("");
    setParentName("");
    setPhone("");
    setAddress("");
    setEditingStudent(null);
    setManualRoll("");
  };

  const startEdit = (st: StudentItem) => {
    setSaveSuccess(false);
    setEditingStudent(st);
    setName(st.name ?? "");
    setDob(st.dob ? String(st.dob) : "");
    setParentName(st.parentName ? String(st.parentName) : "");
    setPhone(st.phone ? String(st.phone) : "");
    setAddress(st.address ? String(st.address) : "");

    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  };

  const cancelEdit = () => {
    setSaveSuccess(false);
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
        ref={listRef}
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

              {!editingStudent && (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
                    <Pressable onPress={() => setAutoRoll(!autoRoll)} style={{ padding: 4 }}>
                      <Ionicons
                        name={autoRoll ? "checkbox" : "square-outline"}
                        size={20}
                        color={Colors.primary}
                      />
                    </Pressable>
                    <Text style={{ marginLeft: 8, color: Colors.textPrimary }}>Auto Roll Number</Text>
                  </View>

                  {!autoRoll && (
                    <TextInput
                      value={manualRoll}
                      onChangeText={setManualRoll}
                      placeholder="Enter Roll Number"
                      placeholderTextColor={Colors.muted}
                      keyboardType="number-pad"
                      style={styles.input}
                    />
                  )}
                </>
              )}


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
                  saveSuccess && styles.savedBtn,
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.primaryBtnText}>
                  {saveSuccess ? "Saved ✓" : editingStudent ? "Save Changes" : "Save Student"}
                </Text>
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
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>
                  {selectedClass ? `Class: ${selectedClass.name}${selectedClass.section ? ` (${selectedClass.section})` : ""}` : "Students"}
                </Text>
                <Text style={styles.subtleSmall}>
                  {selectedClassId ? `${students.length} students` : ""}
                </Text>
              </View>

              {selectedClassId ? (
                <View style={styles.studentActions}>
                  <Pressable
                    onPress={openImportStudents}
                    style={({ pressed }) => [
                      styles.importBtn,
                      pressed && { opacity: 0.88 },
                    ]}
                  >
                    <Ionicons name={premiumEnabled ? "cloud-upload-outline" : "lock-closed-outline"} size={16} color={Colors.primary} />
                    <Text style={styles.arrangeBtnText}>Import</Text>
                  </Pressable>

                  {students.length > 1 ? (
                    <Pressable
                      onPress={openRollManager}
                      style={({ pressed }) => [
                        styles.arrangeBtn,
                        pressed && { opacity: 0.88 },
                      ]}
                    >
                      <Ionicons name="reorder-four" size={16} color={Colors.primary} />
                      <Text style={styles.arrangeBtnText}>Manage Rolls</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>

            {showRollManager ? (
              <View style={styles.rollManagerCard}>
                <Text style={styles.rollManagerTitle}>Manage Roll Numbers</Text>
                <Text style={styles.subtleSmall}>
                  Reordering changes roll numbers only. Attendance and reports remain linked by student ID.
                </Text>

                {!manualMode ? (
                  <View style={styles.rollOptionWrap}>
                    <Pressable
                      onPress={onArrangeAlphabetically}
                      style={({ pressed }) => [
                        styles.rollOptionBtn,
                        pressed && { opacity: 0.88 },
                      ]}
                    >
                      <Ionicons name="arrow-down" size={17} color={Colors.primary} />
                      <Text style={styles.rollOptionText}>Alphabetical A–Z</Text>
                    </Pressable>

                    <Pressable
                      onPress={onArrangeReverseAlphabetically}
                      style={({ pressed }) => [
                        styles.rollOptionBtn,
                        pressed && { opacity: 0.88 },
                      ]}
                    >
                      <Ionicons name="arrow-up" size={17} color={Colors.primary} />
                      <Text style={styles.rollOptionText}>Reverse Z–A</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        setManualOrder([...students]);
                        setManualMode(true);
                      }}
                      style={({ pressed }) => [
                        styles.rollOptionBtn,
                        pressed && { opacity: 0.88 },
                      ]}
                    >
                      <Ionicons name="options" size={17} color={Colors.primary} />
                      <Text style={styles.rollOptionText}>Manual Order</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <View style={styles.manualList}>
                      {manualOrder.map((student, index) => (
                        <View key={student.id} style={styles.manualRow}>
                          <Text style={styles.manualRollPreview}>{index + 1}</Text>
                          <Text style={styles.manualStudentName} numberOfLines={1}>
                            {student.name}
                          </Text>
                          <Pressable
                            disabled={index === 0}
                            onPress={() => moveManualStudent(index, -1)}
                            style={({ pressed }) => [
                              styles.moveBtn,
                              index === 0 && styles.moveBtnDisabled,
                              pressed && index !== 0 && { opacity: 0.75 },
                            ]}
                          >
                            <Ionicons name="chevron-up" size={18} color={Colors.primary} />
                          </Pressable>
                          <Pressable
                            disabled={index === manualOrder.length - 1}
                            onPress={() => moveManualStudent(index, 1)}
                            style={({ pressed }) => [
                              styles.moveBtn,
                              index === manualOrder.length - 1 && styles.moveBtnDisabled,
                              pressed &&
                                index !== manualOrder.length - 1 && { opacity: 0.75 },
                            ]}
                          >
                            <Ionicons name="chevron-down" size={18} color={Colors.primary} />
                          </Pressable>
                        </View>
                      ))}
                    </View>

                    <View style={styles.actionRow}>
                      <Pressable
                        onPress={() => setManualMode(false)}
                        style={({ pressed }) => [
                          styles.secondaryBtn,
                          pressed && { opacity: 0.9 },
                        ]}
                      >
                        <Text style={styles.secondaryBtnText}>Back</Text>
                      </Pressable>
                      <Pressable
                        onPress={saveManualOrder}
                        style={({ pressed }) => [
                          styles.primaryBtn,
                          styles.manualSaveBtn,
                          pressed && { opacity: 0.9 },
                        ]}
                      >
                        <Text style={styles.primaryBtnText}>Save Order</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            ) : null}
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

      <Modal visible={importOpen} transparent animationType="slide" onRequestClose={() => !importing && setImportOpen(false)}>
        <View style={styles.importOverlay}>
          <View style={styles.importModal}>
            <View style={styles.importHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.importTitle}>Import Students</Text>
                <Text style={styles.subtleSmall}>
                  {selectedClass ? `${selectedClass.name}${selectedClass.section ? ` (${selectedClass.section})` : ""}` : "Selected class"}
                </Text>
              </View>
              <Pressable disabled={importing} onPress={() => setImportOpen(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>

            <Text style={styles.importHelp}>
              Excel columns must match the Add Student form: Roll Number, Student's Name, DOB, Parent's Name, Contact Number, Address.
            </Text>

            <View style={styles.importActionRow}>
              <Pressable onPress={downloadImportTemplate} style={({ pressed }) => [styles.secondaryImportBtn, pressed && { opacity: 0.88 }]}>
                <Ionicons name="download-outline" size={17} color={Colors.primary} />
                <Text style={styles.secondaryImportText}>Sample Excel</Text>
              </Pressable>
              <Pressable onPress={chooseImportFile} style={({ pressed }) => [styles.primaryImportBtn, pressed && { opacity: 0.88 }]}>
                <Ionicons name="folder-open-outline" size={17} color="#fff" />
                <Text style={styles.primaryBtnText}>Choose File</Text>
              </Pressable>
            </View>

            {!!importFileName && <Text style={styles.fileName}>File: {importFileName}</Text>}

            {importRows.length > 0 ? (
              <>
                <View style={styles.importSummary}>
                  <Text style={styles.summaryGood}>{importRows.filter((r) => r.errors.length === 0).length} valid</Text>
                  <Text style={styles.summaryBad}>{importRows.filter((r) => r.errors.length > 0).length} invalid</Text>
                </View>

                <ScrollView style={styles.previewList} contentContainerStyle={{ gap: 8 }}>
                  {importRows.map((row) => (
                    <View key={row.sourceRow} style={[styles.previewRow, row.errors.length > 0 && styles.previewRowInvalid]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.previewName}>
                          Row {row.sourceRow}: {row.name || "Missing student name"}
                        </Text>
                        <Text style={styles.previewMeta}>
                          Roll: {row.rollNo ?? "Auto"} • DOB: {row.dob ?? "—"} • Contact: {row.phone ?? "—"}
                        </Text>
                        {row.errors.length > 0 ? <Text style={styles.previewError}>{row.errors.join(" • ")}</Text> : null}
                      </View>
                      <Ionicons
                        name={row.errors.length ? "alert-circle" : "checkmark-circle"}
                        size={20}
                        color={row.errors.length ? "#B42318" : "#067647"}
                      />
                    </View>
                  ))}
                </ScrollView>

                <Pressable
                  disabled={importing || importRows.every((row) => row.errors.length > 0)}
                  onPress={confirmImportStudents}
                  style={({ pressed }) => [
                    styles.confirmImportBtn,
                    (importing || importRows.every((row) => row.errors.length > 0)) && { opacity: 0.5 },
                    pressed && { opacity: 0.88 },
                  ]}
                >
                  <Text style={styles.primaryBtnText}>{importing ? "Importing..." : "Import Valid Students"}</Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.importEmpty}>
                <Ionicons name="document-text-outline" size={28} color={Colors.muted} />
                <Text style={styles.subtle}>Download the sample template, complete it, then choose the Excel or CSV file.</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
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
  savedBtn: {
    backgroundColor: "#16A34A",
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

  arrangeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#C7D2FE",
    backgroundColor: Colors.primarySoft,
  },
  arrangeBtnText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: "900",
  },

  rollManagerCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: 10,
  },
  rollManagerTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: Colors.textPrimary,
  },
  rollOptionWrap: {
    gap: 8,
  },
  rollOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#C7D2FE",
    backgroundColor: Colors.primarySoft,
  },
  rollOptionText: {
    color: Colors.primary,
    fontWeight: "900",
  },
  manualList: {
    gap: 7,
  },
  manualRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#fff",
  },
  manualRollPreview: {
    width: 28,
    textAlign: "center",
    fontWeight: "900",
    color: Colors.primary,
  },
  manualStudentName: {
    flex: 1,
    color: Colors.textPrimary,
    fontWeight: "800",
  },
  moveBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#C7D2FE",
    backgroundColor: Colors.primarySoft,
  },
  moveBtnDisabled: {
    opacity: 0.3,
  },
  manualSaveBtn: {
    flex: 1,
    marginTop: 0,
  },

  studentActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  importBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#C7D2FE",
    backgroundColor: Colors.primarySoft,
  },

  importOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  importModal: {
    maxHeight: "88%",
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    gap: 12,
  },
  importHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  importTitle: { fontSize: 18, fontWeight: "900", color: Colors.textPrimary },
  modalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#F8FAFC",
  },
  importHelp: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },
  importActionRow: { flexDirection: "row", gap: 10 },
  secondaryImportBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#C7D2FE",
    backgroundColor: Colors.primarySoft,
  },
  secondaryImportText: { color: Colors.primary, fontWeight: "900" },
  primaryImportBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 12,
    borderRadius: 13,
    backgroundColor: Colors.primary,
  },
  fileName: { color: Colors.textPrimary, fontSize: 12, fontWeight: "800" },
  importSummary: { flexDirection: "row", gap: 10 },
  summaryGood: { color: "#067647", fontWeight: "900" },
  summaryBad: { color: "#B42318", fontWeight: "900" },
  previewList: { maxHeight: 330 },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ABEFC6",
    backgroundColor: "#ECFDF3",
  },
  previewRowInvalid: { borderColor: "#FECACA", backgroundColor: "#FEF2F2" },
  previewName: { color: Colors.textPrimary, fontWeight: "900" },
  previewMeta: { marginTop: 3, color: Colors.textSecondary, fontSize: 11 },
  previewError: { marginTop: 4, color: "#B42318", fontSize: 11, fontWeight: "800" },
  confirmImportBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
  },
  importEmpty: {
    paddingVertical: 24,
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#F8FAFC",
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
